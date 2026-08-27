import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";

import type { PiSessionSummary } from "@/runtime/pi/contracts/pi";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/u.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { configuredSessionCatalogIndexFile, readSessionCatalogIndex, writeSessionCatalogIndex } =
  (await import(
    new URL("./session-catalog-index.ts", import.meta.url).href
  )) as typeof import("./session-catalog-index");
const { listSessions, listSessionSearchText } = (await import(
  new URL("./session-registry.ts", import.meta.url).href
)) as typeof import("./session-registry");
moduleHooks.deregister();

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-catalog-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionRoot = path.join(root, "agent", "sessions");
  const projectDirectory = path.join(sessionRoot, "project");
  await mkdir(projectDirectory, { recursive: true });
  const sessionFile = path.join(projectDirectory, "session.jsonl");
  await writeFile(sessionFile, '{"type":"session"}\n', { mode: 0o600 });
  const metadata = await stat(sessionFile);
  const info: SessionInfo = {
    path: sessionFile,
    id: "session-1",
    cwd: path.join(root, "project"),
    name: "Indexed session",
    created: new Date("2026-08-20T00:00:00.000Z"),
    modified: new Date("2026-08-20T00:00:01.000Z"),
    messageCount: 2,
    firstMessage: "Raw first message",
    allMessagesText: "Raw first message Indexed response",
  };
  const summary: PiSessionSummary = {
    id: info.id,
    cwd: info.cwd,
    workspace: { id: "workspace-1", name: "Project", cwd: info.cwd },
    name: info.name,
    created: info.created.toISOString(),
    modified: "2026-08-20T00:00:02.000Z",
    messageCount: info.messageCount,
    firstMessage: "Display first message",
    transient: false,
    running: false,
  };
  return {
    sessionRoot,
    sessionFile,
    info,
    summary,
    fingerprint: `${metadata.size}:${metadata.mtimeMs}`,
  };
}

test("round-trips session summaries and search text through a mode-0600 index", async (t) => {
  const { sessionRoot, sessionFile, info, summary, fingerprint } = await fixture(t);
  const written = await writeSessionCatalogIndex(
    sessionRoot,
    new Map([[info.id, info]]),
    new Map([[summary.id, summary]]),
    new Map([[sessionFile, fingerprint]]),
  );

  assert.equal(written.entries, 1);
  assert.ok(written.bytes > 0);
  const indexMetadata = await stat(configuredSessionCatalogIndexFile(sessionRoot));
  assert.equal(indexMetadata.mode & 0o777, 0o600);

  const loaded = await readSessionCatalogIndex(sessionRoot);
  assert.equal(loaded.status, "hit");
  if (loaded.status !== "hit") assert.fail("Expected a readable session catalog index");
  assert.equal(loaded.snapshot.fingerprints.get(sessionFile), fingerprint);
  assert.deepEqual(loaded.snapshot.sessions.get(info.id), info);
  assert.deepEqual(loaded.snapshot.summaries.get(info.id), {
    id: info.id,
    cwd: info.cwd,
    name: info.name,
    created: info.created.toISOString(),
    modified: summary.modified,
    messageCount: info.messageCount,
    firstMessage: summary.firstMessage,
    transient: false,
    running: false,
  });
});

test("ignores corrupt indexes and entries outside the session root", async (t) => {
  const { sessionRoot, info, summary } = await fixture(t);
  const outsideFile = path.join(path.dirname(sessionRoot), "outside.jsonl");
  await writeFile(outsideFile, "{}\n");

  const written = await writeSessionCatalogIndex(
    sessionRoot,
    new Map([[info.id, { ...info, path: outsideFile }]]),
    new Map([[summary.id, summary]]),
    new Map([[outsideFile, "3:1"]]),
  );
  assert.equal(written.entries, 0);
  const empty = await readSessionCatalogIndex(sessionRoot);
  assert.equal(empty.status, "hit");
  if (empty.status === "hit") assert.equal(empty.snapshot.sessions.size, 0);

  await writeFile(configuredSessionCatalogIndexFile(sessionRoot), "not-json\n", { mode: 0o600 });
  const corrupt = await readSessionCatalogIndex(sessionRoot);
  assert.equal(corrupt.status, "invalid");
});

test("restores the session catalog without a full scan after process state is lost", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-persistent-session-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const globals = globalThis as typeof globalThis & { __workbenchPiRegistry?: unknown };
  delete globals.__workbenchPiRegistry;
  t.after(() => delete globals.__workbenchPiRegistry);

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, undefined, { id: "persistent-metadata-cache" });
  manager.appendMessage({ role: "user", content: "persist me", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "persisted" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now() + 1,
  });
  assert.ok(manager.getSessionFile());

  const originalListAll = SessionManager.listAll;
  let fullScanCount = 0;
  Object.defineProperty(SessionManager, "listAll", {
    configurable: true,
    value: async (...args: unknown[]) => {
      fullScanCount += 1;
      return Reflect.apply(originalListAll, SessionManager, args) as ReturnType<
        typeof SessionManager.listAll
      >;
    },
  });
  t.after(() => {
    Object.defineProperty(SessionManager, "listAll", {
      configurable: true,
      value: originalListAll,
    });
  });

  const first = await listSessions();
  assert.equal(first.sessions[0]?.id, manager.getSessionId());
  assert.equal(fullScanCount, 1);
  assert.match((await listSessionSearchText())[0]?.allMessagesText ?? "", /persist me persisted/u);

  delete globals.__workbenchPiRegistry;
  const afterRestart = await listSessions();

  assert.deepEqual(afterRestart, first);
  assert.equal(fullScanCount, 1, "a persisted index must replace the process-start full scan");
});
