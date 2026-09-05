import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_NOTIFICATION_SOUNDS,
  type DesktopNotificationSound,
} from "@workbench/desktop-contracts";
import { playNotificationSound, stopNotificationSound } from "./notification-sounds";

test("built-in tones differ, release audio resources, and replace ongoing playback", async (t) => {
  const contexts: TestAudioContext[] = [];
  let rejectResume = false;
  const parameter = () => ({
    values: [] as number[],
    setValueAtTime(value: number) {
      this.values.push(value);
    },
    linearRampToValueAtTime(value: number) {
      this.values.push(value);
    },
    exponentialRampToValueAtTime(value: number) {
      this.values.push(value);
    },
  });
  class TestAudioContext {
    state = "suspended";
    currentTime = 0;
    destination = {};
    nodes: { frequency: ReturnType<typeof parameter>; onended?: () => void; endsAt: number }[] = [];
    constructor() {
      contexts.push(this);
    }
    async resume() {
      if (rejectResume) throw new Error("audio-unavailable");
      this.state = "running";
    }
    async close() {
      this.state = "closed";
    }
    createGain() {
      return { gain: parameter(), connect() {}, disconnect() {} };
    }
    createOscillator() {
      const node = {
        frequency: parameter(),
        onended: undefined as (() => void) | undefined,
        endsAt: 0,
        connect() {},
        disconnect() {},
        start() {},
        stop(time: number) {
          this.endsAt = time;
        },
      };
      this.nodes.push(node);
      return node;
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: TestAudioContext,
  });
  t.after(() => {
    stopNotificationSound();
    if (descriptor) Object.defineProperty(globalThis, "AudioContext", descriptor);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  });
  const tones = new Set();
  for (const sound of DESKTOP_NOTIFICATION_SOUNDS) {
    await playNotificationSound(sound);
    const context = contexts.at(-1)!;
    tones.add(JSON.stringify(context.nodes.map((node) => [node.frequency.values, node.endsAt])));
    assert.ok(context.nodes.every((node) => node.endsAt > 0 && node.endsAt < 1));
    for (const node of context.nodes) node.onended?.();
    assert.equal(context.state, "closed");
  }
  assert.equal(tones.size, DESKTOP_NOTIFICATION_SOUNDS.length);
  await playNotificationSound("chime");
  const previous = contexts.at(-1)!;
  await playNotificationSound("bell");
  assert.equal(previous.state, "closed");
  for (const node of previous.nodes) node.onended?.();
  assert.equal(contexts.at(-1)!.state, "running");
  stopNotificationSound();
  assert.equal(contexts.at(-1)!.state, "closed");
  rejectResume = true;
  await assert.rejects(playNotificationSound("soft"), /audio-unavailable/);
  assert.equal(contexts.at(-1)!.state, "closed");
  const count = contexts.length;
  await assert.rejects(
    playNotificationSound("unknown" as DesktopNotificationSound),
    /invalid-notification-sound/,
  );
  assert.equal(contexts.length, count);
});
