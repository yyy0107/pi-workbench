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
        const isBuildDomain =
          directory === path.join(repositoryRoot, "packages") && entry.name === "build";
        return ignoredDirectories.has(entry.name) && !isBuildDomain ? [] : filesUnder(absolute);
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
    "packages/contracts/runtime-contracts/src/rpc.ts",
    "packages/transport/runtime-transport-client/src/rpc.ts",
    "packages/transport/runtime-transport-server/src/rpc.ts",
    "packages/server/server-core/src/rpc-domain-error.ts",
  ])
    assert.equal(existsSync(path.join(repositoryRoot, retiredFile)), false, retiredFile);
});

// Runtime reachability differs from type reachability: SDK surface metadata can
// mention ReactNode without loading a renderer. Erase only explicit type edges.
function withoutTypeEdges(node) {
  if (Array.isArray(node)) return node.map(withoutTypeEdges).filter(Boolean);
  if (!node || typeof node !== "object") return node;
  if (
    node.type === "ImportDeclaration" &&
    (node.importKind === "type" ||
      (node.specifiers.length > 0 && node.specifiers.every((item) => item.importKind === "type")))
  )
    return undefined;
  if (
    ["ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) &&
    (node.exportKind === "type" ||
      (node.specifiers?.length > 0 && node.specifiers.every((item) => item.exportKind === "type")))
  )
    return undefined;
  if (node.type?.startsWith("TS")) {
    // Assertions/satisfies/non-null still evaluate their expression.
    return node.expression ? withoutTypeEdges(node.expression) : undefined;
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, withoutTypeEdges(value)]),
  );
}

test("runtime boundary projection retains evaluated assertions and removes only type imports", () => {
  const source = `
    import type { ReactNode } from "react";
    import { type Metadata } from "metadata-only";
    export type { Shape } from "shape-only";
    import { type Label, run } from "runtime-value";
    const pending = import("dynamic-value") as Promise<unknown>;
    const checked = run() satisfies unknown;
  `;
  assert.deepEqual(moduleSpecifiers(withoutTypeEdges(parseWorkspaceSource(source))), [
    "runtime-value",
    "dynamic-value",
  ]);
});

function assertCapabilityClosure(entry, forbidden, { runtimeOnly = false, noDom = false } = {}) {
  const pending = [resolveBoundarySource(path.join(repositoryRoot, "package.json"), entry)];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const parsed = parseWorkspaceSource(readFileSync(file, "utf8"), file);
    const program = runtimeOnly ? withoutTypeEdges(parsed) : parsed;
    for (const specifier of moduleSpecifiers(program, file)) {
      assert.doesNotMatch(specifier, forbidden, `${entry}: ${repositoryRelative(file)}`);
      if (specifier.startsWith(".") || specifier.startsWith("@workbench/")) {
        pending.push(resolveBoundarySource(file, specifier));
      }
    }
    if (noDom) {
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.type === "Identifier")
          assert.ok(
            !["window", "document"].includes(node.name),
            `${entry}: DOM in ${repositoryRelative(file)}`,
          );
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(visit);
          else visit(value);
        }
      };
      visit(program);
    }
  }
  return seen;
}

test("portable ports and workspace catalog never depend on concrete Pi implementations", () => {
  const ports = workspaceManifests.get("@workbench/pi-sdk-ports").manifest;
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const dependency of Object.keys(ports[field] ?? {}))
      assert.doesNotMatch(dependency, /^@workbench\/(?:pi-runtime-browser|workspace-server)$/u);
  }
  assertCapabilityClosure("@workbench/browser-contracts", /^@workbench\/(?:pi-|browser-server)/u);
  assertCapabilityClosure(
    "@workbench/agent-runtime-contracts/workspace-catalog",
    /^@workbench\/(?:pi-|workspace-server)/u,
  );
  assertCapabilityClosure("@workbench/workspace-server/catalog", /^@workbench\/pi-/u);
  for (const name of [
    "session-runtime-dependencies.ts",
    "external-session-import-service.ts",
    "pi-automation-service.ts",
  ]) {
    const source = readFileSync(
      path.join(repositoryRoot, "packages/pi-sdk/pi-sdk-sessions/src", name),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /Pick\s*<\s*WorkspaceStore|import\s+type\s*\{\s*WorkspaceStore\s*\}/u,
    );
  }
});

test("headless workspace entries never load React, UI, Shell or DOM operations", () => {
  for (const entry of [
    "@workbench/workspace-runtime",
    "@workbench/workspace-runtime/persistence",
    "@workbench/workspace-runtime/directory-store",
  ]) {
    assertCapabilityClosure(
      entry,
      /^(?:react(?:-dom)?(?:\/|$)|@base-ui\/|lucide-react|@workbench\/(?:ui(?:-|\/|$)|shell(?:-|\/|$)|extension-host|i18n))/u,
      { runtimeOnly: true, noDom: true },
    );
  }
});

test("file icons are independent from the tree and download has no React runtime", () => {
  assertCapabilityClosure(
    "@workbench/ui-file-presentation/icons",
    /^@workbench\/(?:workspace-|shell(?:-|\/|$)|agent-runtime-client)/u,
    { runtimeOnly: true },
  );
  assertCapabilityClosure(
    "@workbench/ui-file-presentation/download",
    /^(?:react(?:-dom)?(?:\/|$)|@workbench\/)/u,
    { runtimeOnly: true },
  );
});

test("Spec008 retired imports and aggregate session dependencies cannot return", () => {
  const retired =
    /^@workbench\/(?:workspace-runtime\/(?:react|presentation|i18n|styles\.css)|workspace-files\/download|pi-sdk-resources\/workspace-store)$/u;
  for (const workspace of workspaces) {
    for (const root of ["src", "lib", "tests", "test"]) {
      for (const file of filesUnder(path.join(workspace, root)).filter((file) =>
        /\.[cm]?[jt]sx?$/u.test(file),
      )) {
        for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"), file))
          assert.doesNotMatch(specifier, retired, repositoryRelative(file));
      }
    }
  }
  const session = readFileSync(
    path.join(repositoryRoot, "packages/pi-runtime/pi-runtime-client/src/runtime/session.ts"),
    "utf8",
  );
  assert.doesNotMatch(session, /\bPiSessionManager\b|this\.manager\b/u);
  for (const [name, entry] of [
    ["@workbench/workspace-runtime", "./react"],
    ["@workbench/workspace-runtime", "./presentation"],
    ["@workbench/workspace-runtime", "./i18n"],
    ["@workbench/workspace-runtime", "./styles.css"],
    ["@workbench/workspace-files", "./download"],
    ["@workbench/pi-sdk-resources", "./workspace-store"],
  ])
    assert.equal(
      workspaceManifests.get(name).manifest.exports[entry],
      undefined,
      `${name}${entry}`,
    );
});

test("session behavior owners cannot reach back into the complete registry or manager", () => {
  const read = (file) => readFileSync(path.join(repositoryRoot, file), "utf8");
  const registry = read("packages/pi-sdk/pi-sdk-sessions/src/session-registry.ts");
  assert.doesNotMatch(registry, /class\s+HostedPiSession\b/u);
  assert.match(registry, /from\s+["']\.\/hosted-pi-session["']/u);
  assert.doesNotMatch(
    registry,
    /registry\.(?:sessions|startLocks|scratchSessions|persistedSessions|forkTail)\b/u,
  );
  for (const name of [
    "hosted-pi-session",
    "session-projections",
    "persisted-session-directory",
    "scratch-session-directory",
  ]) {
    const file = `packages/pi-sdk/pi-sdk-sessions/src/${name}.ts`;
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\b(?:PiSessionRegistry|RegistryState|processPiSessionRegistryState)\b/u,
      file,
    );
    assert.ok(!moduleSpecifiers(source, file).includes("./session-registry"), file);
  }
  for (const name of [
    "session-dependencies",
    "session-attachments",
    "session-history",
    "manager-catalog",
  ]) {
    const file = `packages/pi-runtime/pi-runtime-client/src/runtime/${name}.ts`;
    const source = read(file);
    assert.doesNotMatch(source, /\bPiSessionManager\b/u, file);
    assert.deepEqual(
      moduleSpecifiers(source, file).filter(
        (value) => value === "./manager" || value === "./session",
      ),
      [],
      file,
    );
  }
});

test("Pi product resources and default extensions stay outside SDK services", () => {
  const sdk = path.join(repositoryRoot, "packages/pi-sdk");
  for (const file of filesUnder(sdk)) {
    assert.ok(!/[/\\](?:resources|skills)[/\\]/u.test(file), `Product content in SDK: ${file}`);
    if (!sourceFile.test(file) || /[/\\]tests[/\\]/u.test(file)) continue;
    for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"), file))
      assert.doesNotMatch(specifier, /^@workbench\/pi-workbench(?:-runtime)?(?:\/|$)/u, file);
  }
  const owners = productionSources.filter((file) =>
    /export function createWorkbenchInternalPiExtensions\s*\(/u.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(owners.map(repositoryRelative).sort(), [
    "packages/pi-runtime/pi-runtime-server/src/tool-composition.ts",
    "packages/product/pi-workbench-runtime/src/extensions.ts",
  ]);
  const sdkResources = workspaceManifests.get("@workbench/pi-sdk-resources").manifest;
  assert.equal(sdkResources.exports["./builtin-resources"], undefined);
  assert.equal(sdkResources.exports["./resource-locations"], undefined);
  assert.equal(sdkResources.dependencies["@workbench/pi-runtime-browser"], undefined);
  const product = path.join(repositoryRoot, "packages/product/pi-workbench-runtime");
  assert.ok(existsSync(path.join(product, "resources/skills/pi-docs/SKILL.md")));
  assert.ok(existsSync(path.join(product, "resources/prompts")));
});

test("Node Pi product entry points do not load UI or the server composition", () => {
  for (const entry of Object.keys(
    workspaceManifests.get("@workbench/pi-workbench-runtime").manifest.exports,
  ).map((key) => key.slice(2)))
    assertCapabilityClosure(
      `@workbench/pi-workbench-runtime/${entry}`,
      /^(?:react(?:-dom)?(?:\/|$)|next(?:\/|$)|@workbench\/(?:pi-workbench(?:\/|$)|pi-runtime-server(?:\/|$)|pi-ui-|ui(?:-|\/|$)|shell(?:-|\/|$)))/u,
      { runtimeOnly: true },
    );
});

test("SDK manifests do not depend on product packages and product tools retain narrow entries", () => {
  for (const [name, { manifest }] of workspaceManifests) {
    if (!name.startsWith("@workbench/pi-sdk-")) continue;
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"])
      for (const dependency of Object.keys(manifest[field] ?? {}))
        assert.doesNotMatch(dependency, /^@workbench\/pi-workbench(?:-runtime)?$/, name);
  }
  assert.equal(workspaceManifests.has("@workbench/pi-runtime-tools"), false);
  for (const entry of ["tools", "tools/builtin-tools"])
    assertCapabilityClosure(
      `@workbench/pi-workbench-runtime/${entry}`,
      /^@workbench\/terminal-server(?:\/|$)/u,
      { runtimeOnly: true },
    );
});

test("Pi extension registration lives in executable product resource entries", () => {
  const product = path.join(repositoryRoot, "packages/product/pi-workbench-runtime");
  const manifest = workspaceManifests.get("@workbench/pi-workbench-runtime").manifest;
  const entries = Object.entries(manifest.exports).filter(([key]) =>
    key.startsWith("./extensions/"),
  );
  assert.equal(entries.length, 8);
  for (const [key, target] of entries) {
    assert.equal(target, `./resources/${key.slice(2)}/index.ts`);
    const source = readFileSync(path.join(product, target), "utf8");
    assert.match(source, /pi\.(?:registerTool|on)\(/u, key);
  }
  for (const tool of ["ask-user", "rpiv-todo", "workbench-settings"]) {
    const source = readFileSync(path.join(product, "src", tool, "index.ts"), "utf8");
    assert.doesNotMatch(source, /pi\.(?:registerTool|on)\(/u, tool);
  }
  const composition = readFileSync(path.join(product, "src/extensions.ts"), "utf8");
  const factories = moduleSpecifiers(composition, "extensions.ts").filter((specifier) =>
    specifier.includes("/extensions/"),
  );
  assert.equal(factories.length, 8);
});

test("Browser remains a workspace surface without Pi resources or a Settings contribution", () => {
  assert.equal(workspaceManifests.has("@workbench/pi-runtime-browser"), false);
  const product = path.join(repositoryRoot, "packages/product/pi-workbench-runtime");
  assert.equal(existsSync(path.join(product, "resources/skills/browser-use")), false);
  assert.equal(existsSync(path.join(product, "resources/extensions/browser")), false);
  assert.equal(existsSync(path.join(product, "src/browser")), false);
  const extension = readFileSync(
    path.join(repositoryRoot, "packages/workspace/workspace-browser/src/extension.ts"),
    "utf8",
  );
  assert.match(extension, /context\.workspace\.register\(browserSurfaceDefinition\)/u);
  assert.doesNotMatch(extension, /context\.settings\.register/u);
});
