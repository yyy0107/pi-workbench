import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type {
  WorkbenchSettingsPort,
  WorkbenchSettingsPreferences,
} from "@workbench/shell/settings";
import { useSidebarSettingsHydration } from "../src/shell/use-sidebar-settings-hydration";

import { flushReactMicrotasks, installMinimalReactDomEnvironment } from "./react-dom-environment";

async function settleReactWork(): Promise<void> {
  await flushReactMicrotasks();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await flushReactMicrotasks();
}

function SidebarHydrationProbe({ service }: Readonly<{ service: WorkbenchSettingsPort }>) {
  const revision = useRef(0);
  const [, setOpen] = useState(true);
  useSidebarSettingsHydration(service, revision, setOpen);
  return null;
}

test("Strict replay shares one sidebar hydration and one normalized write", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  let resolveLoad!: (preferences: WorkbenchSettingsPreferences) => void;
  let loads = 0;
  const updates: unknown[] = [];
  const service: WorkbenchSettingsPort = {
    load() {
      loads += 1;
      return new Promise((resolve) => (resolveLoad = resolve));
    },
    async update(patch) {
      updates.push(patch);
    },
  };
  document.cookie = "sidebar_state=false";

  try {
    await act(async () => {
      root.render(
        createElement(StrictMode, null, createElement(SidebarHydrationProbe, { service })),
      );
      await flushReactMicrotasks();
    });
    assert.equal(loads, 1);

    await act(async () => {
      resolveLoad({});
      await settleReactWork();
    });
    assert.deepEqual(updates, [{ sidebarOpen: false }]);
    assert.match(document.cookie, /sidebar_state=;.+max-age=0/);
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});

test("true unmount cancels late sidebar settings and cookie writes", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  let resolveLoad!: (preferences: WorkbenchSettingsPreferences) => void;
  const updates: unknown[] = [];
  const service: WorkbenchSettingsPort = {
    load: () => new Promise((resolve) => (resolveLoad = resolve)),
    async update(patch) {
      updates.push(patch);
    },
  };
  document.cookie = "sidebar_state=true";

  try {
    await act(async () => {
      root.render(createElement(SidebarHydrationProbe, { service }));
      await flushReactMicrotasks();
    });
    await act(async () => {
      root.unmount();
      resolveLoad({});
      await settleReactWork();
    });

    assert.deepEqual(updates, []);
    assert.equal(document.cookie, "sidebar_state=true");
  } finally {
    dom.restore();
  }
});
