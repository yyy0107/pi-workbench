import assert from "node:assert/strict";
import test from "node:test";

import {
  TerminalInteractionDetector,
  type TerminalInteractionDetectorScheduler,
} from "./terminal-interaction-detector";

class FakeScheduler implements TerminalInteractionDetectorScheduler {
  nowValue = 0;
  nextId = 0;
  readonly tasks = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.nowValue;
  }

  schedule(callback: () => void, delayMs: number): number {
    const id = ++this.nextId;
    this.tasks.set(id, { at: this.nowValue + delayMs, callback });
    return id;
  }

  cancel(handle: unknown): void {
    this.tasks.delete(Number(handle));
  }

  advance(milliseconds: number): void {
    const target = this.nowValue + milliseconds;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      this.tasks.delete(next[0]);
      this.nowValue = next[1].at;
      next[1].callback();
    }
    this.nowValue = target;
  }
}

test("does not infer interaction from quiet plain output", () => {
  const scheduler = new FakeScheduler();
  const detector = new TerminalInteractionDetector({ scheduler, quietPeriodMs: 800 });

  detector.feed("Compiling application...\r\n");
  scheduler.advance(10_000);

  assert.equal(detector.state, "none");
});

test("detects a quiet confirmation prompt without ANSI control sequences", () => {
  const scheduler = new FakeScheduler();
  const detector = new TerminalInteractionDetector({ scheduler, quietPeriodMs: 800 });

  detector.feed("Continue? [y/N] ");
  scheduler.advance(799);
  assert.equal(detector.state, "none");
  scheduler.advance(1);

  assert.equal(detector.state, "possible");
});

test("detects a secret prompt split across PTY chunks", () => {
  const scheduler = new FakeScheduler();
  const detector = new TerminalInteractionDetector({ scheduler, quietPeriodMs: 100 });

  detector.feed("Enter pass");
  detector.feed("phrase for key '/tmp/id_ed25519': ");
  scheduler.advance(100);

  assert.equal(detector.state, "possible");
});

test("does not treat an ordinary completed status line as a prompt", () => {
  const scheduler = new FakeScheduler();
  const detector = new TerminalInteractionDetector({ scheduler, quietPeriodMs: 100 });

  detector.feed("Status: ready\r\n");
  scheduler.advance(1_000);

  assert.equal(detector.state, "none");
});

test("marks a live process as possibly interactive after TUI signals become quiet", () => {
  const scheduler = new FakeScheduler();
  const states: string[] = [];
  const detector = new TerminalInteractionDetector({
    scheduler,
    quietPeriodMs: 800,
    onStateChange: (state) => states.push(state),
  });

  detector.feed("\u001b[?25l\u001b[1G\u001b[JSelect a skill");
  scheduler.advance(799);
  assert.equal(detector.state, "none");
  scheduler.advance(1);

  assert.equal(detector.state, "possible");
  assert.deepEqual(states, ["possible"]);
});

test("resets a possible prompt when ordinary output resumes", () => {
  const scheduler = new FakeScheduler();
  const detector = new TerminalInteractionDetector({ scheduler, quietPeriodMs: 100 });

  detector.feed("\u001b[?25l\u001b[2J");
  scheduler.advance(100);
  assert.equal(detector.state, "possible");

  detector.feed("download complete\r\n");
  assert.equal(detector.state, "none");
});

test("tracks user input separately from process completion", () => {
  const scheduler = new FakeScheduler();
  const detector = new TerminalInteractionDetector({ scheduler });

  detector.recordInput();
  assert.equal(detector.state, "active");

  detector.finish();
  assert.equal(detector.state, "none");
});

test("returns active interaction to none after the process resumes output", () => {
  const scheduler = new FakeScheduler();
  const states: string[] = [];
  const detector = new TerminalInteractionDetector({
    scheduler,
    activeSettleMs: 400,
    onStateChange: (state) => states.push(state),
  });

  detector.recordInput();
  detector.feed("Installing packages...\r\n");
  scheduler.advance(399);
  assert.equal(detector.state, "active");
  scheduler.advance(1);

  assert.equal(detector.state, "none");
  assert.deepEqual(states, ["active", "none"]);
});

test("detects another prompt after user input and resumed output", () => {
  const scheduler = new FakeScheduler();
  const detector = new TerminalInteractionDetector({
    scheduler,
    quietPeriodMs: 100,
    activeSettleMs: 50,
  });

  detector.recordInput();
  detector.feed("Installing packages...\r\n");
  scheduler.advance(50);
  assert.equal(detector.state, "none");

  detector.feed("Confirm installation? [y/N] ");
  scheduler.advance(100);
  assert.equal(detector.state, "possible");
});
