import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SESSION_RPC_SERVICE = new URL("./session-rpc-service.ts", import.meta.url);
const SESSION_PROTOCOL_FACADE = new URL("./pi-session-protocol-facade.ts", import.meta.url);
const SESSION_CONTEXT_TRACE_SERVICE = new URL(
  "./pi-session-context-trace-service.ts",
  import.meta.url,
);
const EXTERNAL_SESSION_IMPORT_SERVICE = new URL(
  "../imports/external-session-import-service.ts",
  import.meta.url,
);
const EXTERNAL_SESSION_TYPES = new URL("../imports/external-session-types.ts", import.meta.url);
const RPC_ROUTER = new URL("../transport/rpc-router.ts", import.meta.url);
const RPC_ROUTE_GROUP = new URL("../transport/routes/rpc-route-group.ts", import.meta.url);
const SESSION_RPC_ROUTES = new URL("../transport/routes/session-rpc-routes.ts", import.meta.url);
const SESSION_CONTEXT_TRACE_RPC_ROUTES = new URL(
  "../transport/routes/session-context-trace-rpc-routes.ts",
  import.meta.url,
);
const EXTERNAL_SESSION_IMPORT_RPC_ROUTES = new URL(
  "../transport/routes/external-session-import-rpc-routes.ts",
  import.meta.url,
);

const CORE_SESSION_RPC_METHODS = [
  "session.list",
  "session.search",
  "session.create",
  "session.history",
  "session.regenerate",
  "session.resume",
  "session.selectBranch",
  "session.models",
  "session.selectModel",
  "session.contextPolicy",
  "session.updateContextPolicy",
  "session.compactContext",
  "session.rename",
  "session.delete",
  "session.fork",
  "session.prompt",
  "session.attachment",
  "session.updateQueue",
  "session.cancel",
] as const;

const SESSION_CONTEXT_TRACE_RPC_METHODS = [
  "session.contextTrace.list",
  "session.contextTrace.activations",
  "session.contextTrace.promptParts",
  "session.contextTrace.read",
] as const;

const EXTERNAL_SESSION_IMPORT_RPC_METHODS = ["sessionImport.scan", "sessionImport.import"] as const;

test("the session RPC facade depends on Pi protocol collaborators instead of the registry or SDK model service", async () => {
  const source = await readFile(SESSION_RPC_SERVICE, "utf8");

  assert.doesNotMatch(source, /from\s+["']\.\/session-registry["']/);
  assert.doesNotMatch(source, /from\s+["']\.\.\/models\/model-service["']/);
  assert.match(source, /from\s+["']\.\/pi-session-history-service["']/);
  assert.match(source, /from\s+["']\.\/pi-session-model-context-service["']/);
});

test("the Pi composition root owns concrete session collaborators and late-bound workspaces", async () => {
  const source = await readFile(SESSION_PROTOCOL_FACADE, "utf8");

  assert.match(source, /createPiAgentServerAdapter/);
  assert.match(source, /createPiSessionHistoryService/);
  assert.match(source, /createPiSessionModelContextService/);
  assert.match(source, /new SessionRpcService/);
  assert.match(source, /resolveWorkspaceStore/);
});

test("core session transport routes depend on the protocol facade without reaching into Pi state", async () => {
  const source = await readFile(SESSION_RPC_ROUTES, "utf8");

  assert.match(source, /import type \{ PiSessionProtocolFacade \}/);
  assert.doesNotMatch(source, /session-registry/);
  assert.doesNotMatch(source, /ModelService/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  for (const method of CORE_SESSION_RPC_METHODS) {
    assert.ok(source.includes(`case "${method}":`), `Missing extracted route: ${method}`);
  }
});

test("the RPC router delegates core session methods without assembling or handling them", async () => {
  const source = await readFile(RPC_ROUTER, "utf8");

  assert.match(
    source,
    /const sessionProtocolFacade = createPiSessionProtocolFacade\(\{ commands: commandService \}\)/,
  );
  assert.match(source, /const sessionRpcRoutes = createSessionRpcRoutes\(/);
  assert.match(source, /const rpcRouteGroups: readonly RpcRouteGroup\[\] = \[/);
  assert.match(source, /dispatchRpcRouteGroups\(request, method, rpcRouteGroups\)/);
  assert.match(source, /\n\s+sessionRpcRoutes,/);
  assert.doesNotMatch(source, /new SessionRpcService/);
  assert.doesNotMatch(source, /function sessionService\(/);
  assert.doesNotMatch(source, /createPiSessionHistoryService/);
  assert.doesNotMatch(source, /createPiSessionModelContextService/);
  for (const method of CORE_SESSION_RPC_METHODS) {
    assert.ok(!source.includes(`case "${method}":`), `Router still owns route: ${method}`);
  }
});

test("the Pi Context Trace service owns live-session and journal coordination", async () => {
  const source = await readFile(SESSION_CONTEXT_TRACE_SERVICE, "utf8");

  assert.match(source, /from\s+["']\.\/session-registry["']/);
  assert.match(source, /from\s+["']\.\/session-context-trace["']/);
  assert.match(source, /from\s+["']\.\/session-context-trace-journal["']/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  assert.match(source, /readPromptParts: readSessionContextTracePromptParts/);
  assert.match(source, /await implementation\.startSession\(sessionId\)/);
});

test("Context Trace transport routes depend on the narrow service without reaching into Pi state", async () => {
  const source = await readFile(SESSION_CONTEXT_TRACE_RPC_ROUTES, "utf8");

  assert.match(source, /import type \{ PiSessionContextTraceService \}/);
  assert.doesNotMatch(source, /sessions\/session-registry["']/);
  assert.doesNotMatch(source, /sessions\/session-context-trace["']/);
  assert.doesNotMatch(source, /session-context-trace-journal/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  for (const method of SESSION_CONTEXT_TRACE_RPC_METHODS) {
    assert.ok(source.includes(`case "${method}":`), `Missing extracted route: ${method}`);
  }
});

test("the RPC router composes and delegates Context Trace without handling its state", async () => {
  const source = await readFile(RPC_ROUTER, "utf8");

  assert.match(source, /const sessionContextTraceService = createPiSessionContextTraceService\(\)/);
  assert.match(source, /const sessionContextTraceRpcRoutes = createSessionContextTraceRpcRoutes\(/);
  assert.match(source, /\n\s+sessionContextTraceRpcRoutes,/);
  assert.match(source, /dispatchRpcRouteGroups\(request, method, rpcRouteGroups\)/);
  assert.match(source, /error instanceof PiSessionContextTraceServiceError/);
  assert.doesNotMatch(source, /function requireSessionContextTrace\(/);
  assert.doesNotMatch(source, /from\s+["']\.\.\/sessions\/session-context-trace["']/);
  assert.doesNotMatch(source, /from\s+["']\.\.\/sessions\/session-context-trace-journal["']/);
  for (const method of SESSION_CONTEXT_TRACE_RPC_METHODS) {
    assert.ok(!source.includes(`case "${method}":`), `Router still owns route: ${method}`);
  }
});

test("external import domain types reuse the stable browser-facing RPC contract", async () => {
  const source = await readFile(EXTERNAL_SESSION_TYPES, "utf8");

  assert.match(source, /from\s+["']@\/runtime\/pi\/contracts\/rpc["']/);
  assert.match(source, /ExternalSessionDescriptor = ExternalSessionImportView/);
  assert.match(
    source,
    /ExternalSessionSourceSnapshot = ExternalSessionImportScanValue\["sources"\]\[number\]/,
  );
  assert.doesNotMatch(source, /"codex"\s*\|\s*"claude-code"\s*\|\s*"cursor"/);
});

test("the external import service owns Pi persistence, source adapters, and Workspace attachment", async () => {
  const source = await readFile(EXTERNAL_SESSION_IMPORT_SERVICE, "utf8");

  assert.match(source, /import \{ SessionManager \} from "@earendil-works\/pi-coding-agent"/);
  assert.match(source, /new CodexSessionAdapter\(\)/);
  assert.match(source, /new ClaudeCodeSessionAdapter\(\)/);
  assert.match(source, /new CursorSessionAdapter\(\)/);
  assert.match(source, /registerImportedSessionManager/);
  assert.match(source, /getWorkspaceStore/);
  assert.doesNotMatch(source, /rpc-transport/);
});

test("external import transport routes depend only on the narrow import protocol", async () => {
  const source = await readFile(EXTERNAL_SESSION_IMPORT_RPC_ROUTES, "utf8");

  assert.match(source, /import type \{ ExternalSessionImportProtocol \}/);
  assert.match(source, /EXTERNAL_SESSION_SOURCES/);
  assert.doesNotMatch(source, /CodexSessionAdapter|ClaudeCodeSessionAdapter|CursorSessionAdapter/);
  assert.doesNotMatch(source, /SessionManager|session-registry|WorkspaceStore|getWorkspaceStore/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  for (const method of EXTERNAL_SESSION_IMPORT_RPC_METHODS) {
    assert.ok(source.includes(`case "${method}":`), `Missing extracted route: ${method}`);
  }
});

test("the RPC router delegates all extracted domains through one route-group dispatcher", async () => {
  const [routerSource, routeGroupSource] = await Promise.all([
    readFile(RPC_ROUTER, "utf8"),
    readFile(RPC_ROUTE_GROUP, "utf8"),
  ]);

  assert.match(
    routerSource,
    /const externalSessionImportService = getExternalSessionImportService\(\)/,
  );
  assert.match(
    routerSource,
    /const externalSessionImportRpcRoutes = createExternalSessionImportRpcRoutes\(/,
  );
  assert.match(routerSource, /\n\s+externalSessionImportRpcRoutes,/);
  assert.match(routerSource, /dispatchRpcRouteGroups\(request, method, rpcRouteGroups\)/);
  assert.doesNotMatch(routerSource, /const externalSessionSource =/);
  assert.doesNotMatch(routerSource, /const externalSessionImportPayload =/);
  for (const method of EXTERNAL_SESSION_IMPORT_RPC_METHODS) {
    assert.ok(!routerSource.includes(`case "${method}":`), `Router still owns route: ${method}`);
  }

  assert.match(routeGroupSource, /for \(const group of groups\)/);
  assert.match(routeGroupSource, /const response = group\.handle\(request, method\)/);
  assert.match(routeGroupSource, /if \(response\) return response/);
});
