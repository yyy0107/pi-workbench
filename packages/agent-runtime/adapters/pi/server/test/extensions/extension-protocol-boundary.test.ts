import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const EXTENSION_SERVICE = new URL("../../src/extensions/extension-service.ts", import.meta.url);
const EXTENSION_RPC_ROUTES = new URL(
  "../../src/transport/routes/extension-rpc-routes.ts",
  import.meta.url,
);
const RESOURCE_RPC_VALIDATORS = new URL(
  "../../src/transport/resource-rpc-validators.ts",
  import.meta.url,
);
const RPC_ROUTE_COMPOSITION = new URL(
  "../../src/transport/rpc-route-composition.ts",
  import.meta.url,
);

const EXTENSION_RPC_METHODS = [
  "extension.list",
  "extension.files.read",
  "extension.files.list",
  "extension.setEnabled",
  "extension.remove",
] as const;

test("Extension transport depends only on its protocol and shared Resource validators", async () => {
  const source = await readFile(EXTENSION_RPC_ROUTES, "utf8");

  assert.match(source, /import type \{ ExtensionProtocol \}/);
  assert.match(source, /from "\.\.\/resource-rpc-validators"/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  assert.doesNotMatch(source, /session-registry|scoped-resource-context/);
  assert.doesNotMatch(source, /pi-resource-mutation-coordinator|SettingsManager/);
  assert.doesNotMatch(source, /internal-extensions|node:fs|node:path/);
  for (const method of EXTENSION_RPC_METHODS) {
    assert.ok(source.includes(`case "${method}":`), `Missing extracted Extension route: ${method}`);
  }
  for (const method of ["command.list", "package.list", "skill.list"]) {
    assert.ok(
      !source.includes(`case "${method}":`),
      `Non-Extension route leaked into Extensions: ${method}`,
    );
  }
});

test("Extension routes define one reusable full identity and preserve mutation security", async () => {
  const source = await readFile(EXTENSION_RPC_ROUTES, "utf8");

  assert.match(source, /const extensionIdentityFields = \{/);
  assert.equal(source.match(/name: resourceNameValidator/g)?.length, 1);
  assert.equal(source.match(/\.\.\.extensionIdentityFields/g)?.length, 3);
  assert.equal(source.match(/loopbackOnly: true/g)?.length, 2);
  assert.match(source, /relativePath: rpcOptional\(resourceRelativeFilePathValidator\)/);
  assert.match(source, /relativePath: rpcOptional\(resourceRelativeDirectoryPathValidator\)/);
});

test("ExtensionService implements the narrow protocol while retaining Pi resource ownership", async () => {
  const source = await readFile(EXTENSION_SERVICE, "utf8");

  assert.match(source, /export interface ExtensionProtocol/);
  assert.match(source, /export class ExtensionService implements ExtensionProtocol/);
  assert.match(source, /from "@earendil-works\/pi-coding-agent"/);
  assert.match(source, /from "\.\.\/resources\/scoped-resource-context"/);
  assert.match(source, /from "\.\.\/sessions\/session-registry"/);
  assert.match(source, /from "\.\.\/resources\/pi-resource-mutation-coordinator"/);
  assert.match(source, /from "\.\.\/internal-extensions\/index"/);
  assert.match(source, /handlers: ReadonlyMap/);
  assert.match(source, /tools: ReadonlyMap/);
  assert.match(source, /commands: ReadonlyMap/);
  assert.doesNotMatch(source, /rpc-transport|extension-rpc-routes/);
});

test("shared Resource validators remain independent of the Extension domain", async () => {
  const source = await readFile(RESOURCE_RPC_VALIDATORS, "utf8");

  assert.match(source, /export function resourceRequestPayload/);
  assert.match(source, /export const resourceListPayload/);
  assert.doesNotMatch(source, /extension-service|ExtensionIdentity|extensionIdentity/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
});

test("the route composition creates Extensions without retaining transport details", async () => {
  const source = await readFile(RPC_ROUTE_COMPOSITION, "utf8");

  assert.match(source, /createExtensionRpcRoutes/);
  assert.match(source, /const extensionService = new ExtensionService/);
  assert.match(source, /createExtensionRpcRoutes\(dependencies\.extension\)/);
  assert.match(source, /extension: \{ service: extensionService, \.\.\.domainErrors \}/);
  assert.doesNotMatch(source, /resource-rpc-validators/);
  assert.match(source, /projectRpcDomainError/);
  for (const method of EXTENSION_RPC_METHODS) {
    assert.ok(
      !source.includes(`case "${method}":`),
      `Composition still owns Extension route details: ${method}`,
    );
  }
  assert.doesNotMatch(source, /const extensionIdentityPayload/);
  assert.doesNotMatch(source, /const extensionFilesListPayload/);
  assert.doesNotMatch(source, /const extensionFileReadPayload/);
  assert.doesNotMatch(source, /const extensionSetEnabledPayload/);
  assert.doesNotMatch(
    source,
    /resourceNameValidator|resourceRelativeDirectoryPathValidator|resourceRelativeFilePathValidator|resourceRequestPayload/,
  );
  assert.doesNotMatch(
    source,
    /ExtensionFileReadPayload|ExtensionFilesListPayload|ExtensionIdentityPayload|ExtensionSetEnabledPayload/,
  );
});
