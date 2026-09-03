"use client";

import { useAuiState } from "@assistant-ui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";

import { readAgentThreadWorkspace } from "@workbench/agent-runtime-client/extras";
import { useWorkbenchAgentThreadSnapshot } from "@workbench/agent-runtime-client/context";
import {
  WorkbenchAgentRuntimeInstallationHost,
  type WorkbenchAgentRuntimeInstallation,
} from "@workbench/agent-runtime-client/installation";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import {
  useWorkspaceCapabilities,
  type WorkbenchWorkspaceDirectoryStorePort,
} from "@workbench/agent-runtime-client/workspaces";
import { useExtensionErrorReporter, useMainViewService } from "@workbench/extension-host";
import {
  ExtensionProvider,
  useOpenerRegistry,
  useWorkspaceSurfaceRegistry,
} from "@workbench/extension-host/installation";
import { DefaultOpenerService } from "@workbench/extension-host/services";
import type {
  OpenerRegistry,
  WorkspaceContext,
  WorkspaceSurfaceOpenOperations,
  WorkspaceSurfaceRegistry,
  WorkbenchExtension,
} from "@workbench/extension-sdk";
import type { RuntimeConnection } from "@workbench/host-contracts";

import {
  createWorkbenchDraftPersistence,
  createWorkbenchThreadScrollPersistence,
} from "./browser-session-persistence";
import { I18nProvider, useI18n, type Locale, type TranslationBundle } from "./i18n";
import { shouldCloseRightWorkspaceForNewThread } from "./new-thread-policy";
import { createPanelStore } from "./panels";
import { createRightWorkspacePromptFeedbackPort } from "./right-workspace";
import {
  RightWorkspaceProvider,
  WorkspaceSurfaceRuntimeHost,
  useRightWorkspace,
  useRightWorkspaceState,
  useSetWorkspaceContext,
  useWorkspaceFeedbackStore,
  type RightWorkspaceOpenerFactory,
  type WorkspaceRuntimeErrorReporter,
} from "./right-workspace-react";
import {
  createRightWorkspacePersistence,
  type RightWorkspaceLegacyStorage,
} from "./right-workspace/right-workspace-persistence";
import {
  RuntimeConnectionProvider,
  useRuntimeConnection,
} from "./runtime-connection/runtime-connection-provider";
import { WorkbenchSettingsProvider, useWorkbenchSettingsService } from "./settings";
import type { WorkbenchSettingsPort } from "./settings";
import { TooltipProvider } from "./ui";
import { WorkbenchShell, type WorkbenchShellProps } from "./shell/workbench-shell";
import {
  createWorkspaceDirectoryStoreInstallation,
  type WorkspaceDirectoryStoreInstallation,
} from "./workspace-directory-store";
import type { RightWorkspaceDraftPersistencePort } from "./right-workspace";
import type { ThreadScrollPersistencePort } from "./workbench";

const WorkbenchApplicationInstallationContext = createContext<string | undefined>(undefined);

export function useWorkbenchApplicationInstallationId(): string {
  const installationId = useContext(WorkbenchApplicationInstallationContext);
  if (!installationId) {
    throw new Error("WorkbenchApplicationProviders must own the application installation.");
  }
  return installationId;
}

function RuntimeApplicationProviders({
  bundles,
  children,
  createSettingsService,
  initialLocale,
}: Readonly<{
  bundles: readonly TranslationBundle[];
  children: ReactNode;
  createSettingsService(connection: RuntimeConnection): WorkbenchSettingsPort;
  initialLocale: Locale;
}>) {
  const connection = useRuntimeConnection();
  const [settings] = useState(() => createSettingsService(connection));

  return (
    <WorkbenchSettingsProvider service={settings}>
      <I18nProvider bundles={bundles} initialLocale={initialLocale}>
        <TooltipProvider>{children}</TooltipProvider>
      </I18nProvider>
    </WorkbenchSettingsProvider>
  );
}

/** Install renderer-wide services from one immutable Runtime connection descriptor. */
export function WorkbenchApplicationProviders({
  bundles,
  children,
  createSettingsService,
  initialLocale,
  installationId,
  runtimeConnection,
}: Readonly<{
  bundles: readonly TranslationBundle[];
  children: ReactNode;
  createSettingsService(connection: RuntimeConnection): WorkbenchSettingsPort;
  initialLocale: Locale;
  installationId: string;
  runtimeConnection: RuntimeConnection;
}>) {
  const [installedApplicationId] = useState(() => {
    const normalized = installationId.trim();
    if (!normalized) throw new Error("Workbench application installation id must not be empty.");
    return normalized;
  });
  return (
    <WorkbenchApplicationInstallationContext.Provider value={installedApplicationId}>
      <RuntimeConnectionProvider connection={runtimeConnection}>
        <RuntimeApplicationProviders
          bundles={bundles}
          createSettingsService={createSettingsService}
          initialLocale={initialLocale}
        >
          {children}
        </RuntimeApplicationProviders>
      </RuntimeConnectionProvider>
    </WorkbenchApplicationInstallationContext.Provider>
  );
}

const BROWSER_LEGACY_STORAGE: RightWorkspaceLegacyStorage = Object.freeze({
  getItem: (key: string) => window.localStorage.getItem(key),
  removeItem: (key: string) => window.localStorage.removeItem(key),
});

/** Install the generic Right Workspace around an application-owned identity. */
export function WorkbenchApplicationRightWorkspaceProvider({
  applicationId,
  children,
  draftPersistence,
  legacyStorage = BROWSER_LEGACY_STORAGE,
  openers,
  registry,
}: Readonly<{
  applicationId: string;
  children: ReactNode;
  draftPersistence: RightWorkspaceDraftPersistencePort;
  legacyStorage?: RightWorkspaceLegacyStorage;
  openers: OpenerRegistry;
  registry: WorkspaceSurfaceRegistry;
}>) {
  const { isLocalizableText } = useI18n();
  const installedLocalizableTextValidator = useRef(isLocalizableText).current;
  const settings = useWorkbenchSettingsService();
  const persistence = useMemo(
    () => createRightWorkspacePersistence({ settings, legacyStorage }),
    [legacyStorage, settings],
  );
  const createOpener = useCallback<RightWorkspaceOpenerFactory>(
    (surfaces: WorkspaceSurfaceOpenOperations) => new DefaultOpenerService(openers, surfaces),
    [openers],
  );
  const initialContext = useMemo<WorkspaceContext>(
    () => Object.freeze({ applicationId }),
    [applicationId],
  );

  return (
    <RightWorkspaceProvider
      createOpener={createOpener}
      draftPersistence={draftPersistence}
      initialContext={initialContext}
      persistence={persistence}
      registry={registry}
      validateLocalizableText={installedLocalizableTextValidator}
    >
      {children}
    </RightWorkspaceProvider>
  );
}

export interface ActiveWorkspaceContextInput {
  threadId?: string;
  workspaceId?: string;
  rootPath?: string;
}

export function createActiveWorkspaceContext(
  applicationId: string,
  { threadId, workspaceId, rootPath }: ActiveWorkspaceContextInput,
): WorkspaceContext {
  return {
    applicationId,
    ...(threadId ? { threadId } : {}),
    ...(workspaceId ? { projectId: workspaceId, worktreeId: workspaceId } : {}),
    ...(rootPath ? { rootPath } : {}),
  };
}

export function createMainViewWorkspaceContext(
  applicationId: string,
  kind: string,
): WorkspaceContext {
  return createActiveWorkspaceContext(applicationId, {
    threadId: `workbench-main-view:${encodeURIComponent(kind)}`,
  });
}

export interface ActiveConversationWorkspace {
  readonly context: WorkspaceContext;
  readonly isPinned: boolean;
  readonly mainThreadId?: string;
  readonly threadScopeId?: string;
  readonly workspaceId?: string;
}

export function syncConversationWorkspaceSelection(
  workspaceId: string | undefined,
  isPinned: boolean,
  revealWorkspace: (workspaceId: string) => void,
): void {
  if (workspaceId && !isPinned) revealWorkspace(workspaceId);
}

/** Bind one product workspace selection to Shell and runtime contributions. */
export function ActiveWorkspaceRuntimeBindings({
  activeMainViewKind,
  applicationId,
  conversation,
  reportError,
  revealWorkspace,
}: Readonly<{
  activeMainViewKind?: string;
  applicationId: string;
  conversation: ActiveConversationWorkspace;
  reportError: WorkspaceRuntimeErrorReporter;
  revealWorkspace(workspaceId: string): void;
}>) {
  const controller = useRightWorkspace();
  const setContext = useSetWorkspaceContext();
  const previousThread = useRef<{ localId?: string; scopeId?: string }>({});
  const resolvedContext = useMemo(
    () =>
      activeMainViewKind
        ? createMainViewWorkspaceContext(applicationId, activeMainViewKind)
        : conversation.context,
    [activeMainViewKind, applicationId, conversation.context],
  );

  useEffect(() => {
    syncConversationWorkspaceSelection(
      conversation.workspaceId,
      conversation.isPinned,
      revealWorkspace,
    );
  }, [conversation.isPinned, conversation.workspaceId, revealWorkspace]);

  useLayoutEffect(() => {
    setContext(resolvedContext);
    if (activeMainViewKind) {
      controller.restoreContext(resolvedContext);
      return;
    }

    if (conversation.threadScopeId) {
      const previous = previousThread.current;
      const promotedScopeId =
        previous.localId === conversation.mainThreadId &&
        previous.scopeId !== conversation.threadScopeId
          ? previous.scopeId
          : undefined;
      if (promotedScopeId) controller.promoteThreadScope(promotedScopeId, resolvedContext);
    }
    previousThread.current = {
      localId: conversation.mainThreadId,
      scopeId: conversation.threadScopeId,
    };
    controller.restoreContext(resolvedContext);
  }, [
    activeMainViewKind,
    controller,
    conversation.mainThreadId,
    conversation.threadScopeId,
    resolvedContext,
    setContext,
  ]);

  return <WorkspaceSurfaceRuntimeHost context={resolvedContext} reportError={reportError} />;
}

function NewThreadWorkspaceLayoutTracker() {
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
    controller.resetLayout();
  }, [controller, hydrated, mainThreadId, newThreadId]);

  return null;
}

function useActiveConversationWorkspace(applicationId: string) {
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const mainThread = useAuiState((state) =>
    state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId),
  );
  const runtimeThreadId = useAuiState((state) => state.threadListItem.id);
  const runtimeWorkspace = useAuiState((state) => readAgentThreadWorkspace(state.thread.extras));
  const workspace = runtimeThreadId === mainThreadId ? runtimeWorkspace : undefined;
  const threadScopeId = mainThread?.remoteId ?? mainThread?.externalId ?? mainThreadId;
  const threadSnapshot = useWorkbenchAgentThreadSnapshot(threadScopeId);
  const workspaceId = workspace?.id;
  const rootPath = workspace?.rootPath;
  const context = useMemo(
    () =>
      createActiveWorkspaceContext(applicationId, {
        ...(threadScopeId ? { threadId: threadScopeId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(rootPath ? { rootPath } : {}),
      }),
    [applicationId, rootPath, threadScopeId, workspaceId],
  );

  return {
    context,
    isPinned: threadSnapshot.isPinned,
    mainThreadId,
    threadScopeId,
    workspaceId,
  } as const;
}

function InstalledActiveWorkspaceRuntimeBindings({
  applicationId,
  reportError,
}: Readonly<{
  applicationId: string;
  reportError: WorkspaceRuntimeErrorReporter;
}>) {
  const { revealWorkspace } = useWorkspaceCapabilities();
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  const conversation = useActiveConversationWorkspace(applicationId);

  return (
    <ActiveWorkspaceRuntimeBindings
      activeMainViewKind={activeMainView?.kind}
      applicationId={applicationId}
      conversation={conversation}
      reportError={reportError}
      revealWorkspace={revealWorkspace}
    />
  );
}

export interface WorkbenchAgentRuntimeInstallationOptions {
  readonly promptFeedback: PromptFeedbackPort;
  readonly runtimeConnection: RuntimeConnection;
  readonly workspaceDirectoryStore: WorkbenchWorkspaceDirectoryStorePort;
}

export interface WorkbenchRuntimeContributionsProviderProps {
  readonly children: ReactNode;
  readonly openers: OpenerRegistry;
  readonly runtimeConnection: RuntimeConnection;
}

/** Mount an application-selected Agent Runtime around backend-neutral Workbench bridges. */
export function WorkbenchAgentRuntimeApplicationProvider({
  applicationId,
  children,
  createInstallation,
  runtimeContributionsProvider: RuntimeContributionsProvider,
}: Readonly<{
  applicationId: string;
  children: ReactNode;
  createInstallation(
    options: WorkbenchAgentRuntimeInstallationOptions,
  ): WorkbenchAgentRuntimeInstallation;
  runtimeContributionsProvider: ComponentType<WorkbenchRuntimeContributionsProviderProps>;
}>) {
  const runtimeConnection = useRuntimeConnection();
  const openers = useOpenerRegistry();
  const feedback = useWorkspaceFeedbackStore();
  const promptFeedback = useMemo(
    () => createRightWorkspacePromptFeedbackPort(feedback),
    [feedback],
  );
  const reportExtensionError = useExtensionErrorReporter();
  const settings = useWorkbenchSettingsService();
  const [workspaceDirectories] = useState<WorkspaceDirectoryStoreInstallation>(() =>
    createWorkspaceDirectoryStoreInstallation(settings),
  );
  const installation = useMemo(
    () =>
      createInstallation({
        promptFeedback,
        runtimeConnection,
        workspaceDirectoryStore: workspaceDirectories.port,
      }),
    [createInstallation, promptFeedback, runtimeConnection, workspaceDirectories],
  );

  useEffect(() => {
    void workspaceDirectories
      .hydrate()
      .catch((error) =>
        console.error("[workbench] failed to restore sidebar workspace expansion", error),
      );
  }, [workspaceDirectories]);

  return (
    <WorkbenchAgentRuntimeInstallationHost installation={installation}>
      <RuntimeContributionsProvider openers={openers} runtimeConnection={runtimeConnection}>
        <NewThreadWorkspaceLayoutTracker />
        <InstalledActiveWorkspaceRuntimeBindings
          applicationId={applicationId}
          reportError={reportExtensionError}
        />
        {children}
      </RuntimeContributionsProvider>
    </WorkbenchAgentRuntimeInstallationHost>
  );
}

type WorkbenchApplicationShellFrameProps = Pick<
  WorkbenchShellProps,
  "assets" | "branding" | "installationEffects" | "mainViewHost" | "runningIndicatorCatalog"
>;

export interface WorkbenchApplicationShellProps extends WorkbenchApplicationShellFrameProps {
  readonly applicationId: string;
  readonly children: ReactNode;
  readonly extensions: readonly WorkbenchExtension[];
  readonly runtimeProvider: ComponentType<{ children: ReactNode }>;
  readonly createDraftPersistence?: (namespace: string) => RightWorkspaceDraftPersistencePort;
  readonly createThreadScrollPersistence?: (namespace: string) => ThreadScrollPersistencePort;
}

function WorkbenchApplicationShellInstallation({
  applicationId,
  assets,
  branding,
  children,
  draftPersistence,
  installationEffects,
  mainViewHost,
  runningIndicatorCatalog,
  runtimeProvider: RuntimeProvider,
  threadScrollPersistence,
}: WorkbenchApplicationShellFrameProps &
  Readonly<{
    applicationId: string;
    children: ReactNode;
    draftPersistence: RightWorkspaceDraftPersistencePort;
    runtimeProvider: ComponentType<{ children: ReactNode }>;
    threadScrollPersistence: ThreadScrollPersistencePort;
  }>) {
  const openers = useOpenerRegistry();
  const registry = useWorkspaceSurfaceRegistry();
  return (
    <WorkbenchApplicationRightWorkspaceProvider
      applicationId={applicationId}
      draftPersistence={draftPersistence}
      openers={openers}
      registry={registry}
    >
      <RuntimeProvider>
        <WorkbenchShell
          assets={assets}
          branding={branding}
          installationEffects={installationEffects}
          mainViewHost={mainViewHost}
          runningIndicatorCatalog={runningIndicatorCatalog}
          threadScrollPersistence={threadScrollPersistence}
        >
          {children}
        </WorkbenchShell>
      </RuntimeProvider>
    </WorkbenchApplicationRightWorkspaceProvider>
  );
}

/** Compose Extension Host, Right Workspace, selected Runtime, and the full Workbench Shell. */
export function WorkbenchApplicationShell({
  applicationId,
  assets,
  branding,
  children,
  createDraftPersistence = createWorkbenchDraftPersistence,
  createThreadScrollPersistence = createWorkbenchThreadScrollPersistence,
  extensions,
  installationEffects,
  mainViewHost,
  runningIndicatorCatalog,
  runtimeProvider,
}: WorkbenchApplicationShellProps) {
  const installationId = useWorkbenchApplicationInstallationId();
  const [panelStore] = useState(createPanelStore);
  const [draftPersistence] = useState(() => createDraftPersistence(installationId));
  const [threadScrollPersistence] = useState(() => createThreadScrollPersistence(installationId));
  return (
    <ExtensionProvider extensions={extensions} panelStore={panelStore}>
      <WorkbenchApplicationShellInstallation
        applicationId={applicationId}
        assets={assets}
        branding={branding}
        draftPersistence={draftPersistence}
        installationEffects={installationEffects}
        mainViewHost={mainViewHost}
        runningIndicatorCatalog={runningIndicatorCatalog}
        runtimeProvider={runtimeProvider}
        threadScrollPersistence={threadScrollPersistence}
      >
        {children}
      </WorkbenchApplicationShellInstallation>
    </ExtensionProvider>
  );
}
