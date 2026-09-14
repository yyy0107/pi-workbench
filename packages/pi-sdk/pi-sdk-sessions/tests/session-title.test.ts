import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  appendSessionTitleOrigin,
  persistGeneratedSessionTitle,
  sessionTitleOriginFromEntries,
} from "@workbench/pi-sdk-sessions/session-title";

async function manager(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-title-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return SessionManager.create(root);
}

test("persists a generated title and its origin from the first user message", async (t) => {
  const session = await manager(t);
  assert.equal(
    persistGeneratedSessionTitle(session, "请修复 `src/really-long-file.ts` 中的加载问题"),
    "请修复 `src/really-long-file.ts` 中的加载问题",
  );
  assert.equal(session.getSessionName(), "请修复 `src/really-long-file.ts` 中的加载问题");
  assert.equal(sessionTitleOriginFromEntries(session.getEntries()), "generated");
  const entryCount = session.getEntries().length;
  assert.equal(persistGeneratedSessionTitle(session, "later message"), undefined);
  assert.equal(session.getEntries().length, entryCount);
});

test("never replaces an existing title even when it predates origin metadata", async (t) => {
  const session = await manager(t);
  session.appendSessionInfo("Existing title");
  assert.equal(persistGeneratedSessionTitle(session, "new first message"), undefined);
  assert.equal(session.getSessionName(), "Existing title");
});

test("an explicit origin protects a deliberately untitled session", async (t) => {
  const session = await manager(t);
  appendSessionTitleOrigin(session, "explicit");
  assert.equal(persistGeneratedSessionTitle(session, "must not become the title"), undefined);
  assert.equal(session.getSessionName(), undefined);
  assert.equal(sessionTitleOriginFromEntries(session.getEntries()), "explicit");
});

test("does not persist a title for an empty first message", async (t) => {
  const session = await manager(t);
  assert.equal(persistGeneratedSessionTitle(session, "  \n  "), undefined);
  assert.equal(session.getSessionName(), undefined);
  assert.equal(sessionTitleOriginFromEntries(session.getEntries()), undefined);
});
