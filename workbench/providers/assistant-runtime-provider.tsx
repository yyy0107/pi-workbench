"use client";

import { useAuiState } from "@assistant-ui/react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  useRightWorkspace,
  useWorkspaceFeedbackStore,
  useSetWorkspaceContext,
  WorkspaceSurfaceRuntimeHost,
} from "@/components/right-workspace";
import { useRightWorkspaceState } from "@/components/right-workspace/workspace-context";
import { useMainViewService } from "@/platform/extensions";
import { readAgentThreadWorkspace } from "@/runtime/assistant-ui/agent-runtime-extras";
import { WorkbenchAgentRuntimeInstallationHost } from "@/runtime/assistant-ui/agent-runtime-installation";
import { useWorkspaceCapabilities } from "@/services/workspace-selection-service";
import { shouldCloseRightWorkspaceForNewThread } from "@/workbench/workspaces/new-thread-policy";

import {
  activeWorkspaceContext,
  mainViewWorkspaceContext,
  shouldPromoteThreadSurfaceScope,
} from "./active-workspace-context";
import { createInstalledAgentRuntime } from "./installed-agent-runtime";

function NewThreadWorkspaceVisibilityTracker() {
  const controller = useRightWorkspace();
  const hydrated = useRightWorkspaceState((state) => state.hydrated);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const handledNewThreadIds = useRef(new Set<string>());

  useLayoutEffect(() => {
    if (!mainThreadId) return;
    const alreadyHandled = handledNewThreadIds.current.has(mainThreadId);
    if (
      !shouldCloseRightWorkspaceForNewThread({
        hydrated,
        mainThreadId,
        newThreadId,
        alreadyHandled,
      })
    ) {
      return;
    }

    handledNewThreadIds.current.add(mainThreadId);
    controller.setWorkspaceOpen(false);
  }, [controller, hydrated, mainThreadId, newThreadId]);

  return null;
}

function useActiveConversationWorkspace() {
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const mainThread = useAuiState((state) =>
    state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId),
  );
  const runtimeThreadId = useAuiState((state) => state.threadListItem.id);
  const runtimeWorkspace = useAuiState((state) => readAgentThreadWorkspace(state.thread.extras));
  // Thread-list selection and the bound thread runtime normally update together. Keep the
  // workspace empty during a transitional render instead of pairing a new thread with old extras.
  const workspace = runtimeThreadId === mainThreadId ? runtimeWorkspace : undefined;
  const threadScopeId = mainThread?.remoteId ?? mainThread?.externalId ?? mainThreadId;
  const workspaceId = workspace?.id;
  const rootPath = workspace?.rootPath;
  const context = useMemo(
    () =>
      activeWorkspaceContext({
        ...(threadScopeId ? { threadId: threadScopeId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(rootPath ? { rootPath } : {}),
      }),
    [rootPath, threadScopeId, workspaceId],
  );

  return { context, mainThreadId, threadScopeId, workspaceId } as const;
}

function ActiveWorkspaceContextTracker() {
  const controller = useRightWorkspace();
  const setContext = useSetWorkspaceContext();
  const { revealWorkspace } = useWorkspaceCapabilities();
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  const activeMainViewKind = activeMainView?.kind;
  const surfaceOrder = useRightWorkspaceState((state) => state.surfaceOrder);
  const surfacesById = useRightWorkspaceState((state) => state.surfaces);
  const {
    context: conversationContext,
    mainThreadId,
    threadScopeId,
    workspaceId,
  } = useActiveConversationWorkspace();
  const previousThread = useRef<{ localId?: string; scopeId?: string }>({});

  useEffect(() => {
    if (workspaceId) revealWorkspace(workspaceId);
  }, [revealWorkspace, workspaceId]);

  useLayoutEffect(() => {
    if (activeMainViewKind) {
      const context = mainViewWorkspaceContext(activeMainViewKind);
      setContext(context);
      controller.restoreContext(context);
      return;
    }

    setContext(conversationContext);
    if (threadScopeId) {
      const previous = previousThread.current;
      const promotedScopeId =
        previous.localId === mainThreadId && previous.scopeId !== threadScopeId
          ? previous.scopeId
          : undefined;
      for (const surfaceId of surfaceOrder) {
        const surface = surfacesById[surfaceId];
        if (!surface || !shouldPromoteThreadSurfaceScope(surface.scope, promotedScopeId)) {
          continue;
        }
        controller.update(surfaceId, { scope: { type: "thread", key: threadScopeId } });
      }
    }
    previousThread.current = { localId: mainThreadId, scopeId: threadScopeId };
    controller.restoreContext(conversationContext);
  }, [
    activeMainViewKind,
    conversationContext,
    controller,
    mainThreadId,
    setContext,
    surfaceOrder,
    surfacesById,
    threadScopeId,
  ]);

  return null;
}

/** Mount the explicitly installed Agent Runtime while keeping Workbench bridges backend-neutral. */
export function WorkbenchAssistantRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const promptFeedback = useWorkspaceFeedbackStore();
  const installation = useMemo(() => createInstalledAgentRuntime(promptFeedback), [promptFeedback]);

  return (
    <WorkbenchAgentRuntimeInstallationHost installation={installation}>
      <NewThreadWorkspaceVisibilityTracker />
      <ActiveWorkspaceContextTracker />
      {/* Surface runtimes follow the active Main View context as well as conversations. */}
      <WorkspaceSurfaceRuntimeHost />
      {children}
    </WorkbenchAgentRuntimeInstallationHost>
  );
}
