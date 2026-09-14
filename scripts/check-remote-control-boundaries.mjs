import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isTestSource, moduleSpecifiers } from "./workspace-source.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const REMOTE_ROOTS = [
  "apps/mobile",
  "apps/desktop-electron",
  "packages/contracts/remote-control-contracts",
  "packages/transport/remote-control-client",
  "packages/server/remote-control-direct-server",
  "packages/pi-runtime/pi-runtime-remote-control",
];

const BRIDGE_ALLOWED_WORKBENCH_DEPENDENCIES = new Set([
  "@workbench/pi-rpc-client",
  "@workbench/remote-control-contracts",
  "@workbench/runtime-transport-client",
]);

function workspacePackageName(specifier) {
  if (!specifier.startsWith("@workbench/")) return undefined;
  return specifier.split("/").slice(0, 2).join("/");
}

function productionDependencies(manifest) {
  return Object.keys({
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  });
}

function manifestViolations(filename, manifest) {
  const violations = [];
  const dependencies = productionDependencies(manifest);
  const reject = (dependency, reason) => violations.push(`${filename}: ${dependency} ${reason}`);

  for (const dependency of dependencies) {
    const workbenchName = workspacePackageName(dependency);
    if (filename === "packages/contracts/remote-control-contracts/package.json") {
      if (
        dependency === "react" ||
        dependency.startsWith("@types/") ||
        dependency.startsWith("node:")
      ) {
        reject(dependency, "is not allowed in the runtime-neutral contract package");
      }
      if (workbenchName && workbenchName !== "@workbench/core-contracts") {
        reject(dependency, "is outside the contract package dependency boundary");
      }
    }

    if (filename === "packages/transport/remote-control-client/package.json") {
      if (/^(?:expo|react(?:-native)?|@react-native)/u.test(dependency)) {
        reject(dependency, "belongs to the mobile app adapter, not the pure client");
      }
      if (workbenchName && workbenchName !== "@workbench/remote-control-contracts") {
        reject(dependency, "is outside the pure remote client boundary");
      }
    }

    if (filename === "packages/server/remote-control-direct-server/package.json") {
      if (
        dependency === "pg" ||
        /(?:oauth|oidc|postgres|notification|push|relay|auth-session|web-browser)/iu.test(
          dependency,
        )
      ) {
        reject(dependency, "is a forbidden central-service dependency in the direct gateway");
      }
      if (workbenchName && workbenchName !== "@workbench/remote-control-contracts") {
        reject(dependency, "is outside the direct gateway dependency boundary");
      }
    }

    if (filename === "packages/pi-runtime/pi-runtime-remote-control/package.json") {
      if (workbenchName && !BRIDGE_ALLOWED_WORKBENCH_DEPENDENCIES.has(workbenchName)) {
        reject(dependency, "is not an approved public desktop-bridge dependency");
      }
    }

    if (filename === "apps/mobile/package.json") {
      if (/(?:oauth|oidc|notification|push|auth-session|web-browser|relay)/iu.test(dependency)) {
        reject(dependency, "is a forbidden account, push, or central-service dependency");
      }
      if (
        workbenchName &&
        /(?:^@workbench\/ui|shell|agent-runtime-client|pi-runtime-client|pi-conversation-adapter|extension|toolbox|runtime-contracts|terminal|browser)/u.test(
          workbenchName,
        )
      ) {
        reject(dependency, "is a forbidden desktop capability in the mobile app");
      }
    }
  }
  return violations;
}

function sourceViolations(filename, source) {
  const violations = [];
  const specifiers = moduleSpecifiers(source, filename);
  const add = (message) => violations.push(`${filename}: ${message}`);

  for (const specifier of specifiers) {
    if (/^@workbench\/[^/]+\/(?:src|lib|internal)(?:\/|$)/u.test(specifier)) {
      add(`forbidden deep import ${specifier}`);
    }
    if (
      filename.startsWith("apps/mobile/") &&
      /@workbench\/(?:ui(?:-|\/|$)|shell|agent-runtime-client|pi-runtime-client|pi-conversation-adapter|extension|pi-ui-toolbox|runtime-contracts|terminal|browser)/u.test(
        specifier,
      )
    ) {
      add(`forbidden mobile import ${specifier}`);
    }
    if (
      filename.startsWith("apps/mobile/") &&
      /(?:oauth|oidc|notification|auth-session|web-browser|relay)/iu.test(specifier)
    ) {
      add(`forbidden mobile central-service import ${specifier}`);
    }
    if (
      filename.startsWith("packages/server/remote-control-direct-server/") &&
      /(?:oauth|oidc|postgres|notification|push|relay|auth-session|web-browser|@workbench\/(?:pi-|runtime-|agent-runtime|toolbox|terminal|browser|ui|shell))/iu.test(
        specifier,
      )
    ) {
      add(`forbidden direct-gateway import ${specifier}`);
    }
    if (
      filename.startsWith("packages/contracts/remote-control-contracts/") &&
      /^(?:react|node:|@workbench\/(?!core-contracts))/u.test(specifier)
    ) {
      add(`forbidden contract import ${specifier}`);
    }
    if (
      filename.startsWith("packages/pi-runtime/pi-runtime-remote-control/") &&
      (specifier.includes("/apps/") ||
        specifier.startsWith("apps/") ||
        /(?:streams\/stream-hub|session-registry)/u.test(specifier))
    ) {
      add(`forbidden private bridge import ${specifier}`);
    }
  }

  if (
    filename.startsWith("packages/contracts/remote-control-contracts/") &&
    /\bmethod\s*:\s*string\b/u.test(source) &&
    /\bpayload\??\s*:\s*unknown\b/u.test(source)
  ) {
    add("catch-all method/payload wire contract is forbidden");
  }

  if (
    (filename.startsWith("packages/server/remote-control-direct-server/") ||
      /(?:direct-protocol|direct-profile|profiles\.ts$)/u.test(filename)) &&
    !filename.endsWith("/lib/redaction.ts") &&
    /\b(?:accountId|relayOrigin|accessToken|refreshToken|ticket)\b/u.test(source)
  ) {
    add("account, Relay, or bearer credential field is forbidden in a direct-access owner");
  }

  if (
    (filename.startsWith("apps/mobile/src/") ||
      filename === "apps/desktop-electron/src/desktop-remote-control.cjs" ||
      filename.startsWith("packages/pi-runtime/pi-runtime-remote-control/src/")) &&
    /\b(?:accountId|relayOrigin|accessToken|refreshToken|leaseGeneration|ticket)\b/u.test(source)
  ) {
    add("account, Relay, ticket, or lease state is forbidden in the direct product path");
  }

  if (
    filename.startsWith("packages/server/remote-control-direct-server/") &&
    /(?:https?:\/\/(?:8\.8\.8\.8|example\.com)|wss?:\/\/(?:8\.8\.8\.8|example\.com))/iu.test(source)
  ) {
    add("public endpoint literal is forbidden in the direct gateway");
  }

  return violations;
}

export function remoteControlBoundaryViolations({ manifests = new Map(), sources = new Map() }) {
  return [
    ...[...manifests].flatMap(([filename, manifest]) => manifestViolations(filename, manifest)),
    ...[...sources].flatMap(([filename, source]) => sourceViolations(filename, source)),
    ...packageCycleViolations(manifests),
  ].sort();
}

function packageCycleViolations(manifests) {
  const names = new Map(
    [...manifests]
      .filter(([, manifest]) => typeof manifest.name === "string")
      .map(([filename, manifest]) => [manifest.name, filename]),
  );
  const edges = new Map(
    [...manifests]
      .filter(([, manifest]) => typeof manifest.name === "string")
      .map(([, manifest]) => [
        manifest.name,
        productionDependencies(manifest).filter((dependency) => names.has(dependency)),
      ]),
  );
  const violations = new Set();
  const visiting = new Set();
  const visited = new Set();
  const visit = (name, pathNames) => {
    if (visiting.has(name)) {
      const start = pathNames.indexOf(name);
      const cycle = [...pathNames.slice(start), name];
      violations.add(`remote package dependency cycle: ${cycle.join(" -> ")}`);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of edges.get(name) ?? []) visit(dependency, [...pathNames, name]);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of edges.keys()) visit(name, []);
  return [...violations];
}

async function sourceFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(filename)));
    else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !isTestSource(filename)
    ) {
      files.push(filename);
    }
  }
  return files;
}

export async function checkRemoteControlBoundaries(repositoryRoot = REPOSITORY_ROOT) {
  const manifests = new Map();
  const sources = new Map();
  for (const root of REMOTE_ROOTS) {
    const directory = path.join(repositoryRoot, root);
    try {
      manifests.set(
        `${root}/package.json`,
        JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")),
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    for (const filename of await sourceFiles(directory)) {
      const relative = path.relative(repositoryRoot, filename).split(path.sep).join("/");
      sources.set(relative, await readFile(filename, "utf8"));
    }
  }
  const violations = remoteControlBoundaryViolations({ manifests, sources });
  if (violations.length > 0) {
    throw new Error(
      `Remote-control boundary violations:\n${violations.map((item) => `- ${item}`).join("\n")}`,
    );
  }
}

const invokedFile = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
if (invokedFile === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    await checkRemoteControlBoundaries();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
