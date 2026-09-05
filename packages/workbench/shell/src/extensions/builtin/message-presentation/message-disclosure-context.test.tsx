import assert from "node:assert/strict";
import test from "node:test";

import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";

import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "../../../../test/react-dom-environment";

import {
  MessageDisclosureProvider,
  MessageDisclosureScope,
  useMessageDisclosure,
} from "./message-disclosure-context";
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

test("closing a disclosure resets nested overrides without closing sibling groups", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const states = new Map<string, readonly [boolean, (open: boolean) => void]>();

  function Tool({ id }: { id: string }) {
    states.set(id, useMessageDisclosure("tool", id));
    return null;
  }
  function Group({ id }: { id: string }) {
    const state = useMessageDisclosure("parallel-tools", id);
    states.set(id, state);
    return createElement(
      MessageDisclosureScope,
      { kind: "parallel-tools", id },
      state[0] ? createElement(Tool, { id: `${id}-tool` }) : null,
    );
  }
  function Timeline() {
    const state = useMessageDisclosure("steps", "timeline");
    states.set("timeline", state);
    return createElement(
      MessageDisclosureScope,
      { kind: "steps", id: "timeline" },
      state[0]
        ? [createElement(Group, { key: "a", id: "a" }), createElement(Group, { key: "b", id: "b" })]
        : null,
    );
  }
  async function toggle(id: string, open: boolean) {
    await act(async () => {
      states.get(id)![1](open);
      await flushReactMicrotasks();
    });
  }

  try {
    await act(async () => {
      root.render(
        createElement(MessageDisclosureProvider, { phase: "streaming" }, createElement(Timeline)),
      );
      await flushReactMicrotasks();
    });
    await toggle("a", true);
    await toggle("a-tool", true);
    await toggle("b", true);
    await toggle("b-tool", true);
    await toggle("a", false);
    await toggle("a", true);
    assert.equal(states.get("a-tool")![0], false);
    assert.equal(states.get("b")![0], true);
    assert.equal(states.get("b-tool")![0], true);
    await toggle("a-tool", true);
    await toggle("timeline", false);
    await toggle("timeline", true);
    assert.equal(states.get("a")![0], false);
    assert.equal(states.get("b")![0], false);
    await toggle("a", true);
    await toggle("b", true);
    assert.equal(states.get("a-tool")![0], false);
    assert.equal(states.get("b-tool")![0], false);
  } finally {
    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    environment.restore();
  }
});
