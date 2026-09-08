import assert from "node:assert/strict";
import test from "node:test";
import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { BrowserCommand, BrowserEvent, BrowserInput } from "@workbench/browser-contracts";
import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { I18nProvider } from "../../../i18n";
import { WorkbenchSettingsProvider } from "../../../settings";
import { MemoryBrowserSessionService } from "./memory-browser-session-service";
import { BrowserViewport, createBrowserInputQueue } from "./browser-viewport";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("browser viewport requests sharp frames and updates density without changing CSS input coordinates", async () => {
  const dom = installMinimalReactDomEnvironment();
  const observerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const mutationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
  const rafDescriptor = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const cancelRafDescriptor = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  const paints = new Map<number, FrameRequestCallback>();
  let paintId = 0;
  Object.assign(globalThis, {
    requestAnimationFrame(callback: FrameRequestCallback) {
      paints.set(++paintId, callback);
      return paintId;
    },
    cancelAnimationFrame(id: number) {
      paints.delete(id);
    },
  });
  const commands: BrowserCommand[] = [];
  const errors: unknown[] = [];
  let frameListener: ((event: BrowserEvent) => void) | undefined;
  let densityListener: (() => void) | undefined;
  let observedResolution = "";
  let disconnected = false;
  let dragDisconnected = false;
  let dragging = false;
  let resize!: () => void;
  let dragChanged!: () => void;
  const bounds = { left: 0, top: 0, width: 600, height: 400 };
  Object.assign(window, {
    devicePixelRatio: 2,
    matchMedia(media: string) {
      observedResolution = media;
      return {
        addEventListener(_type: string, listener: () => void) {
          densityListener = listener;
        },
        removeEventListener() {
          densityListener = undefined;
        },
      };
    },
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
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
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        dragChanged = callback;
      }
      observe() {}
      disconnect() {
        dragDisconnected = true;
      }
    },
  });
  class Browser extends MemoryBrowserSessionService {
    override async command<T>(command: BrowserCommand): Promise<T> {
      commands.push(command);
      return undefined as T;
    }
    override subscribeEvents(listener: (event: BrowserEvent) => void) {
      frameListener = listener;
      return () => {
        frameListener = undefined;
      };
    }
  }
  const browser = new Browser();
  browser.attach({
    id: "tab",
    projectId: "project",
    url: "https://example.test/",
    title: "Example",
    status: "ready",
    canGoBack: false,
    canGoForward: false,
    agentControlled: true,
  });
  const attributes = new Set<string>();
  const element = {
    get clientWidth() {
      return bounds.width;
    },
    get clientHeight() {
      return bounds.height;
    },
    getBoundingClientRect: () => bounds,
    closest: () => ({ getAttribute: () => (dragging ? "true" : null) }),
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    setAttribute(name: string) {
      attributes.add(name);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
  };
  const picture = { src: "" };
  const cursor = { hidden: true, style: { transform: "" } };
  const root = createRoot(dom.container);
  let tree!: ReturnType<typeof BrowserViewport>;
  function Probe() {
    tree = BrowserViewport({
      browser,
      sessionId: "tab",
      isVisible: true,
      zoom: 1,
      onError: (error) => errors.push(error),
      onFind() {},
    });
    tree.props.ref.current = element;
    tree.props.children[0].props.ref.current = picture;
    tree.props.children[1].props.ref.current = {
      focus: () => tree.props.children[1].props.onFocus(),
      blur: () => tree.props.children[1].props.onBlur(),
    };
    tree.props.children[2].props.ref.current = cursor;
    return null;
  }
  const flushResize = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  try {
    await act(async () =>
      root.render(
        <WorkbenchSettingsProvider
          service={{ load: async () => ({ locale: "en-US" }), update: async () => {} }}
        >
          <I18nProvider initialLocale="en-US">
            <Probe />
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      ),
    );
    await flushResize();
    assert.equal(tree.props.children[0].props.style.visibility, "hidden");
    assert.ok(tree.props.children.at(-1));
    assert.deepEqual(commands.at(-1), {
      type: "viewport",
      sessionId: "tab",
      width: 600,
      height: 400,
      visible: true,
      deviceScaleFactor: 2,
      zoom: 1,
      device: null,
    });
    window.devicePixelRatio = 3;
    densityListener?.();
    await flushResize();
    assert.equal(observedResolution, "(resolution: 3dppx)");
    assert.equal(
      (commands.at(-1) as Extract<BrowserCommand, { type: "viewport" }>).deviceScaleFactor,
      3,
    );
    const visibleFrame: BrowserEvent = {
      type: "frame",
      sessionId: "tab",
      width: 600,
      height: 400,
      mimeType: "image/png",
      data: "frame",
    };
    frameListener?.({ ...visibleFrame, data: "older" });
    frameListener?.(visibleFrame);
    assert.equal(picture.src, "");
    assert.equal(paints.size, 1, "only the latest incoming frame is decoded per paint");
    paints.get(paintId)!(0);
    paints.delete(paintId);
    assert.equal(picture.src, "data:image/png;base64,frame");
    await act(async () => tree.props.children[0].props.onLoad());
    assert.equal(tree.props.children[0].props.style.visibility, "visible");
    assert.equal(tree.props.children.at(-1), null);
    await act(async () => tree.props.children[0].props.onError());
    assert.equal(tree.props.children[0].props.style.visibility, "hidden");
    assert.equal(errors.length, 1, "decode failures reach the existing reload/retry UI");
    await act(async () => tree.props.children[0].props.onLoad());
    assert.equal(tree.props.children[0].props.style.visibility, "visible");
    assert.equal(cursor.hidden, true, "a controlled tab has no invented initial mouse position");
    frameListener?.({ type: "cursor", sessionId: "tab", cursor: { x: 80, y: 60 } });
    frameListener?.({ type: "cursor", sessionId: "tab", cursor: { x: 120, y: 100 } });
    frameListener?.({ type: "cursor", sessionId: "other", cursor: { x: 1, y: 1 } });
    assert.equal(paints.size, 1, "cursor updates share the frame paint and coalesce to the latest");
    paints.get(paintId)!(0);
    paints.delete(paintId);
    assert.equal(cursor.hidden, false);
    assert.equal(cursor.style.transform, "translate(120px, 100px)", "DPR does not scale input");
    tree.props.children[1].props.onFocus();
    assert.ok(attributes.has("data-focus-visible"), "keyboard entry keeps a visible focus cue");
    tree.props.onPointerDown({
      target: element,
      currentTarget: element,
      clientX: 120,
      clientY: 100,
      button: 0,
      buttons: 1,
      detail: 1,
      pointerId: 1,
      preventDefault() {},
    });
    assert.ok(!attributes.has("data-focus-visible"), "pointer focus removes the outer outline");
    await settle();
    assert.equal(commands.at(-1)?.type, "input");
    const command = commands.at(-1) as Extract<BrowserCommand, { type: "input" }>;
    assert.deepEqual(command.event, {
      kind: "mouse",
      type: "mousePressed",
      x: 120,
      y: 100,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers: 0,
    });
    const viewportCount = () => commands.filter((command) => command.type === "viewport").length;
    const beforeDrag = viewportCount();
    dragging = true;
    dragChanged();
    bounds.width = 640;
    resize();
    paints.get(paintId)!(0);
    paints.delete(paintId);
    assert.equal(
      cursor.style.transform,
      "translate(140px, 100px)",
      "local drag letterboxing updates the cursor without changing the remote viewport",
    );
    await flushResize();
    bounds.width = 680;
    resize();
    await flushResize();
    assert.equal(viewportCount(), beforeDrag, "even a paused drag must not restart remote layout");
    dragging = false;
    dragChanged();
    await flushResize();
    assert.equal(viewportCount(), beforeDrag + 1, "release applies only the final preview width");
    assert.equal((commands.at(-1) as Extract<BrowserCommand, { type: "viewport" }>).width, 680);
    frameListener?.({ ...visibleFrame, width: 400, height: 800 });
    frameListener?.({ type: "cursor", sessionId: "tab", cursor: { x: 120, y: 100 } });
    paints.get(paintId)!(0);
    paints.delete(paintId);
    assert.equal(cursor.style.transform, "translate(300px, 50px)", "device preview scales once");
    frameListener?.({ type: "cursor", sessionId: "tab", cursor: null });
    paints.get(paintId)!(0);
    paints.delete(paintId);
    assert.equal(
      cursor.hidden,
      true,
      "navigation can clear a stale pointer without ending control",
    );
    frameListener?.({ type: "cursor", sessionId: "tab", cursor: { x: 120, y: 100 } });
    paints.get(paintId)!(0);
    paints.delete(paintId);
    assert.equal(cursor.hidden, false);
    await act(async () => {
      browser.attach({ ...browser.getSession("tab")!, agentControlled: false });
    });
    paints.get(paintId)!(0);
    paints.delete(paintId);
    assert.equal(cursor.hidden, true, "ending control or disconnecting hides the pointer");
    frameListener?.(visibleFrame);
    assert.equal(paints.size, 1);
  } finally {
    await act(async () => root.unmount());
    assert.equal(densityListener, undefined);
    assert.equal(frameListener, undefined);
    assert.equal(disconnected, true);
    assert.equal(dragDisconnected, true);
    assert.equal(paints.size, 0, "unmount cancels the pending paint");
    if (observerDescriptor) Object.defineProperty(globalThis, "ResizeObserver", observerDescriptor);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
    if (mutationDescriptor)
      Object.defineProperty(globalThis, "MutationObserver", mutationDescriptor);
    else Reflect.deleteProperty(globalThis, "MutationObserver");
    if (rafDescriptor) Object.defineProperty(globalThis, "requestAnimationFrame", rafDescriptor);
    else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    if (cancelRafDescriptor)
      Object.defineProperty(globalThis, "cancelAnimationFrame", cancelRafDescriptor);
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    browser.dispose();
    dom.restore();
  }
});

test("browser input pipelines a bounded window while retaining order and coalescing queued motion", async () => {
  const sent: BrowserInput[] = [];
  const completions: Array<() => void> = [];
  const queue = createBrowserInputQueue(
    (event) => {
      sent.push(event);
      return new Promise<void>((resolve) => {
        completions.push(resolve);
      });
    },
    (error) => assert.fail(String(error)),
  );
  const move = (x: number): BrowserInput => ({ kind: "mouse", type: "mouseMoved", x, y: 1 });
  queue.push(move(0));
  for (let index = 1; index <= 1000; index++) queue.push(move(index));
  const down: BrowserInput = { kind: "key", type: "keyDown", key: "a", code: "KeyA", text: "a" };
  queue.push(down);
  queue.push(move(1001));
  queue.push(move(1002));
  for (let index = 0; index < 100; index++)
    queue.push({ kind: "mouse", type: "mouseWheel", x: 1002, y: 1, deltaY: 2 });
  await settle();
  assert.deepEqual(
    sent,
    Array.from({ length: 8 }, (_, index) => move(index)),
  );
  for (const expected of [
    move(1000),
    down,
    move(1002),
    { kind: "mouse", type: "mouseWheel", x: 1002, y: 1, deltaX: 0, deltaY: 200 },
  ]) {
    completions.shift()!();
    await settle();
    assert.deepEqual(sent.at(-1), expected);
  }
  assert.equal(sent.length, 12);
  assert.equal(completions.length, 8, "the window never exceeds eight pending RPCs");
  for (const complete of completions) complete();
  await settle();
});

test("browser keyboard pairs shortcut releases, forwards physical keys, and commits IME once", async () => {
  const dom = installMinimalReactDomEnvironment();
  const sent: BrowserInput[] = [];
  class Browser extends MemoryBrowserSessionService {
    override async command<T>(command: BrowserCommand): Promise<T> {
      if (command.type === "input") sent.push(command.event);
      return undefined as T;
    }
  }
  const browser = new Browser();
  const root = createRoot(dom.container);
  let tree!: ReturnType<typeof BrowserViewport>;
  let finds = 0;
  function Probe() {
    tree = BrowserViewport({
      browser,
      sessionId: "tab",
      isVisible: true,
      zoom: 1,
      onError: (error) => assert.fail(String(error)),
      onFind: () => finds++,
    });
    return null;
  }
  const keyboard = () => (tree.props.children[1] as ReactElement<ComponentProps<"textarea">>).props;
  const key = (name: string, code: string, ctrlKey = false) => ({
    key: name,
    code,
    keyCode: name.toUpperCase().charCodeAt(0),
    ctrlKey,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    nativeEvent: { isComposing: false },
    preventDefault() {},
    getModifierState: () => false,
  });
  try {
    await act(async () =>
      root.render(
        <WorkbenchSettingsProvider
          service={{ load: async () => ({ locale: "en-US" }), update: async () => {} }}
        >
          <I18nProvider initialLocale="en-US">
            <Probe />
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      ),
    );
    keyboard().onKeyDown?.(key("a", "KeyA", true) as never);
    keyboard().onKeyUp?.(key("a", "KeyA", true) as never);
    keyboard().onKeyDown?.(key("f", "KeyF", true) as never);
    keyboard().onKeyUp?.(key("f", "KeyF", true) as never);
    keyboard().onKeyDown?.(key("b", "KeyB") as never);
    keyboard().onBlur?.({} as never);
    keyboard().onCompositionStart?.({} as never);
    keyboard().onKeyDown?.(key("c", "KeyC") as never);
    keyboard().onInput?.({
      currentTarget: { value: "你" },
      nativeEvent: { isComposing: true },
    } as never);
    keyboard().onCompositionEnd?.({ data: "你好", currentTarget: { value: "你好" } } as never);
    keyboard().onInput?.({
      currentTarget: { value: "你好" },
      nativeEvent: { isComposing: false },
    } as never);
    keyboard().onInput?.({
      currentTarget: { value: "é" },
      nativeEvent: { isComposing: false },
    } as never);
    await settle();
    assert.equal(finds, 1);
    assert.deepEqual(
      sent.map((event) =>
        event.kind === "key"
          ? [event.type, event.code, event.text]
          : [event.kind, event.kind === "text" && event.text],
      ),
      [
        ["keyDown", "KeyA", undefined],
        ["keyUp", "KeyA", undefined],
        ["keyDown", "KeyB", "b"],
        ["keyUp", "KeyB", undefined],
        ["text", "你好"],
        ["text", "é"],
      ],
    );
  } finally {
    await act(async () => root.unmount());
    browser.dispose();
    dom.restore();
  }
});
