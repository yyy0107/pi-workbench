import assert from "node:assert/strict";
import test from "node:test";

import type { LocalizableText, OpenerService, WorkspaceContext } from "@workbench/extension-sdk";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import type {
  RightWorkspaceController,
  RightWorkspaceState,
  WorkspaceFeedbackStore,
} from "@workbench/shell/right-workspace";
import {
  RightWorkspaceProvider,
  useOpenerService,
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceDraftStore,
  useWorkspaceContext,
  useWorkspaceFeedbackStore,
  type RightWorkspaceOpenerFactory,
} from "@workbench/shell/right-workspace/react";
import { act, createElement, Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { flushReactMicrotasks, installMinimalReactDomEnvironment } from "../react-dom-environment";
import { useBrowserSessionService } from "../../src/extensions/builtin/workspace-browser/browser-session-service";
import { useArtifactPreviewService } from "../../src/extensions/builtin/workspace-artifact/artifact-preview-service";
import type { BrowserSessionService } from "../../src/extensions/builtin/workspace-browser/browser-session-service";
import type { ArtifactPreviewService } from "../../src/extensions/builtin/workspace-artifact/artifact-preview-service";
import type { WorkspaceDraftStore } from "@workbench/shell/right-workspace";

const validateLocalizableText = (candidate: unknown): candidate is LocalizableText =>
  typeof candidate === "string" ||
  Boolean(candidate && typeof candidate === "object" && "key" in candidate);

class MemoryPersistence {
  reads = 0;
  readonly writes: string[] = [];

  constructor(readonly serialized: string | null = null) {}

  async read(): Promise<string | null> {
    this.reads += 1;
    return this.serialized;
  }

  async write(serialized: string): Promise<void> {
    this.writes.push(serialized);
  }
}

function openerFactory(calls: string[], label: string): RightWorkspaceOpenerFactory {
  return () => {
    calls.push(label);
    return Object.freeze<OpenerService>({
      async open() {},
      getHandlers: () => [],
      subscribe: () => () => undefined,
    });
  };
}

async function settleReactWork(): Promise<void> {
  await flushReactMicrotasks();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await flushReactMicrotasks();
}

interface InstallationSnapshot {
  readonly context: WorkspaceContext;
  readonly controller: RightWorkspaceController;
  readonly feedback: WorkspaceFeedbackStore;
  readonly opener: OpenerService;
  readonly state: RightWorkspaceState;
}

function InstallationProbe({
  capture,
}: Readonly<{ capture(environment: InstallationSnapshot): void }>) {
  capture({
    context: useWorkspaceContext(),
    controller: useRightWorkspace(),
    feedback: useWorkspaceFeedbackStore(),
    opener: useOpenerService(),
    state: useRightWorkspaceState((state) => state),
  });
  return null;
}

function providerTree(
  capture: (environment: InstallationSnapshot) => void,
  options: {
    context?: WorkspaceContext;
    createOpener?: RightWorkspaceOpenerFactory;
    persistence?: MemoryPersistence;
    providerKey?: string;
    registry?: WorkspaceSurfaceRegistryImpl;
  } = {},
) {
  return createElement(RightWorkspaceProvider, {
    key: options.providerKey,
    createOpener: options.createOpener ?? openerFactory([], "default"),
    initialContext: options.context ?? { applicationId: "fixture-app" },
    persistence: options.persistence,
    registry: options.registry ?? new WorkspaceSurfaceRegistryImpl(),
    validateLocalizableText,
    children: createElement(InstallationProbe, { capture }),
  });
}

test("Strict Effects share one installation and true unmount invalidates its mutable owners", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const persistence = new MemoryPersistence(
    JSON.stringify({ open: true, width: 620, surfaceOrder: [], surfaces: [] }),
  );
  const openerCalls: string[] = [];
  const createOpener = openerFactory(openerCalls, "strict");
  const initialContext = { applicationId: "strict-app" };
  const registry = new WorkspaceSurfaceRegistryImpl();
  let environment: InstallationSnapshot | undefined;

  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          providerTree((value) => (environment = value), {
            context: initialContext,
            createOpener,
            persistence,
            registry,
          }),
        ),
      );
      await settleReactWork();
    });

    assert.ok(environment);
    assert.equal(persistence.reads, 1);
    assert.equal(persistence.writes.length, 1);
    assert.equal(environment.state.width, 620);
    // React may probe the pure installation initializer more than once in development. Only the
    // committed installation initializes persistence and reaches consumers.
    assert.ok(openerCalls.length >= 1);

    await act(async () => {
      environment?.controller.setWidth(680);
      environment?.feedback.add({
        surfaceId: "surface-1",
        kind: "fixture",
        target: {},
        text: "pending",
        scope: { type: "application", key: "strict-app" },
      });
      await settleReactWork();
    });
    assert.equal(persistence.writes.length, 2, "Strict replay must preserve the live controller");

    const staleEnvironment = environment;
    await act(async () => {
      root.unmount();
      await settleReactWork();
    });
    assert.throws(() => staleEnvironment.controller.setWidth(700), /disposed/);
    assert.throws(
      () =>
        staleEnvironment.feedback.add({
          surfaceId: "surface-2",
          kind: "fixture",
          target: {},
          text: "stale",
          scope: { type: "application", key: "strict-app" },
        }),
      /disposed/,
    );
    assert.equal(persistence.writes.length, 2);
  } finally {
    dom.restore();
  }
});

test("true unmount closes the persistence gate before a pending read continuation", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  let resolveRead!: (serialized: string | null) => void;
  const writes: string[] = [];
  const persistence = {
    read: () => new Promise<string | null>((resolve) => (resolveRead = resolve)),
    write: async (serialized: string) => {
      writes.push(serialized);
    },
  };
  const createOpener = openerFactory([], "pending");
  const initialContext = { applicationId: "pending-app" };
  const registry = new WorkspaceSurfaceRegistryImpl();
  let environment: InstallationSnapshot | undefined;

  try {
    await act(async () => {
      root.render(
        createElement(RightWorkspaceProvider, {
          createOpener,
          initialContext,
          persistence,
          registry,
          validateLocalizableText,
          children: createElement(InstallationProbe, {
            capture: (value) => (environment = value),
          }),
        }),
      );
      await flushReactMicrotasks();
    });
    assert.ok(environment);
    const staleEnvironment = environment;

    await act(async () => {
      resolveRead(null);
      root.unmount();
      await settleReactWork();
    });

    assert.equal(writes.length, 0);
    assert.throws(() => staleEnvironment.controller.setWorkspaceOpen(true), /disposed/);
    assert.throws(() => staleEnvironment.feedback.claimForThreads([]), /disposed/);
  } finally {
    dom.restore();
  }
});

test("same-key rerenders retain immutable inputs and keyed replacement disposes the old installation", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const firstPersistence = new MemoryPersistence();
  const firstRegistry = new WorkspaceSurfaceRegistryImpl();
  const firstContext = { applicationId: "first-app" };
  const firstOpenerCalls: string[] = [];
  const firstFactory = openerFactory(firstOpenerCalls, "first");
  let environment: InstallationSnapshot | undefined;
  const invariantErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => invariantErrors.push(args);

  try {
    await act(async () => {
      root.render(
        providerTree((value) => (environment = value), {
          context: firstContext,
          createOpener: firstFactory,
          persistence: firstPersistence,
          providerKey: "one",
          registry: firstRegistry,
        }),
      );
      await settleReactWork();
    });
    assert.ok(environment);
    const firstInstallation = environment;

    await act(async () => {
      root.render(
        providerTree((value) => (environment = value), {
          context: { applicationId: "ignored-app" },
          createOpener: openerFactory([], "ignored"),
          persistence: new MemoryPersistence(),
          providerKey: "one",
          registry: new WorkspaceSurfaceRegistryImpl(),
        }),
      );
      await settleReactWork();
    });
    assert.equal(environment?.controller, firstInstallation.controller);
    assert.equal(environment?.feedback, firstInstallation.feedback);
    assert.equal(environment?.opener, firstInstallation.opener);
    assert.equal(environment?.context.applicationId, "first-app");
    assert.deepEqual(firstOpenerCalls, ["first"]);
    assert.equal(
      invariantErrors.some((args) => String(args[0]).includes("installation inputs are immutable")),
      true,
    );

    await act(async () => {
      root.render(
        providerTree((value) => (environment = value), {
          context: { applicationId: "second-app" },
          createOpener: openerFactory([], "second"),
          persistence: new MemoryPersistence(),
          providerKey: "two",
        }),
      );
      await settleReactWork();
    });
    assert.ok(environment);
    assert.notEqual(environment.controller, firstInstallation.controller);
    assert.equal(environment.context.applicationId, "second-app");
    assert.throws(() => firstInstallation.controller.setWidth(800), /disposed/);
    assert.throws(() => firstInstallation.feedback.remove("missing"), /disposed/);
  } finally {
    console.error = originalConsoleError;
    await act(async () => {
      root.unmount();
      await settleReactWork();
    });
    dom.restore();
  }
});

test("two providers with equal context values isolate controllers, state, feedback, and writes", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const firstPersistence = new MemoryPersistence();
  const secondPersistence = new MemoryPersistence();
  const firstContext = { applicationId: "shared-app" };
  const secondContext = { applicationId: "shared-app" };
  const firstFactory = openerFactory([], "first");
  const secondFactory = openerFactory([], "second");
  const firstRegistry = new WorkspaceSurfaceRegistryImpl();
  const secondRegistry = new WorkspaceSurfaceRegistryImpl();
  let first: InstallationSnapshot | undefined;
  let second: InstallationSnapshot | undefined;

  try {
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          providerTree((value) => (first = value), {
            context: firstContext,
            createOpener: firstFactory,
            persistence: firstPersistence,
            registry: firstRegistry,
          }),
          providerTree((value) => (second = value), {
            context: secondContext,
            createOpener: secondFactory,
            persistence: secondPersistence,
            registry: secondRegistry,
          }),
        ),
      );
      await settleReactWork();
    });
    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first.controller, second.controller);
    assert.notEqual(first.state, second.state);
    assert.notEqual(first.feedback, second.feedback);
    assert.notEqual(first.opener, second.opener);
    assert.notEqual(first.context, second.context);
    assert.equal(firstPersistence.writes.length, 1);
    assert.equal(secondPersistence.writes.length, 1);

    await act(async () => {
      first?.controller.setWidth(700);
      first?.feedback.add({
        surfaceId: "surface-1",
        kind: "fixture",
        target: {},
        text: "first only",
        scope: { type: "application", key: "shared-app" },
      });
      await settleReactWork();
    });
    assert.equal(first.state.width, 700);
    assert.notEqual(second.state.width, 700);
    assert.equal(first.feedback.getSnapshot().feedback.length, 1);
    assert.equal(second.feedback.getSnapshot().feedback.length, 0);
    assert.equal(firstPersistence.writes.length, 2);
    assert.equal(secondPersistence.writes.length, 1);
  } finally {
    await act(async () => {
      root.unmount();
      await settleReactWork();
    });
    dom.restore();
  }
});

interface WorkspaceServiceSnapshot {
  readonly artifacts: ArtifactPreviewService;
  readonly browser: BrowserSessionService;
  readonly drafts: WorkspaceDraftStore;
}

function WorkspaceServiceProbe({
  capture,
}: Readonly<{ capture(services: WorkspaceServiceSnapshot): void }>) {
  capture({
    artifacts: useArtifactPreviewService(),
    browser: useBrowserSessionService(),
    drafts: useWorkspaceDraftStore(),
  });
  return null;
}

function workspaceServiceProviderTree(capture: (services: WorkspaceServiceSnapshot) => void) {
  return createElement(RightWorkspaceProvider, {
    createOpener: openerFactory([], "workspace-services"),
    initialContext: { applicationId: "shared-app" },
    registry: new WorkspaceSurfaceRegistryImpl(),
    validateLocalizableText,
    children: createElement(WorkspaceServiceProbe, { capture }),
  });
}

test("workspace service resources isolate equal ids and release listeners on true unmount", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  let first: WorkspaceServiceSnapshot | undefined;
  let second: WorkspaceServiceSnapshot | undefined;

  try {
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          workspaceServiceProviderTree((services) => (first = services)),
          workspaceServiceProviderTree((services) => (second = services)),
        ),
      );
      await settleReactWork();
    });
    assert.ok(first);
    assert.ok(second);

    first.browser.attach({
      id: "shared-browser",
      projectId: "shared-project",
      url: "https://first.example",
      title: "First",
      status: "ready",
      canGoBack: false,
      canGoForward: false,
    });
    second.browser.attach({
      id: "shared-browser",
      projectId: "shared-project",
      url: "https://second.example",
      title: "Second",
      status: "ready",
      canGoBack: false,
      canGoForward: false,
    });
    const scope = { type: "thread", key: "shared-thread" } as const;
    first.artifacts.upsertArtifact({
      id: "shared-artifact",
      scope,
      title: "First",
      rendererKind: "markdown",
      content: "first installation",
      updatedAt: 1,
    });
    second.artifacts.upsertArtifact({
      id: "shared-artifact",
      scope,
      title: "Second",
      rendererKind: "markdown",
      content: "second installation",
      updatedAt: 1,
    });

    assert.equal(first.browser.getSession("shared-browser")?.url, "https://first.example");
    assert.equal(second.browser.getSession("shared-browser")?.url, "https://second.example");
    assert.equal(
      first.artifacts.getArtifact({ id: "shared-artifact", scope })?.content,
      "first installation",
    );
    assert.equal(
      second.artifacts.getArtifact({ id: "shared-artifact", scope })?.content,
      "second installation",
    );
    first.drafts.setItem("shared-draft", "first installation");
    second.drafts.setItem("shared-draft", "second installation");
    assert.equal(first.drafts.getItem("shared-draft"), "first installation");
    assert.equal(second.drafts.getItem("shared-draft"), "second installation");

    let staleBrowserNotifications = 0;
    let staleArtifactNotifications = 0;
    first.browser.subscribe(() => {
      staleBrowserNotifications += 1;
    });
    first.artifacts.subscribe(() => {
      staleArtifactNotifications += 1;
    });
    const stale = first;
    await act(async () => {
      root.unmount();
      await settleReactWork();
    });

    assert.equal(stale.browser.getSession("shared-browser"), undefined);
    assert.equal(stale.artifacts.getArtifact({ id: "shared-artifact", scope }), undefined);
    assert.equal(stale.drafts.getItem("shared-draft"), null);
    stale.drafts.setItem("late", "ignored");
    assert.equal(stale.drafts.getItem("late"), null);
    assert.throws(
      () =>
        stale.browser.attach({
          id: "late",
          projectId: "shared-project",
          url: "about:blank",
          title: "Late",
          status: "ready",
          canGoBack: false,
          canGoForward: false,
        }),
      /disposed/u,
    );
    assert.throws(
      () =>
        stale.artifacts.upsertArtifact({
          id: "late",
          scope,
          title: "Late",
          rendererKind: "unknown",
          updatedAt: 2,
        }),
      /disposed/u,
    );
    assert.equal(staleBrowserNotifications, 0);
    assert.equal(staleArtifactNotifications, 0);
  } finally {
    dom.restore();
  }
});
