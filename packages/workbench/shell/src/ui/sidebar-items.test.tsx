import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { CollapsibleTrigger } from "./collapsible";
import {
  SidebarActions,
  SidebarGroup,
  SidebarRow,
  SidebarSectionHeading,
  SidebarStatus,
} from "./index";

test("section headings are non-selectable drop targets with sibling actions", () => {
  const html = renderToStaticMarkup(
    <SidebarGroup
      open
      header={
        <SidebarSectionHeading
          label="Projects"
          expanded
          description="Collapse section"
          drag={{ ref() {}, dropPosition: "inside", shouldSuppressClick: () => false }}
          actions={
            <SidebarActions>
              <button type="button">Add project</button>
            </SidebarActions>
          }
        />
      }
    >
      <span>Folder</span>
    </SidebarGroup>,
  );
  assert.match(html, /<h2\b[^>]*>Projects<\/h2>/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-controls=/);
  assert.match(html, /data-sidebar-drop="inside"/);
  assert.doesNotMatch(
    html,
    /data-slot="sidebar-row"|data-workbench-selection-surface|data-active=|aria-current=/,
  );
  assert.equal((html.match(/<button\b/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
});

test("collapsible rows keep action buttons outside the primary trigger", () => {
  const html = renderToStaticMarkup(
    <SidebarGroup
      open
      header={
        <SidebarRow
          label="Project"
          trigger={<CollapsibleTrigger />}
          icon={<span>Folder</span>}
          hoverIcon={<span>Expand</span>}
          actions={
            <SidebarActions>
              <button type="button">Options</button>
            </SidebarActions>
          }
        />
      }
    >
      <span>Conversation</span>
    </SidebarGroup>,
  );
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-controls=/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
  assert.match(html, /data-sidebar-actions=""/);
});

test("animated groups track intrinsic content height without overriding opening or closing", async () => {
  const environment = installMinimalReactDomEnvironment();
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  let resize = () => {};
  let disconnected = false;
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
  const root = createRoot(environment.container);
  let group: ReturnType<typeof SidebarGroup>;
  let height = 180;
  const element = { getBoundingClientRect: () => ({ height }) } as HTMLDivElement;
  let cleanup: (() => void) | undefined;
  function Probe() {
    group = SidebarGroup({ open: true, animateContent: true, header: null, children: "Rows" });
    return null;
  }
  const panel = () => group.props.children[1];
  const style = (open = true, transitionStatus = "idle") =>
    panel().props.style({ open, transitionStatus });
  try {
    await act(async () => root.render(<Probe />));
    assert.equal(style(), undefined);
    await act(async () => {
      cleanup = panel().props.children.props.ref(element);
    });
    assert.deepEqual(style(), { "--collapsible-panel-height": "180px" });

    height = 360;
    await act(async () => resize());
    assert.deepEqual(style(), { "--collapsible-panel-height": "360px" });
    assert.equal(style(true, "starting"), undefined);
    assert.equal(style(false, "ending"), undefined);
    assert.equal(style(false), undefined);
  } finally {
    cleanup?.();
    await act(async () => root.unmount());
    if (previousObserver) Object.defineProperty(globalThis, "ResizeObserver", previousObserver);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
    environment.restore();
  }
  assert.equal(disconnected, true);
});

test("the default icon remains available without a hover replacement; activity and waiting coexist", () => {
  const html = renderToStaticMarkup(
    <SidebarRow
      active
      label="Conversation"
      icon={<span>Running animation</span>}
      description="Generating"
      status={<SidebarStatus>Waiting for input</SidebarStatus>}
    />,
  );
  assert.match(html, /Running animation/);
  assert.doesNotMatch(html, /data-has-hover-icon/);
  assert.match(html, /Generating/);
  assert.match(html, /Waiting for input/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /aria-describedby="[^"]+ [^"]+"/);
});
