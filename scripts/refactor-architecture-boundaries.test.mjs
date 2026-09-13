import { builtinModules } from "node:module";
import { moduleSpecifiers, parseWorkspaceSource } from "./workspace-source.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceFile = /\.(?:[cm]?[jt]sx?|css)$/u;
const ignoredDirectories = new Set([".next", "build", "coverage", "dist", "node_modules", "out"]);

function filesUnder(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return ignoredDirectories.has(entry.name) ? [] : filesUnder(absolute);
      }
      return [absolute];
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function workspaceDirectories() {
  return ["apps", "packages"].flatMap((root) =>
    filesUnder(path.join(repositoryRoot, root))
      .filter((file) => path.basename(file) === "package.json")
      .map((manifest) => path.dirname(manifest)),
  );
}

const workspaces = workspaceDirectories();
const productionSources = workspaces.flatMap((workspace) =>
  filesUnder(path.join(workspace, "src")).filter((file) => sourceFile.test(file)),
);

function repositoryRelative(file) {
  return path.relative(repositoryRoot, file).replaceAll(path.sep, "/");
}

function assertSourcesDoNotMatch(pattern, message) {
  for (const file of productionSources) {
    assert.equal(
      pattern.test(readFileSync(file, "utf8")),
      false,
      `${message}: ${repositoryRelative(file)}`,
    );
  }
}

test("refactored UI sources contain no retired visual overrides", () => {
  assertSourcesDoNotMatch(/var\(----/u, "four-hyphen token reference");
  assertSourcesDoNotMatch(/active:translate-y-0!/u, "default Button motion override");
});

test("retired component-extension and right Panel APIs cannot return", () => {
  assertSourcesDoNotMatch(
    /component-extensions|component-extension-installation|installable-extensions|useInstalledComponentExtensions/u,
    "retired component-extension API",
  );
  assertSourcesDoNotMatch(/panel\.right/u, "retired right Panel slot");

  for (const workspace of workspaces) {
    const manifestPath = path.join(workspace, "package.json");
    const manifest = readFileSync(manifestPath, "utf8");
    assert.doesNotMatch(
      manifest,
      /component-extensions|component-extension-installation/u,
      `retired component-extension manifest entry: ${repositoryRelative(manifestPath)}`,
    );
  }
});

test("the application has one Headless Agent Runtime stack and no AI SDK chat runtime", () => {
  assertSourcesDoNotMatch(/\bfrom\s*["'](?:ai|@ai-sdk\/react)["']/u, "AI SDK import");
  assertSourcesDoNotMatch(/\buseChat\s*\(/u, "second chat runtime hook");

  for (const workspace of workspaces) {
    const manifestPath = path.join(workspace, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    };
    assert.equal(
      Object.hasOwn(dependencies, "ai") || Object.hasOwn(dependencies, "@ai-sdk/react"),
      false,
      `AI SDK dependency: ${repositoryRelative(manifestPath)}`,
    );
  }
});

// Follow real module edges, including lib and type-only imports: package names alone
// cannot distinguish a browser-safe subpath from the server subpath of one package.
const apiDirectory = path.join(repositoryRoot, "packages/transport/api");
const workspaceManifests = new Map(
  workspaces.map((directory) => {
    const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    return [manifest.name, { directory, manifest }];
  }),
);

function exportedSource(value) {
  if (typeof value === "string") return value;
  return value?.types ?? value?.import ?? value?.default;
}

function resolveBoundarySource(importer, specifier) {
  if (specifier.startsWith(".")) {
    const target = path.resolve(path.dirname(importer), specifier);
    for (const candidate of [
      target,
      `${target}.ts`,
      `${target}.tsx`,
      path.join(target, "index.ts"),
    ]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    assert.fail(`Unresolved API dependency: ${specifier} from ${repositoryRelative(importer)}`);
  }
  const name = specifier.split("/").slice(0, 2).join("/");
  const owner = workspaceManifests.get(name);
  assert.ok(owner, `Unexpected external API dependency: ${specifier}`);
  const key = specifier === name ? "." : `.${specifier.slice(name.length)}`;
  const target = exportedSource(owner.manifest.exports[key]);
  assert.equal(typeof target, "string", `Missing explicit export: ${specifier}`);
  return path.resolve(owner.directory, target);
}

function assertApiClosure(entry, server) {
  const pending = [path.join(apiDirectory, "src", entry)];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    if (!server) assert.doesNotMatch(source, /\bprocess\s*\./u, repositoryRelative(file));
    for (const specifier of moduleSpecifiers(source, file)) {
      if (builtinModules.includes(specifier) || specifier.startsWith("node:")) {
        assert.ok(server, `Node dependency in pure API closure: ${specifier}`);
        continue;
      }
      if (!specifier.startsWith(".")) {
        const permitted = server
          ? /^@workbench\/(?:api|server-core)(?:\/|$)/u
          : /^@workbench\/api(?:\/|$)/u;
        assert.match(
          specifier,
          permitted,
          `Forbidden API dependency from ${repositoryRelative(file)}`,
        );
      }
      const target = resolveBoundarySource(file, specifier);
      assert.ok(
        target.startsWith(`${apiDirectory}${path.sep}`) ||
          (server && target.startsWith(path.join(repositoryRoot, "packages/server/server-core/"))),
        `API source escaped its allowed owners: ${repositoryRelative(target)}`,
      );
      pending.push(target);
    }
  }
}

test("API pure exports never load Host, Pi, server-core or Node transitively", () => {
  const root = parseWorkspaceSource(readFileSync(path.join(apiDirectory, "src/index.ts"), "utf8"));
  for (const statement of root.body) assert.equal(statement.exportKind, "type");
  for (const entry of ["index.ts", "contracts.ts", "errors.ts", "validation.ts", "client.ts"])
    assertApiClosure(entry, false);
  assertApiClosure("server.ts", true);
});

test("retired RPC implementations and reverse server-core API edges cannot return", () => {
  const retired =
    /@workbench\/(?:host-(?:contracts|client|server)\/rpc|server-core\/rpc-domain-error)$/u;
  for (const workspace of workspaces) {
    for (const root of ["src", "lib", "tests", "test"]) {
      for (const file of filesUnder(path.join(workspace, root)).filter((name) =>
        /\.[cm]?[jt]sx?$/u.test(name),
      )) {
        for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"), file)) {
          assert.doesNotMatch(specifier, retired, repositoryRelative(file));
          if (workspace.endsWith("/server-core"))
            assert.doesNotMatch(specifier, /^@workbench\/api(?:\/|$)/u, repositoryRelative(file));
        }
      }
    }
  }
  for (const retiredFile of [
    "packages/client/host-contracts/src/rpc.ts",
    "packages/client/host-client/src/rpc.ts",
    "packages/host/host-server/src/rpc.ts",
    "packages/server/server-core/src/rpc-domain-error.ts",
  ])
    assert.equal(existsSync(path.join(repositoryRoot, retiredFile)), false, retiredFile);
});
