import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { WorkspaceStore, WorkspaceStoreError } = (await import(
  new URL("./workspace-store.ts", import.meta.url).href
)) as typeof import("./workspace-store");
moduleHooks.deregister();

type WorkspaceStoreEvent = import("./workspace-store").WorkspaceStoreEvent;

interface Fixture {
  root: string;
  stateFile: string;
  workspace(name: string): Promise<string>;
}

async function fixture(context: TestContext): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workspace-store-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    stateFile: path.join(root, "state", "workspaces.json"),
    async workspace(name: string): Promise<string> {
      const workspacePath = path.join(root, "projects", name);
      await mkdir(workspacePath, { recursive: true });
      return workspacePath;
    },
  };
}

function tickingClock(start = "2026-01-02T03:04:05.000Z"): () => Date {
  let tick = 0;
  const epoch = Date.parse(start);
  return () => new Date(epoch + tick++ * 1_000);
}

async function expectStoreError(
  promise: Promise<unknown>,
  code: import("./workspace-store").WorkspaceStoreErrorCode,
  details: object,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof WorkspaceStoreError);
    assert.equal(error.code, code);
    assert.deepEqual(error.details, details);
    return true;
  });
}

test("creates, idempotently canonicalizes, renames, and metadata-deletes workspaces", async (t) => {
  const files = await fixture(t);
  const alpha = await files.workspace("alpha");
  const regularFile = path.join(files.root, "not-a-directory");
  await mkdir(path.dirname(regularFile), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(regularFile, "content"));

  const store = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });
  const events: WorkspaceStoreEvent[] = [];
  const unsubscribe = store.subscribe((event) => events.push(event));

  assert.deepEqual(await store.list(), {
    items: [],
    archivedSessionIds: [],
    pinnedWorkspaceIds: [],
    pinnedSessionIds: [],
  });
  const created = await store.create({ path: alpha });
  assert.equal(created.created, true);
  assert.equal(created.workspace.title, "alpha");
  assert.equal(
    created.workspace.path,
    await import("node:fs/promises").then(({ realpath }) => realpath(alpha)),
  );
  assert.equal(created.workspace.createdAt, "2026-01-02T03:04:05.000Z");
  assert.equal(created.workspace.updatedAt, created.workspace.createdAt);

  const duplicate = await store.create(path.join(alpha, "."));
  assert.equal(duplicate.created, false);
  assert.deepEqual(duplicate.workspace, created.workspace);
  await expectStoreError(store.create("  "), "workspace-invalid-path", { path: "  " });
  await expectStoreError(store.create(regularFile), "workspace-invalid-path", {
    path: regularFile,
  });

  const renamed = await store.rename({
    workspaceId: created.workspace.workspaceId,
    title: "  Alpha project  ",
  });
  assert.equal(renamed.workspace.title, "Alpha project");
  assert.equal(renamed.workspace.updatedAt, "2026-01-02T03:04:06.000Z");

  const listed = await store.list();
  listed.items[0].sessionIds.push("external-mutation");
  assert.deepEqual((await store.list()).items[0].sessionIds, []);

  await expectStoreError(store.delete("missing"), "workspace-not-found", {
    workspaceId: "missing",
  });
  assert.deepEqual(await store.delete(created.workspace.workspaceId), { deleted: true });
  assert.equal(
    (await stat(alpha)).isDirectory(),
    true,
    "metadata deletion must keep the directory",
  );
  assert.deepEqual(await store.list(), {
    items: [],
    archivedSessionIds: [],
    pinnedWorkspaceIds: [],
    pinnedSessionIds: [],
  });
  const recreated = await store.create(alpha);
  assert.notEqual(recreated.workspace.workspaceId, created.workspace.workspaceId);
  unsubscribe();

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "host/workspace-changed",
      "host/workspace-order-changed",
      "host/workspace-changed",
      "host/workspace-removed",
      "host/workspace-order-changed",
      "host/workspace-changed",
      "host/workspace-order-changed",
    ],
  );
});

test("allows equal default titles for different paths but keeps rename titles unique", async (t) => {
  const files = await fixture(t);
  const firstPath = await files.workspace(path.join("one", "project"));
  const secondPath = await files.workspace(path.join("two", "project"));
  const store = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });

  const first = await store.create(firstPath);
  const second = await store.create(secondPath);
  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.deepEqual(
    (await store.list()).items.map((workspace) => workspace.workspaceId),
    [second.workspace.workspaceId, first.workspace.workspaceId],
  );

  await store.rename(first.workspace.workspaceId, "Primary project");
  await expectStoreError(
    store.rename(second.workspace.workspaceId, "Primary project"),
    "workspace-name-conflict",
    { name: "Primary project" },
  );
});

test("serializes concurrent mutations and persists stable workspace order atomically", async (t) => {
  const files = await fixture(t);
  const [alpha, beta, gamma] = await Promise.all([
    files.workspace("alpha"),
    files.workspace("beta"),
    files.workspace("gamma"),
  ]);
  const store = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });

  const results = await Promise.all([
    store.create(alpha),
    store.create(beta),
    store.create(gamma),
    store.create(alpha),
  ]);
  assert.deepEqual(
    results.map((result) => result.created),
    [true, true, true, false],
  );
  const [alphaId, betaId, gammaId] = results.map((result) => result.workspace.workspaceId);

  assert.deepEqual(await store.insertBefore(gammaId, alphaId), {
    workspaceIds: [betaId, gammaId, alphaId],
  });
  assert.deepEqual(await store.insertBefore({ workspaceId: alphaId }), {
    workspaceIds: [betaId, gammaId, alphaId],
  });
  assert.deepEqual(await store.insertBefore(alphaId, alphaId), {
    workspaceIds: [betaId, gammaId, alphaId],
  });
  await expectStoreError(store.insertBefore(alphaId, "missing"), "workspace-not-found", {
    workspaceId: "missing",
  });

  const reloaded = new WorkspaceStore(files.stateFile);
  assert.deepEqual(
    (await reloaded.list()).items.map((workspace) => workspace.workspaceId),
    [betaId, gammaId, alphaId],
  );
  assert.deepEqual(await readdir(path.dirname(files.stateFile)), [path.basename(files.stateFile)]);
});

test("serializes mutations across store instances sharing one state file", async (t) => {
  const files = await fixture(t);
  const [alpha, beta] = await Promise.all([files.workspace("alpha"), files.workspace("beta")]);
  const first = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });
  const second = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });
  await Promise.all([first.list(), second.list()]);

  const [createdAlpha, createdBeta] = await Promise.all([first.create(alpha), second.create(beta)]);
  assert.equal(createdAlpha.created, true);
  assert.equal(createdBeta.created, true);

  const reloaded = new WorkspaceStore(files.stateFile);
  assert.deepEqual((await reloaded.list()).items.map((workspace) => workspace.title).sort(), [
    "alpha",
    "beta",
  ]);
});

test("prepends attached sessions, reorders them locally, and archives globally", async (t) => {
  const files = await fixture(t);
  const [alpha, beta] = await Promise.all([files.workspace("alpha"), files.workspace("beta")]);
  const store = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });
  const alphaWorkspace = (await store.create(alpha)).workspace;
  const betaWorkspace = (await store.create(beta)).workspace;
  await store.reconcile([
    { id: "session-a", cwd: alpha },
    { id: "session-b", cwd: alpha },
    { id: "session-c", cwd: beta },
  ]);

  const events: WorkspaceStoreEvent[] = [];
  store.subscribe((event) => events.push(event));
  const attached = await store.attachSession(alphaWorkspace.workspaceId, "session-d");
  assert.deepEqual(attached.workspace.sessionIds, ["session-d", "session-a", "session-b"]);
  const selfAnchored = await store.insertSessionBefore(
    alphaWorkspace.workspaceId,
    "session-d",
    "session-d",
  );
  assert.deepEqual(selfAnchored.workspace.sessionIds, ["session-d", "session-a", "session-b"]);

  const reordered = await store.insertSessionBefore(
    alphaWorkspace.workspaceId,
    "session-b",
    "session-a",
  );
  assert.deepEqual(reordered.workspace.sessionIds, ["session-d", "session-b", "session-a"]);
  const appended = await store.insertSessionBefore(alphaWorkspace.workspaceId, "session-d");
  assert.deepEqual(appended.workspace.sessionIds, ["session-b", "session-a", "session-d"]);
  await expectStoreError(
    store.insertSessionBefore(betaWorkspace.workspaceId, "session-b", "session-c"),
    "workspace-move-invalid",
    {
      workspaceId: betaWorkspace.workspaceId,
      sessionId: "session-b",
      beforeSessionId: "session-c",
    },
  );
  await expectStoreError(
    store.insertSessionBefore(betaWorkspace.workspaceId, "unknown"),
    "workspace-move-invalid",
    { workspaceId: betaWorkspace.workspaceId, sessionId: "unknown" },
  );
  await expectStoreError(
    store.insertSessionBefore(betaWorkspace.workspaceId, "session-c", "missing"),
    "workspace-move-invalid",
    {
      workspaceId: betaWorkspace.workspaceId,
      sessionId: "session-c",
      beforeSessionId: "missing",
    },
  );

  const archivedAlpha = await store.archiveSession("session-a");
  assert.deepEqual(archivedAlpha, { sessionId: "session-a", archived: true });

  const alreadyArchivedAlpha = await store.archiveSession({ sessionId: "session-a" });
  assert.deepEqual(alreadyArchivedAlpha, { sessionId: "session-a", archived: true });

  const archivedBeta = await store.archiveSession("session-c");
  assert.deepEqual(archivedBeta, { sessionId: "session-c", archived: true });

  const unarchivedAlpha = await store.setSessionArchived("session-a", false);
  assert.deepEqual(unarchivedAlpha, { sessionId: "session-a", archived: false });
  const list = await store.list();
  assert.deepEqual(list.archivedSessionIds, ["session-c"]);
  assert.deepEqual(
    list.items.find((workspace) => workspace.workspaceId === alphaWorkspace.workspaceId)
      ?.sessionIds,
    ["session-b", "session-a", "session-d"],
  );
  assert.deepEqual(
    list.items.find((workspace) => workspace.workspaceId === betaWorkspace.workspaceId)?.sessionIds,
    [],
  );

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "host/workspace-changed",
      "host/workspace-changed",
      "host/workspace-changed",
      "host/session-archive-changed",
      "host/session-archive-changed",
      "host/session-archive-changed",
      "host/session-archive-changed",
    ],
  );
  assert.deepEqual(
    events
      .slice(-4)
      .map((event) =>
        event.type === "host/session-archive-changed"
          ? [event.sessionId, event.archived, event.workspace?.sessionIds]
          : [event.type],
      ),
    [
      ["session-a", true, ["session-b", "session-d"]],
      ["session-a", true, ["session-b", "session-d"]],
      ["session-c", true, []],
      ["session-a", false, ["session-b", "session-a", "session-d"]],
    ],
  );
});

test("reloads state and only imports unknown legacy workspaces once", async (t) => {
  const files = await fixture(t);
  const [alpha, beta, gamma] = await Promise.all([
    files.workspace("alpha"),
    files.workspace("beta"),
    files.workspace("gamma"),
  ]);
  const first = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });
  const imported = await first.reconcile([
    { id: "alpha-1", cwd: alpha },
    { id: "beta-1", cwd: beta },
  ]);
  assert.deepEqual(
    imported.items.map((workspace) => [workspace.title, workspace.sessionIds]),
    [
      ["alpha", ["alpha-1"]],
      ["beta", ["beta-1"]],
    ],
  );
  const betaId = imported.items[1].workspaceId;
  await first.archiveSession("beta-1");
  await first.delete(betaId);

  const second = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });
  const afterRestart = await second.reconcile([
    { id: "alpha-1", cwd: alpha },
    { id: "alpha-2", cwd: alpha },
    { id: "beta-2", cwd: beta },
    { id: "gamma-1", cwd: gamma },
  ]);
  assert.deepEqual(
    afterRestart.items.map((workspace) => workspace.title),
    ["alpha"],
  );
  assert.deepEqual(afterRestart.items[0].sessionIds, ["alpha-1"]);
  assert.deepEqual(afterRestart.archivedSessionIds, ["beta-1"]);

  const explicitlyImported = await second.reconcile(
    [
      { id: "beta-2", cwd: beta },
      { id: "gamma-1", cwd: gamma },
    ],
    { importUnknownWorkspaces: true },
  );
  assert.deepEqual(
    explicitlyImported.items.map((workspace) => workspace.title),
    ["alpha", "gamma"],
  );
  assert.deepEqual(explicitlyImported.items[1].sessionIds, ["gamma-1"]);

  const recreatedBeta = await second.create(beta);
  assert.equal(recreatedBeta.created, true);
  const reconciledAgain = await second.reconcile([{ id: "beta-2", cwd: beta }]);
  assert.deepEqual(
    reconciledAgain.items.find(
      (workspace) => workspace.workspaceId === recreatedBeta.workspace.workspaceId,
    )?.sessionIds,
    [],
  );
  const attached = await second.attachSession(recreatedBeta.workspace.workspaceId, "beta-2");
  assert.deepEqual(attached.workspace.sessionIds, ["beta-2"]);

  const persisted = JSON.parse(await readFile(files.stateFile, "utf8")) as {
    schemaVersion: number;
    legacyReconciled: boolean;
    ignoredWorkspacePaths: string[];
  };
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.legacyReconciled, true);
  assert.deepEqual(persisted.ignoredWorkspacePaths, []);

  const third = new WorkspaceStore(files.stateFile);
  assert.deepEqual(await third.list(), await second.list());
});

test("persists workspace and session pins and publishes authoritative changes", async (t) => {
  const files = await fixture(t);
  const alpha = await files.workspace("alpha");
  const first = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });
  const imported = await first.reconcile([{ id: "session-a", cwd: alpha }]);
  const workspaceId = imported.items[0].workspaceId;
  const events: WorkspaceStoreEvent[] = [];
  first.subscribe((event) => events.push(event));

  assert.deepEqual(await first.setPinned({ workspaceId, pinned: true }), {
    workspaceId,
    pinned: true,
  });
  assert.deepEqual(await first.setSessionPinned({ sessionId: "session-a", pinned: true }), {
    sessionId: "session-a",
    pinned: true,
  });
  assert.deepEqual((await first.list()).pinnedWorkspaceIds, [workspaceId]);
  assert.deepEqual((await first.list()).pinnedSessionIds, ["session-a"]);

  const second = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });
  assert.deepEqual((await second.list()).pinnedWorkspaceIds, [workspaceId]);
  assert.deepEqual((await second.list()).pinnedSessionIds, ["session-a"]);
  await second.removeSession("session-a");
  await second.delete(workspaceId);
  assert.deepEqual((await second.list()).pinnedWorkspaceIds, []);
  assert.deepEqual((await second.list()).pinnedSessionIds, []);

  assert.deepEqual(
    events.map((event) => event.type),
    ["host/workspace-pinned-changed", "host/session-pinned-changed"],
  );
});

test("unarchive restores an unassigned session to its canonical workspace atomically", async (t) => {
  const files = await fixture(t);
  const alpha = await files.workspace("alpha");
  const store = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });
  const imported = await store.reconcile([{ id: "session-a", cwd: alpha }]);
  await store.archiveSession("session-a");
  await store.delete(imported.items[0].workspaceId);

  const events: WorkspaceStoreEvent[] = [];
  store.subscribe((event) => events.push(event));
  assert.deepEqual(await store.unarchiveSession({ id: "session-a", cwd: alpha }), {
    sessionId: "session-a",
    archived: false,
  });

  const restored = await store.list();
  assert.deepEqual(restored.archivedSessionIds, []);
  assert.deepEqual(
    restored.items.map((workspace) => [workspace.title, workspace.sessionIds]),
    [["alpha", ["session-a"]]],
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "host/session-archive-changed");
  if (events[0]?.type !== "host/session-archive-changed") {
    assert.fail("expected one atomic archive event");
  }
  assert.deepEqual(events[0].workspace?.sessionIds, ["session-a"]);
});

test("explicit session removal clears workspace and archive metadata", async (t) => {
  const files = await fixture(t);
  const alpha = await files.workspace("alpha");
  const store = new WorkspaceStore({ stateFile: files.stateFile, now: tickingClock() });
  const workspace = (await store.create(alpha)).workspace;
  await store.reconcile([{ id: "session-a", cwd: alpha }]);
  await store.archiveSession("session-a");

  const events: WorkspaceStoreEvent[] = [];
  store.subscribe((event) => events.push(event));
  assert.deepEqual(await store.removeSession("session-a"), { removed: true });
  assert.deepEqual(await store.removeSession("session-a"), { removed: false });
  const reconciled = await store.list();

  assert.deepEqual(reconciled.items[0].sessionIds, []);
  assert.deepEqual(reconciled.archivedSessionIds, []);
  assert.equal(reconciled.items[0].workspaceId, workspace.workspaceId);
  assert.deepEqual(
    events.map((event) => event.type),
    ["host/workspace-changed", "host/session-archive-changed"],
  );
});
