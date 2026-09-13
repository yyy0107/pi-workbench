import {
  type PromptSubmissionProvenance,
  type PromptSubmissionResult,
  type RunningListener,
  type ResolveWorkbenchComposerCommandsOptions,
  type ResolvedWorkbenchComposerRequest,
  type SessionOrigins,
  type PromptQueueMutation,
} from "./session-types";
import {
  customMessageMatchesEntry,
  jsonEqual,
  compactAssistantMessageUpdate,
  legacySessionEventsFromManager,
  resumeStateFromManager,
  sessionManagerInfo,
  textOnlyModelContext,
  isRecord,
  historyFromManager,
  historyEventTime,
  sessionOriginsFromEntries,
  sessionModifiedAt,
  firstUserText,
  isWorkbenchDisplayOnlyCustomType,
  storedCanonicalEvent,
} from "./session-projections";
import { HostedPiSession } from "./hosted-pi-session";
export {
  PROMPT_SOURCE_CUSTOM_TYPE,
  type PromptSubmissionProvenance,
  type PromptSubmissionResult,
  type ResolveWorkbenchComposerCommandsOptions,
  type ResolvedWorkbenchComposerRequest,
  type PromptQueueMutation,
} from "./session-types";
import { getSessionContextTrace } from "./session-context-trace";
import {
  REVIEW_ENTRY_TYPE,
  getReviewSnapshots,
} from "@workbench/pi-runtime-tools/workspace-review";
import type { GitReviewSnapshot } from "@workbench/workspace-server/git";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  type AgentSession,
  AgentSessionRuntime,
  type AgentSessionServices,
  buildContextEntries,
  createAgentSessionFromServices,
  getAgentDir,
  sessionEntryToContextMessages,
  type SessionInfo,
  type SessionEntry,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  installSystemPromptPlaceholders,
  sessionTerminalShell,
} from "../lib/system-prompt-placeholders";
import { createWorkbenchAgentSessionServices as createModelServices } from "@workbench/pi-sdk-models/services";
import { withWorkbenchBuiltinSkills } from "@workbench/pi-sdk-resources/builtin-skills";
import { requireSkillOptIn } from "@workbench/pi-sdk-resources/skill-enablement";
import { workbenchToolOverrides } from "@workbench/pi-runtime-tools/builtin-tools";
import type {
  PiAgentMessage,
  PiImageContent,
  PiModelListResponse,
  PiModelSelection,
  PiQueuedPrompt,
  PiQueueMode,
  PiSessionHistory,
  PiSessionSummary,
} from "@workbench/pi-rpc-contracts/messages";
import {
  AUTOMATION_SESSION_ORIGIN_CUSTOM_TYPE,
  parseAutomationSessionOrigin,
  type AutomationSessionOrigin,
} from "@workbench/automation-contracts";
import {
  hasWorkbenchComposerSemantics,
  isWorkbenchComposerResolutionCustomType,
  isWorkbenchComposerUserCustomType,
  parseWorkbenchComposerResolutionDetails,
  parseWorkbenchComposerUserDetails,
  type WorkbenchComposerCommandResponse,
  type WorkbenchComposerReloadConfiguration,
  type WorkbenchComposerCommandTrace,
  type WorkbenchComposerCommandSubmission,
  type WorkbenchComposerSubmission,
  type WorkbenchComposerUserProjection,
  type WorkbenchResolvedAgentRequest,
} from "@workbench/core-contracts/composer/request";
import { PI_SESSION_FORKED_EVENT } from "@workbench/pi-rpc-contracts/messages";
import type {
  SessionCompactValue,
  SessionContextPolicy,
  SessionContextPolicyValue,
  SessionEvent,
  SessionHistoryBranches,
  SessionResumeState,
} from "@workbench/pi-rpc-contracts/rpc";
import {
  latestSessionContextPolicyMarker,
  policyFromSessionEntries,
  SESSION_CONTEXT_POLICY_CUSTOM_TYPE,
} from "./session-context-policy";
import { deriveSessionDisplayTitle } from "@workbench/pi-runtime-adapters/sessions";

import { createSessionEventPayload } from "@workbench/pi-rpc-contracts/stream";
import {
  preflightPlanWorkbenchComposerCommands,
  type PlannedWorkbenchComposerCommand,
} from "@workbench/pi-sdk-resources/composer-command-planner";
import { expandPromptTemplateContent } from "@workbench/pi-sdk-resources/prompt-template-expander";
import { composerCommandFailureReason } from "@workbench/pi-sdk-resources/composer-command-failure";
import {
  piCompactUsesLegacyArguments,
  resolvePiCompactCustomInstructions,
} from "@workbench/pi-sdk-resources/pi-composer-command-arguments";
import { PiServerError } from "@workbench/pi-sdk-ports/errors";
import { ColdSessionEventCache } from "./cold-session-event-cache";
import { getInteractiveResponseRegistry as getInteractiveRegistry } from "./interactive-response-registry";
import {
  readSessionCatalogIndex,
  type SessionCatalogIndexSnapshot,
  writeSessionCatalogIndex,
} from "./session-catalog-index";
import {
  activateSessionContextTrace,
  releaseSessionContextTrace,
  sessionContextTraceExtensions,
  sessionContextTraceSystemPromptOptions,
  sessionContextTraceSystemPromptSources,
} from "./session-context-trace";
import {
  appendSessionEventJournal,
  createCanonicalSessionEvent,
  initializeSessionEventJournal,
  readSessionEventJournal,
} from "./session-event-journal";
import { ensureSessionPersistence, reconcileInterruptedSession } from "./session-interruption";

import { validateWorkspace, workspaceFromCwd } from "@workbench/pi-sdk-resources/workspace-paths";
import { getProjectTrustService } from "@workbench/pi-sdk-resources/trust";
import { registerWorkbenchShutdownHook } from "@workbench/server-core/shutdown-hooks";
import { resolveInitialSessionModel } from "../lib/session-initial-model";
export { PiServerError } from "@workbench/pi-sdk-ports/errors";
export const SCRATCH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export { SerializedSessionMutations } from "./session-mutations";

export type { ScratchSessionStateRecord as ScratchSessionRecord } from "./session-registry-state";
import type { ScratchSessionStateRecord as ScratchSessionRecord } from "./session-registry-state";
import {
  processPiSessionRegistryState,
  type PiSessionRegistryState,
} from "./session-registry-state";
import { PersistedSessionDirectory } from "./persisted-session-directory";
import { ScratchSessionDirectory } from "./scratch-session-directory";
type RegistryState = PiSessionRegistryState<HostedPiSession>;
type SessionCatalogRegistryView = Pick<RegistryState, "live" | "persisted" | "scratch">;
interface CanonicalJournalEntry {
  entry: SessionEntry;
  event: SessionEvent;
  branchIndex: number;
}
import type { PiSessionRuntimeDependencies } from "./session-runtime-dependencies";

export type PiSessionRegistry = ReturnType<typeof createPiSessionRegistry>;
export type HostedSession = Awaited<ReturnType<PiSessionRegistry["getOrStartSession"]>>;

/** One registry implementation per server module generation; original process state and SDK lifetimes stay intact. */
export function createPiSessionRegistry(dependencies: PiSessionRuntimeDependencies) {
  const {
    getPublisher: getStreamHub,
    getWorkspaceStore,
    getHostBindings: getPiAgentHostBindings,
    ensureBuiltinResources: ensureWorkbenchBuiltinResources,
    createExtensions: createWorkbenchInternalPiExtensions,
    prepareExtensions: prepareWorkbenchPiExtensions,
  } = dependencies;
  function getInteractiveResponseRegistry() {
    return getInteractiveRegistry({ hub: getStreamHub() });
  }

  const modelProviderRevisions = new Map<string, number>();
  const coldSessionEventCache = new ColdSessionEventCache();
  function notifyModelProviderConfigurationChanged(provider: string): void {
    modelProviderRevisions.set(provider, (modelProviderRevisions.get(provider) ?? 0) + 1);
  }

  function commandArgumentText(
    command: WorkbenchComposerCommandSubmission,
    fallback: string,
  ): string {
    if (command.args === undefined) return fallback.trim();
    if (typeof command.args === "string") return command.args;
    if (command.args === null) return "";
    return JSON.stringify(command.args);
  }
  function validateWorkbenchComposerCommands(
    session: Pick<
      AgentSession,
      "extensionRunner" | "getActiveToolNames" | "promptTemplates" | "resourceLoader"
    >,
    submission: WorkbenchComposerSubmission,
  ): void {
    preflightPlanWorkbenchComposerCommands(session, submission);
  }
  function notifyCommandResponse(
    options: ResolveWorkbenchComposerCommandsOptions,
    response: WorkbenchComposerCommandResponse,
  ): void {
    try {
      options.onCommandResponse?.(response);
    } catch {
      // UI status reporting is observational and must not change command execution semantics.
    }
  }
  function commandTrace(
    plan: PlannedWorkbenchComposerCommand,
    status: WorkbenchComposerCommandTrace["status"],
    failureReason?: WorkbenchComposerCommandTrace["failureReason"],
  ): WorkbenchComposerCommandTrace {
    const command = plan.command;
    return {
      source: command.source,
      commandId: command.commandId,
      label: command.label,
      scope: command.scope,
      effect: plan.effect,
      status,
      ...(command.args === undefined ? {} : { args: command.args }),
      ...(failureReason === undefined ? {} : { failureReason }),
    };
  }
  function currentReloadConfiguration(
    resourceLoader: AgentSession["resourceLoader"],
  ): WorkbenchComposerReloadConfiguration {
    const systemPromptSource = resourceLoader.getSystemPromptSource();
    return {
      extensions: resourceLoader
        .getExtensions()
        .extensions.filter((extension) => !extension.hidden)
        .map((extension) => extension.path),
      skills: resourceLoader.getSkills().skills.map((skill) => skill.name),
      prompts: resourceLoader.getPrompts().prompts.map((prompt) => prompt.name),
      contextFiles: [
        ...(systemPromptSource ? [systemPromptSource.path] : []),
        ...resourceLoader.getAppendSystemPromptSources().map((source) => source.path),
        ...resourceLoader.getAgentsFiles().agentsFiles.map((file) => file.path),
      ],
    };
  }
  async function resolveWorkbenchComposerCommands(
    session: Pick<
      AgentSession,
      | "compact"
      | "extensionRunner"
      | "getActiveToolNames"
      | "prompt"
      | "promptTemplates"
      | "reload"
      | "resourceLoader"
      | "sessionManager"
    >,
    submission: WorkbenchComposerSubmission,
    options: ResolveWorkbenchComposerCommandsOptions = {},
  ): Promise<ResolvedWorkbenchComposerRequest> {
    const plans =
      options.plannedCommands ?? preflightPlanWorkbenchComposerCommands(session, submission);
    const request: WorkbenchResolvedAgentRequest = {
      version: 1,
      userText: submission.text,
      config: {
        ...(submission.mode === undefined ? {} : { mode: submission.mode }),
        ...(submission.model === undefined ? {} : { model: submission.model }),
        metadata: { ...submission.metadata },
      },
      selectedSkills: [],
      instructions: [],
      trustedContext: [],
      untrustedContext: submission.context.map((context) => ({
        source: context.type,
        trust: "untrusted-context",
        value: context.value,
      })),
      commandTrace: [],
    };
    let agentTurn = false;
    const commandResponses: WorkbenchComposerCommandResponse[] = [];

    for (const plan of plans) {
      const command = plan.command;
      let reloadConfiguration: WorkbenchComposerReloadConfiguration | undefined;
      if (plan.kind === "builtin") {
        notifyCommandResponse(options, {
          source: "agent",
          commandId: command.commandId,
          label: command.label,
          status: "running",
          ...(command.args === undefined ? {} : { args: command.args }),
        });
      }
      try {
        switch (plan.kind) {
          case "workbench":
            break;
          case "builtin":
            if (plan.builtin.name === "compact") {
              await session.compact(resolvePiCompactCustomInstructions(command, request.userText));
              if (piCompactUsesLegacyArguments(command)) request.userText = "";
            } else {
              await session.reload();
              reloadConfiguration = currentReloadConfiguration(session.resourceLoader);
            }
            break;
          case "skill": {
            request.selectedSkills.push({
              invocationName: command.commandId,
              name: plan.skill.name,
              location: plan.skill.filePath,
              baseDir: plan.skill.baseDir,
              selectedBy: "user",
              content: await readFile(plan.skill.filePath, "utf8"),
            });
            break;
          }
          case "prompt":
            request.userText = expandPromptTemplateContent(
              plan.template.content,
              commandArgumentText(command, request.userText),
            );
            break;
          case "extension": {
            const args = commandArgumentText(command, request.userText);
            const commandPrompt = `/${command.commandId}${args ? ` ${args}` : ""}`;
            const releaseProjection = options.projectInternalUserPrompt?.();
            agentTurn = true;
            try {
              await session.prompt(commandPrompt, { source: "rpc" });
            } finally {
              releaseProjection?.();
            }
            break;
          }
        }
        request.commandTrace.push(commandTrace(plan, "success"));
        if (plan.kind === "builtin") {
          const response: WorkbenchComposerCommandResponse = {
            source: "agent",
            commandId: command.commandId,
            label: command.label,
            status: "success",
            ...(command.args === undefined ? {} : { args: command.args }),
            ...(reloadConfiguration === undefined ? {} : { reloadConfiguration }),
          };
          commandResponses.push(response);
          notifyCommandResponse(options, response);
        }
      } catch (error) {
        const failureReason = composerCommandFailureReason(command, error);
        try {
          options.onCommandError?.(command, error);
        } catch {
          // Error reporting is observational and must not reject an admitted Composer transaction.
        }
        request.commandTrace.push(commandTrace(plan, "execution-failed", failureReason));
        if (plan.kind === "builtin") {
          const response: WorkbenchComposerCommandResponse = {
            source: "agent",
            commandId: command.commandId,
            label: command.label,
            status: "execution-failed",
            ...(command.args === undefined ? {} : { args: command.args }),
            failureReason,
          };
          commandResponses.push(response);
          notifyCommandResponse(options, response);
        }
      }
    }
    return { request, commandResponses, agentTurn };
  }

  const SESSION_ORIGIN_SCAN_BYTES = 64 * 1024;
  async function readSessionOrigins(file: string): Promise<SessionOrigins> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(file, "r");
      const buffer = Buffer.allocUnsafe(SESSION_ORIGIN_SCAN_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      let automationOrigin: AutomationSessionOrigin | undefined;
      for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
        if (!line.includes(AUTOMATION_SESSION_ORIGIN_CUSTOM_TYPE)) continue;
        const entry = JSON.parse(line) as unknown;
        if (!isRecord(entry) || entry.type !== "custom") continue;
        if (!automationOrigin && entry.customType === AUTOMATION_SESSION_ORIGIN_CUSTOM_TYPE) {
          automationOrigin = parseAutomationSessionOrigin(entry.data);
        }
        if (automationOrigin) break;
      }
      return automationOrigin === undefined ? {} : { automationOrigin };
    } catch {
      // Missing, malformed, or concurrently replaced files remain ordinary conversations.
    } finally {
      await handle?.close().catch(() => undefined);
    }
    return {};
  }

  function contentHasImage(content: unknown): boolean {
    return (
      Array.isArray(content) &&
      content.some(
        (part) => isRecord(part) && part.type === "image" && typeof part.data === "string",
      )
    );
  }
  function messagesHaveImages(messages: readonly unknown[]): boolean {
    return messages.some((candidate) => isRecord(candidate) && contentHasImage(candidate.content));
  }

  function state(): PiSessionRegistryState<HostedPiSession> {
    return processPiSessionRegistryState<HostedPiSession>();
  }
  const persistedDirectory = new PersistedSessionDirectory(state().persisted);
  const scratchDirectory = new ScratchSessionDirectory(state().scratch, {
    isBusy: (id) => {
      const host = state().live.get(id);
      return host?.isAlive === true && host.isBusy;
    },
    release: (id) => releaseScratchSession(id),
    invalidateFile: (filePath) => coldSessionEventCache.invalidate(filePath),
  });
  function runningSessionIds(): string[] {
    return state().live.runningIds();
  }
  function publishRunningSessions(): void {
    const registry = state();
    const ids = runningSessionIds();
    const key = ids.join("\u0000");
    if (key === registry.live.lastRunningKey) return;
    const previous = new Set(
      registry.live.lastRunningKey ? registry.live.lastRunningKey.split("\u0000") : [],
    );
    const next = new Set(ids);
    registry.live.lastRunningKey = key;
    for (const sessionId of new Set([...previous, ...next])) {
      if (previous.has(sessionId) === next.has(sessionId)) continue;
      try {
        const runTiming = next.has(sessionId)
          ? registry.live.sessions.get(sessionId)?.runTiming
          : undefined;
        getStreamHub().publishHost({
          type: "host/session-status",
          sessionId,
          running: next.has(sessionId),
          ...(runTiming === undefined ? {} : { runTiming }),
        });
      } catch {
        // Running state remains authoritative through session.list.
      }
    }
    for (const listener of registry.live.runningListeners) listener(ids);
  }
  async function createHost(
    sessionManager: SessionManager,
    initialModel?: PiModelSelection,
    options: { customTools?: readonly ToolDefinition[] } = {},
  ): Promise<HostedPiSession> {
    initializeInactiveSessionJournal(sessionManager);
    const cwd = sessionManager.getCwd();
    const hostBindings = getPiAgentHostBindings();
    await ensureWorkbenchBuiltinResources();
    const sessionPreferences = await hostBindings.readSessionPreferences?.();
    const initialContextPolicy = policyFromSessionEntries(sessionManager.getBranch());
    const services = await createWorkbenchAgentSessionServices({
      cwd,
      resourceLoaderOptions: {
        skillsOverride: withWorkbenchBuiltinSkills,
        extensionFactories: createWorkbenchInternalPiExtensions(
          hostBindings.askUserSettings,
          hostBindings.todoSettings,
          hostBindings.builtinToolSettings,
          hostBindings.workbenchSettingsToolSettings,
        ),
        extensionsOverride: prepareWorkbenchPiExtensions,
      },
      resourceLoaderReloadOptions: {
        resolveProjectTrust: async () => getProjectTrustService().isTrusted(cwd),
      },
    });
    requireSkillOptIn(services.resourceLoader, services.settingsManager);
    const modelSelection = resolveInitialSessionModel(
      initialModel,
      services.modelRuntime.getAvailableSnapshot(),
    );
    const shell = sessionTerminalShell(
      services.settingsManager.getShellPath()?.trim() || hostBindings.getDefaultTerminalShell?.(),
    );
    const toolOverrides = workbenchToolOverrides(
      cwd,
      hostBindings,
      sessionPreferences?.enhancedSearch,
    );
    const workbenchToolSources = new Map(toolOverrides.map(({ name, source }) => [name, source]));
    // Explicit SDK tools are applied last and may replace a Workbench override as well.
    for (const tool of options.customTools ?? []) workbenchToolSources.delete(tool.name);
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...modelSelection,
      customTools: [
        ...toolOverrides.map((override) =>
          override.create({
            cwd,
            sessionId: sessionManager.getSessionId(),
            commandPrefix: services.settingsManager.getShellCommandPrefix(),
            shellPath: shell,
          }),
        ),
        ...(options.customTools ?? []),
      ],
    });
    installSystemPromptPlaceholders(session, { shell });
    // Workbench creates and replaces sessions through its registry, but still retains Pi's
    // high-level runtime owner so disposal emits session_shutdown before invalidating extension ctx.
    const sessionRuntime = new AgentSessionRuntime(session, services, async () => {
      throw new Error("Workbench does not replace a hosted Pi session in place");
    });
    const interactiveResponses = getInteractiveResponseRegistry();
    const contextTrace = await activateSessionContextTrace(
      session.sessionId,
      (event) => {
        getStreamHub().publishMux({
          type: "session/context-trace",
          sessionId: session.sessionId,
          event,
        });
      },
      sessionPreferences?.retainAllModelIO,
    );
    contextTrace.setSystemPromptSourcesResolver(() =>
      sessionContextTraceSystemPromptSources(session.resourceLoader, cwd, services.agentDir),
    );
    contextTrace.setSystemPromptOptionsResolver(() =>
      sessionContextTraceSystemPromptOptions(session.resourceLoader, cwd),
    );
    contextTrace.setExtensionsResolver(() => sessionContextTraceExtensions(session.resourceLoader));
    let host: HostedPiSession;
    try {
      await session.bindExtensions({
        mode: "rpc",
        uiContext: interactiveResponses.createExtensionUIContext(
          session.sessionId,
          hostBindings.askUserSettings,
        ),
      });
      host = new HostedPiSession(
        {
          readHistory: getSessionHistory,
          workspaceFiles: () => getPiAgentHostBindings().workspaceFiles,
          getPublisher: getStreamHub,
          interactiveResponses: getInteractiveResponseRegistry,
          announceChanged: announceSessionChanged,
          modelProviderRevision: (provider) => modelProviderRevisions.get(provider) ?? 0,
          resolveComposerCommands: resolveWorkbenchComposerCommands,
        },
        sessionRuntime,
        contextTrace,
        publishRunningSessions,
        () => {
          const registry = state();
          cacheHostedSession(registry, host);
          registry.live.detach(host);
          interactiveResponses.clearSession(host.id);
          publishRunningSessions();
        },
        initialContextPolicy,
        workbenchToolSources,
      );
    } catch (error) {
      await sessionRuntime.dispose();
      await releaseSessionContextTrace(session.sessionId, contextTrace);
      throw error;
    }
    state().live.attach(host);
    cacheHostedSession(state(), host);
    try {
      getStreamHub().publishMux({
        type: "session/subscribed",
        sessionId: host.id,
        lastSeq: host.currentSequence,
      });
      host.publishQueueSnapshot();
    } catch {
      // The session can still be reached through unary history after reconnect.
    }
    publishRunningSessions();
    return host;
  }
  async function modelServices(cwd: string): Promise<AgentSessionServices> {
    const workspace = validateWorkspace(cwd);
    return createWorkbenchAgentSessionServices({
      cwd: workspace.cwd,
      resourceLoaderReloadOptions: {
        resolveProjectTrust: async () => getProjectTrustService().isTrusted(workspace.cwd),
      },
    });
  }
  async function persistedSession(id: string): Promise<SessionInfo | undefined> {
    await ensurePersistedSessionCache();
    const cached = persistedDirectory.info(id);
    if (cached && existsSync(cached.path)) return cached;
    return undefined;
  }

  function canonicalJournalEntries(branch: readonly SessionEntry[]): CanonicalJournalEntry[] {
    const result: CanonicalJournalEntry[] = [];
    for (let branchIndex = 0; branchIndex < branch.length; branchIndex += 1) {
      const entry = branch[branchIndex]!;
      const event = storedCanonicalEvent(entry);
      if (!event || event.seq !== result.length) continue;
      result.push({ entry, event: { ...event, entryId: entry.id }, branchIndex });
    }
    return result;
  }

  function persistedMessageForkLeaf(
    journalEntry: CanonicalJournalEntry,
    branch: readonly SessionEntry[],
  ): SessionEntry | undefined {
    const { branchIndex: journalBranchIndex, entry: eventEntry, event } = journalEntry;
    if (!isRecord(event.data) || !isRecord(event.data.message)) return undefined;
    const message = event.data.message;
    const next = branch[journalBranchIndex + 1];
    if (typeof message.role !== "string") return undefined;

    if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
      // Cache notices belong to the Workbench projection, not Pi's durable model message.
      const persistedMessage = { ...message };
      if (message.role === "assistant") delete persistedMessage.workbenchCacheMiss;
      return next?.type === "message" && jsonEqual(next.message, persistedMessage)
        ? next
        : undefined;
    }
    if (message.role !== "custom") return undefined;
    if (customMessageMatchesEntry(message, next)) return next;

    // Workbench custom messages are persisted before AgentSession emits their lifecycle events:
    // custom_message -> message_start journal -> message_end journal. The message_end event entry is
    // the correct fork leaf because its parent chain already contains the matching context message.
    const startEntry = branch[journalBranchIndex - 1];
    const persistedEntry = branch[journalBranchIndex - 2];
    const startEvent = startEntry ? storedCanonicalEvent(startEntry) : undefined;
    const startMessage = isRecord(startEvent?.data) ? startEvent.data.message : undefined;
    return startEvent?.type === "message_start" &&
      jsonEqual(startMessage, message) &&
      customMessageMatchesEntry(message, persistedEntry)
      ? eventEntry
      : undefined;
  }
  function forkUnavailable(): PiServerError {
    return new PiServerError("pi_fork_unavailable", 409);
  }
  function forkLeafForSequence(manager: SessionManager, atSeq?: number): SessionEntry {
    const branch = manager.getBranch();
    const journal = canonicalJournalEntries(branch);
    const lastSeq = journal.at(-1)?.event.seq ?? -1;
    const anchor = atSeq !== undefined && atSeq <= lastSeq ? journal[atSeq] : undefined;
    // Legacy migration records one synthetic `message` event per context message but does not retain
    // the original Pi entry id. A later turn boundary cannot make that historical anchor unambiguous.
    if (anchor?.event.type === "message") throw forkUnavailable();
    if (anchor?.event.type === "message_end") {
      const messageLeaf = persistedMessageForkLeaf(anchor, branch);
      if (!messageLeaf) throw forkUnavailable();
      return messageLeaf;
    }
    const boundary =
      atSeq === undefined
        ? journal.findLast(({ event }) => event.type === "turn_end")
        : (journal.find(({ event }) => event.type === "turn_end" && event.seq >= atSeq) ??
          (atSeq > lastSeq
            ? journal.findLast(({ event }) => event.type === "turn_end")
            : undefined));
    if (!boundary) throw forkUnavailable();

    let turnOpen = false;
    for (const candidate of journal) {
      if (candidate.event.seq > boundary.event.seq) break;
      if (candidate.event.type === "agent_start") {
        // Regeneration and message-anchored forks may retain an open turn from the previous run.
        turnOpen = false;
      } else if (candidate.event.type === "turn_start") {
        if (turnOpen) throw forkUnavailable();
        turnOpen = true;
      } else if (candidate.event.type === "message_end") {
        if (!persistedMessageForkLeaf(candidate, branch)) {
          throw forkUnavailable();
        }
      } else if (candidate.event.type === "turn_end") {
        if (!turnOpen) throw forkUnavailable();
        turnOpen = false;
      }
    }
    if (turnOpen) throw forkUnavailable();
    return boundary.entry;
  }
  function createDetachedSessionFork(
    sourcePath: string,
    atSeq?: number,
    sessionDirectory?: string,
  ): SessionManager {
    const sourceBefore = statSync(sourcePath);
    const detached = SessionManager.open(sourcePath, sessionDirectory);
    const contextPolicy = latestSessionContextPolicyMarker(detached.getBranch());
    const leaf = forkLeafForSequence(detached, atSeq);
    const sourceId = detached.getSessionId();
    const childPath = detached.createBranchedSession(leaf.id);
    if (!childPath || detached.getSessionId() === sourceId) throw forkUnavailable();
    try {
      const sourceAfter = statSync(sourcePath);
      if (sourceAfter.size !== sourceBefore.size || sourceAfter.mtimeMs !== sourceBefore.mtimeMs) {
        removeFailedForkFile(sourcePath, detached);
        throw forkUnavailable();
      }
      if (contextPolicy) {
        detached.appendCustomEntry(SESSION_CONTEXT_POLICY_CUSTOM_TYPE, contextPolicy);
      }
      const inheritedEvents = readSessionEventJournal(detached);
      const sourceEventSeq = inheritedEvents.at(-1)?.seq;
      if (sourceEventSeq === undefined) throw forkUnavailable();
      appendSessionEventJournal(
        detached,
        createCanonicalSessionEvent(
          {
            type: PI_SESSION_FORKED_EVENT,
            sourceSessionId: sourceId,
            sourceEventSeq,
          },
          inheritedEvents.length,
          Date.now(),
        ),
      );
    } catch (error) {
      removeFailedForkFile(sourcePath, detached);
      if (error instanceof PiServerError) throw error;
      throw forkUnavailable();
    }
    return detached;
  }
  class RequestedSessionCwdConflict extends PiServerError {
    readonly requestedCwd: string;
    readonly existingCwd: string;

    constructor(sessionId: string, requestedCwd: string, existingCwd: string) {
      super("pi_session_conflict", 409);
      this.name = "RequestedSessionCwdConflict";
      this.message = `Session ${sessionId} already belongs to ${existingCwd}; requested ${requestedCwd}.`;
      this.requestedCwd = requestedCwd;
      this.existingCwd = existingCwd;
    }
  }
  function requireRequestedCwd(sessionId: string, requestedCwd: string, existingCwd: string): void {
    const canonicalExistingCwd = workspaceFromCwd(existingCwd).cwd;
    if (canonicalExistingCwd !== requestedCwd) {
      throw new RequestedSessionCwdConflict(sessionId, requestedCwd, canonicalExistingCwd);
    }
  }
  function announceSessionAdded(host: HostedPiSession): void {
    const summary = host.summary();
    try {
      getStreamHub().publishHost({
        type: "host/session-added",
        sessionId: host.id,
        blank: summary.messageCount === 0,
        summary,
        cwd: summary.cwd,
      });
    } catch {
      // session.list remains the authoritative recovery path.
    }
  }
  function announceSessionChanged(host: HostedPiSession): void {
    if (state().scratch.sessions.has(host.id)) return;
    const summary = host.summary();
    cacheHostedSession(state(), host);
    try {
      getStreamHub().publishHost({
        type: "host/session-changed",
        sessionId: host.id,
        summary,
      });
    } catch {
      // session.list remains the authoritative recovery path.
    }
  }
  async function getOrStartSession(id: string): Promise<HostedPiSession> {
    const registry = state();
    const existing = registry.live.sessions.get(id);
    if (existing?.isAlive) return existing;
    if (existing) await existing.shutdown();

    const starting = registry.live.startLocks.get(id);
    if (starting) return starting;

    const start = (async () => {
      const scratch = registry.scratch.sessions.get(id);
      if (scratch) {
        if (!existsSync(/* turbopackIgnore: true */ scratch.filePath)) {
          scratchDirectory.delete(id);
          throw new PiServerError("pi_session_not_found", 404);
        }
        return createHost(SessionManager.open(scratch.filePath, scratchDirectory.directory()));
      }
      const info = await persistedSession(id);
      if (!info) throw new PiServerError("pi_session_not_found", 404);
      return createHost(SessionManager.open(info.path));
    })().finally(() => registry.live.startLocks.delete(id));
    registry.live.startLocks.set(id, start);
    return start;
  }
  async function sessionSourceFile(
    id: string,
  ): Promise<{ cwd: string; filePath: string } | undefined> {
    const registry = state();
    let live = registry.live.sessions.get(id);
    if (!live?.isAlive) {
      const starting = registry.live.startLocks.get(id);
      if (starting) live = await starting;
    }
    const liveFile = live?.session.sessionManager.getSessionFile();
    if (live?.isAlive && liveFile && existsSync(/* turbopackIgnore: true */ liveFile)) {
      return { cwd: live.session.sessionManager.getCwd(), filePath: liveFile };
    }
    const scratch = registry.scratch.sessions.get(id);
    if (scratch && existsSync(/* turbopackIgnore: true */ scratch.filePath)) {
      return { cwd: scratch.cwd, filePath: scratch.filePath };
    }
    const persisted = await persistedSession(id);
    return persisted ? { cwd: persisted.cwd, filePath: persisted.path } : undefined;
  }
  function getScratchSessionRecord(id: string): ScratchSessionRecord | undefined {
    return state().scratch.sessions.get(id);
  }
  async function getScratchSessionSummary(id: string): Promise<PiSessionSummary | undefined> {
    const record = state().scratch.sessions.get(id);
    if (!record) return undefined;
    const live = state().live.sessions.get(id);
    if (live?.isAlive) return live.summary();
    if (!existsSync(/* turbopackIgnore: true */ record.filePath)) return undefined;
    return persistedMetadataFromManager(SessionManager.open(record.filePath), false).summary;
  }
  async function createScratchSession(
    sourceSessionId: string,
    atSeq?: number,
    options: Readonly<{ workspaceId?: string; ttlMs?: number }> = {},
  ): Promise<{ host: HostedSession; record: ScratchSessionRecord }> {
    const registry = state();
    const source = await sessionSourceFile(sourceSessionId);
    if (!source) throw new PiServerError("pi_session_not_found", 404);

    return state().forks.run(async () => {
      const sourceFile = await sessionSourceFile(sourceSessionId);
      if (!sourceFile || !existsSync(/* turbopackIgnore: true */ sourceFile.filePath)) {
        throw new PiServerError("pi_session_not_found", 404);
      }

      let child: SessionManager;
      try {
        // Snapshot the last completed turn even while the source continues running.
        child = createDetachedSessionFork(sourceFile.filePath, atSeq, scratchDirectory.directory());
      } catch (error) {
        if (error instanceof PiServerError) throw error;
        throw forkUnavailable();
      }
      const sessionId = child.getSessionId();
      const filePath = child.getSessionFile();
      if (!filePath || !existsSync(/* turbopackIgnore: true */ filePath)) {
        throw forkUnavailable();
      }
      if (
        registry.live.sessions.has(sessionId) ||
        registry.live.startLocks.has(sessionId) ||
        registry.scratch.sessions.has(sessionId)
      ) {
        removeFailedForkFile(sourceFile.filePath, child);
        throw forkUnavailable();
      }

      const createdAt = Date.now();
      const record: ScratchSessionRecord = {
        id: sessionId,
        sourceSessionId,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        cwd: sourceFile.cwd,
        filePath,
        createdAt,
        expiresAt: createdAt + (options.ttlMs ?? SCRATCH_SESSION_TTL_MS),
      };
      scratchDirectory.set(record);
      scratchDirectory.scheduleExpiry(record);
      try {
        const host = await createHost(child);
        return { host, record };
      } catch (error) {
        scratchDirectory.clearExpiry(record);
        scratchDirectory.delete(sessionId);
        removeFailedForkFile(sourceFile.filePath, child);
        throw error;
      }
    });
  }
  async function releaseScratchSession(id: string): Promise<void> {
    const registry = state();
    const record = registry.scratch.sessions.get(id);
    if (!record) return;
    scratchDirectory.clearExpiry(record);
    const starting = registry.live.startLocks.get(id);
    if (starting) await starting.catch(() => undefined);
    const live = registry.live.sessions.get(id);
    if (live?.isAlive) await live.shutdown();
    coldSessionEventCache.invalidate(record.filePath);
    if (existsSync(/* turbopackIgnore: true */ record.filePath)) unlinkSync(record.filePath);
    scratchDirectory.delete(id);
    registry.persisted.sessions.delete(id);
    registry.persisted.summaries.delete(id);
    registry.persisted.fingerprints.delete(record.filePath);
  }
  async function promoteScratchSession(
    id: string,
    title?: string,
  ): Promise<{ host: HostedSession; sourceSessionId: string; workspaceId?: string }> {
    const registry = state();
    const record = registry.scratch.sessions.get(id);
    if (!record || !existsSync(/* turbopackIgnore: true */ record.filePath)) {
      throw new PiServerError("pi_session_not_found", 404);
    }
    const live = registry.live.sessions.get(id);
    if (live?.isAlive && live.isBusy) throw new PiServerError("pi_session_busy", 409);

    return state().forks.run(async () => {
      const current = registry.scratch.sessions.get(id);
      if (!current || !existsSync(/* turbopackIgnore: true */ current.filePath)) {
        throw new PiServerError("pi_session_not_found", 404);
      }
      const currentHost = registry.live.sessions.get(id);
      if (currentHost?.isAlive && currentHost.isBusy) {
        throw new PiServerError("pi_session_busy", 409);
      }

      const promoted = SessionManager.forkFrom(current.filePath, current.cwd);
      const promotedPath = promoted.getSessionFile();
      if (title?.trim()) promoted.appendSessionInfo(title.trim());
      let host: HostedPiSession;
      try {
        host = await createHost(promoted);
      } catch (error) {
        if (promotedPath && existsSync(/* turbopackIgnore: true */ promotedPath)) {
          unlinkSync(promotedPath);
        }
        throw error;
      }
      announceSessionAdded(host);
      try {
        await releaseScratchSession(id);
      } catch (error) {
        // Promotion is already durable and visible. Retain success rather than deleting the formal
        // file underneath a live host; the temporary file remains isolated for later cleanup.
        console.error("[workbench-pi] promoted scratch cleanup failed", error);
      }
      return {
        host,
        sourceSessionId: current.sourceSessionId,
        ...(current.workspaceId ? { workspaceId: current.workspaceId } : {}),
      };
    });
  }
  async function createSession(
    cwd: string,
    sessionId?: string,
    initialModel?: PiModelSelection,
    options: {
      sessionDirectory?: string;
      customTools?: readonly ToolDefinition[];
    } = {},
  ): Promise<HostedPiSession> {
    const workspace = validateWorkspace(cwd);
    const registry = state();
    if (sessionId !== undefined) {
      const existing = registry.live.sessions.get(sessionId);
      if (existing?.isAlive) {
        requireRequestedCwd(sessionId, workspace.cwd, existing.session.sessionManager.getCwd());
        return existing;
      }
      if (existing) await existing.shutdown();

      const starting = registry.live.startLocks.get(sessionId);
      if (starting) {
        const host = await starting;
        requireRequestedCwd(sessionId, workspace.cwd, host.session.sessionManager.getCwd());
        return host;
      }

      const start = (async () => {
        const persisted = await persistedSession(sessionId);
        if (persisted !== undefined) {
          requireRequestedCwd(sessionId, workspace.cwd, persisted.cwd);
          return createHost(SessionManager.open(persisted.path), initialModel, options);
        }
        const host = await createHost(
          SessionManager.create(workspace.cwd, options.sessionDirectory, { id: sessionId }),
          initialModel,
          options,
        );
        announceSessionAdded(host);
        return host;
      })().finally(() => registry.live.startLocks.delete(sessionId));
      registry.live.startLocks.set(sessionId, start);
      return start;
    }

    const key = `new:${randomUUID()}`;
    const start = createHost(
      SessionManager.create(workspace.cwd, options.sessionDirectory),
      initialModel,
      options,
    )
      .then((host) => {
        announceSessionAdded(host);
        return host;
      })
      .finally(() => registry.live.startLocks.delete(key));
    registry.live.startLocks.set(key, start);
    return start;
  }
  function removeFailedForkFile(sourcePath: string, child: SessionManager): void {
    const childPath = child.getSessionFile();
    if (!childPath || childPath === sourcePath || !existsSync(childPath)) return;
    try {
      unlinkSync(childPath);
    } catch {
      // A failed child remains discoverable and reconcilable if cleanup races another filesystem actor.
    }
  }

  async function forkSession(id: string, atSeq?: number): Promise<{ id: string }> {
    const registry = state();
    let live = registry.live.sessions.get(id);
    if (!live?.isAlive) {
      const starting = registry.live.startLocks.get(id);
      if (starting) live = await starting;
    }
    if (live?.isAlive && live.isBusy && atSeq === undefined) throw forkUnavailable();

    let sourcePath = live?.session.sessionManager.getSessionFile() ?? undefined;
    if (!sourcePath || !existsSync(/* turbopackIgnore: true */ sourcePath)) {
      const info = await persistedSession(id);
      if (!info && !live?.isAlive) throw new PiServerError("pi_session_not_found", 404);
      sourcePath = info?.path;
    }
    if (!sourcePath || !existsSync(/* turbopackIgnore: true */ sourcePath)) {
      throw forkUnavailable();
    }
    const resolvedSourcePath = sourcePath;

    return state().forks.run(async () => {
      if (
        !existsSync(/* turbopackIgnore: true */ resolvedSourcePath) ||
        (atSeq === undefined && registry.live.sessions.get(id)?.isBusy)
      ) {
        throw forkUnavailable();
      }
      const occupiedIds = new Set(registry.persisted.sessions.keys());
      if (
        !existsSync(/* turbopackIgnore: true */ resolvedSourcePath) ||
        (atSeq === undefined && registry.live.sessions.get(id)?.isBusy)
      ) {
        throw forkUnavailable();
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let child: SessionManager;
        try {
          child = createDetachedSessionFork(resolvedSourcePath, atSeq);
        } catch (error) {
          if (error instanceof PiServerError) throw error;
          throw forkUnavailable();
        }

        const childId = child.getSessionId();
        if (
          occupiedIds.has(childId) ||
          registry.live.sessions.has(childId) ||
          registry.live.startLocks.has(childId)
        ) {
          removeFailedForkFile(resolvedSourcePath, child);
          continue;
        }

        try {
          return { id: registerImportedSessionManager(child).id };
        } catch (error) {
          removeFailedForkFile(resolvedSourcePath, child);
          throw error;
        }
      }
      throw forkUnavailable();
    });
  }
  function persistedSummary(
    info: SessionInfo,
    running: boolean,
    origins: SessionOrigins = {},
  ): PiSessionSummary {
    const { automationOrigin } = origins;
    return {
      id: info.id,
      cwd: info.cwd,
      workspace: workspaceFromCwd(info.cwd),
      name: info.name,
      created: info.created.toISOString(),
      // listAll already derives the last user/assistant activity while streaming the file. Opening
      // every JSONL again here doubles cold-index construction I/O; subsequent changed-file refreshes
      // use SessionManager and therefore retain Workbench's richer branch-aware timestamp.
      modified: info.modified.toISOString(),
      messageCount: info.messageCount,
      firstMessage: deriveSessionDisplayTitle(info.firstMessage),
      transient: false,
      running,
      ...(automationOrigin === undefined ? {} : { automationOrigin }),
    };
  }

  function persistedMetadataFromManager(
    manager: SessionManager,
    running: boolean,
  ): { info?: SessionInfo; summary: PiSessionSummary } {
    const messages = manager
      .getEntries()
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message);
    const header = manager.getHeader();
    const file = manager.getSessionFile();
    const timestamp = header?.timestamp ?? new Date().toISOString();
    const { automationOrigin } = sessionOriginsFromEntries(manager.getEntries());
    const summary: PiSessionSummary = {
      id: manager.getSessionId(),
      cwd: manager.getCwd(),
      workspace: workspaceFromCwd(manager.getCwd()),
      name: manager.getSessionName(),
      created: timestamp,
      modified: sessionModifiedAt(manager).toISOString(),
      messageCount: messages.length,
      firstMessage: firstUserText(messages),
      transient: !file || !existsSync(file),
      running,
      ...(automationOrigin === undefined ? {} : { automationOrigin }),
    };
    return { summary, info: sessionManagerInfo(manager, summary) };
  }
  function configuredSessionCacheKey(): string {
    return path.join(getAgentDir(), "sessions");
  }
  function ensureSessionCacheScope(registry: SessionCatalogRegistryView): string {
    const cacheKey = configuredSessionCacheKey();
    if (registry.persisted.cacheKey === cacheKey) return cacheKey;
    registry.persisted.cacheKey = cacheKey;
    registry.persisted.cacheReady = false;
    registry.persisted.cacheTask = undefined;
    registry.persisted.sessions.clear();
    registry.persisted.summaries.clear();
    registry.persisted.fingerprints.clear();
    coldSessionEventCache.clear();
    return cacheKey;
  }
  async function scanSessionFingerprints(sessionRoot: string): Promise<Map<string, string>> {
    let directories: string[];
    try {
      directories = (await readdir(sessionRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => path.join(sessionRoot, entry.name));
    } catch {
      return new Map();
    }

    const fileGroups = await Promise.all(
      directories.map(async (directory) => {
        try {
          return (await readdir(directory))
            .filter((name) => name.endsWith(".jsonl"))
            .map((name) => path.join(directory, name));
        } catch {
          return [];
        }
      }),
    );
    const fingerprints = new Map<string, string>();
    await Promise.all(
      fileGroups.flat().map(async (file) => {
        try {
          const metadata = await stat(file);
          fingerprints.set(file, `${metadata.size}:${metadata.mtimeMs}`);
        } catch {
          // A concurrently removed session is absent from the authoritative scan.
        }
      }),
    );
    return fingerprints;
  }
  function fingerprintsMatch(
    left: ReadonlyMap<string, string>,
    right: ReadonlyMap<string, string>,
  ) {
    if (left.size !== right.size) return false;
    for (const [file, fingerprint] of left) {
      if (right.get(file) !== fingerprint) return false;
    }
    return true;
  }
  function cacheHostedSession(
    registry: SessionCatalogRegistryView,
    host: HostedPiSession,
    fingerprints?: Map<string, string>,
  ): void {
    if (registry.scratch.sessions.has(host.id)) {
      const previous = registry.persisted.sessions.get(host.id);
      registry.persisted.sessions.delete(host.id);
      registry.persisted.summaries.delete(host.id);
      if (previous) {
        registry.persisted.fingerprints.delete(previous.path);
        fingerprints?.delete(previous.path);
      }
      return;
    }
    const { info, summary } = host.metadataSnapshot();
    registry.persisted.summaries.set(summary.id, summary);
    if (!info) {
      const previous = registry.persisted.sessions.get(summary.id);
      registry.persisted.sessions.delete(summary.id);
      if (previous) {
        registry.persisted.fingerprints.delete(previous.path);
        fingerprints?.delete(previous.path);
      }
      return;
    }
    registry.persisted.sessions.set(info.id, info);
    try {
      const metadata = statSync(info.path);
      const fingerprint = `${metadata.size}:${metadata.mtimeMs}`;
      registry.persisted.fingerprints.set(info.path, fingerprint);
      fingerprints?.set(info.path, fingerprint);
    } catch {
      registry.persisted.fingerprints.delete(info.path);
      fingerprints?.delete(info.path);
    }
  }
  function cachePersistedSessionManager(
    registry: SessionCatalogRegistryView,
    manager: SessionManager,
  ): PiSessionSummary {
    const { info, summary } = persistedMetadataFromManager(manager, false);
    persistedDirectory.cache(info, summary);
    if (!info) return summary;
    try {
      const metadata = statSync(info.path);
      registry.persisted.fingerprints.set(info.path, `${metadata.size}:${metadata.mtimeMs}`);
    } catch {
      registry.persisted.fingerprints.delete(info.path);
    }
    return summary;
  }
  function registerImportedSessionManager(manager: SessionManager): PiSessionSummary {
    const registry = state();
    const id = manager.getSessionId();
    if (registry.live.sessions.get(id)?.isAlive || registry.persisted.sessions.has(id)) {
      throw new PiServerError("pi_session_conflict", 409);
    }
    const summary = cachePersistedSessionManager(registry, manager);
    try {
      getStreamHub().publishHost({
        type: "host/session-added",
        sessionId: id,
        blank: summary.messageCount === 0,
        summary,
        cwd: summary.cwd,
      });
    } catch {
      // session.list remains the authoritative recovery path.
    }
    return summary;
  }
  function removeCachedSessionFile(registry: SessionCatalogRegistryView, file: string): void {
    coldSessionEventCache.invalidate(file);
    for (const [id, info] of registry.persisted.sessions) {
      if (info.path !== file) continue;
      registry.persisted.sessions.delete(id);
      registry.persisted.summaries.delete(id);
    }
  }
  function refreshChangedSessionFiles(
    registry: SessionCatalogRegistryView,
    fingerprints: ReadonlyMap<string, string>,
  ): void {
    for (const file of registry.persisted.fingerprints.keys()) {
      if (fingerprints.has(file)) continue;
      removeCachedSessionFile(registry, file);
    }

    const running = new Set(runningSessionIds());
    for (const [file, fingerprint] of fingerprints) {
      if (registry.persisted.fingerprints.get(file) === fingerprint) continue;
      removeCachedSessionFile(registry, file);
      try {
        const manager = SessionManager.open(file);
        const { info, summary } = persistedMetadataFromManager(
          manager,
          running.has(manager.getSessionId()),
        );
        if (!info) continue;
        registry.persisted.sessions.set(info.id, info);
        registry.persisted.summaries.set(summary.id, summary);
      } catch {
        // A malformed or concurrently removed file is excluded until a later fingerprint change.
      }
    }

    registry.persisted.fingerprints.clear();
    for (const [file, fingerprint] of fingerprints) {
      registry.persisted.fingerprints.set(file, fingerprint);
    }
  }
  function hydratePersistedSessionCache(
    registry: SessionCatalogRegistryView,
    snapshot: SessionCatalogIndexSnapshot,
  ): void {
    registry.persisted.sessions.clear();
    for (const [id, info] of snapshot.sessions) registry.persisted.sessions.set(id, info);
    registry.persisted.summaries.clear();
    for (const [id, summary] of snapshot.summaries) {
      registry.persisted.summaries.set(id, {
        ...summary,
        workspace: workspaceFromCwd(summary.cwd),
      });
    }
    registry.persisted.fingerprints.clear();
    for (const [file, fingerprint] of snapshot.fingerprints) {
      registry.persisted.fingerprints.set(file, fingerprint);
    }
    registry.persisted.cacheReady = true;
  }
  async function persistSessionCatalogIndex(
    registry: SessionCatalogRegistryView,
    cacheKey: string,
  ): Promise<void> {
    try {
      await writeSessionCatalogIndex(
        cacheKey,
        registry.persisted.sessions,
        registry.persisted.summaries,
        registry.persisted.fingerprints,
      );
    } catch (error) {
      console.error("[workbench-pi] session catalog index write failed", error);
    }
  }
  function startPersistedSessionCacheRefresh(
    registry: SessionCatalogRegistryView,
    cacheKey: string,
  ): Promise<void> {
    if (registry.persisted.cacheTask) return registry.persisted.cacheTask;
    const task = (async () => {
      let indexStatus: "memory" | "hit" | "missing" | "invalid" = registry.persisted.cacheReady
        ? "memory"
        : "missing";
      if (!registry.persisted.cacheReady) {
        const index = await readSessionCatalogIndex(cacheKey);
        indexStatus = index.status;
        if (index.status === "hit") hydratePersistedSessionCache(registry, index.snapshot);
        if (index.status === "invalid") {
          console.warn(
            `[workbench-pi] session catalog index ignored (${index.reason}, ${index.bytes ?? 0} bytes)`,
          );
        }
      }

      const fingerprints = await scanSessionFingerprints(cacheKey);
      if (registry.persisted.cacheKey !== cacheKey) return;
      for (const host of registry.live.sessions.values()) {
        if (host.isAlive) cacheHostedSession(registry, host, fingerprints);
      }
      if (
        registry.persisted.cacheReady &&
        fingerprintsMatch(registry.persisted.fingerprints, fingerprints)
      ) {
        return;
      }
      if (registry.persisted.cacheReady) {
        refreshChangedSessionFiles(registry, fingerprints);
      } else {
        const persisted = await SessionManager.listAll();
        if (registry.persisted.cacheKey !== cacheKey) return;
        const running = new Set(runningSessionIds());
        const nextSessions = new Map(persisted.map((session) => [session.id, session]));
        const sessionOrigins = await Promise.all(
          persisted.map((session) => readSessionOrigins(session.path)),
        );
        const nextSummaries = new Map(
          persisted.map((session, index) => [
            session.id,
            persistedSummary(session, running.has(session.id), sessionOrigins[index]),
          ]),
        );
        registry.persisted.sessions.clear();
        for (const [id, info] of nextSessions) registry.persisted.sessions.set(id, info);
        registry.persisted.summaries.clear();
        for (const [id, summary] of nextSummaries) {
          registry.persisted.summaries.set(id, summary);
        }
        registry.persisted.cacheReady = true;
      }
      registry.persisted.fingerprints.clear();
      for (const [file, fingerprint] of fingerprints) {
        registry.persisted.fingerprints.set(file, fingerprint);
      }
      for (const host of registry.live.sessions.values()) {
        if (host.isAlive) cacheHostedSession(registry, host);
      }
      registry.persisted.cacheReady = true;
      if (indexStatus !== "memory") {
        await persistSessionCatalogIndex(registry, cacheKey);
      }
    })().finally(() => {
      if (registry.persisted.cacheTask === task) {
        registry.persisted.cacheTask = undefined;
      }
    });
    registry.persisted.cacheTask = task;
    return task;
  }
  async function ensurePersistedSessionCache(): Promise<SessionCatalogRegistryView> {
    const registry = state();
    const cacheKey = ensureSessionCacheScope(registry);
    if (!registry.persisted.cacheReady) {
      await startPersistedSessionCacheRefresh(registry, cacheKey);
    } else if (!registry.persisted.cacheTask) {
      // Active hosts are overlaid synchronously below. Cold files are revalidated in the
      // background so filesystem latency can never hold the list RPC on its critical path.
      void startPersistedSessionCacheRefresh(registry, cacheKey).catch((error: unknown) => {
        console.error("Pi session metadata refresh failed.", error);
      });
    }
    return registry;
  }
  async function listSessions(): Promise<{
    sessions: PiSessionSummary[];
    runningSessionIds: string[];
  }> {
    const registry = await ensurePersistedSessionCache();
    const interactiveResponses = getInteractiveResponseRegistry();
    const scratchIds = new Set(registry.scratch.sessions.keys());
    // Running ids are transport state, not catalog membership. Hidden scratch ids must remain here
    // so their bound client Runtimes survive unary rebaselines during concurrent main/side runs.
    const runningIds = runningSessionIds();
    const running = new Set(runningIds);
    const summaries = new Map(
      [...registry.persisted.summaries].map(([id, summary]) => [
        id,
        summary.running === running.has(id) ? summary : { ...summary, running: running.has(id) },
      ]),
    );
    for (const host of registry.live.sessions.values()) {
      if (host.isAlive && !scratchIds.has(host.id)) summaries.set(host.id, host.summary());
    }
    return {
      sessions: [...summaries.values()]
        .map((summary) => ({
          ...summary,
          waitingForUserInput: interactiveResponses.isSessionWaitingForUserInput(summary.id),
        }))
        .sort((left, right) => right.created.localeCompare(left.created)),
      runningSessionIds: runningIds,
    };
  }
  async function listSessionSearchText(): Promise<
    Array<{ sessionId: string; allMessagesText: string }>
  > {
    const registry = await ensurePersistedSessionCache();
    return [...registry.persisted.sessions.values()].map((session) => ({
      sessionId: session.id,
      allMessagesText: session.allMessagesText,
    }));
  }
  async function listSessionFiles(): Promise<Array<{ path: string; fingerprint?: string }>> {
    const registry = await ensurePersistedSessionCache();
    await registry.persisted.cacheTask;
    return [...registry.persisted.sessions.values()]
      .filter((session) => !registry.scratch.sessions.has(session.id))
      .map((session) => ({
        path: session.path,
        fingerprint: registry.persisted.fingerprints.get(session.path),
      }));
  }
  async function listModels(cwd: string): Promise<PiModelListResponse> {
    const services = await modelServices(cwd);
    const available = services.modelRuntime.getAvailableSnapshot();
    const configuredProvider = services.settingsManager.getDefaultProvider();
    const configuredModelId = services.settingsManager.getDefaultModel();
    const configuredModel = available.find(
      (model) => model.provider === configuredProvider && model.id === configuredModelId,
    );
    const defaultModel = configuredModel ?? available[0];

    return {
      models: available.map((model) => ({
        provider: model.provider,
        providerName: services.modelRuntime.getProvider(model.provider)?.name ?? model.provider,
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        input: [...model.input],
      })),
      defaultModel: defaultModel
        ? { provider: defaultModel.provider, modelId: defaultModel.id }
        : null,
    };
  }

  function initializeInactiveSessionJournal(manager: SessionManager): SessionEvent[] {
    ensureSessionPersistence(manager);
    const initialized = initializeSessionEventJournal(
      manager,
      legacySessionEventsFromManager(manager),
    );
    if (initialized.error !== undefined) throw initialized.error;
    reconcileInterruptedSession(manager, initialized.events);
    resumeStateFromManager(manager, initialized.events);
    return initialized.events;
  }
  async function getSessionHistory(id: string): Promise<PiSessionHistory> {
    const live = state().live.sessions.get(id);
    if (live?.isAlive) return historyFromManager(live.session.sessionManager);
    if (live) await live.shutdown();
    const info = await persistedSession(id);
    if (!info) throw new PiServerError("pi_session_not_found", 404);
    const manager = SessionManager.open(info.path);
    initializeInactiveSessionJournal(manager);
    return historyFromManager(manager);
  }
  async function getSessionEvents(id: string): Promise<SessionEvent[]> {
    const live = state().live.sessions.get(id);
    if (live?.isAlive) return [...live.canonicalEvents];
    if (live) await live.shutdown();
    const info = await persistedSession(id);
    if (!info) throw new PiServerError("pi_session_not_found", 404);
    return coldSessionEventCache.load(info.path, (canonicalPath) => {
      const manager = SessionManager.open(canonicalPath);
      return initializeInactiveSessionJournal(manager);
    });
  }
  function entryCustomMessage(
    entry: SessionEntry,
  ): { customType: string; details: unknown } | undefined {
    if (entry.type === "custom_message") {
      return { customType: entry.customType, details: entry.details };
    }
    if (entry.type === "custom") {
      return { customType: entry.customType, details: entry.data };
    }
    return undefined;
  }
  function contextBranchEvents(entries: readonly SessionEntry[]): Array<{ event: SessionEvent }> {
    const projections = new Map<string, WorkbenchComposerUserProjection>();
    const projectionOrder: string[] = [];
    const readyProjections = new Set<string>();
    const removeProjection = (submissionId: string) => {
      projections.delete(submissionId);
      readyProjections.delete(submissionId);
      const index = projectionOrder.indexOf(submissionId);
      if (index >= 0) projectionOrder.splice(index, 1);
    };

    return entries.flatMap((entry) => {
      const custom = entryCustomMessage(entry);
      if (isWorkbenchComposerUserCustomType(custom?.customType)) {
        const details = parseWorkbenchComposerUserDetails(custom.details);
        if (details) {
          projections.set(details.submissionId, {
            version: 2,
            submissionId: details.submissionId,
            sourceText: details.sourceText,
            ...(details.document === undefined ? {} : { document: details.document }),
            hidden: true,
          });
          if (!projectionOrder.includes(details.submissionId)) {
            projectionOrder.push(details.submissionId);
          }
        }
      } else if (isWorkbenchComposerResolutionCustomType(custom?.customType)) {
        const resolution = parseWorkbenchComposerResolutionDetails(custom.details);
        if (resolution?.status === "resolved" && projections.has(resolution.submissionId)) {
          readyProjections.add(resolution.submissionId);
        } else if (resolution) {
          removeProjection(resolution.submissionId);
        }
      }

      const messages =
        entry.type === "custom" && isWorkbenchDisplayOnlyCustomType(entry.customType)
          ? [
              {
                role: "custom" as const,
                customType: entry.customType,
                content: "",
                display: true,
                details: entry.data,
                timestamp: Date.parse(entry.timestamp),
              },
            ]
          : (sessionEntryToContextMessages(entry) as PiAgentMessage[]);
      return messages.map((message) => {
        let projectedMessage:
          | PiAgentMessage
          | (PiAgentMessage & {
              workbenchComposer: WorkbenchComposerUserProjection;
            }) = message;
        if (message.role === "user") {
          const submissionId =
            projectionOrder.find((candidate) => readyProjections.has(candidate)) ??
            projectionOrder[0];
          const projection = submissionId ? projections.get(submissionId) : undefined;
          if (submissionId && projection) {
            projectedMessage = { ...message, workbenchComposer: projection };
            removeProjection(submissionId);
          }
        }
        return {
          event: {
            type: "message",
            seq: 0,
            time: historyEventTime(projectedMessage, Date.parse(entry.timestamp)),
            data: projectedMessage,
            entryId: entry.id,
          },
        };
      });
    });
  }
  function conversationRole(event: SessionEvent): string | undefined {
    if (event.type === "message") {
      return isRecord(event.data) && typeof event.data.role === "string"
        ? event.data.role
        : undefined;
    }
    if (event.type !== "message_end" || !isRecord(event.data)) return undefined;
    return isRecord(event.data.message) && typeof event.data.message.role === "string"
      ? event.data.message.role
      : undefined;
  }
  function sessionEventBranchesFromManager(manager: SessionManager): SessionHistoryBranches {
    const entries = manager.getEntries();
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const parentIds = new Set(entries.flatMap((entry) => (entry.parentId ? [entry.parentId] : [])));
    const currentLeafId = manager.getLeafId();
    const leaves = entries
      .filter((entry) => !parentIds.has(entry.id))
      .sort(
        (left, right) => Number(right.id === currentLeafId) - Number(left.id === currentLeafId),
      );
    const candidates = leaves.map((leaf) => {
      const canonicalEvents = canonicalJournalEntries(manager.getBranch(leaf.id)).map(
        ({ event }) => ({ event }),
      );
      const contextEvents = contextBranchEvents(buildContextEntries(entries, leaf.id, entriesById));
      contextEvents.forEach(({ event }, seq) => {
        event.seq = seq;
      });
      const conversationRoles = new Set(["user", "assistant", "toolResult"]);
      const canonicalMessageEvents = canonicalEvents.filter(({ event }) =>
        conversationRoles.has(conversationRole(event) ?? ""),
      );
      const contextMessageEvents = contextEvents.filter(({ event }) =>
        conversationRoles.has(conversationRole(event) ?? ""),
      );
      const requiresContextProjection =
        canonicalMessageEvents.length < contextMessageEvents.length ||
        canonicalMessageEvents.some(
          ({ event }, index) =>
            event.type === "message" &&
            event.entryId !== contextMessageEvents[index]?.event.entryId,
        );
      return { leafId: leaf.id, canonicalEvents, contextEvents, requiresContextProjection };
    });
    // A migrated legacy journal lives after its original context. Once a branch starts from an old
    // user entry, that journal is no longer an ancestor. Project every leaf from the Pi context in
    // this case so shared messages keep the same real SessionEntry ids across sibling answers.
    const useContextEvents = candidates.some((candidate) => candidate.requiresContextProjection);
    const seenPaths = new Set<string>();
    const items = candidates.flatMap((candidate) => {
      const events = useContextEvents ? candidate.contextEvents : candidate.canonicalEvents;
      const pathKey = events.map(({ event }) => event.entryId ?? `${event.seq}`).join("\u0000");
      if (seenPaths.has(pathKey)) return [];
      seenPaths.add(pathKey);
      return [{ leafId: candidate.leafId, events }];
    });
    return { headLeafId: manager.getLeafId(), items };
  }
  async function getSessionEventBranches(id: string): Promise<SessionHistoryBranches> {
    const live = state().live.sessions.get(id);
    if (live?.isAlive) return sessionEventBranchesFromManager(live.session.sessionManager);
    if (live) await live.shutdown();
    const info = await persistedSession(id);
    if (!info) throw new PiServerError("pi_session_not_found", 404);
    const manager = SessionManager.open(info.path);
    initializeInactiveSessionJournal(manager);
    return sessionEventBranchesFromManager(manager);
  }

  async function getSessionResumeState(id: string): Promise<SessionResumeState> {
    const live = state().live.sessions.get(id);
    if (live?.isAlive) {
      if (live.isBusy) return {};
      return resumeStateFromManager(live.session.sessionManager, live.canonicalEvents);
    }
    if (live) await live.shutdown();
    const info = await persistedSession(id);
    if (!info) throw new PiServerError("pi_session_not_found", 404);
    const manager = SessionManager.open(info.path);
    return resumeStateFromManager(manager, initializeInactiveSessionJournal(manager));
  }
  async function regenerateSession(
    id: string,
    messageId: string,
    requestId?: string,
  ): Promise<void> {
    const host = await getOrStartSession(id);
    await host.regenerate(messageId, requestId);
  }
  async function resumeSession(
    id: string,
    checkpointId: string,
    expectedLeafId: string,
  ): Promise<void> {
    const host = await getOrStartSession(id);
    await host.resume(checkpointId, expectedLeafId);
  }
  async function selectSessionBranch(id: string, leafId: string): Promise<void> {
    const host = await getOrStartSession(id);
    await host.selectBranch(leafId);
  }
  async function renameSession(id: string, name: string): Promise<number> {
    const normalized = name.trim();
    const live = state().live.sessions.get(id);
    if (live?.isAlive) {
      return live.rename(normalized);
    }
    const info = await persistedSession(id);
    if (!info) throw new PiServerError("pi_session_not_found", 404);
    const manager = SessionManager.open(info.path);
    const initialized = initializeSessionEventJournal(
      manager,
      legacySessionEventsFromManager(manager),
    );
    if (initialized.error !== undefined) throw initialized.error;
    manager.appendSessionInfo(normalized);
    const event = createCanonicalSessionEvent(
      { type: "session_info_changed", name: normalized || undefined },
      initialized.events.length,
      Date.now(),
    );
    appendSessionEventJournal(manager, event);
    coldSessionEventCache.invalidate(info.path);
    const summary = cachePersistedSessionManager(state(), manager);
    try {
      getStreamHub().publishMux(createSessionEventPayload(id, event));
    } catch {
      // Durable history remains the authoritative recovery path.
    }
    try {
      getStreamHub().publishHost({ type: "host/session-changed", sessionId: id, summary });
    } catch {
      // session.list remains the authoritative recovery path.
    }
    return event.seq;
  }
  async function deleteSession(id: string): Promise<void> {
    const live = state().live.sessions.get(id);
    const info = await persistedSession(id);
    if (!live && !info) throw new PiServerError("pi_session_not_found", 404);
    await live?.shutdown();
    // Remove durable workspace references first. If deleting the session log then
    // fails, the next authoritative session reconciliation can safely reattach it;
    // the inverse order can leave an unrecoverable ghost session in workspace state.
    await getWorkspaceStore().removeSession(id);
    if (info?.path) coldSessionEventCache.invalidate(info.path);
    if (info?.path && existsSync(info.path)) unlinkSync(info.path);
    persistedDirectory.remove(id);
    try {
      getStreamHub().publishHost({ type: "host/session-removed", sessionId: id });
    } catch {
      // session.list remains the authoritative recovery path.
    }
  }
  async function sendPrompt(
    id: string,
    message: string,
    images?: PiImageContent[],
    selection?: PiModelSelection,
  ): Promise<void> {
    if (!message.trim() && !images?.length) throw new PiServerError("pi_empty_prompt", 400);
    const host = await getOrStartSession(id);
    await host.prompt(message, images, selection);
  }
  async function cancelSession(id: string): Promise<void> {
    const host = state().live.sessions.get(id);
    if (!host?.isAlive) return;
    await host.cancel();
  }
  async function selectSessionModel(
    id: string,
    selection: { provider: string; model: string; reasoningEffort?: string },
  ): Promise<void> {
    const host = await getOrStartSession(id);
    await host.selectModel(selection);
  }
  async function getSessionContextPolicy(id: string): Promise<SessionContextPolicyValue> {
    const host = await getOrStartSession(id);
    return host.refreshContextPolicyValue();
  }
  async function updateSessionContextPolicy(
    id: string,
    policy: SessionContextPolicy,
  ): Promise<SessionContextPolicyValue> {
    const host = await getOrStartSession(id);
    return host.updateContextPolicy(policy);
  }
  async function compactSessionContext(id: string): Promise<SessionCompactValue> {
    const host = await getOrStartSession(id);
    return host.compactContextNow();
  }
  async function queuePrompt(id: string, mode: PiQueueMode, prompt: PiQueuedPrompt): Promise<void> {
    if (
      !prompt.message.trim() &&
      !prompt.images?.length &&
      !prompt.fileAttachmentIds?.length &&
      !prompt.textAttachmentIds?.length
    ) {
      throw new PiServerError("pi_empty_prompt", 400);
    }
    const host = await getOrStartSession(id);
    await host.submit(mode, prompt, undefined, { requireRunning: true });
  }
  async function submitPrompt(
    id: string,
    mode: PiQueueMode,
    prompt: PiQueuedPrompt,
    provenance?: PromptSubmissionProvenance,
  ): Promise<PromptSubmissionResult> {
    const composer = provenance?.composer;
    if (
      !prompt.message.trim() &&
      !prompt.images?.length &&
      !prompt.fileAttachmentIds?.length &&
      !prompt.textAttachmentIds?.length &&
      !(composer && hasWorkbenchComposerSemantics(composer))
    ) {
      throw new PiServerError("pi_empty_prompt", 400);
    }
    const host = await getOrStartSession(id);
    return host.submit(mode, prompt, provenance);
  }
  async function replacePromptQueue(
    id: string,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    const host = await getOrStartSession(id);
    await host.replaceQueue(steering, followUp);
  }
  async function setPromptQueuePaused(
    id: string,
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    const host = await getOrStartSession(id);
    await host.setQueuePaused(paused, steering, followUp);
  }
  async function steerQueuedPrompt(
    id: string,
    prompt: PiQueuedPrompt,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    if (
      !prompt.message.trim() &&
      !prompt.images?.length &&
      !prompt.fileAttachmentIds?.length &&
      !prompt.textAttachmentIds?.length
    ) {
      throw new PiServerError("pi_empty_prompt", 400);
    }
    const host = await getOrStartSession(id);
    await host.steerQueued(prompt, steering, followUp);
  }
  async function updatePromptQueueItem(
    id: string,
    itemId: string,
    mutation: PromptQueueMutation,
  ): Promise<void> {
    const host = await getOrStartSession(id);
    await host.updateQueueItem(itemId, mutation);
  }
  function getRunningSessionIds(): string[] {
    return runningSessionIds();
  }
  function getLoadedSessions(): readonly HostedPiSession[] {
    return state().live.loaded();
  }
  function getAttachedSessionCount(): number {
    return state().live.loaded().length;
  }
  function subscribeRunningSessions(listener: RunningListener): () => void {
    return state().live.subscribeRunning(listener);
  }
  registerWorkbenchShutdownHook("pi-sessions", async () => {
    const registry = state();
    await Promise.allSettled(registry.live.startLocks.values());
    const results = await Promise.allSettled(
      [...registry.live.sessions.values()].map((session) => session.shutdown()),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more Pi sessions failed to shut down.");
    }
    await scratchDirectory.shutdown();
  });
  async function resolvePiReviewSnapshots(cwd: string, id: string) {
    const live = state().live.sessions.get(id);
    const info = live?.isAlive ? undefined : await persistedSession(id);
    const manager = live?.isAlive
      ? live.session.sessionManager
      : info
        ? SessionManager.open(info.path)
        : undefined;
    if (!manager) throw new PiServerError("pi_session_not_found", 404);
    const reviewSnapshots = getReviewSnapshots();
    const directory = await reviewSnapshots.directory(cwd);
    if (directory !== (await reviewSnapshots.directory(manager.getCwd())))
      throw new PiServerError("pi_session_not_found", 404);
    const snapshots = manager.getBranch().flatMap((entry): GitReviewSnapshot[] => {
      if (entry.type !== "custom" || entry.customType !== REVIEW_ENTRY_TYPE) return [];
      const value = entry.data as GitReviewSnapshot | undefined;
      return value &&
        typeof value.id === "string" &&
        Number.isFinite(value.timestamp) &&
        (value.before === undefined || /^[a-f0-9]{40,64}$/.test(value.before)) &&
        (value.after === undefined || /^[a-f0-9]{40,64}$/.test(value.after))
        ? [value]
        : [];
    });
    return { gitDir: path.join(directory, "objects.git"), snapshots };
  }
  function createWorkbenchAgentSessionServices(options: Parameters<typeof createModelServices>[0]) {
    return createModelServices(options, { getRequestObserver: getSessionContextTrace });
  }

  return {
    notifyModelProviderConfigurationChanged,
    compactAssistantMessageUpdate,
    validateWorkbenchComposerCommands,
    resolveWorkbenchComposerCommands,
    sessionModifiedAt,
    messagesHaveImages,
    textOnlyModelContext,
    createDetachedSessionFork,
    getOrStartSession,
    getScratchSessionRecord,
    getScratchSessionSummary,
    createScratchSession,
    releaseScratchSession,
    promoteScratchSession,
    createSession,
    forkSession,
    registerImportedSessionManager,
    listSessions,
    listSessionSearchText,
    listSessionFiles,
    listModels,
    getSessionHistory,
    getSessionEvents,
    getSessionEventBranches,
    getSessionResumeState,
    regenerateSession,
    resumeSession,
    selectSessionBranch,
    renameSession,
    deleteSession,
    sendPrompt,
    cancelSession,
    selectSessionModel,
    getSessionContextPolicy,
    updateSessionContextPolicy,
    compactSessionContext,
    queuePrompt,
    submitPrompt,
    replacePromptQueue,
    setPromptQueuePaused,
    steerQueuedPrompt,
    updatePromptQueueItem,
    getRunningSessionIds,
    getLoadedSessions,
    getAttachedSessionCount,
    subscribeRunningSessions,
    resolvePiReviewSnapshots,
  };
}
