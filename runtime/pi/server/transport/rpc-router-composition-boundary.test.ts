import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const RPC_ROUTER = new URL("./rpc-router.ts", import.meta.url);
const RPC_ROUTE_COMPOSITION = new URL("./rpc-route-composition.ts", import.meta.url);
const HOST_SERVICE = new URL("../host/host-service.ts", import.meta.url);
const LOCAL_APP_SERVICE = new URL("../local-apps/service.ts", import.meta.url);
const PROJECT_TRUST_SERVICE = new URL("../trust/project-trust-service.ts", import.meta.url);
const COMMAND_SERVICE = new URL("../commands/command-service.ts", import.meta.url);
const PROMPT_SERVICE = new URL("../prompts/prompt-service.ts", import.meta.url);
const HOST_ROUTES = new URL("./routes/host-rpc-routes.ts", import.meta.url);
const LOCAL_APP_ROUTES = new URL("./routes/local-app-rpc-routes.ts", import.meta.url);
const PROJECT_TRUST_ROUTES = new URL("./routes/project-trust-rpc-routes.ts", import.meta.url);
const RESOURCE_CATALOG_ROUTES = new URL("./routes/resource-catalog-rpc-routes.ts", import.meta.url);

const HOST_METHODS = [
  "host.describe",
  "host.pickDirectory",
  "host.listDirectory",
  "host.createDirectory",
  "host.openPath",
] as const;
const LOCAL_APP_METHODS = [
  "host.localApps.list",
  "host.localApps.refresh",
  "host.localApps.open",
] as const;
const PROJECT_TRUST_METHODS = ["projectTrust.describe", "projectTrust.update"] as const;
const RESOURCE_CATALOG_METHODS = ["command.list", "prompt.list"] as const;

test("the final domain transports depend only on narrow protocols", async () => {
  const [host, localApp, projectTrust, catalogs] = await Promise.all([
    readFile(HOST_ROUTES, "utf8"),
    readFile(LOCAL_APP_ROUTES, "utf8"),
    readFile(PROJECT_TRUST_ROUTES, "utf8"),
    readFile(RESOURCE_CATALOG_ROUTES, "utf8"),
  ]);

  assert.match(host, /import type \{ HostProtocol \}/);
  assert.match(localApp, /import type \{ LocalAppProtocol \}/);
  assert.match(projectTrust, /import type \{ ProjectTrustProtocol \}/);
  assert.match(catalogs, /import type \{ CommandCatalogProtocol \}/);
  assert.match(catalogs, /import type \{ PromptCatalogProtocol \}/);
  assert.match(catalogs, /from "\.\.\/resource-rpc-validators"/);
  for (const source of [host, localApp, projectTrust, catalogs]) {
    assert.doesNotMatch(source, /@earendil-works\/pi-(?:ai|coding-agent)/);
    assert.doesNotMatch(source, /session-registry|scoped-resource-context/);
    assert.doesNotMatch(source, /ResourceLoader|SettingsManager|ProjectTrustStore/);
    assert.doesNotMatch(source, /node:fs|node:path|node:child_process/);
  }
});

test("the extracted routes preserve their distinct trust and cancellation boundaries", async () => {
  const [host, localApp, projectTrust, catalogs] = await Promise.all([
    readFile(HOST_ROUTES, "utf8"),
    readFile(LOCAL_APP_ROUTES, "utf8"),
    readFile(PROJECT_TRUST_ROUTES, "utf8"),
    readFile(RESOURCE_CATALOG_ROUTES, "utf8"),
  ]);

  assert.equal(host.match(/loopbackOnly: true/g)?.length, 2);
  assert.match(host, /Directory selection was cancelled/);
  assert.match(host, /Directory listing was cancelled/);
  assert.match(host, /Opening the host path was cancelled/);
  assert.equal(localApp.match(/loopbackOnly: true/g)?.length, 3);
  assert.match(localApp, /Local application detection was cancelled/);
  assert.match(localApp, /Opening the local application was cancelled/);
  assert.doesNotMatch(projectTrust, /loopbackOnly: true/);
  assert.match(projectTrust, /afterUpdate\(\)/);
  assert.doesNotMatch(catalogs, /loopbackOnly: true/);
});

test("domain services implement the narrow protocols while retaining state ownership", async () => {
  const [host, localApp, projectTrust, commands, prompts] = await Promise.all([
    readFile(HOST_SERVICE, "utf8"),
    readFile(LOCAL_APP_SERVICE, "utf8"),
    readFile(PROJECT_TRUST_SERVICE, "utf8"),
    readFile(COMMAND_SERVICE, "utf8"),
    readFile(PROMPT_SERVICE, "utf8"),
  ]);

  assert.match(host, /export interface HostProtocol/);
  assert.match(host, /export class HostService implements HostProtocol/);
  assert.match(host, /@earendil-works\/pi-coding-agent/);
  assert.match(host, /sessions\/session-registry/);
  assert.match(host, /\.\/host-directories/);

  assert.match(localApp, /export interface LocalAppProtocol/);
  assert.match(localApp, /export class LocalAppService implements LocalAppProtocol/);
  assert.match(localApp, /detectInstalledApps/);
  assert.match(localApp, /launchLocalApp/);

  assert.match(projectTrust, /export interface ProjectTrustProtocol/);
  assert.match(projectTrust, /export class ProjectTrustService implements ProjectTrustProtocol/);
  assert.match(projectTrust, /ProjectTrustStore/);
  assert.match(projectTrust, /SettingsManager/);

  assert.match(commands, /export interface CommandCatalogProtocol/);
  assert.match(
    commands,
    /export class CommandService implements AgentCommandCatalogPort, CommandCatalogProtocol/,
  );
  assert.match(commands, /sessions\/session-registry/);
  assert.match(commands, /resources\/scoped-resource-context/);

  assert.match(prompts, /export interface PromptCatalogProtocol/);
  assert.match(prompts, /export class PromptService implements PromptCatalogProtocol/);
  assert.match(prompts, /resources\/scoped-resource-context/);

  for (const source of [host, localApp, projectTrust, commands, prompts]) {
    assert.doesNotMatch(source, /rpc-transport|transport\/routes/);
  }
});

test("route composition owns the domain graph while the Router remains injectable and thin", async () => {
  const [compositionSource, routerSource] = await Promise.all([
    readFile(RPC_ROUTE_COMPOSITION, "utf8"),
    readFile(RPC_ROUTER, "utf8"),
  ]);

  for (const [factory, dependency] of [
    ["createHostRpcRoutes", "host"],
    ["createLocalAppRpcRoutes", "localApp"],
    ["createProjectTrustRpcRoutes", "projectTrust"],
    ["createResourceCatalogRpcRoutes", "resourceCatalog"],
  ] as const) {
    assert.match(compositionSource, new RegExp(factory));
    assert.match(compositionSource, new RegExp(`${factory}\\(dependencies\\.${dependency}\\)`));
    assert.doesNotMatch(routerSource, new RegExp(factory));
  }
  assert.match(compositionSource, /export function createPiRpcRouteGroups/);
  assert.match(compositionSource, /export function createDefaultPiRpcRouteGroups/);
  assert.match(compositionSource, /const hostService = new HostService\(\)/);
  assert.match(compositionSource, /const commandService = new CommandService\(\)/);
  assert.match(routerSource, /export function createPiRpcRouter/);
  assert.match(routerSource, /routeGroups: createDefaultPiRpcRouteGroups\(\)/);
  assert.match(routerSource, /dispatchRpcRouteGroups\(request, method, routeGroups\)/);
  assert.match(routerSource, /if \(method === "respond"\) return respond\(request\)/);
  for (const method of [
    ...HOST_METHODS,
    ...LOCAL_APP_METHODS,
    ...PROJECT_TRUST_METHODS,
    ...RESOURCE_CATALOG_METHODS,
  ]) {
    assert.ok(
      !compositionSource.includes(`case "${method}":`) &&
        !routerSource.includes(`case "${method}":`),
      `Composition or Router still owns route: ${method}`,
    );
  }
  assert.doesNotMatch(
    routerSource,
    /HostService|LocalAppService|ProjectTrustService|CommandService/,
  );
  assert.doesNotMatch(routerSource, /resource-rpc-validators|projectRpcDomainError/);
  assert.doesNotMatch(routerSource, /rpcObject|rpcOptional|rpcString|rpcBoolean|RpcValidator/);
  assert.doesNotMatch(routerSource, /getAgentDir|PI_VERSION|listModels|canOpenHostPath/);
});
