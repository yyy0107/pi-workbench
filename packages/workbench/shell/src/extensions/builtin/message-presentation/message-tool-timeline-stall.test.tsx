import assert from "node:assert/strict";
import test from "node:test";

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "../../../../test/react-dom-environment";

import { useReasoningStalled } from "./message-tool-timeline";

test("marks running reasoning as stalled until another content delta arrives", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let timeout: (() => void) | undefined;
  let stalled: boolean | undefined;
  const renders: boolean[] = [];

  Object.assign(window, {
    setTimeout(callback: () => void) {
      timeout = callback;
      return 1;
    },
    clearTimeout() {
      timeout = undefined;
    },
  });

  function Probe({ content, running = true }: { content: string; running?: boolean }) {
    stalled = useReasoningStalled(running, content);
    renders.push(stalled);
    return null;
  }

  try {
    await act(async () => {
      root.render(createElement(Probe, { content: "partial" }));
      await flushReactMicrotasks();
    });
    assert.equal(stalled, false);

    await act(async () => {
      timeout?.();
      await flushReactMicrotasks();
    });
    assert.equal(stalled, true);

    renders.length = 0;
    await act(async () => {
      root.render(createElement(Probe, { content: "partial continued" }));
      await flushReactMicrotasks();
    });
    assert.deepEqual(renders, [false], "new content resets immediately without an effect update");

    const contentTimer = timeout;
    await act(async () => {
      root.render(createElement(Probe, { content: "partial continued" }));
      await flushReactMicrotasks();
    });
    assert.equal(timeout, contentTimer, "unchanged content preserves the timer");

    await act(async () => {
      timeout?.();
      await flushReactMicrotasks();
    });
    assert.equal(stalled, true);

    renders.length = 0;
    await act(async () => {
      root.render(createElement(Probe, { content: "partial continued", running: false }));
      await flushReactMicrotasks();
    });
    assert.deepEqual(renders, [false], "stopping clears stalled immediately");
    assert.equal(timeout, undefined, "stopping cancels the timer");

    await act(async () => {
      root.render(createElement(Probe, { content: "partial continued" }));
      await flushReactMicrotasks();
    });
    assert.equal(stalled, false, "resuming identical content starts a fresh wait");
    assert.ok(timeout);
    assert.notEqual(timeout, contentTimer);

    await act(async () => {
      timeout?.();
      await flushReactMicrotasks();
    });
    assert.equal(stalled, true);
  } finally {
    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    assert.equal(timeout, undefined, "unmount cancels the timer");
    environment.restore();
  }
});
