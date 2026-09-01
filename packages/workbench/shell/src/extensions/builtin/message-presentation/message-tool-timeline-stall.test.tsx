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

  Object.assign(window, {
    setTimeout(callback: () => void) {
      timeout = callback;
      return 1;
    },
    clearTimeout() {
      timeout = undefined;
    },
  });

  function Probe({ content }: { content: string }) {
    stalled = useReasoningStalled(true, content);
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

    await act(async () => {
      root.render(createElement(Probe, { content: "partial continued" }));
      await flushReactMicrotasks();
    });
    assert.equal(stalled, false);
  } finally {
    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    environment.restore();
  }
});
