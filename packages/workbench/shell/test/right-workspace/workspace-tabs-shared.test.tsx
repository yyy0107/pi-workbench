import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import { PanelsTopLeftIcon } from "lucide-react";

import { WorkbenchDomIdsProvider } from "../../src/dom";
import { I18nProvider } from "../../src/i18n";
import { WorkbenchSettingsProvider } from "../../src/settings";
import type { RightWorkspaceState } from "../../src/right-workspace";
import {
  RightWorkspaceProvider,
  useRightWorkspace,
  useRightWorkspaceState,
} from "../../src/right-workspace-react";
import { WorkspaceTabs } from "../../src/right-workspace/presentation/workspace-tabs";
import { Tabs, TabsList, TabsTrigger } from "../../src/ui/tabs";
import { installMinimalReactDomEnvironment } from "../react-dom-environment";

test("shared tabs preserve nested workspace trigger ARIA relationships", () => {
  const html = renderToStaticMarkup(
    <Tabs value="surface-a">
      <TabsList activateOnFocus aria-label="Workspace">
        <div role="presentation">
          <TabsTrigger
            value="surface-a"
            id="workspace-tab-surface-a"
            aria-controls="workspace-tabpanel-surface-a"
          >
            Surface A
          </TabsTrigger>
          <button type="button" aria-label="Close Surface A" />
        </div>
      </TabsList>
    </Tabs>,
  );

  assert.match(html, /role="tablist"/u);
  assert.match(html, /role="tab"/u);
  assert.match(html, /aria-selected="true"/u);
  assert.match(html, /aria-controls="workspace-tabpanel-surface-a"/u);
});

test("WorkspaceTabs delegates keyboard navigation to the shared Tabs primitive", async () => {
  const source = await readFile(
    new URL("../../src/right-workspace/presentation/workspace-tabs.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<Tabs[\s\S]*value=\{activeSurfaceId\}/u);
  assert.match(source, /<TabsList[\s\S]*activateOnFocus/u);
  assert.match(source, /<TabsTrigger[\s\S]*value=\{surface\.id\}/u);
  assert.match(source, /<DirectionProvider direction=\{tabDirection\}>/u);
  assert.doesNotMatch(source, /onKeyDown=/u);
});

async function createTabsHarness(onRender?: (tree: ReturnType<typeof WorkspaceTabs>) => void) {
  const dom = installMinimalReactDomEnvironment();
  const listeners = new Map<string, (event: any) => void>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  Object.assign(window, {
    addEventListener(type: string, listener: (event: any) => void) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    requestAnimationFrame(callback: FrameRequestCallback) {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame(id: number) {
      frames.delete(id);
    },
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  const root = createRoot(dom.container);
  const context = { applicationId: "tabs-test" };
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register({
    kind: "fixture",
    cachePolicy: "keep-alive",
    icon: PanelsTopLeftIcon,
    getResourceKey: (params) => String(params.name),
    render: () => null,
  });
  let controller!: ReturnType<typeof useRightWorkspace>;
  let state!: RightWorkspaceState;
  let rendered!: ReturnType<typeof WorkspaceTabs>;
  function Probe() {
    controller = useRightWorkspace();
    state = useRightWorkspaceState((value) => value);
    rendered = WorkspaceTabs();
    onRender?.(rendered);
    return null;
  }
  const trigger = (index: number) =>
    rendered.props.children[0].props.children.props.children.props.children[index].props
      .children[0];
  const dialog = () => rendered.props.children[2];
  const dialogAction = (index: number) =>
    dialog().props.children.props.children[1].props.children[index].props.onClick();

  await act(async () => {
    root.render(
      <WorkbenchSettingsProvider
        service={{ load: async () => ({ locale: "en-US" }), update: async () => {} }}
      >
        <I18nProvider initialLocale="en-US">
          <WorkbenchDomIdsProvider>
            <RightWorkspaceProvider
              initialContext={context}
              registry={registry}
              validateLocalizableText={(value): value is string => typeof value === "string"}
              createOpener={() => ({
                open: async () => {},
                getHandlers: () => [],
                subscribe: () => () => {},
              })}
            >
              <Probe />
            </RightWorkspaceProvider>
          </WorkbenchDomIdsProvider>
        </I18nProvider>
      </WorkbenchSettingsProvider>,
    );
  });
  return {
    controller,
    context,
    trigger,
    dialog,
    dialogAction,
    listeners,
    frames,
    get state() {
      return state;
    },
    async dispose() {
      await act(async () => root.unmount());
      dom.restore();
    },
  };
}

const mouse = (button: number) => ({ button, preventDefault: test.mock.fn() });

test("drag previews coalesce pointer moves and commit the workspace order only on drop", async () => {
  const previousComputedStyle = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: () => ({ direction: "ltr", transform: "none" }),
  });
  let reads = 0;
  let elements: any[] = [];
  let visibleOrder: string[] = [];
  const overlay = { style: { transform: "" } };
  let overlayClass = "";
  const viewport = {
    scrollWidth: 300,
    clientWidth: 300,
    scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 28 }),
    scrollBy: test.mock.fn(),
    addEventListener() {},
    removeEventListener() {},
  };
  const harness = await createTabsHarness((tree) => {
    const dragPortal = tree.props.children[1];
    if (dragPortal) {
      const floatingTab = dragPortal.children.props.children[1];
      floatingTab.props.ref.current = overlay;
      overlayClass = floatingTab.props.className;
    }
    const list = tree.props.children[0].props.children.props.children;
    list.props.ref.current = viewport;
    visibleOrder = [];
    elements = list.props.children.map((menu: any, index: number) => {
      const trigger = menu.props.children[0];
      visibleOrder.push(trigger.props.children[0].props.value);
      const element = {
        get offsetLeft() {
          reads++;
          return index * 100;
        },
        offsetWidth: 100,
        getBoundingClientRect: () => ({
          left: index * 100,
          right: (index + 1) * 100,
          width: 100,
          top: 0,
          height: 28,
        }),
        style: { setProperty() {}, removeProperty() {} },
        querySelector: () => ({ focus() {} }),
      };
      trigger.props.ref(element);
      return element;
    });
  });
  const { controller, context, frames, listeners } = harness;
  const pointer = (x: number) => ({
    ...mouse(0),
    isPrimary: true,
    pointerType: "mouse",
    pointerId: 1,
    buttons: 1,
    clientX: x,
    clientY: 14,
    cancelable: true,
  });
  const flushFrame = async () => {
    const entry = frames.entries().next().value;
    assert.ok(entry);
    frames.delete(entry[0]);
    await act(async () => entry[1](performance.now()));
  };
  try {
    await act(async () => {
      for (const name of ["A", "B", "C"])
        controller.open({ kind: "fixture", title: name, params: { name }, context });
    });
    const original = harness.state.surfaceOrder;
    const reorder = test.mock.method(controller, "reorder");
    const startDrag = () =>
      harness.trigger(0).props.onPointerDown({
        ...pointer(50),
        target: { closest: () => null },
        currentTarget: elements[0],
      });
    startDrag();
    const readsBefore = reads;
    await act(async () => {
      for (let x = 181; x <= 280; x++) listeners.get("pointermove")!(pointer(x));
    });
    assert.equal(frames.size, 1);
    assert.equal(reads, readsBefore);
    await flushFrame();
    assert.equal(overlay.style.transform, "translate3d(230px, 0px, 0)");
    assert.doesNotMatch(overlayClass, /\banimate-in\b|\btransition-(?:all|transform)\b/);
    assert.deepEqual(visibleOrder, [original[1], original[2], original[0]]);
    assert.strictEqual(harness.state.surfaceOrder, original);
    assert.equal(reorder.mock.callCount(), 0);
    assert.equal(viewport.scrollBy.mock.callCount(), 0);

    await act(async () => listeners.get("pointerup")!(pointer(280)));
    assert.deepEqual(harness.state.surfaceOrder, visibleOrder);
    assert.equal(reorder.mock.callCount(), 1);
    assert.equal(frames.size, 0);

    const committed = harness.state.surfaceOrder;
    startDrag();
    await act(async () => listeners.get("pointermove")!(pointer(280)));
    await flushFrame();
    await act(async () => listeners.get("pointercancel")!(pointer(280)));
    assert.strictEqual(harness.state.surfaceOrder, committed);
    assert.deepEqual(visibleOrder, committed);
    assert.equal(reorder.mock.callCount(), 1);

    // A release before the scheduled frame still uses the final pointer position.
    startDrag();
    await act(async () => listeners.get("pointermove")!(pointer(280)));
    await act(async () => listeners.get("pointerup")!(pointer(280)));
    assert.equal(frames.size, 0);
    assert.equal(reorder.mock.callCount(), 2);
    assert.deepEqual(harness.state.surfaceOrder, [committed[1], committed[2], committed[0]]);
  } finally {
    await harness.dispose();
    if (previousComputedStyle)
      Object.defineProperty(globalThis, "getComputedStyle", previousComputedStyle);
    else Reflect.deleteProperty(globalThis, "getComputedStyle");
  }
});

test("middle-click closes background tabs without activation and confirms unsaved changes", async () => {
  const harness = await createTabsHarness();
  const { controller, context, trigger, dialog, dialogAction } = harness;
  try {
    let background!: string;
    let active!: string;
    await act(async () => {
      background = controller.open({
        kind: "fixture",
        title: "Background",
        params: { name: "background" },
        context,
      });
      active = controller.open({
        kind: "fixture",
        title: "Active",
        params: { name: "active" },
        context,
      });
    });

    const middle = mouse(1);
    trigger(0).props.onMouseDown(middle);
    assert.equal(middle.preventDefault.mock.callCount(), 1);
    for (const button of [0, 2]) trigger(0).props.onAuxClick(mouse(button));
    assert.ok(harness.state.surfaces[background]);
    await act(async () => trigger(0).props.onAuxClick(middle));
    assert.equal(harness.state.surfaces[background], undefined);
    assert.equal(harness.state.activeSurfaceId, active);
    assert.equal(dialog().props.open, false);

    await act(async () => controller.update(active, { dirty: true }));
    await act(async () => trigger(0).props.onAuxClick(mouse(1)));
    assert.ok(harness.state.surfaces[active]);
    assert.equal(dialog().props.open, true);
    await act(async () => dialogAction(0));
    assert.ok(harness.state.surfaces[active]);
    assert.equal(dialog().props.open, false);

    await act(async () => trigger(0).props.onAuxClick(mouse(1)));
    await act(async () => dialogAction(1));
    assert.equal(harness.state.surfaces[active], undefined);
    assert.equal(harness.state.open, false);
  } finally {
    await harness.dispose();
  }
});
