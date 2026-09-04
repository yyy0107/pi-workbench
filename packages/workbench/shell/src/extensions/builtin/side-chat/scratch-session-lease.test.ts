import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchScratchSessionCapability } from "@workbench/agent-runtime-client/capabilities";

import { markScratchSessionPromoted, retainScratchSession } from "./scratch-session-lease";

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

test("keeps a scratch alive across a transient Surface remount and releases it on close", async () => {
  const released: string[] = [];
  const manager = {
    releaseScratchSession: async (sessionId: string) => void released.push(sessionId),
  } as WorkbenchScratchSessionCapability;
  const sessionId = `scratch-remount-${Date.now()}`;

  const firstRelease = retainScratchSession(manager, sessionId);
  firstRelease();
  const finalRelease = retainScratchSession(manager, sessionId);
  await nextTask();
  assert.deepEqual(released, []);

  finalRelease();
  await nextTask();
  assert.deepEqual(released, [sessionId]);
});

test("does not release a scratch identity after promotion consumed it", async () => {
  const released: string[] = [];
  const manager = {
    releaseScratchSession: async (sessionId: string) => void released.push(sessionId),
  } as WorkbenchScratchSessionCapability;
  const sessionId = `scratch-promoted-${Date.now()}`;

  const release = retainScratchSession(manager, sessionId);
  markScratchSessionPromoted(manager, sessionId);
  release();
  await nextTask();

  assert.deepEqual(released, []);
});

test("does not merge equal scratch ids from separate runtime installations", async () => {
  const firstReleased: string[] = [];
  const secondReleased: string[] = [];
  const firstManager = {
    releaseScratchSession: async (sessionId: string) => void firstReleased.push(sessionId),
  } as WorkbenchScratchSessionCapability;
  const secondManager = {
    releaseScratchSession: async (sessionId: string) => void secondReleased.push(sessionId),
  } as WorkbenchScratchSessionCapability;
  const sessionId = `scratch-shared-id-${Date.now()}`;

  const releaseFirst = retainScratchSession(firstManager, sessionId);
  const releaseSecond = retainScratchSession(secondManager, sessionId);
  releaseSecond();
  await nextTask();
  assert.deepEqual(firstReleased, []);
  assert.deepEqual(secondReleased, [sessionId]);

  releaseFirst();
  await nextTask();
  assert.deepEqual(firstReleased, [sessionId]);
});
