import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { useAnimatedSelectorDropdown } from "./selector-dropdown";

test("menu reveal survives width callback changes and still cancels on close or unmount", async () => {
  const environment = installMinimalReactDomEnvironment();
  const pending = new Map<number, () => void>();
  let nextId = 0;
  const schedule = (callback: () => void) => {
    pending.set(++nextId, callback);
    return nextId;
  };
  Object.assign(window, {
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: schedule,
    cancelAnimationFrame: (id: number) => pending.delete(id),
    setTimeout: schedule,
    clearTimeout: (id: number) => pending.delete(id),
    getComputedStyle: () => ({
      transitionProperty: "width",
      transitionDuration: "400ms",
      transitionDelay: "0ms",
    }),
  });
  const root = createRoot(environment.container);
  let dropdown: ReturnType<typeof useAnimatedSelectorDropdown>;
  function Probe() {
    // The production minifier can inline the default width function here.
    dropdown = useAnimatedSelectorDropdown({ getOpenWidth: () => 288 });
    dropdown.triggerRef.current = {
      getBoundingClientRect: () => ({ width: 100 }),
    } as HTMLButtonElement;
    return null;
  }
  const flush = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback());
  };

  try {
    await act(async () => root.render(<Probe />));
    await act(async () => dropdown.onOpenChange(true));
    assert.equal(pending.size, 1, "opening must retain its animation frame after rendering");
    await act(async () => flush());
    await act(async () => flush());
    await act(async () => root.render(<Probe />));
    assert.equal(pending.size, 1, "rendering must retain the reveal timer");
    await act(async () => flush());
    assert.equal(dropdown!.contentStyle.animationPlayState, "running");

    await act(async () => dropdown.onOpenChange(true));
    await act(async () => dropdown.onOpenChange(false));
    assert.equal(pending.size, 0, "closing cancels the pending reveal");
    await act(async () => dropdown.onOpenChange(true));
    assert.equal(pending.size, 1);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
  assert.equal(pending.size, 0, "unmounting cancels the pending reveal");
});
