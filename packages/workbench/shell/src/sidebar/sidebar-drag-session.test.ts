import assert from "node:assert/strict";
import test from "node:test";
import type { PointerEvent as ReactPointerEvent } from "react";

import { createSidebarDragSession } from "../hooks/use-sidebar-pointer-reorder";

test("drag previews retain the sidebar style scope inside their Shell portal", (t) => {
  class ElementStub {
    attributes = new Map<string, string>();
    children: ElementStub[] = [];
    parentElement?: ElementStub;
    style = {};
    inert = false;
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    removeAttribute(name: string) {
      this.attributes.delete(name);
    }
    append(...children: ElementStub[]) {
      this.children.push(...children);
      for (const child of children) child.parentElement = this;
    }
    remove() {
      if (this.parentElement)
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    cloneNode() {
      return new ElementStub();
    }
    querySelectorAll() {
      return [];
    }
    closest() {
      return null;
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 300, height: 32 };
    }
    setPointerCapture() {}
    hasPointerCapture() {
      return false;
    }
  }
  const events = new EventTarget();
  const body = new ElementStub();
  const globals = {
    Element: ElementStub,
    document: { body, createElement: () => new ElementStub() },
    window: Object.assign(events, { getSelection: () => null }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  };
  let detach = () => {};
  t.after(() => detach());
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const portal = new ElementStub();
  const row = new ElementStub();
  const session = createSidebarDragSession();
  detach = session.attach(portal as unknown as HTMLElement);
  session.register("thread", {
    element: row as unknown as HTMLElement,
    options: () => ({
      id: "thread",
      enabled: true,
      resolveDrop: () => undefined,
      onDrop: async () => {},
    }),
  });
  session.prepare("thread", {
    currentTarget: row,
    target: row,
    isPrimary: true,
    pointerType: "mouse",
    button: 0,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
  } as unknown as ReactPointerEvent<HTMLElement>);
  events.dispatchEvent(
    Object.assign(new Event("pointermove"), {
      pointerId: 1,
      buttons: 1,
      clientX: 20,
      clientY: 20,
    }),
  );
  const shield = portal.children[0]!;
  const preview = shield.children[0]!;
  assert.equal(shield.attributes.get("data-workbench-surface"), "sidebar");
  assert.equal(preview.attributes.get("data-sidebar-drag-overlay"), "true");
  assert.equal(preview.inert, true);
  assert.equal(preview.attributes.get("aria-hidden"), "true");
  assert.equal(body.children.length, 0);
  session.cancel();
  assert.equal(portal.children.length, 0);
  assert.equal(shield.children.length, 0);
});

test("sidebar drag click suppression is isolated per Shell installation", () => {
  const first = createSidebarDragSession();
  const second = createSidebarDragSession();

  first.suppressClicksUntil(350);
  assert.equal(first.isClickSuppressed(100), true);
  assert.equal(second.isClickSuppressed(100), false);
  assert.equal(first.isClickSuppressed(351), false);
});

test("persistence is serialized within a sidebar without blocking another installation", async () => {
  const first = createSidebarDragSession();
  const second = createSidebarDragSession();
  let finish!: () => void;
  const pending = first.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  assert.equal(first.getSnapshot().pending, true);
  let duplicateRan = false;
  await first.run(async () => {
    duplicateRan = true;
  });
  assert.equal(duplicateRan, false);
  let otherRan = false;
  await second.run(async () => {
    otherRan = true;
  });
  assert.equal(otherRan, true);
  finish();
  await pending;
  assert.equal(first.getSnapshot().pending, false);
  await assert.rejects(
    first.run(async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  assert.equal(first.getSnapshot().pending, false);
});
