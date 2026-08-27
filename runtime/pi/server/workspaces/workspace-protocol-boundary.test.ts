import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WORKSPACE_PROTOCOL_SERVICE = new URL("./workspace-protocol-service.ts", import.meta.url);
const WORKSPACE_STORE = new URL("./workspace-store.ts", import.meta.url);
const WORKSPACE_RPC_ROUTES = new URL(
  "../transport/routes/workspace-rpc-routes.ts",
  import.meta.url,
);
const WORKSPACE_FILE_RPC_ROUTES = new URL(
  "../transport/routes/workspace-file-rpc-routes.ts",
  import.meta.url,
);
const WORKSPACE_FILES = new URL("./workspace-files.ts", import.meta.url);
const WORKSPACE_FILE_CONTENT = new URL("./workspace-file-content.ts", import.meta.url);
const RPC_ROUTER = new URL("../transport/rpc-router.ts", import.meta.url);

const WORKSPACE_ORGANIZATION_RPC_METHODS = [
  "workspace.list",
  "workspace.listArchivedSessions",
  "workspace.create",
  "workspace.rename",
  "workspace.delete",
  "workspace.insertBefore",
  "workspace.insertSessionBefore",
  "workspace.setPinned",
  "workspace.setSessionPinned",
  "workspace.archiveSession",
  "workspace.unarchiveSession",
] as const;

const WORKSPACE_FILE_RPC_METHODS = [
  "workspace.files.list",
  "workspace.files.describe",
  "workspace.files.read",
  "workspace.files.write",
] as const;

test("Workspace transport depends only on the protocol service", async () => {
  const source = await readFile(WORKSPACE_RPC_ROUTES, "utf8");

  assert.match(source, /import type \{ WorkspaceProtocolService \}/);
  assert.doesNotMatch(source, /workspace-registry|WorkspaceStore|session-registry/);
  assert.doesNotMatch(source, /project-trust-service|scoped-resource-context/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  for (const method of WORKSPACE_ORGANIZATION_RPC_METHODS) {
    assert.ok(source.includes(`case "${method}":`), `Missing extracted route: ${method}`);
  }
  for (const method of WORKSPACE_FILE_RPC_METHODS) {
    assert.ok(
      !source.includes(`case "${method}":`),
      `File route leaked into organization: ${method}`,
    );
  }
});

test("Workspace protocol service owns Session catalog, Trust migration, and resource invalidation", async () => {
  const source = await readFile(WORKSPACE_PROTOCOL_SERVICE, "utf8");

  assert.match(source, /from "\.\.\/sessions\/session-registry"/);
  assert.match(source, /from "\.\/workspace-registry"/);
  assert.match(source, /from "\.\.\/trust\/project-trust-service"/);
  assert.match(source, /from "\.\.\/resources\/scoped-resource-context"/);
  assert.match(source, /resolveWorkspaceStore/);
  assert.doesNotMatch(source, /rpc-transport/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
});

test("Workspace file transport depends only on the narrow file protocol", async () => {
  const source = await readFile(WORKSPACE_FILE_RPC_ROUTES, "utf8");

  assert.match(source, /import type \{ WorkspaceFileProtocol \}/);
  assert.doesNotMatch(source, /workspace-registry|WorkspaceStore|session-registry/);
  assert.doesNotMatch(source, /project-trust-service|scoped-resource-context/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  assert.match(source, /RPC_REQUEST_BODY_LIMITS\.workspaceFileWrite/);
  for (const method of WORKSPACE_FILE_RPC_METHODS) {
    assert.ok(source.includes(`case "${method}":`), `Missing extracted file route: ${method}`);
  }
  for (const method of WORKSPACE_ORGANIZATION_RPC_METHODS) {
    assert.ok(
      !source.includes(`case "${method}":`),
      `Organization route leaked into files: ${method}`,
    );
  }
  assert.ok(!source.includes('case "workspace.files.content":'));
});

test("Workspace file service exposes one protocol and a shared late-bound factory", async () => {
  const source = await readFile(WORKSPACE_FILES, "utf8");

  assert.match(source, /export interface WorkspaceFileProtocol/);
  assert.match(source, /class WorkspaceFileService implements WorkspaceFileProtocol/);
  assert.match(source, /export function createWorkspaceFileService/);
  assert.match(source, /workspaceStore: getWorkspaceStore/);
  assert.doesNotMatch(source, /rpc-transport/);
});

test("the RPC router composes both Workspace route groups without handling either domain", async () => {
  const source = await readFile(RPC_ROUTER, "utf8");

  assert.match(source, /const workspaceProtocolService = createWorkspaceProtocolService\(\)/);
  assert.match(source, /const workspaceRpcRoutes = createWorkspaceRpcRoutes\(/);
  assert.match(source, /const workspaceFileService = createWorkspaceFileService\(\)/);
  assert.match(source, /const workspaceFileRpcRoutes = createWorkspaceFileRpcRoutes\(/);
  assert.match(source, /\n\s+workspaceRpcRoutes,/);
  assert.match(source, /\n\s+workspaceFileRpcRoutes,/);
  assert.match(source, /error instanceof WorkspaceProtocolServiceError/);
  for (const method of WORKSPACE_ORGANIZATION_RPC_METHODS) {
    assert.ok(!source.includes(`case "${method}":`), `Router still owns route: ${method}`);
  }
  for (const method of WORKSPACE_FILE_RPC_METHODS) {
    assert.ok(!source.includes(`case "${method}":`), `Router still owns file route: ${method}`);
  }
  assert.doesNotMatch(source, /const workspaceFilesListPayload/);
  assert.doesNotMatch(source, /const workspaceFileReadPayload/);
  assert.doesNotMatch(source, /const workspaceFileWritePayload/);
});

test("the streaming content endpoint stays separate while sharing the default file service", async () => {
  const [routeSource, contentSource] = await Promise.all([
    readFile(WORKSPACE_FILE_RPC_ROUTES, "utf8"),
    readFile(WORKSPACE_FILE_CONTENT, "utf8"),
  ]);

  assert.doesNotMatch(
    routeSource,
    /createReadStream|Readable\.toWeb|parseRange|contentDisposition/,
  );
  assert.match(contentSource, /const workspaceFileService = createWorkspaceFileService\(\)/);
  assert.match(contentSource, /createReadStream/);
  assert.match(contentSource, /parseRange/);
  assert.match(contentSource, /handleWorkspaceFileContentRequest/);
});

test("WorkspaceStore remains the owner of Host stream publication", async () => {
  const source = await readFile(WORKSPACE_STORE, "utf8");

  assert.match(source, /getStreamHub/);
  assert.match(source, /host\/workspace-changed/);
  assert.match(source, /host\/session-archive-changed/);
});
