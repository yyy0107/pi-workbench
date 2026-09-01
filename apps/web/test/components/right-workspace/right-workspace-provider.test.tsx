import assert from "node:assert/strict";
import test from "node:test";

import type {
  WorkbenchSettingsPort,
  WorkbenchSettingsPreferences,
  WorkbenchSettingsPreferencesPatch,
} from "@workbench/agent-runtime-contracts/settings";
import {
  OpenerRegistryImpl,
  WorkspaceSurfaceRegistryImpl,
} from "@workbench/extension-sdk/internal";
import {
  defineRuntimeConnection,
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
} from "@workbench/host-contracts";
import {
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
  useWorkspaceFeedbackStore,
} from "@workbench/shell/right-workspace/react";
import type {
  RightWorkspaceController,
  RightWorkspaceState,
  WorkspaceFeedbackStore,
} from "@workbench/shell/right-workspace";
import type { WorkspaceContext } from "@workbench/extension-sdk";
import { I18nProvider } from "@workbench/shell/i18n";
import { RIGHT_WORKSPACE_LEGACY_STORAGE_KEY } from "@workbench/shell/right-workspace/persistence";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "../../support/react-dom-environment";
import { createInstalledWorkbenchSettingsService } from "@/workbench/providers/installed-workbench-settings";

import { RightWorkspaceProvider } from "@/components/right-workspace/right-workspace-provider";

class MemoryBrowserStorage {
  readonly values = new Map<string, string>();
  readonly removed: string[] = [];

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.removed.push(key);
    this.values.delete(key);
  }
}

async function settleReactWork(): Promise<void> {
  await flushReactMicrotasks();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await flushReactMicrotasks();
}

function installBrowserStorage(storage: MemoryBrowserStorage): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

interface InstallationSnapshot {
  readonly context: WorkspaceContext;
  readonly controller: RightWorkspaceController;
  readonly feedback: WorkspaceFeedbackStore;
  readonly state: RightWorkspaceState;
}

function InstallationProbe({
  capture,
}: Readonly<{ capture(environment: InstallationSnapshot): void }>) {
  capture({
    context: useWorkspaceContext(),
    controller: useRightWorkspace(),
    feedback: useWorkspaceFeedbackStore(),
    state: useRightWorkspaceState((state) => state),
  });
  return null;
}

test("product wrapper injects settings, legacy storage, catalog validation, and application id", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const legacy = new MemoryBrowserStorage();
  legacy.values.set(
    RIGHT_WORKSPACE_LEGACY_STORAGE_KEY,
    JSON.stringify({ open: true, width: 620, surfaceOrder: [], surfaces: [] }),
  );
  installBrowserStorage(legacy);
  let loads = 0;
  const updates: WorkbenchSettingsPreferencesPatch[] = [];
  const service: WorkbenchSettingsPort = {
    async load() {
      loads += 1;
      return { locale: "en-US" };
    },
    async update(patch) {
      updates.push(patch);
    },
  };
  let environment: InstallationSnapshot | undefined;

  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(WorkbenchSettingsProvider, {
            service,
            children: createElement(I18nProvider, {
              initialLocale: "en-US",
              children: createElement(RightWorkspaceProvider, {
                draftPersistence: legacy,
                openers: new OpenerRegistryImpl(),
                registry: new WorkspaceSurfaceRegistryImpl(),
                children: createElement(InstallationProbe, {
                  capture: (value) => (environment = value),
                }),
              }),
            }),
          }),
        ),
      );
      await settleReactWork();
    });

    assert.ok(environment);
    assert.equal(environment.context.applicationId, "pi-workbench");
    assert.equal(loads, 2);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.rightWorkspace?.width, 620);
    assert.deepEqual(legacy.removed, [RIGHT_WORKSPACE_LEGACY_STORAGE_KEY]);

    const staleEnvironment = environment;
    await act(async () => {
      root.unmount();
      await settleReactWork();
    });
    assert.throws(() => staleEnvironment.controller.setWidth(700), /disposed/);
    assert.throws(() => staleEnvironment.feedback.claimForThreads([]), /disposed/);
  } finally {
    dom.restore();
  }
});

test("keyed replacement waits for the shared settings mutation tail before hydration", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const legacy = new MemoryBrowserStorage();
  installBrowserStorage(legacy);
  let revision = 1;
  let preferences: WorkbenchSettingsPreferences = {
    locale: "en-US",
    rightWorkspace: { open: true, width: 500, surfaceOrder: [], surfaces: [] },
  };
  let deferNextUpdate = false;
  let releaseUpdate: (() => void) | undefined;
  let signalUpdateStarted: (() => void) | undefined;
  let updateStarted = Promise.resolve();
  const writtenWidths: Array<number | undefined> = [];
  const fetchImplementation = async (_input: URL, init?: RequestInit): Promise<Response> => {
    const request = JSON.parse(String(init?.body)) as {
      method: string;
      payload: { patch?: WorkbenchSettingsPreferencesPatch };
      rpcId: string;
    };
    if (request.method === "workbenchSettings.describe") {
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value: { revision, preferences } },
      });
    }
    if (request.method === "workbenchSettings.update") {
      const patch = request.payload.patch ?? {};
      writtenWidths.push(patch.rightWorkspace?.width as number | undefined);
      if (deferNextUpdate) {
        deferNextUpdate = false;
        signalUpdateStarted?.();
        await new Promise<void>((resolve) => {
          releaseUpdate = resolve;
        });
      }
      revision += 1;
      preferences = {
        ...preferences,
        ...(patch.rightWorkspace && { rightWorkspace: patch.rightWorkspace }),
      };
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value: { revision } },
      });
    }
    throw new Error(`Unexpected RPC method: ${request.method}`);
  };
  const service = createInstalledWorkbenchSettingsService(
    defineRuntimeConnection({
      kind: "same-origin",
      protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
      httpOrigin: "http://workbench.test",
    }),
    fetchImplementation,
  );
  const openers = new OpenerRegistryImpl();
  let environment: InstallationSnapshot | undefined;
  const renderProduct = (providerKey: string) =>
    createElement(WorkbenchSettingsProvider, {
      service,
      children: createElement(I18nProvider, {
        initialLocale: "en-US",
        children: createElement(RightWorkspaceProvider, {
          key: providerKey,
          draftPersistence: legacy,
          openers,
          registry: new WorkspaceSurfaceRegistryImpl(),
          children: createElement(InstallationProbe, {
            capture: (value) => (environment = value),
          }),
        }),
      }),
    });

  try {
    await act(async () => {
      root.render(renderProduct("first"));
      await settleReactWork();
    });
    assert.ok(environment);
    assert.equal(environment.state.width, 500);
    const staleController = environment.controller;

    updateStarted = new Promise<void>((resolve) => {
      signalUpdateStarted = resolve;
    });
    deferNextUpdate = true;
    await act(async () => {
      environment?.controller.setWidth(700);
      await updateStarted;
    });

    await act(async () => {
      root.render(renderProduct("second"));
      await flushReactMicrotasks();
    });
    assert.ok(environment);
    assert.notEqual(environment.controller, staleController);
    assert.notEqual(environment.state.width, 500, "replacement must not hydrate stale settings");

    releaseUpdate?.();
    await act(async () => {
      await settleReactWork();
    });
    assert.equal(environment.state.width, 700);
    assert.deepEqual(writtenWidths.slice(-2), [700, 700]);
    assert.throws(() => staleController.setWidth(710), /disposed/);
  } finally {
    releaseUpdate?.();
    await act(async () => {
      root.unmount();
      await settleReactWork();
    });
    dom.restore();
  }
});
