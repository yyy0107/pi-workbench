import assert from "node:assert/strict";
import test from "node:test";

import { PersistedSessionDirectory } from "../src/persisted-session-directory";
import { PersistedSessionRegistryState } from "../src/session-registry-state";

test("persisted directory removes info, summary and fingerprint from its authoritative state", () => {
  const state = new PersistedSessionRegistryState();
  const directory = new PersistedSessionDirectory(state);
  const summary = {
    id: "session",
    cwd: "/workspace",
    workspace: { id: "workspace", name: "workspace", cwd: "/workspace" },
    name: "Session",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
    transient: false,
    running: false,
    waitingForUserInput: false,
  };
  const info = {
    id: "session",
    path: "/sessions/session.jsonl",
    cwd: "/workspace",
    created: new Date("2026-01-01T00:00:00.000Z"),
    modified: new Date("2026-01-01T00:00:00.000Z"),
    messageCount: 0,
    firstMessage: "",
    allMessagesText: "",
  };

  directory.cache(info, summary);
  assert.equal(directory.info("session"), info);
  assert.equal(state.summaries.get("session"), summary);
  state.fingerprints.set(info.path, "fingerprint");
  directory.remove("session");

  assert.equal(state.sessions.has("session"), false);
  assert.equal(state.summaries.has("session"), false);
  assert.equal(directory.info("session"), undefined);
  assert.equal(state.fingerprints.has(info.path), false);
});
