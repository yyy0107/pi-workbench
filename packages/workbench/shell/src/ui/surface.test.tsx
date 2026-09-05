import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { SwapLabel } from "./surface";

test("labels retain layout width through hidden and scaled panels", async () => {
  const environment = installMinimalReactDomEnvironment();
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  let measure: () => void;
  let visible = false;
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        measure = callback;
      }
      observe() {}
      disconnect() {}
    },
  });
  const root = createRoot(environment.container);
  let label: ReturnType<typeof SwapLabel>;
  const element = {
    offsetWidth: 81,
    getClientRects: () => (visible ? [{}] : []),
    getBoundingClientRect: () => ({ width: 81 * 0.95 }),
  } as HTMLSpanElement;

  function Probe() {
    label = SwapLabel({ active: 1, children: ["正在准备上下文", "上下文已就绪"] });
    label.props.children[1].props.ref.current = element;
    return null;
  }

  try {
    await act(async () => root.render(<Probe />));
    assert.equal(label!.props.style, undefined);
    visible = true;
    await act(async () => measure());
    assert.equal(label!.props.style.width, 81);
    visible = false;
    Object.assign(element, { offsetWidth: 0 });
    await act(async () => measure());
    assert.equal(label!.props.style.width, 81);
    visible = true;
    Object.assign(element, { offsetWidth: 104 });
    await act(async () => measure());
    assert.equal(label!.props.style.width, 104);
  } finally {
    await act(async () => root.unmount());
    if (previousObserver) Object.defineProperty(globalThis, "ResizeObserver", previousObserver);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
    environment.restore();
  }
});
