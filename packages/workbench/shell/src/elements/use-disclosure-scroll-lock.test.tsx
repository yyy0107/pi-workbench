import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { DisclosureScrollDirectionProvider } from "./disclosure-scroll-direction";
import {
  DISCLOSURE_SCROLL_UNLOCK_EVENT,
  isDisclosureScrollLocked,
  useDisclosureScrollLock,
} from "./use-disclosure-scroll-lock";

test("disclosure compensation covers delayed layout and the actual animation lifetime", async () => {
  const environment = installMinimalReactDomEnvironment();
  const reactRoot = createRoot(environment.container);
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();
  const scrollListeners = new Set<() => void>();
  let unlocks = 0;
  let id = 0;
  let height = 24;
  let resize = () => {};
  let disconnected = false;
  let finishAnimation = () => {};
  const finished = new Promise<void>((resolve) => {
    finishAnimation = resolve;
  });
  const animation = {
    playState: "running",
    finished,
    effect: { getComputedTiming: () => ({ endTime: 200 }) },
  };
  const viewport = {
    scrollTop: 100,
    style: { paddingRight: "", scrollBehavior: "smooth", scrollbarWidth: "" },
    addEventListener: (_event: string, listener: () => void) => scrollListeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => scrollListeners.delete(listener),
    dispatchEvent: (event: Event) => {
      if (event.type === DISCLOSURE_SCROLL_UNLOCK_EVENT) unlocks++;
      return true;
    },
  };
  const disclosure = {
    parentElement: viewport,
    getBoundingClientRect: () => ({ height }),
    getAnimations: () => [
      ...(animation.playState === "running" ? [animation] : []),
      // Streaming labels can shimmer forever; they must not keep a scroll lock alive.
      {
        playState: "running",
        finished: new Promise(() => {}),
        effect: { getComputedTiming: () => ({ endTime: Infinity }) },
      },
    ],
  };
  Object.assign(window, {
    requestAnimationFrame(callback: FrameRequestCallback) {
      frames.set(++id, callback);
      return id;
    },
    cancelAnimationFrame: (frame: number) => frames.delete(frame),
    setTimeout(callback: () => void) {
      timers.set(++id, callback);
      return id;
    },
    clearTimeout: (timer: number) => timers.delete(timer),
  });
  const originalComputedStyle = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
  const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  Object.defineProperties(globalThis, {
    getComputedStyle: {
      configurable: true,
      value: () => ({
        overflowY: "auto",
        direction: "ltr",
        getPropertyValue: () => "stable both-edges",
      }),
    },
    ResizeObserver: {
      configurable: true,
      value: class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {
          disconnected = true;
        }
      },
    },
  });
  let toggle = (_open: boolean) => {};
  let toggleSecond = (_open: boolean) => {};
  function Probe({ second = false }: { second?: boolean }) {
    const [ref, onOpenChange] = useDisclosureScrollLock(() => {});
    ref.current = disclosure as unknown as HTMLDivElement;
    if (second) toggleSecond = onOpenChange;
    else toggle = onOpenChange;
    return null;
  }

  try {
    await act(async () => {
      reactRoot.render(
        <DisclosureScrollDirectionProvider preferUpward>
          <Probe />
        </DisclosureScrollDirectionProvider>,
      );
    });
    toggle(true);
    assert.equal(isDisclosureScrollLocked(viewport as unknown as HTMLElement), true);
    // Base UI starts its height transition after the click's animation-frame callbacks.
    for (const [frame, callback] of [...frames]) {
      frames.delete(frame);
      callback(0);
    }
    height = 104;
    resize();
    assert.equal(viewport.scrollTop, 180, "compensate layout before the next paint");

    for (const [timer, callback] of [...timers]) {
      timers.delete(timer);
      callback();
    }
    await Promise.resolve();
    assert.equal(viewport.style.scrollBehavior, "auto", "200ms from click is not animation end");
    assert.equal(disconnected, false);
    height = 224;
    resize();
    assert.equal(viewport.scrollTop, 300);

    animation.playState = "finished";
    await act(async () => finishAnimation());
    assert.equal(viewport.style.scrollBehavior, "smooth");
    assert.equal(disconnected, true);
    assert.equal(scrollListeners.size, 0);
    assert.equal(frames.size, 0);
    assert.equal(isDisclosureScrollLocked(viewport as unknown as HTMLElement), false);
    assert.equal(unlocks, 1);

    // Unmount still releases the lock immediately, even with an unfinished transition.
    animation.playState = "running";
    await act(async () =>
      reactRoot.render(
        <DisclosureScrollDirectionProvider preferUpward>
          <Probe />
          <Probe second />
        </DisclosureScrollDirectionProvider>,
      ),
    );
    toggle(true);
    toggleSecond(true);
    await act(async () =>
      reactRoot.render(
        <DisclosureScrollDirectionProvider preferUpward>
          <Probe />
        </DisclosureScrollDirectionProvider>,
      ),
    );
    assert.equal(isDisclosureScrollLocked(viewport as unknown as HTMLElement), true);
    assert.equal(
      viewport.style.scrollBehavior,
      "auto",
      "overlapping disclosures share the style lock",
    );
    assert.equal(unlocks, 1, "viewport resumes only after the last disclosure finishes");
    await act(async () => reactRoot.unmount());
    assert.equal(unlocks, 2);
    assert.equal(viewport.style.scrollBehavior, "smooth");
    assert.equal(scrollListeners.size, 0);
    assert.equal(timers.size, 0);
  } finally {
    await act(async () => reactRoot.unmount());
    for (const [key, descriptor] of [
      ["getComputedStyle", originalComputedStyle],
      ["ResizeObserver", originalResizeObserver],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    environment.restore();
  }
});
