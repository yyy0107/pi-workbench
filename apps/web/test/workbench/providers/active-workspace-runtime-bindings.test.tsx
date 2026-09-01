import assert from "node:assert/strict";
import test from "node:test";

import type {
  LocalizableText,
  OpenerService,
  WorkspaceSurfaceDefinition,
} from "@workbench/extension-sdk";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import type {
  RightWorkspaceController,
  RightWorkspaceState,
} from "@workbench/shell/right-workspace";
import {
  RightWorkspaceProvider,
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
} from "@workbench/shell/right-workspace/react";
import { act, createElement, Fragment, useEffect } from "react";
import { createRoot } from "react-dom/client";

import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "../../support/react-dom-environment";

import { activeWorkspaceContext } from "@/workbench/providers/active-workspace-context";
import { ActiveWorkspaceRuntimeBindings } from "@/workbench/providers/active-workspace-runtime-bindings";

const FixtureIcon = (() => null) as unknown as WorkspaceSurfaceDefinition["icon"];
const validateLocalizableText = (candidate: unknown): candidate is LocalizableText =>
  typeof candidate === "string" ||
  Boolean(candidate && typeof candidate === "object" && "key" in candidate);
const fileSurfaceDefinition = {
  kind: "file",
  icon: FixtureIcon,
  cachePolicy: "preserve-dirty",
  allowDuplicateResources: false,
  getResourceKey: (params, context) =>
    `file:${context.threadId ?? "application"}:${String(params.absolutePath ?? "")}`,
  getDefaultScope: (_params, context) => ({
    type: "thread" as const,
    key: context.threadId ?? context.applicationId,
  }),
  render: () => null,
} satisfies WorkspaceSurfaceDefinition;

function createOpener(): OpenerService {
  return {
    async open() {},
    getHandlers: () => [],
    subscribe: () => () => undefined,
  };
}

test("runtime effects consume the render-current conversation and Main View context", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const registry = new WorkspaceSurfaceRegistryImpl();
  const effectThreadIds: string[] = [];

  function ContextEffectRuntime() {
    const context = useWorkspaceContext();
    useEffect(() => {
      effectThreadIds.push(context.threadId ?? "missing");
    }, [context]);
    return null;
  }

  registry.register({
    kind: "context-effect-runtime",
    icon: FixtureIcon,
    cachePolicy: "unmount",
    getResourceKey: () => "context-effect-runtime",
    render: () => null,
    runtime: ContextEffectRuntime,
  });
  const providerContext = activeWorkspaceContext({});

  const renderBindings = (activeMainViewKind?: string, threadId = "conversation-a") =>
    createElement(RightWorkspaceProvider, {
      createOpener,
      initialContext: providerContext,
      registry,
      validateLocalizableText,
      children: createElement(ActiveWorkspaceRuntimeBindings, {
        activeMainViewKind,
        conversation: {
          context: activeWorkspaceContext({ threadId }),
          mainThreadId: threadId,
          threadScopeId: threadId,
        },
        reportError: () => undefined,
        revealWorkspace: () => undefined,
      }),
    });

  try {
    await act(async () => {
      root.render(renderBindings());
      await flushReactMicrotasks();
    });
    assert.deepEqual(effectThreadIds, ["conversation-a"]);

    effectThreadIds.length = 0;
    await act(async () => {
      root.render(renderBindings("settings"));
      await flushReactMicrotasks();
    });
    assert.deepEqual(effectThreadIds, ["workbench-main-view:settings"]);

    effectThreadIds.length = 0;
    await act(async () => {
      root.render(renderBindings(undefined, "conversation-b"));
      await flushReactMicrotasks();
    });
    assert.deepEqual(effectThreadIds, ["conversation-b"]);
  } finally {
    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    dom.restore();
  }
});

test("draft File promotion rekeys atomically and remote reveal keeps the live surface", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register(fileSurfaceDefinition);
  const providerContext = activeWorkspaceContext({});
  const draftContext = activeWorkspaceContext({
    threadId: "draft-thread",
    workspaceId: "workspace-1",
    rootPath: "/workspace",
  });
  const remoteContext = activeWorkspaceContext({
    threadId: "remote-thread",
    workspaceId: "workspace-1",
    rootPath: "/workspace",
  });
  const fileParams = {
    source: "workspace" as const,
    workspaceId: "workspace-1",
    rootPath: "/workspace",
    absolutePath: "/workspace/src/app.ts",
  };
  let controller: RightWorkspaceController | undefined;
  let latestState: RightWorkspaceState | undefined;

  function InstallationProbe() {
    controller = useRightWorkspace();
    latestState = useRightWorkspaceState((state) => state);
    return null;
  }

  const renderBindings = (context: typeof draftContext) =>
    createElement(RightWorkspaceProvider, {
      createOpener,
      initialContext: providerContext,
      registry,
      validateLocalizableText,
      children: createElement(
        Fragment,
        null,
        createElement(ActiveWorkspaceRuntimeBindings, {
          conversation: {
            context,
            mainThreadId: "local-thread",
            ...(context.threadId ? { threadScopeId: context.threadId } : {}),
          },
          reportError: () => undefined,
          revealWorkspace: () => undefined,
        }),
        createElement(InstallationProbe),
      ),
    });

  try {
    await act(async () => {
      root.render(renderBindings(draftContext));
      await flushReactMicrotasks();
    });
    assert.ok(controller);

    let draftSurfaceId = "";
    let destinationDuplicateId = "";
    await act(async () => {
      draftSurfaceId = controller!.open({
        kind: "file",
        title: "Live draft file",
        params: fileParams,
        context: draftContext,
        status: "ready",
        dirty: true,
      });
      destinationDuplicateId = controller!.open({
        kind: "file",
        title: "Stale remote duplicate",
        params: fileParams,
        context: remoteContext,
      });
      await flushReactMicrotasks();
    });
    const draftBefore = latestState?.surfaces[draftSurfaceId];
    assert.ok(draftBefore);
    assert.equal(
      draftBefore.resourceKey,
      fileSurfaceDefinition.getResourceKey(fileParams, draftContext),
    );
    assert.notEqual(draftSurfaceId, destinationDuplicateId);

    await act(async () => {
      root.render(renderBindings(remoteContext));
      await flushReactMicrotasks();
    });

    const promoted = latestState?.surfaces[draftSurfaceId];
    assert.deepEqual(promoted, {
      ...draftBefore,
      resourceKey: fileSurfaceDefinition.getResourceKey(fileParams, remoteContext),
      scope: { type: "thread", key: "remote-thread" },
    });
    assert.equal(promoted?.dirty, true);
    assert.equal(latestState?.surfaces[destinationDuplicateId], undefined);
    assert.deepEqual(latestState?.surfaceOrder, [draftSurfaceId]);
    assert.equal(latestState?.activeSurfaceId, draftSurfaceId);

    let revealedId = "";
    await act(async () => {
      revealedId = controller!.reveal({
        kind: "file",
        title: "Remote file reveal",
        params: fileParams,
        context: remoteContext,
      });
      await flushReactMicrotasks();
    });
    assert.equal(revealedId, draftSurfaceId);
    assert.deepEqual(latestState?.surfaceOrder, [draftSurfaceId]);
  } finally {
    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    dom.restore();
  }
});
