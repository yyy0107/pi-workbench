import assert from "node:assert/strict";
import test from "node:test";

import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { flushReactMicrotasks, installMinimalReactDomEnvironment } from "./react-dom-environment";

import type { WorkbenchExtension } from "@workbench/extension-sdk";
import { usePanelRegistry } from "@workbench/extension-host";

import { useMainViewService } from "../src/extension-context";
import { ExtensionProvider } from "../src/extension-provider";
import { createPanelStoreFixture } from "./panel-store-fixture";

const panelStore = createPanelStoreFixture();

test("the public panel registry hook exposes the installed registry", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let registry: ReturnType<typeof usePanelRegistry> | undefined;

  function PanelRegistryProbe() {
    registry = usePanelRegistry();
    return null;
  }

  try {
    await act(async () => {
      root.render(
        createElement(ExtensionProvider, {
          extensions: [],
          panelStore,
          children: createElement(PanelRegistryProbe),
        }),
      );
      await flushReactMicrotasks();
    });

    assert.ok(registry);
    assert.deepEqual(registry.getAll(), []);
  } finally {
    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    environment.restore();
  }
});

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
      root.render(
        createElement(ExtensionProvider, { extensions: [stable], panelStore, children: null }),
      );
    });
    assert.deepEqual(lifecycle, ["stable:setup"]);

    await act(async () => {
      root.render(
        createElement(ExtensionProvider, {
          extensions: [stable, added],
          panelStore,
          children: null,
        }),
      );
    });
    assert.deepEqual(lifecycle, ["stable:setup", "added:setup"]);

    await act(async () => {
      root.render(
        createElement(ExtensionProvider, { extensions: [stable], panelStore, children: null }),
      );
    });
    assert.deepEqual(lifecycle, ["stable:setup", "added:setup", "added:dispose"]);

    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    mounted = false;
    assert.deepEqual(lifecycle, ["stable:setup", "added:setup", "added:dispose", "stable:dispose"]);
  } finally {
    if (mounted) {
      await act(async () => {
        root.unmount();
        await flushReactMicrotasks();
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
            panelStore,
            children: createElement(MainViewProbe),
          }),
        ),
      );
      await flushReactMicrotasks();
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
            panelStore,
            children: createElement(MainViewProbe),
          }),
        ),
      );
    });
    assert.deepEqual(lifecycle, ["setup", "dispose"]);
    assert.equal(mainViews.getSnapshot(), null);

    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    mounted = false;
    assert.deepEqual(lifecycle, ["setup", "dispose"]);
  } finally {
    if (mounted) {
      await act(async () => {
        root.unmount();
        await flushReactMicrotasks();
      });
    }
    environment.restore();
  }
});
