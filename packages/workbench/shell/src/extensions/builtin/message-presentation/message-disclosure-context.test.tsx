import assert from "node:assert/strict";
import test from "node:test";

import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";

import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "../../../../test/react-dom-environment";

import { MessageDisclosureProvider, useMessageDisclosure } from "./message-disclosure-context";
import type { MessagePresentationPhase } from "./message-presentation-policy";

test("resets disclosure defaults across phases without remounting message content", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let mounted = true;
  let mounts = 0;
  let unmounts = 0;
  let stepsOpen: boolean | undefined;
  let setStepsOpen: ((open: boolean) => void) | undefined;

  function Probe() {
    [stepsOpen, setStepsOpen] = useMessageDisclosure("steps", "timeline");
    useEffect(() => {
      mounts += 1;
      return () => {
        unmounts += 1;
      };
    }, []);
    return null;
  }

  const renderPhase = (phase: MessagePresentationPhase) =>
    createElement(MessageDisclosureProvider, { phase }, createElement(Probe));

  try {
    await act(async () => {
      root.render(renderPhase("streaming"));
      await flushReactMicrotasks();
    });
    assert.equal(stepsOpen, true);
    assert.equal(mounts, 1);

    await act(async () => {
      setStepsOpen?.(false);
      await flushReactMicrotasks();
    });
    assert.equal(stepsOpen, false);

    await act(async () => {
      root.render(renderPhase("completed"));
      await flushReactMicrotasks();
    });
    assert.equal(stepsOpen, false);
    assert.equal(mounts, 1);
    assert.equal(unmounts, 0);

    await act(async () => {
      root.render(renderPhase("streaming"));
      await flushReactMicrotasks();
    });
    assert.equal(stepsOpen, true);
    assert.equal(mounts, 1);
    assert.equal(unmounts, 0);

    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    mounted = false;
    assert.equal(unmounts, 1);
  } finally {
    if (mounted) {
      await act(async () => {
        root.unmount();
        await flushReactMicrotasks();
      });
    }
    environment.restore();
  }
});
