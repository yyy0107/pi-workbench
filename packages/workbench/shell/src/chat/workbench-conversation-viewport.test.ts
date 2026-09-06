import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { ThreadScrollStateProvider } from "../thread-scroll-state";

import {
  conversationViewportAtBottom,
  conversationViewportAtTop,
  nextConversationViewportScrollTop,
  useWorkbenchConversationViewport,
} from "./workbench-conversation-viewport";

test("native conversation scrolling follows the bottom, respects user lock, and anchors prepends", () => {
  assert.equal(
    conversationViewportAtTop({ clientHeight: 300, scrollHeight: 900, scrollTop: 32 }),
    true,
  );
  assert.equal(
    conversationViewportAtTop({ clientHeight: 300, scrollHeight: 900, scrollTop: 33 }),
    false,
  );
  assert.equal(
    conversationViewportAtBottom({ clientHeight: 300, scrollHeight: 900, scrollTop: 598 }),
    true,
  );
  assert.equal(
    conversationViewportAtBottom({ clientHeight: 300, scrollHeight: 900, scrollTop: 597 }),
    false,
  );

  const current = { clientHeight: 300, scrollHeight: 900, scrollTop: 120 };
  assert.equal(
    nextConversationViewportScrollTop({
      current,
      followBottom: true,
      prepended: false,
      previousScrollHeight: 600,
    }),
    600,
  );
  assert.equal(
    nextConversationViewportScrollTop({
      current,
      followBottom: false,
      prepended: false,
      previousScrollHeight: 600,
    }),
    undefined,
  );
  assert.equal(
    nextConversationViewportScrollTop({
      current,
      followBottom: false,
      prepended: true,
      previousScrollHeight: 600,
    }),
    420,
  );
});

async function checkConversationViewport(autoScroll: boolean) {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const originalResize = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const originalMutation = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
  const originalCss = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  const frames = new Map<number, FrameRequestCallback>();
  const timeouts = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  const observed = new Set<Element>();
  let resize: () => void = () => {};
  let mutate: () => void = () => {};
  let mutationOptions: MutationObserverInit | undefined;
  let nextFrame = 0;
  let width = 800;
  let lineContentTop = 392;
  let textConnected = true;
  let flowAttached = false;
  const text = { nodeType: 3 };
  const flow = { getBoundingClientRect: () => ({ width }) };
  const viewport = {
    clientHeight: 300,
    clientWidth: 900,
    scrollHeight: 0,
    scrollTop: 0,
    children: [flow],
    querySelector: (selector: string) =>
      !flowAttached
        ? null
        : selector.includes("data-conversation-node-key")
          ? { getBoundingClientRect: () => ({ top: lineContentTop - viewport.scrollTop }) }
          : flow,
    contains: (node: unknown) => node === text && textConnected,
    getBoundingClientRect: () => ({ top: 0, bottom: 300, left: 0, width: 900, height: 300 }),
    ownerDocument: {
      caretPositionFromPoint: () => ({ offsetNode: text, offset: 5 }),
      createRange: () => ({
        startContainer: text,
        setStart: () => {},
        collapse: () => {},
        getBoundingClientRect: () => ({
          top: lineContentTop - viewport.scrollTop,
          bottom: lineContentTop - viewport.scrollTop + 20,
          height: 20,
        }),
      }),
    },
    scrollTo({ top }: ScrollToOptions) {
      this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, top ?? 0));
    },
    addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
    removeEventListener: (event: string) => listeners.delete(event),
  };
  Object.assign(window, {
    requestAnimationFrame(callback: FrameRequestCallback) {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (frame: number) => frames.delete(frame),
    setTimeout(callback: () => void) {
      timeouts.set(++nextFrame, callback);
      return nextFrame;
    },
    clearTimeout: (timeout: number) => timeouts.delete(timeout),
  });
  Object.defineProperties(globalThis, {
    CSS: { configurable: true, value: { escape: (value: string) => value } },
    ResizeObserver: {
      configurable: true,
      value: class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe(element: Element) {
          observed.add(element);
        }
        unobserve(element: Element) {
          observed.delete(element);
        }
        disconnect() {
          observed.clear();
        }
      },
    },
    MutationObserver: {
      configurable: true,
      value: class {
        constructor(callback: () => void) {
          mutate = callback;
        }
        observe(_element: Element, options: MutationObserverInit) {
          mutationOptions = options;
        }
        disconnect() {}
      },
    },
  });
  const nodeKeys = ["message"];
  let atBottom = true;
  let scrollToBottom: (behavior: ScrollBehavior) => void;
  function Probe() {
    const state = useWorkbenchConversationViewport({
      autoScroll,
      isRunning: false,
      nodeKeys,
      scrollToBottomOnInitialize: false,
      sessionId: "reflow",
    });
    state.viewportRef(viewport as unknown as HTMLDivElement);
    atBottom = state.isAtBottom;
    scrollToBottom = state.scrollToBottom;
    return null;
  }

  try {
    await act(async () => {
      root.render(
        createElement(ThreadScrollStateProvider, {
          persistence: {
            read: () =>
              JSON.stringify([
                [
                  "reflow",
                  {
                    scrollTop: autoScroll ? 80 : 360,
                    atBottom: false,
                    ...(autoScroll ? { anchor: { messageId: "message", offsetTop: 32 } } : {}),
                  },
                ],
              ]),
            write: () => {},
          },
          children: createElement(Probe),
        }),
      );
    });
    await act(async () => {
      for (const [id, callback] of frames) {
        frames.delete(id);
        callback(0);
      }
    });
    assert.equal(viewport.scrollTop, 0);
    assert.deepEqual(mutationOptions, { childList: true });

    await act(async () => {
      flowAttached = true;
      viewport.scrollHeight = 1_200;
      mutate();
      listeners.get("scroll")?.();
    });
    assert.equal(
      viewport.scrollTop,
      360,
      "restoration uses a message anchor when available and accepts legacy pixel records",
    );
    assert.equal(atBottom, false);
    // Only the content gutter changes: viewport.clientWidth stays constant.
    await act(async () => {
      width = 600;
      viewport.scrollHeight = 1_600;
      lineContentTop += 80;
      resize();
    });
    assert.equal(viewport.scrollTop, 440);
    assert.equal(lineContentTop - viewport.scrollTop, 32);
    assert.equal(timeouts.size, 0, "late history restoration must not undo resize compensation");

    await act(async () => {
      width = 1_000;
      viewport.scrollHeight = 1_000;
      lineContentTop -= 180;
      // Browser clamping/scroll events can precede the resize callback.
      listeners.get("scroll")?.();
      resize();
    });
    assert.equal(viewport.scrollTop, 260);
    assert.equal(lineContentTop - viewport.scrollTop, 32);
    assert.equal(atBottom, false);

    await act(async () => {
      viewport.scrollHeight += 100;
      resize();
    });
    assert.equal(viewport.scrollTop, 260, "streaming below the reader must not move them");
    await act(async () => {
      viewport.scrollHeight += 100;
      lineContentTop += 100;
      resize();
    });
    assert.equal(
      viewport.scrollTop,
      360,
      "intrinsic size corrections above the reader preserve the text anchor",
    );
    await act(async () => {
      viewport.scrollHeight -= 100;
      lineContentTop -= 100;
      resize();
    });
    assert.equal(viewport.scrollTop, 260);
    await act(async () => {
      width = 0;
      resize();
    });
    assert.equal(viewport.scrollTop, 260, "temporarily hidden conversations keep their anchor");
    await act(async () => {
      width = 700;
      lineContentTop += 40;
      resize();
    });
    assert.equal(viewport.scrollTop, 300);

    await act(async () => {
      textConnected = false;
      width = 800;
      resize();
    });
    assert.equal(viewport.scrollTop, 300, "detached text must not cause a jump");
    await act(async () => {
      viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
      listeners.get("scroll")?.();
      width = 500;
      viewport.scrollHeight = 1_800;
      listeners.get("scroll")?.();
      resize();
    });
    assert.equal(viewport.scrollTop, 1_500);
    assert.equal(
      atBottom,
      true,
      "resize keeps bottom follow even when streaming auto-scroll is off",
    );

    await act(async () => {
      viewport.clientHeight = 220;
      resize();
    });
    assert.equal(viewport.scrollTop, 1_580, "a taller composer keeps the latest message visible");
    assert.equal(atBottom, true);

    if (autoScroll) {
      await act(async () => {
        viewport.scrollTop -= 100;
        listeners.get("scroll")?.();
        scrollToBottom("instant");
      });
      for (let chunk = 0; chunk < 3; chunk++) {
        await act(async () => {
          viewport.scrollHeight += 100;
          // A queued programmatic scroll arrives after growth but before ResizeObserver.
          listeners.get("scroll")?.();
          resize();
        });
        assert.equal(viewport.scrollTop, viewport.scrollHeight - viewport.clientHeight);
        assert.equal(atBottom, true, "clicking latest must keep following streamed content");
      }
      await act(async () => {
        // Collapsing content clamps scrollTop before ResizeObserver reports the new height.
        viewport.scrollHeight -= 100;
        viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
        listeners.get("scroll")?.();
        resize();
        viewport.scrollHeight += 100;
        listeners.get("scroll")?.();
        resize();
      });
      assert.equal(viewport.scrollTop, viewport.scrollHeight - viewport.clientHeight);
      await act(async () => {
        listeners.get("wheel")?.();
        viewport.scrollHeight += 100;
        viewport.scrollTop -= 100;
        listeners.get("scroll")?.();
        resize();
      });
      const readingTop = viewport.scrollTop;
      await act(async () => {
        viewport.scrollHeight += 100;
        listeners.get("scroll")?.();
        resize();
      });
      assert.equal(viewport.scrollTop, readingTop, "manual scrolling must still stop following");
      assert.equal(atBottom, false);
    }

    const oldFlow = viewport.children[0];
    viewport.children = [];
    await act(async () => {
      mutate();
    });
    assert.equal(observed.has(oldFlow as unknown as Element), false);
  } finally {
    await act(async () => {
      root.unmount();
    });
    assert.equal(observed.size, 0);
    assert.equal(listeners.size, 0);
    assert.equal(timeouts.size, 0);
    for (const [name, descriptor] of [
      ["ResizeObserver", originalResize],
      ["MutationObserver", originalMutation],
      ["CSS", originalCss],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    environment.restore();
  }
}

for (const autoScroll of [false, true]) {
  test(`conversation reflow and bottom follow (autoScroll=${autoScroll})`, () =>
    checkConversationViewport(autoScroll));
}
