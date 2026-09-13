import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  WorkbenchSettingsProvider,
  useWorkbenchSettingsResource,
  type WorkbenchSettingsPort,
} from "../src/index";
import { flushReactMicrotasks, installMinimalReactDomEnvironment } from "@workbench/ui-testkit";

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
