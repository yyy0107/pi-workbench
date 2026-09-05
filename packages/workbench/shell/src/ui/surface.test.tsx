import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { SwapLabel } from "./surface";

test("labels retain their layout width when mounted inside a scaled panel", async () => {
  const environment = installMinimalReactDomEnvironment();
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  const root = createRoot(environment.container);
  let label: ReturnType<typeof SwapLabel>;
  const element = {
    offsetWidth: 81,
    getBoundingClientRect: () => ({ width: 81 * 0.95 }),
  } as HTMLSpanElement;

  function Probe() {
    label = SwapLabel({ active: 1, children: ["正在准备上下文", "上下文已就绪"] });
    label.props.children[1].props.ref.current = element;
    return null;
  }

  try {
    await act(async () => root.render(<Probe />));
    assert.equal(label!.props.style.width, 81);
  } finally {
    await act(async () => root.unmount());
    if (previousObserver) Object.defineProperty(globalThis, "ResizeObserver", previousObserver);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
    environment.restore();
  }
});
