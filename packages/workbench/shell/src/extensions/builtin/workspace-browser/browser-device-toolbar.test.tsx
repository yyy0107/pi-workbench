import assert from "node:assert/strict";
import test from "node:test";
import { act, Children, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { BrowserDevice } from "@workbench/browser-contracts";

import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { Button, DropdownMenuRadioGroup, Input } from "../../../ui";
import {
  BrowserDevicePreview,
  BrowserDeviceToolbar,
  type BrowserDevicePreviewScale,
  type BrowserDeviceToolbarProps,
} from "./browser-device-toolbar";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child)
      ? [child, ...elements(child.props.children)]
      : [],
  );
}
const labels: BrowserDeviceToolbarProps["labels"] = {
  dimensions: "Dimensions",
  responsive: "Responsive",
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
  width: "Width",
  height: "Height",
  rotate: "Rotate",
  previewScale: "Preview scale",
  fit: "Fit",
  close: "Close",
};

test("device toolbar commits complete dimension drafts and keeps display scale separate from the device", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  let tree!: ReturnType<typeof BrowserDeviceToolbar>;
  let current!: BrowserDevice;
  let scale!: BrowserDevicePreviewScale;
  let closed = 0;
  function Probe() {
    const [device, setDevice] = useState<BrowserDevice>({ width: 600, height: 400, mobile: false });
    const [previewScale, setPreviewScale] = useState<BrowserDevicePreviewScale>("fit");
    current = device;
    scale = previewScale;
    tree = BrowserDeviceToolbar({
      device,
      previewScale,
      onDeviceChange: setDevice,
      onPreviewScaleChange: setPreviewScale,
      onClose: () => closed++,
      locale: "en-US",
      labels,
    });
    return null;
  }
  const control = (type: unknown, label: string) => {
    const element = elements(tree).find(
      (item) => item.type === type && item.props["aria-label"] === label,
    );
    assert.ok(element);
    return element.props as Record<string, any>;
  };
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => control(Input, "Width").onChange({ currentTarget: { value: "" } }));
    assert.equal(control(Input, "Width").value, "");
    assert.equal(current.width, 600, "incomplete input must not change the remote layout");
    await act(async () => control(Input, "Width").onChange({ currentTarget: { value: "429" } }));
    assert.equal(current.width, 600);
    await act(async () => control(Input, "Width").onKeyDown({ key: "Enter", preventDefault() {} }));
    assert.equal(current.width, 429);
    await act(async () => control(Input, "Height").onChange({ currentTarget: { value: "621" } }));
    await act(async () => control(Input, "Height").onBlur());
    assert.equal(current.height, 621);
    await act(async () => control(Button, "Rotate").onClick());
    assert.deepEqual(current, { width: 621, height: 429, mobile: false });
    await act(async () => control(Input, "Width").onChange({ currentTarget: { value: "9999" } }));
    await act(async () => control(Input, "Width").onBlur());
    assert.equal(current.width, 3840);
    await act(async () => control(Input, "Width").onChange({ currentTarget: { value: "12" } }));
    await act(async () => control(Input, "Width").onBlur());
    assert.equal(current.width, 240);
    await act(async () => control(DropdownMenuRadioGroup, "Dimensions").onValueChange("phone"));
    assert.deepEqual(current, { width: 390, height: 844, mobile: true });
    await act(async () => control(DropdownMenuRadioGroup, "Preview scale").onValueChange("0.5"));
    assert.equal(scale, 0.5);
    assert.deepEqual(current, { width: 390, height: 844, mobile: true });
    await act(async () =>
      control(DropdownMenuRadioGroup, "Dimensions").onValueChange("responsive"),
    );
    assert.deepEqual(current, { width: 390, height: 844, mobile: false });
    await act(async () => control(Button, "Close").onClick());
    assert.equal(closed, 1);
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});

test("device preview fits both axes, preserves fixed percentages, and resizes with pointer and keyboard", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const observerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const styleDescriptor = Object.getOwnPropertyDescriptor(window, "getComputedStyle");
  let disconnected = false;
  let resize!: () => void;
  Object.assign(globalThis, {
    ResizeObserver: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  });
  Object.assign(window, {
    getComputedStyle: () => ({
      paddingLeft: "24px",
      paddingRight: "24px",
      paddingTop: "24px",
      paddingBottom: "24px",
    }),
  });
  const area = { clientWidth: 648, clientHeight: 448 };
  let tree!: ReturnType<typeof BrowserDevicePreview>;
  let current!: BrowserDevice;
  let changeScale!: (scale: BrowserDevicePreviewScale) => void;
  function Probe() {
    const [device, setDevice] = useState<BrowserDevice>({
      width: 1000,
      height: 800,
      mobile: false,
    });
    const [previewScale, setPreviewScale] = useState<BrowserDevicePreviewScale>("fit");
    current = device;
    changeScale = setPreviewScale;
    tree = BrowserDevicePreview({
      device,
      previewScale,
      onDeviceChange: setDevice,
      children: null,
      labels: { preview: "Preview", resizeWidth: "Resize width", resizeHeight: "Resize height" },
    });
    tree.props.ref.current = area;
    return null;
  }
  const frame = () =>
    elements(tree).find((item) => "data-browser-device-preview" in item.props)!.props;
  const handles = () =>
    elements(tree)
      .filter((item) => item.props.role === "separator")
      .map((item) => item.props as Record<string, any>);
  const captured = new Set<number>();
  const pointer = (x: number, y: number) => ({
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
    preventDefault() {},
    currentTarget: {
      focus() {},
      setPointerCapture(id: number) {
        captured.add(id);
      },
      hasPointerCapture(id: number) {
        return captured.has(id);
      },
      releasePointerCapture(id: number) {
        captured.delete(id);
      },
    },
  });
  try {
    await act(async () => root.render(<Probe />));
    assert.deepEqual(frame().style, { width: 500, height: 400 });
    await act(async () => handles()[1]!.onPointerDown(pointer(0, 0)));
    await act(async () => handles()[1]!.onPointerMove(pointer(100, 0)));
    assert.equal(
      current.width,
      1400,
      "centered edges resize in device CSS pixels at the captured scale",
    );
    assert.deepEqual(
      frame().style,
      { width: 700, height: 400 },
      "auto fit stays stable while dragging",
    );
    await act(async () => handles()[1]!.onPointerUp(pointer(100, 0)));
    assert.equal(captured.size, 0);
    assert.equal((frame().style as { width: number }).width, 600);
    await act(async () => changeScale(0.5));
    assert.deepEqual(frame().style, { width: 700, height: 400 });
    await act(async () =>
      handles()[2]!.onKeyDown({ key: "ArrowDown", shiftKey: true, preventDefault() {} }),
    );
    assert.equal(current.height, 810);
    await act(async () => handles()[0]!.onKeyDown({ key: "Home", preventDefault() {} }));
    assert.equal(current.width, 240);
    await act(async () => changeScale("fit"));
    area.clientHeight = 1000;
    await act(async () => resize());
    assert.deepEqual(
      frame().style,
      { width: 240, height: 810 },
      "automatic fit does not enlarge the device",
    );
  } finally {
    await act(async () => root.unmount());
    if (observerDescriptor) Object.defineProperty(globalThis, "ResizeObserver", observerDescriptor);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
    if (styleDescriptor) Object.defineProperty(window, "getComputedStyle", styleDescriptor);
    else Reflect.deleteProperty(window, "getComputedStyle");
    dom.restore();
  }
  assert.equal(disconnected, true);
});
