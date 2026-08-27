import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const RPC_ROUTER = new URL("../transport/rpc-router.ts", import.meta.url);
const RPC_ROUTE_COMPOSITION = new URL("../transport/rpc-route-composition.ts", import.meta.url);
const RPC_DOMAIN_ERROR_PROJECTOR = new URL(
  "../transport/rpc-domain-error-projector.ts",
  import.meta.url,
);

const EXPOSED_DOMAIN_ERRORS = [
  ["../attachment-understanding/settings-store.ts", "ImageUnderstandingSettingsStoreError"],
  ["../commands/command-service.ts", "CommandServiceError"],
  ["../extensions/extension-service.ts", "ExtensionServiceError"],
  ["../host/host-directories.ts", "HostDirectoryError"],
  ["../local-apps/service.ts", "LocalAppServiceError"],
  ["../models/model-service.ts", "ModelServiceError"],
  ["../packages/installed-package-service.ts", "InstalledPackageServiceError"],
  ["../packages/package-catalog-service.ts", "PiPackageCatalogServiceError"],
  ["../resources/scoped-resource-context.ts", "ScopedResourceContextError"],
  ["../sessions/pi-session-context-trace-service.ts", "PiSessionContextTraceServiceError"],
  ["../sessions/session-rpc-service.ts", "SessionRpcServiceError"],
  ["../settings/agent-settings-service.ts", "AgentSettingsServiceError"],
  ["../settings/workbench-settings-service.ts", "WorkbenchSettingsServiceError"],
  ["../skills/skill-service.ts", "SkillServiceError"],
  ["../trust/project-trust-service.ts", "ProjectTrustServiceError"],
  ["../workspaces/workspace-files.ts", "WorkspaceFileError"],
  ["../workspaces/workspace-protocol-service.ts", "WorkspaceProtocolServiceError"],
  ["../workspaces/workspace-store.ts", "WorkspaceStoreError"],
] as const;

test("every browser-visible domain error opts into the explicit RPC-safe brand", async () => {
  for (const [relativePath, className] of EXPOSED_DOMAIN_ERRORS) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
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
  assert.doesNotMatch(source, /instanceof/);
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
