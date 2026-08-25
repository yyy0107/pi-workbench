import assert from "node:assert/strict";
import test from "node:test";

import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { WorkbenchExtension } from "./api/extension";
import { useMainViewService } from "./extension-context";
import { ExtensionProvider } from "./extension-provider";

interface ReactDomGlobals {
  document?: unknown;
  HTMLElement?: unknown;
  HTMLIFrameElement?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: unknown;
  window?: unknown;
}

function installMinimalReactDomEnvironment(): {
  container: Element;
  restore(): void;
} {
  const globalObject = globalThis as typeof globalThis & ReactDomGlobals;
  const keys = [
    "document",
    "HTMLElement",
    "HTMLIFrameElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "window",
  ] as const;
  const previousDescriptors = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalObject, key)]),
  );
  const noop = () => undefined;
  class FakeElement {}
  class FakeIFrameElement extends FakeElement {}
  const windowFixture: Record<string, unknown> = {
    event: undefined,
    HTMLElement: FakeElement,
    HTMLIFrameElement: FakeIFrameElement,
  };
  const documentFixture: Record<string, unknown> = {
    activeElement: null,
    addEventListener: noop,
    body: null,
    defaultView: windowFixture,
    documentElement: { namespaceURI: "http://www.w3.org/1999/xhtml" },
    nodeType: 9,
    removeEventListener: noop,
  };
  windowFixture.document = documentFixture;
  const container = Object.assign(new FakeElement(), {
    addEventListener: noop,
    appendChild: noop,
    insertBefore: noop,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    nodeName: "DIV",
    nodeType: 1,
    ownerDocument: documentFixture,
    parentNode: null,
    removeChild: noop,
    removeEventListener: noop,
    tagName: "DIV",
    textContent: "",
  });
  documentFixture.body = container;

  Object.defineProperties(globalObject, {
    document: { configurable: true, value: documentFixture, writable: true },
    HTMLElement: { configurable: true, value: FakeElement, writable: true },
    HTMLIFrameElement: { configurable: true, value: FakeIFrameElement, writable: true },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
    window: { configurable: true, value: windowFixture, writable: true },
  });

  return {
    container: container as unknown as Element,
    restore() {
      for (const key of keys) {
        const descriptor = previousDescriptors.get(key);
        if (descriptor) Object.defineProperty(globalObject, key, descriptor);
        else Reflect.deleteProperty(globalObject, key);
      }
    },
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

test("changing the active extension list only starts and stops changed extensions", async () => {
  const environment = installMinimalReactDomEnvironment();
  const lifecycle: string[] = [];
  const extension = (id: string): WorkbenchExtension => ({
    id,
    name: id,
    version: "1.0.0",
    setup() {
      lifecycle.push(`${id}:setup`);
      return {
        dispose() {
          lifecycle.push(`${id}:dispose`);
        },
      };
    },
  });
  const stable = extension("stable");
  const added = extension("added");
  const root = createRoot(environment.container);
  let mounted = true;

  try {
    await act(async () => {
      root.render(createElement(ExtensionProvider, { extensions: [stable], children: null }));
    });
    assert.deepEqual(lifecycle, ["stable:setup"]);

    await act(async () => {
      root.render(
        createElement(ExtensionProvider, { extensions: [stable, added], children: null }),
      );
    });
    assert.deepEqual(lifecycle, ["stable:setup", "added:setup"]);

    await act(async () => {
      root.render(createElement(ExtensionProvider, { extensions: [stable], children: null }));
    });
    assert.deepEqual(lifecycle, ["stable:setup", "added:setup", "added:dispose"]);

    await act(async () => {
      root.unmount();
      await flushMicrotasks();
    });
    mounted = false;
    assert.deepEqual(lifecycle, ["stable:setup", "added:setup", "added:dispose", "stable:dispose"]);
  } finally {
    if (mounted) {
      await act(async () => {
        root.unmount();
        await flushMicrotasks();
      });
    }
    environment.restore();
  }
});

test("Strict Effects do not dispose and restart the owned extension manager", async () => {
  const environment = installMinimalReactDomEnvironment();
  const lifecycle: string[] = [];
  const FixtureView = () => null;
  const stable: WorkbenchExtension = {
    id: "stable",
    name: "stable",
    version: "1.0.0",
    setup(context) {
      lifecycle.push("setup");
      const mainView = context.mainViews.register({ kind: "fixture", component: FixtureView });
      return [
        mainView,
        {
          dispose() {
            lifecycle.push("dispose");
          },
        },
      ];
    },
  };
  let mainViews: ReturnType<typeof useMainViewService> | undefined;
  function MainViewProbe() {
    mainViews = useMainViewService();
    return null;
  }
  const root = createRoot(environment.container);
  let mounted = true;

  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(ExtensionProvider, {
            extensions: [stable],
            children: createElement(MainViewProbe),
          }),
        ),
      );
      await flushMicrotasks();
    });
    assert.deepEqual(lifecycle, ["setup"]);
    assert.ok(mainViews);

    mainViews.open({ kind: "fixture", title: "Fixture", params: {} });
    assert.equal(mainViews.getSnapshot()?.kind, "fixture");

    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(ExtensionProvider, {
            extensions: [],
            children: createElement(MainViewProbe),
          }),
        ),
      );
    });
    assert.deepEqual(lifecycle, ["setup", "dispose"]);
    assert.equal(mainViews.getSnapshot(), null);

    await act(async () => {
      root.unmount();
      await flushMicrotasks();
    });
    mounted = false;
    assert.deepEqual(lifecycle, ["setup", "dispose"]);
  } finally {
    if (mounted) {
      await act(async () => {
        root.unmount();
        await flushMicrotasks();
      });
    }
    environment.restore();
  }
});
