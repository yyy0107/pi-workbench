import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const RPC_ROUTER = new URL("../../src/transport/rpc-router.ts", import.meta.url);
const RPC_ROUTE_COMPOSITION = new URL(
  "../../src/transport/rpc-route-composition.ts",
  import.meta.url,
);
const RPC_DOMAIN_ERROR_PROJECTOR = new URL(
  "../../../../transport/api/src/server.ts",
  import.meta.url,
);
const REPOSITORY_ROOT = new URL("../../../../../", import.meta.url);

const EXPOSED_DOMAIN_ERRORS = [
  ["packages/pi/pi-resources-server/src/command-service.ts", "CommandServiceError"],
  ["packages/pi/pi-resources-server/src/extension-service.ts", "ExtensionServiceError"],
  ["packages/server/local-host-server/src/host-directories.ts", "HostDirectoryError"],
  ["packages/server/local-host-server/src/local-apps/service.ts", "LocalAppServiceError"],
  ["packages/pi/pi-model-server/src/model-service.ts", "ModelServiceError"],
  [
    "packages/pi/pi-resources-server/src/installed-package-service.ts",
    "InstalledPackageServiceError",
  ],
  [
    "packages/pi/pi-resources-server/src/package-catalog-service.ts",
    "PiPackageCatalogServiceError",
  ],
  ["packages/pi/pi-resources-server/src/scoped-resource-context.ts", "ScopedResourceContextError"],
  [
    "packages/pi/pi-session-server/src/pi-session-context-trace-service.ts",
    "PiSessionContextTraceServiceError",
  ],
  ["packages/pi/pi-session-server/src/session-rpc-service.ts", "SessionRpcServiceError"],
  ["packages/pi/pi-resources-server/src/agent-settings-service.ts", "AgentSettingsServiceError"],
  ["packages/server/settings-server/src/service.ts", "WorkbenchSettingsServiceError"],
  ["packages/pi/pi-resources-server/src/skill-service.ts", "SkillServiceError"],
  ["packages/pi/pi-resources-server/src/project-trust-service.ts", "ProjectTrustServiceError"],
  ["packages/server/workspace-server/src/files.ts", "WorkspaceFileError"],
  [
    "packages/pi/pi-resources-server/src/workspace-protocol-service.ts",
    "WorkspaceProtocolServiceError",
  ],
  ["packages/server/workspace-server/src/catalog.ts", "WorkspaceStoreError"],
] as const;

test("every browser-visible domain error opts into the explicit RPC-safe brand", async () => {
  for (const [relativePath, className] of EXPOSED_DOMAIN_ERRORS) {
    const source = await readFile(new URL(relativePath, REPOSITORY_ROOT), "utf8");
    const declarationStart = source.indexOf(`export class ${className}`);

    assert.ok(declarationStart >= 0, `Missing ${className}`);
    assert.match(source.slice(declarationStart, declarationStart + 400), /extends RpcDomainError/);
    assert.match(source, /import \{ RpcDomainError \}/);
  }
});

test("the shared projector accepts branded errors without importing domain implementations", async () => {
  const source = await readFile(RPC_DOMAIN_ERROR_PROJECTOR, "utf8");

  assert.match(source, /import \{ isRpcDomainError \}/);
  assert.match(source, /if \(!isRpcDomainError\(error\)\) throw error/);
  assert.match(source, /rpcBusinessError\(error\.code, error\.message/);
  assert.doesNotMatch(
    source.slice(source.indexOf("export const projectRpcDomainError")),
    /instanceof/,
  );
  for (const [, className] of EXPOSED_DOMAIN_ERRORS) {
    assert.ok(!source.includes(className), `Projector imports concrete error ${className}`);
  }
});

test("Router and route composition no longer retain the concrete error whitelist", async () => {
  const [router, composition] = await Promise.all([
    readFile(RPC_ROUTER, "utf8"),
    readFile(RPC_ROUTE_COMPOSITION, "utf8"),
  ]);

  assert.doesNotMatch(router, /RpcDomainError|rpcBusinessError|instanceof/);
  assert.match(composition, /projectRpcDomainError/);
  assert.doesNotMatch(composition, /rpcBusinessError|instanceof/);
  for (const [, className] of EXPOSED_DOMAIN_ERRORS) {
    assert.ok(!router.includes(className), `Router imports concrete error ${className}`);
    assert.ok(!composition.includes(className), `Composition imports concrete error ${className}`);
  }
});
