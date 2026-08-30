import assert from "node:assert/strict";
import test from "node:test";

import type { PiSideChatClient } from "@/workbench/runtime-contributions/pi/client/side-chat";

import { markScratchSessionPromoted, retainScratchSession } from "./scratch-session-lease";

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

test("keeps a scratch alive across a transient Surface remount and releases it on close", async () => {
  const released: string[] = [];
  const manager = {
    releaseScratchSession: async (sessionId: string) => void released.push(sessionId),
  } as PiSideChatClient;
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
  } as PiSideChatClient;
  const sessionId = `scratch-promoted-${Date.now()}`;

  const release = retainScratchSession(manager, sessionId);
  markScratchSessionPromoted(sessionId);
  release();
  await nextTask();

  assert.deepEqual(released, []);
});
