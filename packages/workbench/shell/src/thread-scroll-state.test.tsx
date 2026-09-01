import assert from "node:assert/strict";
import test from "node:test";

import { act, createElement, Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  ThreadScrollStateProvider,
  useThreadScrollState,
  type ThreadScrollPersistencePort,
} from "./thread-scroll-state";
import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "../test/react-dom-environment";

test("Workbench installations isolate same-id scroll state and cancel late persistence", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const frames = new Map<number, FrameRequestCallback>();
  const canceledFrames: number[] = [];
  const writes = { first: [] as string[], second: [] as string[] };
  let nextFrame = 1;
  Object.assign(window, {
    requestAnimationFrame(callback: FrameRequestCallback) {
      const frame = nextFrame++;
      frames.set(frame, callback);
      return frame;
    },
    cancelAnimationFrame(frame: number) {
      canceledFrames.push(frame);
    },
  });

  const createPersistence = (scrollTop: number, target: string[]): ThreadScrollPersistencePort => ({
    read() {
      return JSON.stringify([["shared-thread", { scrollTop, atBottom: false }]]);
    },
    write(serialized) {
      target.push(serialized);
    },
  });
  const firstPersistence = createPersistence(10, writes.first);
  const secondPersistence = createPersistence(20, writes.second);
  let firstState: ReturnType<typeof useThreadScrollState> | undefined;
  let secondState: ReturnType<typeof useThreadScrollState> | undefined;

  function Probe({ installation }: { installation: "first" | "second" }) {
    const state = useThreadScrollState();
    if (installation === "first") firstState = state;
    else secondState = state;
    return null;
  }

  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            Fragment,
            null,
            createElement(ThreadScrollStateProvider, {
              persistence: firstPersistence,
              children: createElement(Probe, { installation: "first" }),
            }),
            createElement(ThreadScrollStateProvider, {
              persistence: secondPersistence,
              children: createElement(Probe, { installation: "second" }),
            }),
          ),
        ),
      );
      await flushReactMicrotasks();
    });

    assert.equal(firstState?.get("shared-thread")?.scrollTop, 10);
    assert.equal(secondState?.get("shared-thread")?.scrollTop, 20);
    firstState?.save("shared-thread", { scrollTop: 30, atBottom: true });
    secondState?.save("shared-thread", { scrollTop: 40, atBottom: false });
    assert.equal(firstState?.get("shared-thread")?.scrollTop, 30);
    assert.equal(secondState?.get("shared-thread")?.scrollTop, 40);
    assert.equal(frames.size, 2);

    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    assert.deepEqual(canceledFrames.sort(), [1, 2]);

    // Even a broken scheduler delivering canceled callbacks cannot write after true unmount.
    for (const callback of frames.values()) callback(0);
    assert.deepEqual(writes, { first: [], second: [] });
  } finally {
    environment.restore();
  }
});
