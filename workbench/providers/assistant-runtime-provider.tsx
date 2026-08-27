"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AssistantRuntimeProvider, useAui, useAuiState } from "@assistant-ui/react";

import {
  useRightWorkspace,
  useSetWorkspaceContext,
  useWorkspaceFeedbackStore,
  WorkspaceSurfaceRuntimeHost,
} from "@/components/right-workspace";
import { useRightWorkspaceState } from "@/components/right-workspace/workspace-context";
import { useI18n } from "@/i18n";
import { useMainViewService } from "@/platform/extensions";
import { PiCommandsProvider } from "@/runtime/pi/client/runtime/command-context";
import {
  PiSessionManagerProvider,
  usePiThreadListItemState,
} from "@/runtime/pi/client/runtime/context";
import {
  PI_CLIENT_RUNTIME_IMPLEMENTATION_TOKEN,
  PiSessionManager,
} from "@/runtime/pi/client/runtime/manager";
import { createPiAgentRuntimeAdapter } from "@/runtime/pi/client/assistant-ui/adapter";
import { piThreadListStructureMatches } from "@/runtime/pi/client/runtime/thread-list-sync";
import { useWorkbenchRuntime } from "@/runtime/assistant-ui/use-workbench-runtime";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
} from "@/services/workspace-selection-service";
import {
  resolvePendingThreadPromotionId,
  shouldCloseRightWorkspaceForNewThread,
} from "@/workbench/workspaces/new-thread-policy";
import type { PromptFeedbackPort } from "@/services/workspace-feedback-service";

import {
  activeWorkspaceContext,
  mainViewWorkspaceContext,
  shouldPromoteThreadSurfaceScope,
} from "./active-workspace-context";
import { WorkbenchWorkspaceSelectionProvider } from "./workspace-selection-provider";

function ActivePiThreadTracker({ manager }: { manager: PiSessionManager }) {
  const aui = useAui();
  const managerRevision = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const activeMessageCount = useAuiState((state) => state.thread.messages.length);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const archivedThreadIds = useAuiState((state) => state.threads.archivedThreadIds);
  const isThreadListLoading = useAuiState((state) => state.threads.isLoading);
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const mainThread = threadItems.find((thread) => thread.id === mainThreadId);
  const mainThreadScopeId = mainThread?.remoteId ?? mainThread?.externalId ?? mainThreadId ?? "";
  const mainThreadState = usePiThreadListItemState(mainThreadScopeId);
  const [reconcileTick, requestReconcile] = useReducer((value: number) => value + 1, 0);
  const reloadedRevision = useRef(managerRevision);
  const requestedReloadRevision = useRef(managerRevision);
  const reloadTask = useRef<Promise<void> | null>(null);
  const reloadDeferred = useRef(false);
  const draftThreadId = useRef<string | undefined>(undefined);
  const pendingPromotionThreadId = useRef<string | undefined>(undefined);
  const { revealWorkspace } = useWorkspaceCapabilities();

  if (mainThreadId && mainThreadId === newThreadId) {
    draftThreadId.current = mainThreadId;
  } else if (draftThreadId.current !== mainThreadId) {
    draftThreadId.current = undefined;
  }
  pendingPromotionThreadId.current = resolvePendingThreadPromotionId({
    pendingThreadId:
      pendingPromotionThreadId.current ??
      (draftThreadId.current === mainThreadId ? draftThreadId.current : undefined),
    mainThreadId,
    status: mainThread?.status,
    remoteId: mainThread?.remoteId,
    hasMessages: activeMessageCount > 0,
  });
  if (activeMessageCount > 0) draftThreadId.current = undefined;
  reloadDeferred.current = pendingPromotionThreadId.current === mainThreadId;

  useEffect(() => {
    manager.setActive(mainThreadId, mainThread?.remoteId);
  }, [mainThread?.remoteId, mainThreadId, manager]);

  useEffect(() => {
    requestedReloadRevision.current = managerRevision;

    if (reloadDeferred.current) return;
    if (
      isThreadListLoading ||
      reloadTask.current ||
      reloadedRevision.current === requestedReloadRevision.current
    ) {
      return;
    }

    const revision = requestedReloadRevision.current;
    const managedThreads = manager.getThreadListSnapshot();
    if (
      piThreadListStructureMatches(managedThreads, {
        threadIds,
        archivedThreadIds,
        threadItems,
      })
    ) {
      reloadedRevision.current = revision;
      return;
    }

    // RemoteThreadListAdapter is pull-based. Reconcile once only when a host event changes list
    // membership or ordering; metadata-only revisions are rendered from the manager snapshot.
    reloadedRevision.current = revision;
    const task = aui.threads.reload();
    reloadTask.current = task;
    void task
      .catch((error) => console.error("[workbench-pi] thread list reload failed", error))
      .finally(() => {
        if (reloadTask.current === task) reloadTask.current = null;
        requestReconcile();
      });
  }, [
    activeMessageCount,
    archivedThreadIds,
    aui,
    isThreadListLoading,
    mainThreadId,
    mainThread?.remoteId,
    mainThread?.status,
    manager,
    managerRevision,
    newThreadId,
    reconcileTick,
    threadIds,
    threadItems,
  ]);

  useEffect(() => {
    const workspaceId = mainThreadState.metadata.workspace?.id;
    if (workspaceId) revealWorkspace(workspaceId);
  }, [mainThreadState.metadata.workspace?.id, revealWorkspace]);

  return null;
}

function PiDraftWorkspaceTracker({ manager }: { manager: PiSessionManager }) {
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const { draftWorkspace } = useWorkspaceSelection();
  const draftWorkspaceId = draftWorkspace?.id;
  const draftWorkspaceName = draftWorkspace?.name;
  const draftWorkspaceCwd = draftWorkspace?.cwd;
  const draftWorkspacePinned = draftWorkspace?.pinned;

  useLayoutEffect(() => {
    if (!newThreadId) return;
    return () => manager.setDraftWorkspace(newThreadId, undefined);
  }, [manager, newThreadId]);

  useLayoutEffect(() => {
    if (!newThreadId) return;
    const workspace =
      draftWorkspaceId === undefined ||
      draftWorkspaceName === undefined ||
      draftWorkspaceCwd === undefined
        ? undefined
        : {
            id: draftWorkspaceId,
            name: draftWorkspaceName,
            cwd: draftWorkspaceCwd,
            ...(draftWorkspacePinned === undefined ? {} : { pinned: draftWorkspacePinned }),
          };
    manager.setDraftWorkspace(newThreadId, workspace);
  }, [
    draftWorkspaceCwd,
    draftWorkspaceId,
    draftWorkspaceName,
    draftWorkspacePinned,
    manager,
    newThreadId,
  ]);

  return null;
}

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
  const threadScopeId = mainThread?.remoteId ?? mainThread?.externalId ?? mainThreadId;
  const threadState = usePiThreadListItemState(threadScopeId ?? "");
  const workspaceId = threadState.metadata.workspace?.id;
  const rootPath = threadState.metadata.workspace?.cwd;
  const context = useMemo(
    () =>
      activeWorkspaceContext({
        ...(threadScopeId ? { threadId: threadScopeId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(rootPath ? { rootPath } : {}),
      }),
    [rootPath, threadScopeId, workspaceId],
  );

  return { context, mainThreadId, threadScopeId } as const;
}

function ActiveWorkspaceContextTracker() {
  const controller = useRightWorkspace();
  const setContext = useSetWorkspaceContext();
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
  } = useActiveConversationWorkspace();
  const previousThread = useRef<{ localId?: string; scopeId?: string }>({});

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

export function WorkbenchAssistantRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useI18n();
  const workspaceFeedback = useWorkspaceFeedbackStore();
  const titleFallbacks = useMemo(
    () => ({
      attachment: t("workbench.chat.titles.attachmentAnalysis"),
      image: t("workbench.chat.titles.imageConversation"),
    }),
    [t],
  );
  const managerRef = useRef<PiSessionManager | null>(null);
  const managerLifecycleRef = useRef(0);
  // Fast Refresh keeps refs alive even when the manager module is replaced. Recreate the manager
  // so existing sessions cannot retain an older class prototype without newly added RPC methods.
  if (
    managerRef.current &&
    managerRef.current.implementationToken !== PI_CLIENT_RUNTIME_IMPLEMENTATION_TOKEN
  ) {
    managerRef.current = null;
  }
  if (!managerRef.current) {
    const promptFeedback: PromptFeedbackPort = {
      claimForThreads: (threadIds) => workspaceFeedback.claimForThreads(threadIds),
      commit: (token) => workspaceFeedback.commit(token),
      release: (token) => workspaceFeedback.release(token),
    };
    managerRef.current = new PiSessionManager({ promptFeedback, titleFallbacks });
  }
  const manager = managerRef.current;
  const agentRuntimeAdapter = useMemo(() => createPiAgentRuntimeAdapter(manager), [manager]);
  const runtime = useWorkbenchRuntime(agentRuntimeAdapter);

  useEffect(() => manager.setTitleFallbacks(titleFallbacks), [manager, titleFallbacks]);

  useEffect(() => {
    const lifecycle = ++managerLifecycleRef.current;
    void manager
      .start()
      .catch((error) => console.error("[workbench-pi] session manager failed to start", error));
    return () => {
      // React Strict Effects immediately mounts this effect again in development. Defer the
      // irreversible disposal so the replacement setup can claim the same manager first.
      queueMicrotask(() => {
        if (managerRef.current !== manager || managerLifecycleRef.current === lifecycle) {
          manager.dispose();
        }
      });
    };
  }, [manager]);

  return (
    <PiSessionManagerProvider manager={manager}>
      <WorkbenchWorkspaceSelectionProvider>
        <AssistantRuntimeProvider runtime={runtime}>
          <PiCommandsProvider>
            <ActivePiThreadTracker manager={manager} />
            <PiDraftWorkspaceTracker manager={manager} />
            <NewThreadWorkspaceVisibilityTracker />
            <ActiveWorkspaceContextTracker />
            {/* Surface runtimes must follow the active Main View context as well as conversations. */}
            <WorkspaceSurfaceRuntimeHost />
            {children}
          </PiCommandsProvider>
        </AssistantRuntimeProvider>
      </WorkbenchWorkspaceSelectionProvider>
    </PiSessionManagerProvider>
  );
}
