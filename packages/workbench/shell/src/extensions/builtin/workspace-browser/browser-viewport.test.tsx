import assert from "node:assert/strict";
import test from "node:test";
import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { BrowserCommand, BrowserInput } from "@workbench/browser-contracts";
import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { I18nProvider } from "../../../i18n";
import { WorkbenchSettingsProvider } from "../../../settings";
import { MemoryBrowserSessionService } from "./memory-browser-session-service";
import { BrowserViewport, createBrowserInputQueue } from "./browser-viewport";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("browser input preserves key ordering and coalesces motion without concurrent requests", async () => {
  const sent: BrowserInput[] = [];
  let complete!: () => void;
  const queue = createBrowserInputQueue(
    (event) => {
      sent.push(event);
      return new Promise<void>((resolve) => {
        complete = resolve;
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
  assert.deepEqual(sent, [move(0)]);
  for (const expected of [
    move(1000),
    down,
    move(1002),
    { kind: "mouse", type: "mouseWheel", x: 1002, y: 1, deltaX: 0, deltaY: 200 },
  ]) {
    complete();
    await settle();
    assert.deepEqual(sent.at(-1), expected);
  }
  assert.equal(sent.length, 5);
  complete();
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
      fitToWidth: true,
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
