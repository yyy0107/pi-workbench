import assert from "node:assert/strict";
import test from "node:test";

import { act, createElement, Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { useAppearanceController, useAppearancePreferences } from "./appearance";
import {
  WorkbenchSettingsProvider,
  useWorkbenchSettingsResource,
  type WorkbenchSettingsPort,
  type WorkbenchSettingsPreferencesPatch,
} from "./settings";
import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "../test/react-dom-environment";

test("provider defers disposable resources across Strict Effects and releases the final owner", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const resourceKey = Symbol("disposable-settings-resource");
  let disposals = 0;
  const service: WorkbenchSettingsPort = {
    async load() {
      return {};
    },
    async update() {},
  };

  function Probe() {
    useWorkbenchSettingsResource(resourceKey, () => ({
      dispose() {
        disposals += 1;
      },
    }));
    return null;
  }

  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(WorkbenchSettingsProvider, {
            service,
            children: createElement(Probe),
          }),
        ),
      );
      await flushReactMicrotasks();
    });
    assert.equal(disposals, 0);

    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    assert.equal(disposals, 1);
  } finally {
    environment.restore();
  }
});

test("provider installations isolate presentation snapshots, listeners, hydration, and writes", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const writes = {
    first: [] as WorkbenchSettingsPreferencesPatch[],
    second: [] as WorkbenchSettingsPreferencesPatch[],
    third: [] as WorkbenchSettingsPreferencesPatch[],
  };
  const firstService: WorkbenchSettingsPort = {
    async load() {
      return { appearance: { colorMode: "dark" } };
    },
    async update(patch) {
      writes.first.push(patch);
    },
  };
  const secondService: WorkbenchSettingsPort = {
    async load() {
      return { appearance: { colorMode: "light" } };
    },
    async update(patch) {
      writes.second.push(patch);
    },
  };
  const thirdService: WorkbenchSettingsPort = {
    async load() {
      return { appearance: { colorMode: "system" } };
    },
    async update(patch) {
      writes.third.push(patch);
    },
  };
  const probes: Record<
    string,
    {
      colorMode: string;
      codeTheme: string;
      update: ReturnType<typeof useAppearanceController>["update"];
    }
  > = {};

  function Probe({ id }: { id: string }) {
    const preferences = useAppearancePreferences();
    const controller = useAppearanceController();
    probes[id] = {
      colorMode: preferences.colorMode,
      codeTheme: preferences.codeTheme,
      update: controller.update,
    };
    return null;
  }

  try {
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(WorkbenchSettingsProvider, {
            service: firstService,
            children: createElement(Probe, { id: "first" }),
          }),
          createElement(WorkbenchSettingsProvider, {
            service: secondService,
            children: createElement(Probe, { id: "second" }),
          }),
        ),
      );
      await flushReactMicrotasks();
    });

    assert.equal(probes.first?.colorMode, "dark");
    assert.equal(probes.second?.colorMode, "light");

    await act(async () => {
      probes.first?.update({ codeTheme: "dracula" });
      await flushReactMicrotasks();
    });

    assert.equal(probes.first?.codeTheme, "dracula");
    assert.notEqual(probes.second?.codeTheme, "dracula");
    assert.equal(writes.first.length, 1);
    assert.equal(writes.second.length, 0);

    await act(async () => {
      root.render(
        createElement(WorkbenchSettingsProvider, {
          key: "third-installation",
          service: thirdService,
          children: createElement(Probe, { id: "third" }),
        }),
      );
      await flushReactMicrotasks();
    });

    assert.equal(probes.third?.colorMode, "system");
    assert.notEqual(probes.third?.codeTheme, "dracula");
    assert.equal(writes.third.length, 0);
  } finally {
    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    environment.restore();
  }
});
