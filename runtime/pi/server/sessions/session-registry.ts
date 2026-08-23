import { existsSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  type AgentSession,
  type AgentSessionServices,
  buildContextEntries,
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  stripFrontmatter,
  sessionEntryToContextMessages,
  type SessionInfo,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import type {
  PiAssistantMessage,
  PiAgentMessage,
  PiEvent,
  PiImageContent,
  PiModelListResponse,
  PiModelSelection,
  PiQueuedPrompt,
  PiQueueMode,
  PiSessionHistory,
  PiSessionSummary,
  PiThinkingLevel,
  PiToolCallTiming,
} from "../../contracts";
import {
  compileWorkbenchComposerPrompt,
  hasWorkbenchComposerDocument,
  hasWorkbenchComposerSemantics,
  LEGACY_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
  parseWorkbenchComposerResolutionDetails,
  parseWorkbenchComposerUserDetails,
  type WorkbenchComposerCommandResponse,
  type WorkbenchComposerCommandResponseDetails,
  type WorkbenchComposerCommandTrace,
  type WorkbenchComposerCommandSubmission,
  type WorkbenchComposerResolutionDetails,
  type WorkbenchComposerSubmission,
  type WorkbenchComposerUserProjection,
  type WorkbenchResolvedAgentRequest,
} from "../../../composer-request";
import { PI_MODEL_CHANGED_EVENT, PI_SESSION_FORKED_EVENT } from "../../contracts";
import { PI_CANCEL_INTENT_CUSTOM_TYPE } from "../../message-termination";
import type { SessionEvent, SessionHistoryBranches } from "../../rpc-contracts";
import { applySessionMessageDelta, copyPiAssistantMessage } from "../../session-message-reducer";
import {
  createSessionEventPayload,
  createSessionMessageSnapshotPayload,
  createSessionMessageUpdatePayload,
  type SessionMessageDelta,
  type SessionMessageMetadata,
} from "../../stream-contracts";
import {
  preflightPlanWorkbenchComposerCommands,
  type PlannedWorkbenchComposerCommand,
} from "../commands/composer-command-planner";
import { expandPromptTemplateContent } from "../commands/prompt-template-expander";
import {
  piCompactUsesLegacyArguments,
  resolvePiCompactCustomInstructions,
} from "../commands/pi-composer-command-arguments";
import { PiServerError } from "../core/errors";
import { getInteractiveResponseRegistry } from "./interactive-response-registry";
import {
  appendSessionEventJournal,
  createCanonicalSessionEvent,
  initializeSessionEventJournal,
  readSessionEventJournal,
  SESSION_EVENT_CUSTOM_TYPE,
  SESSION_EVENT_JOURNAL_CUSTOM_TYPE,
} from "./session-event-journal";
import { SessionQueueProjection } from "./session-queue";
import { getStreamHub } from "../streams/stream-hub";
import { getWorkspaceStore } from "../workspaces/workspace-registry";
import { validateWorkspace, workspaceFromCwd } from "../workspaces/workspace-paths";
import { createInteractiveBashTool } from "../../../terminal/server/interactive-bash-tool";
import {
  isTerminalImageRecognitionSnapshot,
  parseImageRecognitionSnapshot,
  reduceImageRecognitionSnapshot,
  WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE,
  type ImageRecognitionSnapshot,
} from "../../../image-understanding/state-machine";
import {
  decideImageUnderstandingRoute,
  GlmOcrProvider,
  ImageUnderstandingProviderError,
  PaddleOcrProvider,
  type ImageUnderstandingObservation,
} from "../image-understanding/index";
import { ImageRecognitionLifecycle } from "../image-understanding/lifecycle";
import { recognizeWithMultimodalModel } from "../image-understanding/multimodal";
import { getImageUnderstandingSettingsStore } from "../image-understanding/registry";

export { PiServerError } from "../core/errors";

const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const TOOL_TIMING_CUSTOM_TYPE = "workbench.tool-timing.v1";
const BRANCH_SELECTION_CUSTOM_TYPE = "workbench.branch-selection.v1";
export const PROMPT_SOURCE_CUSTOM_TYPE = "workbench.prompt-source.v1";
const modelProviderRevisions = new Map<string, number>();

export function notifyModelProviderConfigurationChanged(provider: string): void {
  modelProviderRevisions.set(provider, (modelProviderRevisions.get(provider) ?? 0) + 1);
}

export interface PromptSubmissionProvenance {
  rpcId?: string;
  clientTimeZone?: string;
  composer?: WorkbenchComposerSubmission;
}

export interface PromptSubmissionResult {
  queued: boolean;
  queueItemId?: string;
}

type SessionEventListener = (event: PiEvent) => void;
type RunningListener = (sessionIds: string[]) => void;

interface PromptQueueSnapshot {
  steering: PiQueuedPrompt[];
  followUp: PiQueuedPrompt[];
}

interface ActiveAssistantStream {
  id: string;
  /** Durable coordinate of the matching assistant message_start; fixed for this stream. */
  startSeq: number;
  revision: number;
  message: PiAssistantMessage;
  toolCallJson: Map<number, string>;
}

interface ReadonlyPromptQueueSnapshot {
  readonly steering: readonly PiQueuedPrompt[];
  readonly followUp: readonly PiQueuedPrompt[];
}

interface SessionTimestampEntry {
  type?: string;
  timestamp: string;
  customType?: string;
  data?: unknown;
  message?: unknown;
}

interface SessionTimestampSource {
  getBranch(): readonly SessionTimestampEntry[];
  getHeader(): { timestamp: string } | null;
  getSessionFile(): string | null | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function agentMessageText(value: unknown): string {
  if (!isRecord(value)) return "";
  const content = value.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n");
}

function assistantMessageHasOutput(value: unknown): boolean {
  if (!isRecord(value) || value.role !== "assistant" || !Array.isArray(value.content)) {
    return false;
  }
  return value.content.some(
    (part) =>
      isRecord(part) &&
      ((part.type === "text" && typeof part.text === "string" && part.text.length > 0) ||
        (part.type === "thinking" &&
          part.redacted !== true &&
          typeof part.thinking === "string" &&
          part.thinking.length > 0)),
  );
}

function assistantUpdateHasOutput(event: PiEvent): boolean {
  const update = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : undefined;
  const hasDelta =
    (update?.type === "text_delta" || update?.type === "thinking_delta") &&
    typeof update.delta === "string" &&
    update.delta.length > 0;
  return hasDelta || assistantMessageHasOutput(event.message);
}

function assistantMessageMetadata(value: unknown): SessionMessageMetadata | undefined {
  if (!isRecord(value) || value.role !== "assistant" || !Array.isArray(value.content)) {
    return undefined;
  }
  const { content: _content, ...metadata } = value;
  return {
    ...metadata,
    ...(isRecord(metadata.usage) ? { usage: { ...metadata.usage } } : {}),
    ...(Array.isArray(metadata.diagnostics)
      ? {
          diagnostics: metadata.diagnostics.map((diagnostic) =>
            isRecord(diagnostic) ? { ...diagnostic } : diagnostic,
          ),
        }
      : {}),
  } as SessionMessageMetadata;
}

function assistantMessagePart(
  message: unknown,
  contentIndex: number,
): Record<string, unknown> | undefined {
  if (!isRecord(message) || !Array.isArray(message.content)) return undefined;
  const part = message.content[contentIndex];
  return isRecord(part) ? part : undefined;
}

function compactToolCall(
  value: unknown,
): Extract<SessionMessageDelta, { type: "toolcall_end" }>["toolCall"] | undefined {
  if (
    !isRecord(value) ||
    value.type !== "toolCall" ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isRecord(value.arguments)
  ) {
    return undefined;
  }
  return {
    type: "toolCall",
    id: value.id,
    name: value.name,
    arguments: value.arguments,
    ...(typeof value.thoughtSignature === "string"
      ? { thoughtSignature: value.thoughtSignature }
      : {}),
    ...(typeof value.namespace === "string" ? { namespace: value.namespace } : {}),
  };
}

/** Convert Pi's cumulative AgentSession event into the compact pi-messages wire vocabulary. */
export function compactAssistantMessageUpdate(event: PiEvent): SessionMessageDelta | undefined {
  const source = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : undefined;
  if (!source || !Number.isInteger(source.contentIndex) || (source.contentIndex as number) < 0) {
    return undefined;
  }
  const contentIndex = source.contentIndex as number;
  const part = assistantMessagePart(event.message, contentIndex);
  switch (source.type) {
    case "text_start":
      return { type: "text_start", contentIndex };
    case "text_delta":
      return typeof source.delta === "string"
        ? { type: "text_delta", contentIndex, delta: source.delta }
        : undefined;
    case "text_end":
      return typeof source.content === "string"
        ? {
            type: "text_end",
            contentIndex,
            content: source.content,
            ...(typeof part?.textSignature === "string"
              ? { contentSignature: part.textSignature }
              : {}),
          }
        : undefined;
    case "thinking_start":
      return { type: "thinking_start", contentIndex };
    case "thinking_delta":
      return typeof source.delta === "string"
        ? { type: "thinking_delta", contentIndex, delta: source.delta }
        : undefined;
    case "thinking_end":
      return typeof source.content === "string"
        ? {
            type: "thinking_end",
            contentIndex,
            content: source.content,
            ...(typeof part?.thinkingSignature === "string"
              ? { contentSignature: part.thinkingSignature }
              : {}),
            ...(typeof part?.redacted === "boolean" ? { redacted: part.redacted } : {}),
          }
        : undefined;
    case "toolcall_start":
      return part?.type === "toolCall" &&
        typeof part.id === "string" &&
        typeof part.name === "string"
        ? { type: "toolcall_start", contentIndex, id: part.id, toolName: part.name }
        : undefined;
    case "toolcall_delta":
      return typeof source.delta === "string"
        ? { type: "toolcall_delta", contentIndex, delta: source.delta }
        : undefined;
    case "toolcall_end": {
      const toolCall = compactToolCall(source.toolCall ?? part);
      return toolCall ? { type: "toolcall_end", contentIndex, toolCall } : undefined;
    }
    default:
      return undefined;
  }
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

/** Resolve the whole catalog before any command with side effects is allowed to execute. */
export function validateWorkbenchComposerCommands(
  session: Pick<AgentSession, "extensionRunner" | "promptTemplates" | "resourceLoader">,
  submission: WorkbenchComposerSubmission,
): void {
  preflightPlanWorkbenchComposerCommands(session, submission);
}

export interface ResolveWorkbenchComposerCommandsOptions {
  /** Plans captured by the preflight phase before the durable user marker is recorded. */
  plannedCommands?: readonly PlannedWorkbenchComposerCommand[];
  /**
   * Marks the next Pi user message as internal command expansion. The returned disposer removes an
   * unconsumed marker when Pi handles the command without creating a user message.
   */
  projectInternalUserPrompt?(): () => void;
  /** Reports execution failures after the complete command document has passed validation. */
  onCommandError?(command: WorkbenchComposerCommandSubmission, error: unknown): void;
  /** Publishes the running and terminal states of Pi built-in session actions. */
  onCommandResponse?(response: WorkbenchComposerCommandResponse): void;
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
  };
}

export interface ResolvedWorkbenchComposerRequest {
  request: WorkbenchResolvedAgentRequest;
  /** Durable, user-visible outcomes produced only by Pi built-in session actions. */
  commandResponses: WorkbenchComposerCommandResponse[];
  /** A Pi extension command owns this turn, so no second main turn may be started. */
  agentTurn: boolean;
}

export async function resolveWorkbenchComposerCommands(
  session: Pick<
    AgentSession,
    | "compact"
    | "extensionRunner"
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
    if (plan.kind === "builtin") {
      notifyCommandResponse(options, {
        source: "pi",
        commandId: command.commandId,
        label: command.label,
        status: "running",
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
          } else await session.reload();
          break;
        case "skill": {
          const content = await readFile(plan.skill.filePath, "utf8");
          const body = stripFrontmatter(content).trim();
          request.instructions.push({
            source: command.commandId,
            trust: "trusted-instruction",
            content: [
              `Skill: ${plan.skill.name}`,
              `References are relative to ${plan.skill.baseDir}.`,
              "",
              body,
            ].join("\n"),
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
          source: "pi",
          commandId: command.commandId,
          label: command.label,
          status: "success",
        };
        commandResponses.push(response);
        notifyCommandResponse(options, response);
      }
    } catch (error) {
      try {
        options.onCommandError?.(command, error);
      } catch {
        // Error reporting is observational and must not reject an admitted Composer transaction.
      }
      request.commandTrace.push(commandTrace(plan, "execution-failed"));
      if (plan.kind === "builtin") {
        const response: WorkbenchComposerCommandResponse = {
          source: "pi",
          commandId: command.commandId,
          label: command.label,
          status: "execution-failed",
        };
        commandResponses.push(response);
        notifyCommandResponse(options, response);
      }
    }
  }
  return { request, commandResponses, agentTurn };
}

function parsedDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

function meaningfulEntryTime(entry: SessionTimestampEntry): Date | undefined {
  if (
    entry.type === "custom" &&
    (entry.customType === SESSION_EVENT_CUSTOM_TYPE ||
      entry.customType === SESSION_EVENT_JOURNAL_CUSTOM_TYPE)
  ) {
    return undefined;
  }
  if (entry.type === "message" && isRecord(entry.message)) {
    const messageTimestamp = entry.message.timestamp;
    if (typeof messageTimestamp === "number" && Number.isFinite(messageTimestamp)) {
      return new Date(messageTimestamp);
    }
  }
  return parsedDate(entry.timestamp);
}

/** Derive ordering from durable activity without counting journal storage writes as activity. */
export function sessionModifiedAt(source: SessionTimestampSource): Date {
  const branch = source.getBranch();
  let expectedSequence = 0;
  let modifiedTime: number | undefined;
  for (const entry of branch) {
    const canonical = storedCanonicalEvent(entry);
    if (canonical?.seq === expectedSequence) {
      expectedSequence += 1;
      modifiedTime = Math.max(modifiedTime ?? Number.NEGATIVE_INFINITY, canonical.time);
    }
    const meaningful = meaningfulEntryTime(entry);
    if (meaningful) {
      modifiedTime = Math.max(modifiedTime ?? Number.NEGATIVE_INFINITY, meaningful.getTime());
    }
  }
  if (modifiedTime !== undefined) return new Date(modifiedTime);

  const headerTimestamp = parsedDate(source.getHeader()?.timestamp);
  if (headerTimestamp) return headerTimestamp;

  const file = source.getSessionFile();
  if (file) {
    try {
      return statSync(file).mtime;
    } catch {
      // A transient or newly-created session can disappear before the stat call.
    }
  }
  return new Date();
}

export type PromptQueueMutation =
  | { kind: "edit"; prompt: PiQueuedPrompt }
  | { kind: "remove" }
  | { kind: "steer" };

function copyQueuedPrompts(prompts: readonly PiQueuedPrompt[]): PiQueuedPrompt[] {
  return prompts.map((prompt) => ({
    message: prompt.message,
    ...(prompt.images?.length ? { images: prompt.images.map((image) => ({ ...image })) } : {}),
  }));
}

function copyQueueSnapshot(queue: ReadonlyPromptQueueSnapshot): PromptQueueSnapshot {
  return {
    steering: copyQueuedPrompts(queue.steering),
    followUp: copyQueuedPrompts(queue.followUp),
  };
}

function contentHasImage(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((part) => isRecord(part) && part.type === "image" && typeof part.data === "string")
  );
}

/** Durable context image detection shared by model-switch admission and its regression tests. */
export function messagesHaveImages(messages: readonly unknown[]): boolean {
  return messages.some((candidate) => isRecord(candidate) && contentHasImage(candidate.content));
}

function promptsHaveImages(prompts: ReadonlyPromptQueueSnapshot): boolean {
  return [...prompts.steering, ...prompts.followUp].some((prompt) =>
    prompt.images?.some((image) => image.type === "image" && Boolean(image.data)),
  );
}

function imageUnsupported(): PiServerError {
  return new PiServerError("pi_model_image_unsupported", 400);
}

function firstUserText(messages: readonly unknown[]): string {
  for (const candidate of messages) {
    if (!candidate || typeof candidate !== "object") continue;
    const message = candidate as { role?: unknown; content?: unknown };
    if (message.role !== "user") continue;
    if (typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
    if (!Array.isArray(message.content)) continue;
    const text = message.content.find((part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
      ),
    )?.text;
    if (text?.trim()) return text.trim();
  }
  return "";
}

export class SerializedSessionMutations {
  private tail: Promise<void> = Promise.resolve();

  run<Value>(mutation: () => Promise<Value>): Promise<Value> {
    const run = this.tail.catch(() => undefined).then(mutation);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

type ImageUnderstandingRunResult =
  | { kind: "native"; images: PiImageContent[] }
  | { kind: "preprocessed"; observations: ImageUnderstandingObservation[] }
  | { kind: "failed"; errorCode: string }
  | { kind: "cancelled" };

const MAX_IMAGE_UNDERSTANDING_CONTEXT_CHARACTERS = 250_000;

function validateImageUnderstandingObservations(
  observations: readonly ImageUnderstandingObservation[],
  expectedImageIds: readonly string[],
): void {
  const imageCount = expectedImageIds.length;
  if (observations.length !== imageCount) {
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }
  const imageIds = new Set(observations.map(({ imageId }) => imageId));
  if (imageIds.size !== imageCount || expectedImageIds.some((imageId) => !imageIds.has(imageId))) {
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }
  const totalCharacters = observations.reduce((total, observation) => {
    return total + observation.text.length;
  }, 0);
  if (totalCharacters > MAX_IMAGE_UNDERSTANDING_CONTEXT_CHARACTERS) {
    throw new ImageUnderstandingProviderError("provider-response-too-large");
  }
}

function stableImageUnderstandingErrorCode(error: unknown): string {
  if (error instanceof ImageUnderstandingProviderError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "provider-aborted";
  if (isRecord(error) && typeof error.code === "string" && /^[a-z0-9._-]+$/u.test(error.code)) {
    return error.code;
  }
  return "provider-unavailable";
}

function interruptedImageRecognitionTransitions(
  events: readonly SessionEvent[],
  now = Date.now(),
): ImageRecognitionSnapshot[][] {
  const latest = new Map<string, ImageRecognitionSnapshot>();
  for (const event of events) {
    if (event.type !== "message" || !isRecord(event.data)) continue;
    if (event.data.customType !== WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE) continue;
    const incoming = parseImageRecognitionSnapshot(event.data.details);
    if (!incoming) continue;
    const current = latest.get(incoming.operationId);
    if (!current) {
      latest.set(incoming.operationId, incoming);
      continue;
    }
    try {
      latest.set(incoming.operationId, reduceImageRecognitionSnapshot(current, incoming));
    } catch {
      // A corrupt operation does not prevent independent operations from being reconciled.
    }
  }

  const transition = (
    current: ImageRecognitionSnapshot,
    state:
      | { status: "running"; stage: "fallback" }
      | { status: "failed"; errorCode: "recognition-interrupted" },
  ): ImageRecognitionSnapshot => {
    const updatedAt = Math.max(current.timestamps?.updatedAt ?? 0, now);
    const incoming = parseImageRecognitionSnapshot({
      version: 1,
      operationId: current.operationId,
      submissionId: current.submissionId,
      ...(current.rpcId === undefined ? {} : { rpcId: current.rpcId }),
      revision: current.revision + 1,
      ...state,
      method: current.method,
      ...(current.providerId === undefined ? {} : { providerId: current.providerId }),
      imageCount: current.imageCount,
      completedCount: current.completedCount,
      ...(current.progress === undefined ? {} : { progress: current.progress }),
      timestamps: {
        createdAt: current.timestamps?.createdAt ?? updatedAt,
        updatedAt,
        ...(state.status === "failed" ? { completedAt: updatedAt } : {}),
      },
    });
    if (!incoming) throw new TypeError("Could not reconcile an interrupted image operation.");
    return reduceImageRecognitionSnapshot(current, incoming);
  };

  return [...latest.values()].flatMap((snapshot) => {
    if (isTerminalImageRecognitionSnapshot(snapshot)) return [];
    const running =
      snapshot.status === "pending"
        ? transition(snapshot, { status: "running", stage: "fallback" })
        : snapshot;
    const failed = transition(running, {
      status: "failed",
      errorCode: "recognition-interrupted",
    });
    return [snapshot.status === "pending" ? [running, failed] : [failed]];
  });
}

function persistedComposerResolutionSubmissionIds(entries: readonly SessionEntry[]): Set<string> {
  const submissionIds = new Set<string>();
  for (const entry of entries) {
    const details =
      entry.type === "custom_message" &&
      entry.customType === WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE
        ? entry.details
        : entry.type === "custom" && entry.customType === WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE
          ? entry.data
          : undefined;
    const resolution = parseWorkbenchComposerResolutionDetails(details);
    if (resolution) submissionIds.add(resolution.submissionId);
  }
  return submissionIds;
}

class HostedPiSession {
  readonly session: AgentSession;
  private readonly listeners = new Set<SessionEventListener>();
  private readonly onRunningChanged: () => void;
  private readonly onDestroyed: () => void;
  private readonly unsubscribeAgent: () => void;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private promptTask: Promise<void> | undefined;
  private imageRecognitionTask: Promise<ImageUnderstandingRunResult> | undefined;
  private imageRecognitionAbort: AbortController | undefined;
  private imageRecognitionCompletion: Promise<void> | undefined;
  private completeImageRecognition: (() => void) | undefined;
  private activePromptHasImages = false;
  private sequence = -1;
  private activeAssistantStream: ActiveAssistantStream | undefined;
  private assistantMessageActive = false;
  private assistantFirstTokenAt: number | undefined;
  private readonly canonicalEventsValue: SessionEvent[];
  private journalWritable = true;
  private journalFailureReported = false;
  private alive = true;
  private suppressQueueUpdates = 0;
  private pausedQueue?: PromptQueueSnapshot;
  private readonly toolStartedAtById = new Map<string, number>();
  private readonly queueProjection = new SessionQueueProjection();
  private readonly mutations = new SerializedSessionMutations();
  private readonly modelProviderRevisions = new Map<string, number>();
  private readonly pendingComposerUserProjections: Array<{
    promptText?: string;
    projection: WorkbenchComposerUserProjection;
  }> = [];
  private readonly cancelledQueueItemIds = new Set<string>();

  constructor(session: AgentSession, onRunningChanged: () => void, onDestroyed: () => void) {
    this.session = session;
    this.onRunningChanged = onRunningChanged;
    this.onDestroyed = onDestroyed;
    const initializedJournal = initializeSessionEventJournal(
      session.sessionManager,
      legacySessionEventsFromManager(session.sessionManager),
    );
    this.canonicalEventsValue = initializedJournal.events;
    this.sequence = initializedJournal.events.at(-1)?.seq ?? -1;
    if (initializedJournal.error !== undefined) this.journalWritable = false;
    this.reconcileQueueProjection();
    this.unsubscribeAgent = session.subscribe((event) => {
      const eventTime = Date.now();
      const transientMessageUpdate = event.type === "message_update";
      if (!transientMessageUpdate) this.touch();
      if (event.type === "tool_execution_start") {
        this.toolStartedAtById.set(event.toolCallId, eventTime);
      } else if (event.type === "tool_execution_update") {
        if (!this.toolStartedAtById.has(event.toolCallId)) {
          this.toolStartedAtById.set(event.toolCallId, eventTime);
        }
      } else if (event.type === "tool_execution_end") {
        const startedAt = this.toolStartedAtById.get(event.toolCallId) ?? eventTime;
        this.toolStartedAtById.delete(event.toolCallId);
        try {
          this.session.sessionManager.appendCustomEntry(TOOL_TIMING_CUSTOM_TYPE, {
            toolCallId: event.toolCallId,
            startedAt,
            completedAt: eventTime,
          } satisfies PiToolCallTiming);
        } catch {
          // Timing persistence must not interrupt the active agent session.
        }
      }
      if (event.type === "queue_update" && this.suppressQueueUpdates === 0) {
        this.reconcileQueueProjection(event.steering, event.followUp);
        this.publish(
          this.pausedQueue
            ? {
                ...(event as PiEvent),
                followUp: this.pausedQueue.followUp.map((prompt) => prompt.message),
                queuePaused: true,
              }
            : (event as PiEvent),
          eventTime,
        );
        this.publishQueueSnapshot();
      } else if (event.type !== "queue_update") {
        this.publish(event as PiEvent, eventTime);
      }
      if (!transientMessageUpdate) this.onRunningChanged();
    });
    if (initializedJournal.error !== undefined) {
      this.reportJournalFailure(initializedJournal.error);
    } else {
      this.reconcileInterruptedImageRecognition();
    }
    this.touch();
  }

  private reconcileInterruptedImageRecognition(): void {
    const resolvedComposerSubmissions = persistedComposerResolutionSubmissionIds(
      this.session.sessionManager.getBranch(),
    );
    for (const transitions of interruptedImageRecognitionTransitions(this.canonicalEventsValue)) {
      for (const snapshot of transitions) {
        const timestamp = snapshot.timestamps?.updatedAt ?? Date.now();
        this.publish(
          {
            type: "message",
            role: "custom",
            customType: WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE,
            content: "",
            display: true,
            details: snapshot,
            timestamp,
          },
          timestamp,
        );
      }
      const terminal = transitions.at(-1);
      if (terminal && isTerminalImageRecognitionSnapshot(terminal)) {
        this.session.sessionManager.appendCustomEntry(
          WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE,
          terminal,
        );
        if (!resolvedComposerSubmissions.has(terminal.submissionId)) {
          const resolution: WorkbenchComposerResolutionDetails = {
            version: 1,
            submissionId: terminal.submissionId,
            status: "command_error",
            commandTrace: [],
          };
          this.session.sessionManager.appendCustomMessageEntry(
            WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE,
            "",
            false,
            resolution,
          );
          const timestamp = terminal.timestamps?.updatedAt ?? Date.now();
          this.publish(
            {
              type: "message",
              role: "custom",
              customType: WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE,
              content: "",
              display: false,
              details: resolution,
              timestamp,
            },
            timestamp,
          );
          resolvedComposerSubmissions.add(terminal.submissionId);
        }
      }
    }
  }

  get id(): string {
    return this.session.sessionId;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  get isRunning(): boolean {
    return this.imageRecognitionAbort !== undefined || this.hasActiveAgentRun;
  }

  private get hasActiveAgentRun(): boolean {
    return this.promptTask !== undefined || this.session.isStreaming;
  }

  get streamingMessage(): unknown {
    return this.session.state.streamingMessage;
  }

  get currentSequence(): number {
    return this.sequence;
  }

  get canonicalEvents(): readonly SessionEvent[] {
    return this.canonicalEventsValue;
  }

  get steeringMessages(): readonly string[] {
    return this.session.getSteeringMessages();
  }

  get followUpMessages(): readonly string[] {
    return this.pausedQueue
      ? this.pausedQueue.followUp.map((prompt) => prompt.message)
      : this.session.getFollowUpMessages();
  }

  get queuePaused(): boolean {
    return this.pausedQueue !== undefined;
  }

  subscribe(listener: SessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyLegacyListeners(event: PiEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A disconnected or faulty legacy SSE listener must not interrupt the agent event loop.
      }
    }
  }

  private legacyEvent(canonical: SessionEvent, includeSequence: boolean): PiEvent {
    const data =
      typeof canonical.data === "object" &&
      canonical.data !== null &&
      !Array.isArray(canonical.data)
        ? (canonical.data as Record<string, unknown>)
        : { data: canonical.data };
    return {
      type: canonical.type,
      ...data,
      ...(includeSequence ? { sequence: canonical.seq } : {}),
    };
  }

  private reportJournalFailure(error: unknown): void {
    if (this.journalFailureReported) return;
    this.journalFailureReported = true;
    try {
      getStreamHub().publishHost({
        type: "host/agent-error",
        sessionId: this.id,
        message:
          error instanceof Error
            ? `Session event journal is unavailable: ${error.message}`
            : "Session event journal is unavailable.",
      });
    } catch {
      // Unary history will surface the missing canonical journal after reconnect.
    }
  }

  private projectComposerUserEvent(event: PiEvent): PiEvent {
    if (event.type !== "message_end") return event;
    const message = isRecord(event.message) ? event.message : undefined;
    if (message?.role !== "user") return event;
    const promptText = agentMessageText(message);
    let index = this.pendingComposerUserProjections.findIndex(
      (candidate) => candidate.promptText === promptText,
    );
    if (index < 0) {
      index = this.pendingComposerUserProjections.findIndex(
        (candidate) => candidate.promptText === undefined,
      );
    }
    if (index < 0) return event;
    const [candidate] = this.pendingComposerUserProjections.splice(index, 1);
    return candidate ? { ...event, workbenchComposer: candidate.projection } : event;
  }

  private queueComposerUserProjection(
    projection: WorkbenchComposerUserProjection,
    promptText?: string,
  ): () => void {
    const candidate = {
      ...(promptText === undefined ? {} : { promptText }),
      projection,
    };
    this.pendingComposerUserProjections.push(candidate);
    return () => {
      const index = this.pendingComposerUserProjections.indexOf(candidate);
      if (index >= 0) this.pendingComposerUserProjections.splice(index, 1);
    };
  }

  private projectAssistantMessageTiming(event: PiEvent, time: number): PiEvent {
    const message = isRecord(event.message) ? event.message : undefined;
    if (event.type === "message_start") {
      this.assistantMessageActive = message?.role === "assistant";
      this.assistantFirstTokenAt = undefined;
      return event;
    }
    if (event.type === "message_update") {
      if (
        this.assistantMessageActive &&
        this.assistantFirstTokenAt === undefined &&
        assistantUpdateHasOutput(event)
      ) {
        this.assistantFirstTokenAt = time;
      }
      return event;
    }
    if (event.type !== "message_end" || message?.role !== "assistant") return event;

    const firstTokenAt =
      this.assistantFirstTokenAt ?? (assistantMessageHasOutput(message) ? time : undefined);
    this.assistantMessageActive = false;
    this.assistantFirstTokenAt = undefined;
    return firstTokenAt === undefined ? event : { ...event, workbenchTiming: { firstTokenAt } };
  }

  private beginAssistantMessageStream(
    message: unknown,
    startSeq: number,
    time: number,
  ): ActiveAssistantStream | undefined {
    if (!assistantMessageMetadata(message)) return undefined;
    const assistantMessage = message as PiAssistantMessage;
    this.clearAssistantMessageStream();
    const stream = {
      id: randomUUID(),
      startSeq,
      revision: 0,
      message: copyPiAssistantMessage(assistantMessage),
      toolCallJson: new Map<number, string>(),
    } satisfies ActiveAssistantStream;
    this.activeAssistantStream = stream;
    try {
      getStreamHub().setSessionMessageSnapshot(
        createSessionMessageSnapshotPayload(
          this.id,
          stream.id,
          0,
          stream.startSeq,
          time,
          stream.message,
        ),
      );
    } catch {
      // The first compact delta will replace this optional pre-token bootstrap state.
    }
    return stream;
  }

  private clearAssistantMessageStream(): void {
    const stream = this.activeAssistantStream;
    this.activeAssistantStream = undefined;
    if (!stream) return;
    try {
      getStreamHub().clearSessionMessageSnapshot(this.id, stream.id);
    } catch {
      // A reconnect without the stale snapshot still converges through durable history.
    }
  }

  private publishMessageUpdate(event: PiEvent, time: number): void {
    const { sequence: _sequence, ...legacyEvent } = event;
    this.notifyLegacyListeners(legacyEvent);
    if (!this.journalWritable) return;
    const metadata = assistantMessageMetadata(event.message);
    if (!metadata) return;
    const stream =
      this.activeAssistantStream ??
      this.beginAssistantMessageStream(event.message, this.sequence, time);
    if (!stream) return;
    const update = compactAssistantMessageUpdate(event);
    const revision = ++stream.revision;
    stream.message = {
      ...stream.message,
      ...metadata,
      role: "assistant",
      content: stream.message.content,
    };
    const nextMessage = update
      ? applySessionMessageDelta(stream.message, stream.toolCallJson, update)
      : undefined;
    stream.message = nextMessage ?? copyPiAssistantMessage(event.message as PiAssistantMessage);
    const toolCallJson =
      stream.toolCallJson.size === 0
        ? undefined
        : Object.fromEntries(
            [...stream.toolCallJson].map(([contentIndex, json]) => [String(contentIndex), json]),
          );
    const snapshot = createSessionMessageSnapshotPayload(
      this.id,
      stream.id,
      revision,
      stream.startSeq,
      time,
      stream.message,
      toolCallJson,
    );
    try {
      const hub = getStreamHub();
      hub.setSessionMessageSnapshot(snapshot);
      hub.publishMux(
        update !== undefined && nextMessage !== undefined
          ? createSessionMessageUpdatePayload(
              this.id,
              stream.id,
              revision,
              stream.startSeq,
              time,
              metadata,
              update,
            )
          : snapshot,
      );
    } catch {
      // A malformed/failed transient frame is repaired by the retained snapshot or message_end.
    }
  }

  private publish(sourceEvent: PiEvent, time = Date.now()): void {
    const event = this.projectAssistantMessageTiming(
      this.projectComposerUserEvent(sourceEvent),
      time,
    );
    if (event.type === "message_update") {
      this.publishMessageUpdate(event, time);
      return;
    }
    const endsAssistantStream =
      event.type === "agent_settled" ||
      (event.type === "message_end" && assistantMessageMetadata(event.message) !== undefined);
    let canonical: SessionEvent;
    try {
      canonical = createCanonicalSessionEvent(event, this.sequence + 1, time);
    } catch (error) {
      if (endsAssistantStream) this.clearAssistantMessageStream();
      this.reportJournalFailure(error);
      return;
    }

    if (!this.journalWritable) {
      if (endsAssistantStream) this.clearAssistantMessageStream();
      this.notifyLegacyListeners(this.legacyEvent(canonical, false));
      return;
    }

    try {
      canonical = appendSessionEventJournal(this.session.sessionManager, canonical);
    } catch (error) {
      // SessionManager mutates its in-memory branch before attempting the filesystem append.
      // Freeze the canonical prefix after a failed append so history and mux cannot allocate a
      // duplicate sequence in this process. Legacy listeners remain usable without a sequence.
      this.journalWritable = false;
      if (endsAssistantStream) this.clearAssistantMessageStream();
      this.reportJournalFailure(error);
      this.notifyLegacyListeners(this.legacyEvent(canonical, false));
      return;
    }

    this.sequence = canonical.seq;
    this.canonicalEventsValue.push(canonical);
    const canonicalData = isRecord(canonical.data) ? canonical.data : undefined;
    const canonicalMessage = canonicalData?.message;
    if (canonical.type === "message_start" && assistantMessageMetadata(canonicalMessage)) {
      this.beginAssistantMessageStream(canonicalMessage, canonical.seq, canonical.time);
    } else if (endsAssistantStream) {
      this.clearAssistantMessageStream();
    }
    this.notifyLegacyListeners(this.legacyEvent(canonical, true));
    try {
      getStreamHub().publishMux(createSessionEventPayload(this.id, canonical));
    } catch {
      // The persisted event remains recoverable through unary history after reconnect.
    }
    if (canonical.type === "message_end" || canonical.type === "session_info_changed") {
      announceSessionChanged(this);
    }
  }

  private publishQueueUpdate(): void {
    this.reconcileQueueProjection();
    this.publish({
      type: "queue_update",
      steering: this.steeringMessages,
      followUp: this.followUpMessages,
      queuePaused: this.queuePaused,
    });
    this.publishQueueSnapshot();
  }

  private reconcileQueueProjection(
    steering: readonly string[] = this.session.getSteeringMessages(),
    followUp: readonly string[] = this.session.getFollowUpMessages(),
  ): void {
    this.queueProjection.reconcile(
      steering.map((message) => ({ message })),
      this.pausedQueue ? this.pausedQueue.followUp : followUp.map((message) => ({ message })),
    );
  }

  publishQueueSnapshot(): void {
    getStreamHub().publishMux({
      type: "session/queue",
      sessionId: this.id,
      items: this.queueProjection.items(),
    });
  }

  private runQueueMutation<Value>(mutation: () => Promise<Value>): Promise<Value> {
    return this.mutations.run(mutation);
  }

  private async refreshChangedModelProvider(provider: string): Promise<void> {
    const revision = modelProviderRevisions.get(provider) ?? 0;
    if ((this.modelProviderRevisions.get(provider) ?? 0) >= revision) return;
    await this.session.modelRuntime.refresh({ allowNetwork: false, providers: [provider] });
    this.modelProviderRevisions.set(provider, revision);
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      const hasPausedPrompts = Boolean(
        this.pausedQueue &&
        (this.pausedQueue.steering.length > 0 || this.pausedQueue.followUp.length > 0),
      );
      if (this.isRunning || hasPausedPrompts) {
        this.touch();
        return;
      }
      void this.shutdown();
    }, SESSION_IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  private requireModelImageCompatibility(
    model: { input: readonly string[] } | undefined,
    incomingImages = false,
  ): void {
    if (model?.input.includes("image")) return;
    if (
      incomingImages ||
      this.activePromptHasImages ||
      messagesHaveImages(this.session.sessionManager.buildSessionContext().messages) ||
      promptsHaveImages(this.queueProjection.prompts())
    ) {
      throw imageUnsupported();
    }
  }

  private async promptNow(
    message: string,
    images?: PiImageContent[],
    selection?: PiModelSelection,
    cancellationSignal?: AbortSignal,
  ): Promise<boolean> {
    if (cancellationSignal?.aborted) return false;
    if (this.hasActiveAgentRun) throw new PiServerError("pi_session_busy", 409);

    if (selection) {
      await this.applyPromptSelection(selection);
    } else if (this.session.model) {
      await this.refreshChangedModelProvider(this.session.model.provider);
      const refreshedModel = this.session.modelRuntime
        .getAvailableSnapshot()
        .find(
          (candidate) =>
            candidate.provider === this.session.model?.provider &&
            candidate.id === this.session.model.id,
        );
      if (!refreshedModel) throw new PiServerError("pi_model_not_available", 400);
      this.requireModelImageCompatibility(refreshedModel, Boolean(images?.length));
      if (refreshedModel !== this.session.model) await this.session.setModel(refreshedModel);
    }

    this.requireModelImageCompatibility(this.session.model, Boolean(images?.length));
    if (cancellationSignal?.aborted) return false;

    let reportPreflight: ((accepted: boolean) => void) | undefined;
    const preflight = new Promise<boolean>((resolvePreflight) => {
      reportPreflight = resolvePreflight;
    });

    const run = this.session.prompt(message, {
      ...(images?.length ? { images } : {}),
      source: "rpc",
      preflightResult: (accepted) => reportPreflight?.(accepted),
    });
    this.promptTask = run;
    this.activePromptHasImages = Boolean(images?.length);
    this.touch();
    this.onRunningChanged();

    void run
      .then(() => this.publish({ type: "command_done" }))
      .catch((error: unknown) => {
        this.publish({ type: "command_error", code: "pi_prompt_failed" });
        try {
          getStreamHub().publishHost({
            type: "host/agent-error",
            sessionId: this.id,
            message: error instanceof Error ? error.message : "The agent command failed.",
          });
        } catch {
          // The session event above remains available to connected session listeners.
        }
      })
      .finally(() => {
        if (this.promptTask === run) {
          this.promptTask = undefined;
          this.activePromptHasImages = false;
        }
        this.touch();
        this.onRunningChanged();
      });

    const accepted = await Promise.race([
      preflight,
      run.then(
        () => true,
        () => false,
      ),
    ]);
    if (!accepted) {
      if (cancellationSignal?.aborted) return false;
      throw new PiServerError("pi_prompt_rejected", 400);
    }
    return true;
  }

  /** Applies a direct-prompt model selection before image routing inspects model capabilities. */
  private async applyPromptSelection(selection: PiModelSelection): Promise<void> {
    await this.refreshChangedModelProvider(selection.provider);
    const model = this.session.modelRuntime
      .getAvailableSnapshot()
      .find(
        (candidate) =>
          candidate.provider === selection.provider && candidate.id === selection.modelId,
      );
    if (!model) throw new PiServerError("pi_model_not_available", 400);
    this.requireModelImageCompatibility(model);
    if (this.session.model?.provider !== model.provider || this.session.model?.id !== model.id) {
      const previousModel = this.session.model;
      const hadConversation = this.session.sessionManager.buildSessionContext().messages.length > 0;
      await this.session.setModel(model);
      if (hadConversation) {
        this.publish({
          type: PI_MODEL_CHANGED_EVENT,
          provider: model.provider,
          model: model.id,
          ...(previousModel
            ? {
                previousProvider: previousModel.provider,
                previousModel: previousModel.id,
              }
            : {}),
        });
      }
    }
    if (selection.thinkingLevel) this.session.setThinkingLevel(selection.thinkingLevel);
  }

  private activateBranch(leafId: string, persistSelection: boolean): void {
    const manager = this.session.sessionManager;
    if (!manager.getEntry(leafId)) throw new PiServerError("pi_branch_not_found", 404);
    manager.branch(leafId);
    if (persistSelection) {
      manager.appendCustomEntry(BRANCH_SELECTION_CUSTOM_TYPE, { selectedLeafId: leafId });
    }
    this.session.agent.state.messages = manager.buildSessionContext().messages;
    const events = readSessionEventJournal(manager);
    this.canonicalEventsValue.splice(0, this.canonicalEventsValue.length, ...events);
    this.sequence = events.at(-1)?.seq ?? -1;
    this.clearAssistantMessageStream();
    this.assistantMessageActive = false;
    this.assistantFirstTokenAt = undefined;
    this.toolStartedAtById.clear();
    try {
      // Branch-local journal sequences restart from the shared prefix. Reset every connected
      // client's watermark before any events from the selected branch can be published.
      getStreamHub().publishMux({
        type: "session/subscribed",
        sessionId: this.id,
        lastSeq: this.sequence,
      });
    } catch {
      // Unary branch history remains authoritative after reconnect.
    }
    announceSessionChanged(this);
  }

  selectBranch(leafId: string): Promise<void> {
    return this.runQueueMutation(async () => {
      if (this.isRunning) throw new PiServerError("pi_session_busy", 409);
      this.activateBranch(leafId, true);
    });
  }

  regenerate(messageId: string): Promise<void> {
    return this.runQueueMutation(async () => {
      if (this.isRunning) throw new PiServerError("pi_session_busy", 409);
      const manager = this.session.sessionManager;
      const selectedEntry = manager.getEntry(messageId);
      const event = selectedEntry ? storedCanonicalEvent(selectedEntry) : undefined;
      const eventData = isRecord(event?.data) ? event.data : undefined;
      const eventMessage = event?.type === "message" ? eventData : eventData?.message;
      let legacySource = false;
      const userEntry = (() => {
        if (
          selectedEntry?.type === "message" &&
          isRecord(selectedEntry.message) &&
          selectedEntry.message.role === "user"
        ) {
          legacySource = true;
          return selectedEntry;
        }
        if (
          (event?.type !== "message_end" && event?.type !== "message") ||
          !isRecord(eventMessage) ||
          eventMessage.role !== "user"
        ) {
          return undefined;
        }
        if (event.type === "message_end") {
          return manager
            .getChildren(messageId)
            .find(
              (entry) =>
                entry.type === "message" &&
                isRecord(entry.message) &&
                entry.message.role === "user" &&
                jsonEqual(entry.message, eventMessage),
            );
        }
        // Legacy journal migration records canonical `message` events after the original context.
        // Its sequence is the stable index into that migrated context.
        const entryId = historyFromManager(manager).context.entryIds[event.seq];
        const entry = entryId ? manager.getEntry(entryId) : undefined;
        if (entry?.type !== "message" || !jsonEqual(entry.message, eventMessage)) return undefined;
        legacySource = true;
        return entry;
      })();
      if (!userEntry) throw new PiServerError("pi_branch_not_found", 404);

      let branchLeafId = userEntry.id;
      if (legacySource) {
        manager.branch(userEntry.id);
        const initialized = initializeSessionEventJournal(
          manager,
          legacySessionEventsFromManager(manager),
        );
        if (initialized.error !== undefined) throw initialized.error;
        branchLeafId = manager.getLeafId() ?? userEntry.id;
      }
      this.activateBranch(branchLeafId, false);
      const run = this.session.agent.continue();
      this.promptTask = run;
      this.activePromptHasImages = false;
      this.touch();
      this.onRunningChanged();
      void run
        .then(() => this.publish({ type: "command_done" }))
        .catch((error: unknown) => {
          this.publish({ type: "command_error", code: "pi_prompt_failed" });
          try {
            getStreamHub().publishHost({
              type: "host/agent-error",
              sessionId: this.id,
              message: error instanceof Error ? error.message : "The agent command failed.",
            });
          } catch {
            // The durable command_error event remains available through history.
          }
        })
        .finally(() => {
          if (this.promptTask === run) this.promptTask = undefined;
          this.touch();
          this.onRunningChanged();
          announceSessionChanged(this);
        });
    });
  }

  async prompt(
    message: string,
    images?: PiImageContent[],
    selection?: PiModelSelection,
  ): Promise<void> {
    await this.submit("followUp", { message, ...(images?.length ? { images } : {}) }, undefined, {
      requireIdle: true,
      ...(selection === undefined ? {} : { selection }),
    });
  }

  private async understandImages(
    images: PiImageContent[],
    submissionId: string,
    rpcId?: string,
  ): Promise<ImageUnderstandingRunResult> {
    if (this.imageRecognitionTask || this.imageRecognitionAbort) {
      throw new PiServerError("pi_session_busy", 409);
    }
    const controller = new AbortController();
    this.imageRecognitionAbort = controller;
    this.imageRecognitionCompletion = new Promise<void>((resolve) => {
      this.completeImageRecognition = resolve;
    });
    const task = (async (): Promise<ImageUnderstandingRunResult> => {
      const settingsStore = getImageUnderstandingSettingsStore();
      let runtimeSettings;
      try {
        runtimeSettings = await settingsStore.resolveRuntimeSettings();
      } catch (error) {
        const lifecycle = new ImageRecognitionLifecycle({
          operationId: randomUUID(),
          submissionId,
          ...(rpcId === undefined ? {} : { rpcId }),
          method: "ocr",
          imageCount: images.length,
          publish: (snapshot) => {
            const timestamp = snapshot.timestamps?.updatedAt ?? Date.now();
            this.publish(
              {
                type: "message",
                role: "custom",
                customType: WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE,
                content: "",
                display: true,
                details: snapshot,
                timestamp,
              },
              timestamp,
            );
          },
        });
        await lifecycle.pending();
        await lifecycle.running("routing");
        if (controller.signal.aborted) await lifecycle.cancelled();
        else await lifecycle.failed(stableImageUnderstandingErrorCode(error));
        this.session.sessionManager.appendCustomEntry(
          WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE,
          lifecycle.current,
        );
        return controller.signal.aborted
          ? { kind: "cancelled" }
          : {
              kind: "failed",
              errorCode: lifecycle.current.errorCode ?? "image-settings-invalid",
            };
      }

      const selectedModel = this.session.model;
      if (selectedModel?.provider) await this.refreshChangedModelProvider(selectedModel.provider);
      const availableModels = this.session.modelRuntime.getAvailableSnapshot();
      const currentModel = selectedModel
        ? availableModels.find(
            (model) => model.provider === selectedModel.provider && model.id === selectedModel.id,
          )
        : availableModels[0];
      const route = decideImageUnderstandingRoute({
        settings: runtimeSettings.value,
        hasImages: images.length > 0,
        modelSupportsImages: currentModel?.input.includes("image") === true,
      });
      const method = route.kind === "native" ? "native" : runtimeSettings.value.engine;
      const providerId = route.kind === "preprocess" ? route.providerId : undefined;
      const lifecycle = new ImageRecognitionLifecycle({
        operationId: randomUUID(),
        submissionId,
        ...(rpcId === undefined ? {} : { rpcId }),
        method,
        ...(providerId === undefined ? {} : { providerId }),
        imageCount: images.length,
        publish: (snapshot) => {
          const timestamp = snapshot.timestamps?.updatedAt ?? Date.now();
          this.publish(
            {
              type: "message",
              role: "custom",
              customType: WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE,
              content: "",
              display: true,
              details: snapshot,
              timestamp,
            },
            timestamp,
          );
        },
      });
      try {
        await lifecycle.pending();
        await lifecycle.running("routing");
        if (controller.signal.aborted) {
          await lifecycle.cancelled();
          return { kind: "cancelled" };
        }
        if (route.kind === "native") {
          await lifecycle.skipped("native");
          return { kind: "native", images };
        }
        if (route.kind === "none") {
          await lifecycle.skipped(method);
          return { kind: "preprocessed", observations: [] };
        }
        if (route.kind === "unsupported") {
          await lifecycle.failed(route.reason);
          return { kind: "failed", errorCode: route.reason };
        }

        const inputs = images.map((image, index) => ({
          id: `image-${index + 1}`,
          ...(image.name === undefined ? {} : { name: image.name }),
          mimeType: image.mimeType,
          data: image.data,
        }));
        let observations: ImageUnderstandingObservation[];
        if (route.method === "ocr") {
          const credential = runtimeSettings.credential;
          if (!credential) {
            await lifecycle.failed("preprocessor-not-configured");
            return { kind: "failed", errorCode: "preprocessor-not-configured" };
          }
          await lifecycle.running("submitting");
          if (runtimeSettings.value.ocrProvider === "glm-ocr") {
            await lifecycle.running("recognizing");
            observations = await new GlmOcrProvider({
              endpoint: runtimeSettings.value.glm.endpoint,
              model: runtimeSettings.value.glm.model,
            }).recognize({ images: inputs, credential, signal: controller.signal });
          } else {
            await lifecycle.running("polling");
            observations = await new PaddleOcrProvider({
              endpoint: runtimeSettings.value.paddle.endpoint,
              model: runtimeSettings.value.paddle.model,
              pollIntervalMs: runtimeSettings.value.paddle.pollIntervalMs,
              pollTimeoutMs: runtimeSettings.value.paddle.pollTimeoutMs,
            }).recognize({ images: inputs, credential, signal: controller.signal });
          }
        } else {
          await lifecycle.running("submitting");
          await lifecycle.running("recognizing");
          observations = await recognizeWithMultimodalModel({
            runtime: this.session.modelRuntime,
            provider: runtimeSettings.value.multimodal.provider,
            model: runtimeSettings.value.multimodal.model,
            images: inputs,
            signal: controller.signal,
            onProgress: async (completedCount) => {
              await lifecycle.running("recognizing", {
                completedCount,
                progress: completedCount / images.length,
              });
            },
          });
        }
        validateImageUnderstandingObservations(
          observations,
          inputs.map(({ id }) => id),
        );
        await lifecycle.running("normalizing", {
          completedCount: observations.length,
          progress: observations.length / images.length,
        });
        await lifecycle.succeeded();
        return { kind: "preprocessed", observations };
      } catch (error) {
        if (
          controller.signal.aborted ||
          stableImageUnderstandingErrorCode(error) === "provider-aborted"
        ) {
          if (!isTerminalImageRecognitionSnapshot(lifecycle.current)) await lifecycle.cancelled();
          return { kind: "cancelled" };
        }
        const errorCode = stableImageUnderstandingErrorCode(error);
        if (!isTerminalImageRecognitionSnapshot(lifecycle.current))
          await lifecycle.failed(errorCode);
        return { kind: "failed", errorCode };
      } finally {
        if (isTerminalImageRecognitionSnapshot(lifecycle.current)) {
          this.session.sessionManager.appendCustomEntry(
            WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE,
            lifecycle.current,
          );
        }
      }
    })();
    this.imageRecognitionTask = task;
    this.touch();
    this.onRunningChanged();
    try {
      return await task;
    } finally {
      if (this.imageRecognitionTask === task) {
        this.imageRecognitionTask = undefined;
      }
      this.touch();
      this.onRunningChanged();
      announceSessionChanged(this);
    }
  }

  private releaseImageRecognitionLease(): void {
    if (!this.imageRecognitionAbort && !this.imageRecognitionCompletion) return;
    this.imageRecognitionAbort = undefined;
    const complete = this.completeImageRecognition;
    this.completeImageRecognition = undefined;
    this.imageRecognitionCompletion = undefined;
    complete?.();
    this.touch();
    this.onRunningChanged();
    announceSessionChanged(this);
  }

  private async resolveComposerSubmission(
    prompt: PiQueuedPrompt,
    submission: WorkbenchComposerSubmission,
    rpcId?: string,
  ): Promise<PiQueuedPrompt | undefined> {
    const plannedCommands = preflightPlanWorkbenchComposerCommands(this.session, submission);
    const submissionId = randomUUID();
    const canonicalDetails = submission.document
      ? {
          version: 2 as const,
          submissionId,
          sourceText: submission.sourceText,
          text: submission.text,
          document: submission.document,
          commands: submission.commands,
          composer: submission,
          ...(prompt.images?.length
            ? {
                images: prompt.images.map(({ data, mimeType, name }) => ({
                  data,
                  mimeType,
                  ...(name === undefined ? {} : { name }),
                })),
              }
            : {}),
          status: "accepted" as const,
        }
      : {
          version: 1 as const,
          submissionId,
          sourceText: submission.sourceText,
        };
    await this.session.sendCustomMessage(
      {
        customType: submission.document
          ? WORKBENCH_COMPOSER_USER_CUSTOM_TYPE
          : LEGACY_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
        content: "",
        display: false,
        details: canonicalDetails,
      },
      { triggerTurn: false },
    );

    const projection = {
      version: 1 as const,
      submissionId,
      sourceText: submission.sourceText,
      ...(submission.document === undefined ? {} : { document: submission.document }),
      hidden: true as const,
    };
    const publishCommandResponse = (response: WorkbenchComposerCommandResponse) => {
      const responseDetails: WorkbenchComposerCommandResponseDetails = {
        version: 1,
        submissionId,
        ...response,
      };
      const timestamp = Date.now();
      this.publish(
        {
          type: "message",
          role: "custom",
          customType: WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
          content: "",
          display: true,
          details: responseDetails,
          timestamp,
        },
        timestamp,
      );
    };
    const sessionActionWithoutUserText =
      !submission.text.trim() &&
      plannedCommands.some((command) => command.effect === "session-action");
    const resolution = await resolveWorkbenchComposerCommands(
      this.session,
      {
        ...submission,
        text: sessionActionWithoutUserText ? submission.text : prompt.message,
      },
      {
        plannedCommands,
        projectInternalUserPrompt: () => this.queueComposerUserProjection(projection),
        onCommandResponse: publishCommandResponse,
      },
    );
    const commandFailed = resolution.request.commandTrace.some(
      (command) => command.status === "execution-failed",
    );
    const commandOwnsAgentTurn = plannedCommands.some((command) => command.effect === "agent-turn");
    let resolvedImages = prompt.images;
    let imageUnderstandingFailure: string | undefined;
    let usedImagePreprocessing = false;
    if (prompt.images?.length && !commandFailed && !commandOwnsAgentTurn) {
      const imageUnderstanding = await this.understandImages(prompt.images, submissionId, rpcId);
      if (imageUnderstanding.kind === "native") {
        resolvedImages = imageUnderstanding.images;
      } else if (imageUnderstanding.kind === "preprocessed") {
        resolvedImages = undefined;
        usedImagePreprocessing = true;
        resolution.request.untrustedContext.push({
          source: "workbench.image-understanding",
          trust: "untrusted-context",
          value: {
            version: 1,
            kind: "image-understanding",
            observations: imageUnderstanding.observations.map((observation) => ({
              imageId: observation.imageId,
              providerId: observation.providerId,
              method: observation.method,
              format: observation.format,
              text: observation.text,
            })),
          },
        });
      } else {
        resolvedImages = undefined;
        imageUnderstandingFailure =
          imageUnderstanding.kind === "cancelled"
            ? "image-recognition-cancelled"
            : imageUnderstanding.errorCode;
      }
      if (this.imageRecognitionAbort?.signal.aborted) {
        resolvedImages = undefined;
        imageUnderstandingFailure = "image-recognition-cancelled";
      }
    }
    const needsMainTurn =
      !commandOwnsAgentTurn &&
      !commandFailed &&
      imageUnderstandingFailure === undefined &&
      (Boolean(resolvedImages?.length) ||
        Boolean(resolution.request.userText.trim()) ||
        resolution.request.instructions.length > 0 ||
        resolution.request.trustedContext.length > 0 ||
        resolution.request.untrustedContext.length > 0);
    const resolutionDetails: WorkbenchComposerResolutionDetails = {
      version: 1,
      submissionId,
      status:
        needsMainTurn || (!commandFailed && imageUnderstandingFailure === undefined)
          ? needsMainTurn
            ? "resolved"
            : "completed"
          : "command_error",
      commandTrace: resolution.request.commandTrace,
    };
    await this.session.sendCustomMessage(
      {
        customType: WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE,
        content: "",
        display: false,
        details: resolutionDetails,
      },
      { triggerTurn: false },
    );
    for (const response of resolution.commandResponses) {
      const responseDetails: WorkbenchComposerCommandResponseDetails = {
        version: 1,
        submissionId,
        ...response,
      };
      this.session.sessionManager.appendCustomEntry(
        WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
        responseDetails,
      );
    }

    if (!needsMainTurn) {
      this.publish(
        commandFailed || imageUnderstandingFailure
          ? {
              type: "command_error",
              code: commandFailed ? "pi_composer_command_failed" : "pi_image_recognition_failed",
            }
          : { type: "command_done" },
      );
      return undefined;
    }
    const resolvedPrompt =
      hasWorkbenchComposerSemantics(submission) || usedImagePreprocessing
        ? compileWorkbenchComposerPrompt(resolution.request)
        : resolution.request.userText;
    this.queueComposerUserProjection(projection, resolvedPrompt);
    return {
      message: resolvedPrompt,
      ...(resolvedImages?.length ? { images: resolvedImages } : {}),
    };
  }

  submit(
    mode: PiQueueMode,
    prompt: PiQueuedPrompt,
    provenance?: PromptSubmissionProvenance,
    options: Readonly<{
      requireIdle?: boolean;
      requireRunning?: boolean;
      selection?: PiModelSelection;
    }> = {},
  ): Promise<PromptSubmissionResult> {
    return this.runQueueMutation(async () => {
      try {
        if (options.requireIdle && this.isRunning) {
          throw new PiServerError("pi_session_busy", 409);
        }
        if (options.requireRunning && !this.isRunning) {
          throw new PiServerError("pi_session_not_running", 409);
        }
        if (provenance?.rpcId && this.cancelledQueueItemIds.delete(provenance.rpcId)) {
          return { queued: false };
        }
        if (options.selection) await this.applyPromptSelection(options.selection);
        let admission: PromptSubmissionResult = { queued: false };
        const submittedComposer = provenance?.composer;
        const composer = submittedComposer
          ? prompt.images?.length &&
            !hasWorkbenchComposerDocument(submittedComposer) &&
            !hasWorkbenchComposerSemantics(submittedComposer)
            ? {
                ...submittedComposer,
                document: [{ type: "text" as const, text: submittedComposer.sourceText }],
              }
            : submittedComposer
          : prompt.images?.length
            ? {
                version: 1 as const,
                document: [{ type: "text" as const, text: prompt.message }],
                sourceText: prompt.message,
                text: prompt.message,
                context: [],
                metadata: {},
                commands: [],
              }
            : undefined;
        let resolvedPrompt =
          composer &&
          (hasWorkbenchComposerDocument(composer) || hasWorkbenchComposerSemantics(composer))
            ? await this.resolveComposerSubmission(prompt, composer, provenance?.rpcId)
            : prompt;
        const recognitionSignal = this.imageRecognitionAbort?.signal;
        if (resolvedPrompt && recognitionSignal?.aborted) {
          resolvedPrompt = undefined;
          this.publish({ type: "command_error", code: "pi_image_recognition_cancelled" });
        }
        if (resolvedPrompt) {
          try {
            if (this.hasActiveAgentRun) {
              admission = {
                queued: true,
                queueItemId: await this.queueNow(mode, resolvedPrompt, provenance?.rpcId),
              };
            } else {
              const started = await this.promptNow(
                resolvedPrompt.message,
                resolvedPrompt.images,
                undefined,
                recognitionSignal,
              );
              if (!started) {
                this.publish({ type: "command_error", code: "pi_image_recognition_cancelled" });
              }
            }
          } catch (error) {
            if (resolvedPrompt !== prompt) {
              const projection = this.pendingComposerUserProjections.at(-1);
              if (projection?.promptText === resolvedPrompt.message) {
                this.pendingComposerUserProjections.pop();
              }
            }
            throw error;
          }
        }

        if (provenance !== undefined) {
          try {
            this.session.sessionManager.appendCustomEntry(PROMPT_SOURCE_CUSTOM_TYPE, {
              version: 1,
              mode,
              source: {
                kind: "rpc",
                ...(provenance.rpcId === undefined ? {} : { rpcId: provenance.rpcId }),
                ...(provenance.clientTimeZone === undefined
                  ? {}
                  : { clientTimeZone: provenance.clientTimeZone }),
              },
            });
          } catch (error) {
            try {
              getStreamHub().publishHost({
                type: "host/agent-error",
                sessionId: this.id,
                message:
                  error instanceof Error
                    ? `Prompt provenance could not be persisted: ${error.message}`
                    : "Prompt provenance could not be persisted.",
              });
            } catch {
              // Prompt admission already succeeded; provenance failure must not duplicate the turn.
            }
          }
        }

        if (provenance?.rpcId) {
          try {
            getStreamHub().publishMux(
              {
                type: "session/prompt-accepted",
                sessionId: this.id,
                mode: mode === "followUp" ? "queue" : "steer",
                running: this.isRunning,
              },
              { rpcId: provenance.rpcId },
            );
          } catch (error) {
            // The prompt is already admitted. Never turn an acknowledgement transport
            // failure into an HTTP failure that could make the caller submit it twice.
            console.error("[workbench-pi] prompt acknowledgement publish failed", error);
          }
        }
        return admission;
      } finally {
        this.releaseImageRecognitionLease();
      }
    });
  }

  selectModel(selection: {
    provider: string;
    model: string;
    reasoningEffort?: string;
  }): Promise<void> {
    return this.runQueueMutation(async () => {
      await this.refreshChangedModelProvider(selection.provider);
      const model = this.session.modelRuntime
        .getAvailableSnapshot()
        .find(
          (candidate) =>
            candidate.provider === selection.provider && candidate.id === selection.model,
        );
      if (!model) throw new PiServerError("pi_model_not_available", 400);
      this.requireModelImageCompatibility(model);
      if (this.session.model?.provider !== model.provider || this.session.model?.id !== model.id) {
        const previousModel = this.session.model;
        const hadConversation =
          this.session.sessionManager.buildSessionContext().messages.length > 0;
        await this.session.setModel(model);
        if (hadConversation) {
          this.publish({
            type: PI_MODEL_CHANGED_EVENT,
            provider: model.provider,
            model: model.id,
            ...(previousModel
              ? {
                  previousProvider: previousModel.provider,
                  previousModel: previousModel.id,
                }
              : {}),
          });
        }
      }
      if (selection.reasoningEffort) {
        this.session.setThinkingLevel(selection.reasoningEffort as PiThinkingLevel);
      }
      this.touch();
    });
  }

  async cancel(): Promise<void> {
    if (this.isRunning) {
      this.session.sessionManager.appendCustomEntry(PI_CANCEL_INTENT_CUSTOM_TYPE, {
        requestedAt: Date.now(),
        source: "workbench",
      });
    }
    const recognition = this.imageRecognitionTask;
    const recognitionCompletion = this.imageRecognitionCompletion;
    this.imageRecognitionAbort?.abort();
    await this.session.abort();
    await recognition?.catch(() => undefined);
    await recognitionCompletion?.catch(() => undefined);
    this.touch();
  }

  queue(mode: PiQueueMode, prompt: PiQueuedPrompt): Promise<void> {
    return this.runQueueMutation(async () => {
      await this.queueNow(mode, prompt);
    });
  }

  private async queueNow(
    mode: PiQueueMode,
    prompt: PiQueuedPrompt,
    requestedId?: string,
  ): Promise<string> {
    if (!this.isRunning) throw new PiServerError("pi_session_not_running", 409);
    if (prompt.images?.length && !this.session.model?.input.includes("image")) {
      throw imageUnsupported();
    }
    const lane = mode === "steer" ? "steering" : "followUp";
    const queueItem = this.queueProjection.append(lane, prompt, requestedId);
    if (this.pausedQueue && mode === "followUp") {
      this.pausedQueue.followUp.push(...copyQueuedPrompts([prompt]));
      this.publishQueueUpdate();
      this.touch();
      return queueItem.id;
    }
    try {
      if (mode === "steer") {
        await this.session.steer(prompt.message, prompt.images);
      } else {
        await this.session.followUp(prompt.message, prompt.images);
      }
    } catch (error) {
      this.publishQueueUpdate();
      throw error;
    }
    this.touch();
    return queueItem.id;
  }

  private async restoreActiveQueue(queue: PromptQueueSnapshot): Promise<void> {
    this.session.clearQueue();
    const firstSteering = queue.steering[0];
    const firstFollowUp = queue.followUp[0];
    if (!this.isRunning && (firstSteering || firstFollowUp)) {
      const first = firstSteering ?? firstFollowUp!;
      await this.promptNow(first.message, first.images);
      if (firstSteering) queue.steering.shift();
      else queue.followUp.shift();
    }
    for (const prompt of queue.steering) {
      await this.session.steer(prompt.message, prompt.images);
    }
    for (const prompt of queue.followUp) {
      await this.session.followUp(prompt.message, prompt.images);
    }
  }

  private async requireQueueImageCapability(queue: ReadonlyPromptQueueSnapshot): Promise<void> {
    if (!promptsHaveImages(queue)) return;
    const currentModel = this.session.model;
    if (currentModel) {
      await this.refreshChangedModelProvider(currentModel.provider);
      const refreshedModel = this.session.modelRuntime
        .getAvailableSnapshot()
        .find(
          (candidate) =>
            candidate.provider === currentModel.provider && candidate.id === currentModel.id,
        );
      if (!refreshedModel) throw new PiServerError("pi_model_not_available", 400);
      if (refreshedModel !== currentModel) await this.session.setModel(refreshedModel);
    }
    if (!this.session.model?.input.includes("image")) throw imageUnsupported();
  }

  replaceQueue(
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    return this.runQueueMutation(() => this.replaceQueueNow(steering, followUp));
  }

  private async replaceQueueNow(
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    await this.requireQueueImageCapability({ steering, followUp });
    const nextQueue = {
      steering: copyQueuedPrompts(steering),
      followUp: copyQueuedPrompts(followUp),
    };
    this.queueProjection.reconcile(nextQueue.steering, nextQueue.followUp);
    if (this.pausedQueue) {
      this.pausedQueue.followUp = nextQueue.followUp;
      this.suppressQueueUpdates += 1;
      try {
        this.session.clearQueue();
        for (const prompt of nextQueue.steering) {
          await this.session.steer(prompt.message, prompt.images);
        }
      } finally {
        this.suppressQueueUpdates -= 1;
        this.publishQueueUpdate();
        this.touch();
      }
      return;
    }
    this.suppressQueueUpdates += 1;
    try {
      await this.restoreActiveQueue(nextQueue);
    } finally {
      this.suppressQueueUpdates -= 1;
      this.publishQueueUpdate();
      this.touch();
    }
  }

  steerQueued(
    prompt: PiQueuedPrompt,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    return this.runQueueMutation(() => this.steerQueuedNow(prompt, steering, followUp));
  }

  private async steerQueuedNow(
    prompt: PiQueuedPrompt,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    await this.requireQueueImageCapability({
      steering: [prompt, ...steering],
      followUp,
    });
    const remaining = {
      steering: copyQueuedPrompts(steering),
      followUp: copyQueuedPrompts(followUp),
    };
    this.queueProjection.reconcile(remaining.steering, remaining.followUp);
    const steeringItem = this.queueProjection.append("steering", prompt);
    this.queueProjection.moveToSteering(steeringItem.id);
    const paused = this.pausedQueue !== undefined;
    if (paused) this.pausedQueue = remaining;

    this.suppressQueueUpdates += 1;
    try {
      this.session.clearQueue();
      if (this.isRunning) await this.session.steer(prompt.message, prompt.images);
      else await this.promptNow(prompt.message, prompt.images);
      for (const queued of remaining.steering) {
        await this.session.steer(queued.message, queued.images);
      }
      if (!paused) {
        for (const queued of remaining.followUp) {
          await this.session.followUp(queued.message, queued.images);
        }
      }
    } finally {
      this.suppressQueueUpdates -= 1;
      this.publishQueueUpdate();
      this.touch();
    }
  }

  setQueuePaused(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    return this.runQueueMutation(() => this.setQueuePausedNow(paused, steering, followUp));
  }

  private async setQueuePausedNow(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    await this.requireQueueImageCapability({ steering, followUp });
    const nextQueue = {
      steering: copyQueuedPrompts(steering),
      followUp: copyQueuedPrompts(followUp),
    };
    this.queueProjection.reconcile(nextQueue.steering, nextQueue.followUp);

    if (paused) {
      this.pausedQueue = nextQueue;
      this.suppressQueueUpdates += 1;
      try {
        this.session.clearQueue();
        for (const prompt of nextQueue.steering) {
          await this.session.steer(prompt.message, prompt.images);
        }
      } finally {
        this.suppressQueueUpdates -= 1;
        this.publishQueueUpdate();
        this.touch();
      }
      return;
    }

    this.pausedQueue = undefined;
    this.suppressQueueUpdates += 1;
    try {
      await this.restoreActiveQueue(nextQueue);
    } finally {
      this.suppressQueueUpdates -= 1;
      this.publishQueueUpdate();
      this.touch();
    }
  }

  updateQueueItem(itemId: string, mutation: PromptQueueMutation): Promise<void> {
    return this.runQueueMutation(() => this.updateQueueItemNow(itemId, mutation));
  }

  private async updateQueueItemNow(itemId: string, mutation: PromptQueueMutation): Promise<void> {
    const item = this.queueProjection.find(itemId);
    if (!item) {
      if (mutation.kind === "remove") {
        // A client can remove its optimistic row before the matching prompt admission reaches this
        // session. Retain that id as a cancellation intent so the later serialized submit is a no-op.
        this.cancelledQueueItemIds.add(itemId);
        return;
      }
      throw new PiServerError("pi_queue_item_not_found", 404);
    }
    if (mutation.kind === "steer" && (item.lane !== "followUp" || !this.isRunning)) {
      throw new PiServerError("pi_steer_unavailable", 409);
    }

    const previousQueue = this.queueProjection.prompts();
    if (mutation.kind === "edit") this.queueProjection.edit(itemId, mutation.prompt);
    else if (mutation.kind === "steer") this.queueProjection.moveToSteering(itemId);
    else this.queueProjection.remove(itemId);

    const nextQueue = this.queueProjection.prompts();
    try {
      await this.requireQueueImageCapability(nextQueue);
    } catch (error) {
      this.queueProjection.reconcile(previousQueue.steering, previousQueue.followUp);
      throw error;
    }
    if (this.pausedQueue) this.pausedQueue = copyQueueSnapshot(nextQueue);
    this.suppressQueueUpdates += 1;
    try {
      this.session.clearQueue();
      for (const prompt of nextQueue.steering) {
        await this.session.steer(prompt.message, prompt.images);
      }
      if (!this.pausedQueue) {
        for (const prompt of nextQueue.followUp) {
          await this.session.followUp(prompt.message, prompt.images);
        }
      }
    } finally {
      this.suppressQueueUpdates -= 1;
      this.publishQueueUpdate();
      this.touch();
    }
  }

  rename(name: string): number {
    const previousSequence = this.sequence;
    this.session.setSessionName(name);
    if (this.sequence <= previousSequence) {
      throw new PiServerError("pi_session_event_journal_unavailable", 500);
    }
    this.touch();
    return this.sequence;
  }

  summary(): PiSessionSummary {
    return sessionManagerSummary(this.session.sessionManager, this.isRunning);
  }

  metadataSnapshot(): { summary: PiSessionSummary; info?: SessionInfo } {
    const manager = this.session.sessionManager;
    const summary = this.summary();
    return { summary, info: sessionManagerInfo(manager, summary) };
  }

  async shutdown(): Promise<void> {
    if (!this.alive) return;
    this.alive = false;
    getInteractiveResponseRegistry().clearSession(this.id);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const recognitionCompletion = this.imageRecognitionCompletion;
    this.imageRecognitionAbort?.abort();
    try {
      if (this.isRunning) await this.session.abort();
      await recognitionCompletion?.catch(() => undefined);
    } catch {
      // Disposal below remains authoritative.
    }
    this.clearAssistantMessageStream();
    this.unsubscribeAgent();
    this.listeners.clear();
    this.session.dispose();
    this.onDestroyed();
  }
}

interface RegistryState {
  sessions: Map<string, HostedPiSession>;
  startLocks: Map<string, Promise<HostedPiSession>>;
  persistedSessions: Map<string, SessionInfo>;
  persistedSessionSummaries: Map<string, PiSessionSummary>;
  persistedSessionFingerprints: Map<string, string>;
  persistedSessionCacheKey: string;
  persistedSessionCacheReady: boolean;
  persistedSessionCacheTask?: Promise<void>;
  runningListeners: Set<RunningListener>;
  lastRunningKey: string;
  forkTail: Promise<void>;
}

const serverGlobal = globalThis as typeof globalThis & {
  __workbenchPiRegistry?: RegistryState;
};

function state(): RegistryState {
  if (!serverGlobal.__workbenchPiRegistry) {
    serverGlobal.__workbenchPiRegistry = {
      sessions: new Map(),
      startLocks: new Map(),
      persistedSessions: new Map(),
      persistedSessionSummaries: new Map(),
      persistedSessionFingerprints: new Map(),
      persistedSessionCacheKey: "",
      persistedSessionCacheReady: false,
      runningListeners: new Set(),
      lastRunningKey: "",
      forkTail: Promise.resolve(),
    };
  }
  const registry = serverGlobal.__workbenchPiRegistry;
  // Preserve compatibility with a registry retained across a development HMR update.
  registry.persistedSessions ??= new Map();
  registry.persistedSessionSummaries ??= new Map();
  registry.persistedSessionFingerprints ??= new Map();
  registry.persistedSessionCacheKey ??= "";
  registry.persistedSessionCacheReady ??= false;
  registry.forkTail ??= Promise.resolve();
  return registry;
}

function runningSessionIds(): string[] {
  return [...state().sessions.values()]
    .filter((host) => host.isAlive && host.isRunning)
    .map((host) => host.id)
    .sort();
}

function publishRunningSessions(): void {
  const registry = state();
  const ids = runningSessionIds();
  const key = ids.join("\u0000");
  if (key === registry.lastRunningKey) return;
  const previous = new Set(registry.lastRunningKey ? registry.lastRunningKey.split("\u0000") : []);
  const next = new Set(ids);
  registry.lastRunningKey = key;
  for (const sessionId of new Set([...previous, ...next])) {
    if (previous.has(sessionId) === next.has(sessionId)) continue;
    try {
      getStreamHub().publishHost({
        type: "host/session-status",
        sessionId,
        running: next.has(sessionId),
      });
    } catch {
      // Running state remains authoritative through session.list.
    }
  }
  for (const listener of registry.runningListeners) listener(ids);
}

async function createHost(sessionManager: SessionManager): Promise<HostedPiSession> {
  const cwd = sessionManager.getCwd();
  const trustProject = process.env.PI_WORKBENCH_TRUST_PROJECT === "1";
  const services = await createAgentSessionServices({
    cwd,
    resourceLoaderReloadOptions: {
      resolveProjectTrust: async () => trustProject,
    },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    customTools: [
      createInteractiveBashTool(cwd, sessionManager.getSessionId(), {
        commandPrefix: services.settingsManager.getShellCommandPrefix(),
        shellPath: services.settingsManager.getShellPath(),
      }),
    ],
  });
  const interactiveResponses = getInteractiveResponseRegistry();
  await session.bindExtensions({
    mode: "rpc",
    uiContext: interactiveResponses.createExtensionUIContext(session.sessionId),
  });

  let host: HostedPiSession;
  host = new HostedPiSession(session, publishRunningSessions, () => {
    const registry = state();
    cacheHostedSession(registry, host);
    if (registry.sessions.get(host.id) === host) registry.sessions.delete(host.id);
    interactiveResponses.clearSession(host.id);
    publishRunningSessions();
  });
  state().sessions.set(host.id, host);
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
  return createAgentSessionServices({
    cwd: workspace.cwd,
    resourceLoaderReloadOptions: {
      resolveProjectTrust: async () => process.env.PI_WORKBENCH_TRUST_PROJECT === "1",
    },
  });
}

async function persistedSession(id: string): Promise<SessionInfo | undefined> {
  const registry = await ensurePersistedSessionCache();
  const cached = registry.persistedSessions.get(id);
  if (cached && existsSync(cached.path)) return cached;
  return undefined;
}

interface CanonicalJournalEntry {
  entry: SessionEntry;
  event: SessionEvent;
  branchIndex: number;
}

function storedCanonicalEvent(entry: SessionTimestampEntry): SessionEvent | undefined {
  if (entry.type !== "custom" || entry.customType !== SESSION_EVENT_CUSTOM_TYPE) {
    return undefined;
  }
  if (!isRecord(entry.data) || entry.data.version !== 1 || !isRecord(entry.data.event)) {
    return undefined;
  }
  const event = entry.data.event;
  if (
    typeof event.type !== "string" ||
    !event.type ||
    !Number.isInteger(event.seq) ||
    (event.seq as number) < 0 ||
    typeof event.time !== "number" ||
    !Number.isFinite(event.time) ||
    !Object.hasOwn(event, "data")
  ) {
    return undefined;
  }
  return event as unknown as SessionEvent;
}

/** Mirror journal recovery semantics while retaining the Pi entry that owns each event. */
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

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function customMessageMatchesEntry(
  message: Record<string, unknown>,
  entry: SessionEntry | undefined,
): boolean {
  return (
    entry?.type === "custom_message" &&
    entry.customType === message.customType &&
    jsonEqual(entry.content, message.content) &&
    entry.display === message.display &&
    jsonEqual(entry.details, message.details)
  );
}

/**
 * `AgentSession` emits `message_end` before it persists the message. A fork cut is only safe when
 * the journal event is immediately followed by the exact context entry produced for that event.
 */
function hasPersistedMessageForEvent(
  event: SessionEvent,
  journalBranchIndex: number,
  branch: readonly SessionEntry[],
): boolean {
  if (!isRecord(event.data) || !isRecord(event.data.message)) return false;
  const message = event.data.message;
  const next = branch[journalBranchIndex + 1];
  if (!next || typeof message.role !== "string") return false;

  if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
    return next.type === "message" && jsonEqual(next.message, message);
  }
  if (message.role !== "custom") return false;
  if (customMessageMatchesEntry(message, next)) return true;

  // Workbench custom messages are persisted before AgentSession emits their lifecycle events:
  // custom_message -> message_start journal -> message_end journal. Accept only that exact,
  // content-matching sequence so the fork still has a provably durable leaf.
  const startEntry = branch[journalBranchIndex - 1];
  const persistedEntry = branch[journalBranchIndex - 2];
  const startEvent = startEntry ? storedCanonicalEvent(startEntry) : undefined;
  const startMessage = isRecord(startEvent?.data) ? startEvent.data.message : undefined;
  return (
    startEvent?.type === "message_start" &&
    jsonEqual(startMessage, message) &&
    customMessageMatchesEntry(message, persistedEntry)
  );
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
  const boundary =
    atSeq === undefined
      ? journal.findLast(({ event }) => event.type === "turn_end")
      : (journal.find(({ event }) => event.type === "turn_end" && event.seq >= atSeq) ??
        (atSeq > lastSeq ? journal.findLast(({ event }) => event.type === "turn_end") : undefined));
  if (!boundary) throw forkUnavailable();

  let turnOpen = false;
  for (const candidate of journal) {
    if (candidate.event.seq > boundary.event.seq) break;
    if (candidate.event.type === "turn_start") {
      if (turnOpen) throw forkUnavailable();
      turnOpen = true;
    } else if (candidate.event.type === "message_end") {
      if (!hasPersistedMessageForEvent(candidate.event, candidate.branchIndex, branch)) {
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

/**
 * Build a child from a detached manager. Pi's runtime-level fork replaces the live source session;
 * opening a second manager and branching that copy preserves the source host and its listeners.
 */
export function createDetachedSessionFork(sourcePath: string, atSeq?: number): SessionManager {
  const sourceBefore = statSync(sourcePath);
  const detached = SessionManager.open(sourcePath);
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

export async function getOrStartSession(id: string): Promise<HostedPiSession> {
  const registry = state();
  const existing = registry.sessions.get(id);
  if (existing?.isAlive) return existing;

  const starting = registry.startLocks.get(id);
  if (starting) return starting;

  const start = (async () => {
    const info = await persistedSession(id);
    if (!info) throw new PiServerError("pi_session_not_found", 404);
    return createHost(SessionManager.open(info.path));
  })().finally(() => registry.startLocks.delete(id));
  registry.startLocks.set(id, start);
  return start;
}

export async function createSession(cwd: string, sessionId?: string): Promise<HostedPiSession> {
  const workspace = validateWorkspace(cwd);
  const registry = state();
  if (sessionId !== undefined) {
    const existing = registry.sessions.get(sessionId);
    if (existing?.isAlive) {
      requireRequestedCwd(sessionId, workspace.cwd, existing.session.sessionManager.getCwd());
      return existing;
    }

    const starting = registry.startLocks.get(sessionId);
    if (starting) {
      const host = await starting;
      requireRequestedCwd(sessionId, workspace.cwd, host.session.sessionManager.getCwd());
      return host;
    }

    const start = (async () => {
      const persisted = await persistedSession(sessionId);
      if (persisted !== undefined) {
        requireRequestedCwd(sessionId, workspace.cwd, persisted.cwd);
        return createHost(SessionManager.open(persisted.path));
      }
      const host = await createHost(
        SessionManager.create(workspace.cwd, undefined, { id: sessionId }),
      );
      announceSessionAdded(host);
      return host;
    })().finally(() => registry.startLocks.delete(sessionId));
    registry.startLocks.set(sessionId, start);
    return start;
  }

  const key = `new:${randomUUID()}`;
  const start = createHost(SessionManager.create(workspace.cwd))
    .then((host) => {
      announceSessionAdded(host);
      return host;
    })
    .finally(() => registry.startLocks.delete(key));
  registry.startLocks.set(key, start);
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

async function serializeForkCreation<Value>(operation: () => Promise<Value>): Promise<Value> {
  const registry = state();
  const previous = registry.forkTail;
  let release!: () => void;
  registry.forkTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

/** Create an independent child without replacing or rebinding the source live AgentSession. */
export async function forkSession(id: string, atSeq?: number): Promise<HostedPiSession> {
  const registry = state();
  let live = registry.sessions.get(id);
  if (!live?.isAlive) {
    const starting = registry.startLocks.get(id);
    if (starting) live = await starting;
  }
  if (live?.isAlive && live.isRunning) throw forkUnavailable();

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

  return serializeForkCreation(async () => {
    if (
      !existsSync(/* turbopackIgnore: true */ resolvedSourcePath) ||
      registry.sessions.get(id)?.isRunning
    ) {
      throw forkUnavailable();
    }
    const occupiedIds = new Set((await SessionManager.listAll()).map((session) => session.id));
    if (
      !existsSync(/* turbopackIgnore: true */ resolvedSourcePath) ||
      registry.sessions.get(id)?.isRunning
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
        registry.sessions.has(childId) ||
        registry.startLocks.has(childId)
      ) {
        removeFailedForkFile(resolvedSourcePath, child);
        continue;
      }

      const start = createHost(child)
        .then((host) => {
          announceSessionAdded(host);
          return host;
        })
        .catch((error) => {
          removeFailedForkFile(resolvedSourcePath, child);
          throw error;
        })
        .finally(() => registry.startLocks.delete(childId));
      registry.startLocks.set(childId, start);
      return start;
    }
    throw forkUnavailable();
  });
}

function persistedSummary(info: SessionInfo, running: boolean): PiSessionSummary {
  let modified = info.modified;
  try {
    modified = sessionModifiedAt(SessionManager.open(info.path));
  } catch {
    // A concurrently removed or malformed log can still use listAll's best-effort metadata.
  }
  return {
    id: info.id,
    cwd: info.cwd,
    workspace: workspaceFromCwd(info.cwd),
    name: info.name,
    created: info.created.toISOString(),
    modified: modified.toISOString(),
    messageCount: info.messageCount,
    firstMessage: info.firstMessage,
    transient: false,
    running,
  };
}

function sessionManagerSummary(manager: SessionManager, running: boolean): PiSessionSummary {
  const context = manager.buildSessionContext();
  const header = manager.getHeader();
  const file = manager.getSessionFile();
  const timestamp = header?.timestamp ?? new Date().toISOString();
  return {
    id: manager.getSessionId(),
    cwd: manager.getCwd(),
    workspace: workspaceFromCwd(manager.getCwd()),
    name: manager.getSessionName(),
    created: timestamp,
    modified: sessionModifiedAt(manager).toISOString(),
    messageCount: context.messages.length,
    firstMessage: firstUserText(context.messages),
    transient: !file || !existsSync(file),
    running,
  };
}

function sessionManagerInfo(
  manager: SessionManager,
  summary: PiSessionSummary,
): SessionInfo | undefined {
  const sessionFile = manager.getSessionFile();
  if (!sessionFile || !existsSync(sessionFile)) return undefined;
  const header = manager.getHeader();
  return {
    path: sessionFile,
    id: summary.id,
    cwd: summary.cwd,
    ...(summary.name === undefined ? {} : { name: summary.name }),
    ...(header?.parentSession === undefined ? {} : { parentSessionPath: header.parentSession }),
    created: new Date(summary.created),
    modified: new Date(summary.modified),
    messageCount: summary.messageCount,
    firstMessage: summary.firstMessage,
    allMessagesText: "",
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
  const summary: PiSessionSummary = {
    id: manager.getSessionId(),
    cwd: manager.getCwd(),
    workspace: workspaceFromCwd(manager.getCwd()),
    name: manager.getSessionName(),
    created: timestamp,
    modified: sessionModifiedAt(manager).toISOString(),
    messageCount: messages.length,
    firstMessage: firstUserText(messages) || "(no messages)",
    transient: !file || !existsSync(file),
    running,
  };
  return { summary, info: sessionManagerInfo(manager, summary) };
}

function configuredSessionCacheKey(): string {
  return path.join(getAgentDir(), "sessions");
}

function ensureSessionCacheScope(registry: RegistryState): string {
  const cacheKey = configuredSessionCacheKey();
  if (registry.persistedSessionCacheKey === cacheKey) return cacheKey;
  registry.persistedSessionCacheKey = cacheKey;
  registry.persistedSessionCacheReady = false;
  registry.persistedSessionCacheTask = undefined;
  registry.persistedSessions.clear();
  registry.persistedSessionSummaries.clear();
  registry.persistedSessionFingerprints.clear();
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

function fingerprintsMatch(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>) {
  if (left.size !== right.size) return false;
  for (const [file, fingerprint] of left) {
    if (right.get(file) !== fingerprint) return false;
  }
  return true;
}

function cacheHostedSession(
  registry: RegistryState,
  host: HostedPiSession,
  fingerprints?: Map<string, string>,
): void {
  const { info, summary } = host.metadataSnapshot();
  registry.persistedSessionSummaries.set(summary.id, summary);
  if (!info) {
    const previous = registry.persistedSessions.get(summary.id);
    registry.persistedSessions.delete(summary.id);
    if (previous) {
      registry.persistedSessionFingerprints.delete(previous.path);
      fingerprints?.delete(previous.path);
    }
    return;
  }
  registry.persistedSessions.set(info.id, info);
  try {
    const metadata = statSync(info.path);
    const fingerprint = `${metadata.size}:${metadata.mtimeMs}`;
    registry.persistedSessionFingerprints.set(info.path, fingerprint);
    fingerprints?.set(info.path, fingerprint);
  } catch {
    registry.persistedSessionFingerprints.delete(info.path);
    fingerprints?.delete(info.path);
  }
}

function cachePersistedSessionManager(
  registry: RegistryState,
  manager: SessionManager,
): PiSessionSummary {
  const { info, summary } = persistedMetadataFromManager(manager, false);
  registry.persistedSessionSummaries.set(summary.id, summary);
  if (!info) return summary;
  registry.persistedSessions.set(info.id, info);
  try {
    const metadata = statSync(info.path);
    registry.persistedSessionFingerprints.set(info.path, `${metadata.size}:${metadata.mtimeMs}`);
  } catch {
    registry.persistedSessionFingerprints.delete(info.path);
  }
  return summary;
}

function removeCachedSessionFile(registry: RegistryState, file: string): void {
  for (const [id, info] of registry.persistedSessions) {
    if (info.path !== file) continue;
    registry.persistedSessions.delete(id);
    registry.persistedSessionSummaries.delete(id);
  }
}

function refreshChangedSessionFiles(
  registry: RegistryState,
  fingerprints: ReadonlyMap<string, string>,
): void {
  for (const file of registry.persistedSessionFingerprints.keys()) {
    if (!fingerprints.has(file)) removeCachedSessionFile(registry, file);
  }

  const running = new Set(runningSessionIds());
  for (const [file, fingerprint] of fingerprints) {
    if (registry.persistedSessionFingerprints.get(file) === fingerprint) continue;
    removeCachedSessionFile(registry, file);
    try {
      const manager = SessionManager.open(file);
      const { info, summary } = persistedMetadataFromManager(
        manager,
        running.has(manager.getSessionId()),
      );
      if (!info) continue;
      registry.persistedSessions.set(info.id, info);
      registry.persistedSessionSummaries.set(summary.id, summary);
    } catch {
      // A malformed or concurrently removed file is excluded until a later fingerprint change.
    }
  }

  registry.persistedSessionFingerprints.clear();
  for (const [file, fingerprint] of fingerprints) {
    registry.persistedSessionFingerprints.set(file, fingerprint);
  }
}

function startPersistedSessionCacheRefresh(
  registry: RegistryState,
  cacheKey: string,
): Promise<void> {
  if (registry.persistedSessionCacheTask) return registry.persistedSessionCacheTask;
  const task = (async () => {
    const fingerprints = await scanSessionFingerprints(cacheKey);
    if (registry.persistedSessionCacheKey !== cacheKey) return;
    for (const host of registry.sessions.values()) {
      if (host.isAlive) cacheHostedSession(registry, host, fingerprints);
    }
    if (
      registry.persistedSessionCacheReady &&
      fingerprintsMatch(registry.persistedSessionFingerprints, fingerprints)
    ) {
      return;
    }
    if (registry.persistedSessionCacheReady) {
      refreshChangedSessionFiles(registry, fingerprints);
      return;
    }

    const persisted = await SessionManager.listAll();
    if (registry.persistedSessionCacheKey !== cacheKey) return;
    const running = new Set(runningSessionIds());
    const nextSessions = new Map(persisted.map((session) => [session.id, session]));
    const nextSummaries = new Map(
      persisted.map((session) => [session.id, persistedSummary(session, running.has(session.id))]),
    );
    registry.persistedSessions.clear();
    for (const [id, info] of nextSessions) registry.persistedSessions.set(id, info);
    registry.persistedSessionSummaries.clear();
    for (const [id, summary] of nextSummaries) {
      registry.persistedSessionSummaries.set(id, summary);
    }
    registry.persistedSessionFingerprints.clear();
    for (const [file, fingerprint] of fingerprints) {
      registry.persistedSessionFingerprints.set(file, fingerprint);
    }
    for (const host of registry.sessions.values()) {
      if (host.isAlive) cacheHostedSession(registry, host);
    }
    registry.persistedSessionCacheReady = true;
  })().finally(() => {
    if (registry.persistedSessionCacheTask === task) {
      registry.persistedSessionCacheTask = undefined;
    }
  });
  registry.persistedSessionCacheTask = task;
  return task;
}

async function ensurePersistedSessionCache(): Promise<RegistryState> {
  const registry = state();
  const cacheKey = ensureSessionCacheScope(registry);
  if (!registry.persistedSessionCacheReady) {
    await startPersistedSessionCacheRefresh(registry, cacheKey);
  } else if (!registry.persistedSessionCacheTask) {
    // Active hosts are overlaid synchronously below. Cold files are revalidated in the
    // background so filesystem latency can never hold the list RPC on its critical path.
    void startPersistedSessionCacheRefresh(registry, cacheKey).catch((error: unknown) => {
      console.error("Pi session metadata refresh failed.", error);
    });
  }
  return registry;
}

export async function listSessions(): Promise<{
  sessions: PiSessionSummary[];
  runningSessionIds: string[];
}> {
  const registry = await ensurePersistedSessionCache();
  const runningIds = runningSessionIds();
  const running = new Set(runningIds);
  const summaries = new Map(
    [...registry.persistedSessionSummaries].map(([id, summary]) => [
      id,
      summary.running === running.has(id) ? summary : { ...summary, running: running.has(id) },
    ]),
  );
  for (const host of registry.sessions.values()) {
    if (host.isAlive) summaries.set(host.id, host.summary());
  }
  return {
    sessions: [...summaries.values()].sort((left, right) =>
      right.modified.localeCompare(left.modified),
    ),
    runningSessionIds: runningIds,
  };
}

export async function listModels(cwd: string): Promise<PiModelListResponse> {
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

function isWorkbenchDisplayOnlyCustomType(customType: string): boolean {
  return (
    customType === WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE ||
    customType === WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE
  );
}

function historyFromManager(manager: SessionManager): PiSessionHistory {
  const context = manager.buildSessionContext();
  const messages: PiAgentMessage[] = [];
  const entryIds: string[] = [];
  const entryCompletedAts: Array<number | null> = [];
  const toolTimings: PiToolCallTiming[] = [];
  for (const entry of manager.getBranch()) {
    if (entry.type !== "custom") continue;
    if (entry.customType === TOOL_TIMING_CUSTOM_TYPE) {
      if (!entry.data || typeof entry.data !== "object") continue;
      const timing = entry.data as Partial<PiToolCallTiming>;
      if (
        typeof timing.toolCallId !== "string" ||
        typeof timing.startedAt !== "number" ||
        !Number.isFinite(timing.startedAt) ||
        typeof timing.completedAt !== "number" ||
        !Number.isFinite(timing.completedAt) ||
        timing.completedAt < timing.startedAt
      ) {
        continue;
      }
      toolTimings.push({
        toolCallId: timing.toolCallId,
        startedAt: timing.startedAt,
        completedAt: timing.completedAt,
      });
    }
  }
  for (const entry of manager.buildContextEntries()) {
    const projectedMessages =
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
    const completedAt = Date.parse(entry.timestamp);
    for (const message of projectedMessages) {
      messages.push(message);
      entryIds.push(entry.id);
      entryCompletedAts.push(Number.isFinite(completedAt) ? completedAt : null);
    }
  }
  return {
    sessionId: manager.getSessionId(),
    context: {
      // Response.json performs the required serialization. Avoiding an additional
      // stringify/parse pass here matters for multi-megabyte conversation histories.
      messages,
      entryIds,
      entryCompletedAts,
      toolTimings,
      thinkingLevel: context.thinkingLevel,
      model: context.model,
    },
  };
}

function historyEventTime(message: PiAgentMessage, completedAt: number | null | undefined): number {
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    return message.timestamp;
  }
  return typeof completedAt === "number" && Number.isFinite(completedAt) ? completedAt : 0;
}

function legacySessionEventsFromManager(manager: SessionManager): SessionEvent[] {
  const history = historyFromManager(manager);
  return history.context.messages.map((message, seq) => ({
    type: "message",
    seq,
    time: historyEventTime(message, history.context.entryCompletedAts?.[seq]),
    data: message,
  }));
}

export async function getSessionHistory(id: string): Promise<PiSessionHistory> {
  const live = state().sessions.get(id);
  if (live?.isAlive) return historyFromManager(live.session.sessionManager);
  const info = await persistedSession(id);
  if (!info) throw new PiServerError("pi_session_not_found", 404);
  return historyFromManager(SessionManager.open(info.path));
}

export async function getSessionEvents(id: string): Promise<SessionEvent[]> {
  const live = state().sessions.get(id);
  if (live?.isAlive) return [...live.canonicalEvents];
  const info = await persistedSession(id);
  if (!info) throw new PiServerError("pi_session_not_found", 404);
  const manager = SessionManager.open(info.path);
  const initialized = initializeSessionEventJournal(
    manager,
    legacySessionEventsFromManager(manager),
  );
  if (initialized.error !== undefined) throw initialized.error;
  return initialized.events;
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
    if (
      custom?.customType === WORKBENCH_COMPOSER_USER_CUSTOM_TYPE ||
      custom?.customType === LEGACY_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE
    ) {
      const details = parseWorkbenchComposerUserDetails(custom.details);
      if (details) {
        projections.set(details.submissionId, {
          version: 1,
          submissionId: details.submissionId,
          sourceText: details.sourceText,
          ...(details.document === undefined ? {} : { document: details.document }),
          hidden: true,
        });
        if (!projectionOrder.includes(details.submissionId)) {
          projectionOrder.push(details.submissionId);
        }
      }
    } else if (custom?.customType === WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE) {
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
    .sort((left, right) => Number(right.id === currentLeafId) - Number(left.id === currentLeafId));
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
          event.type === "message" && event.entryId !== contextMessageEvents[index]?.event.entryId,
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

export async function getSessionEventBranches(id: string): Promise<SessionHistoryBranches> {
  const live = state().sessions.get(id);
  if (live?.isAlive) return sessionEventBranchesFromManager(live.session.sessionManager);
  const info = await persistedSession(id);
  if (!info) throw new PiServerError("pi_session_not_found", 404);
  const manager = SessionManager.open(info.path);
  const initialized = initializeSessionEventJournal(
    manager,
    legacySessionEventsFromManager(manager),
  );
  if (initialized.error !== undefined) throw initialized.error;
  return sessionEventBranchesFromManager(manager);
}

export async function regenerateSession(id: string, messageId: string): Promise<void> {
  const host = await getOrStartSession(id);
  await host.regenerate(messageId);
}

export async function selectSessionBranch(id: string, leafId: string): Promise<void> {
  const host = await getOrStartSession(id);
  await host.selectBranch(leafId);
}

export async function renameSession(id: string, name: string): Promise<number> {
  const normalized = name.trim();
  const live = state().sessions.get(id);
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

export async function deleteSession(id: string): Promise<void> {
  const live = state().sessions.get(id);
  const info = await persistedSession(id);
  if (!live && !info) throw new PiServerError("pi_session_not_found", 404);
  await live?.shutdown();
  // Remove durable workspace references first. If deleting the session log then
  // fails, the next authoritative session reconciliation can safely reattach it;
  // the inverse order can leave an unrecoverable ghost session in workspace state.
  await getWorkspaceStore().removeSession(id);
  if (info?.path && existsSync(info.path)) unlinkSync(info.path);
  const registry = state();
  registry.persistedSessions.delete(id);
  registry.persistedSessionSummaries.delete(id);
  if (info?.path) registry.persistedSessionFingerprints.delete(info.path);
  try {
    getStreamHub().publishHost({ type: "host/session-removed", sessionId: id });
  } catch {
    // session.list remains the authoritative recovery path.
  }
}

export async function sendPrompt(
  id: string,
  message: string,
  images?: PiImageContent[],
  selection?: PiModelSelection,
): Promise<void> {
  if (!message.trim() && !images?.length) throw new PiServerError("pi_empty_prompt", 400);
  const host = await getOrStartSession(id);
  await host.prompt(message, images, selection);
}

export async function cancelSession(id: string): Promise<void> {
  const host = state().sessions.get(id);
  if (!host?.isAlive) return;
  await host.cancel();
}

export async function selectSessionModel(
  id: string,
  selection: { provider: string; model: string; reasoningEffort?: string },
): Promise<void> {
  const host = await getOrStartSession(id);
  await host.selectModel(selection);
}

export async function queuePrompt(
  id: string,
  mode: PiQueueMode,
  prompt: PiQueuedPrompt,
): Promise<void> {
  if (!prompt.message.trim() && !prompt.images?.length) {
    throw new PiServerError("pi_empty_prompt", 400);
  }
  const host = await getOrStartSession(id);
  await host.submit(mode, prompt, undefined, { requireRunning: true });
}

/** Decide prompt-vs-queue against one live HostedPiSession state without a stale list snapshot. */
export async function submitPrompt(
  id: string,
  mode: PiQueueMode,
  prompt: PiQueuedPrompt,
  provenance?: PromptSubmissionProvenance,
): Promise<PromptSubmissionResult> {
  const composer = provenance?.composer;
  if (
    !prompt.message.trim() &&
    !prompt.images?.length &&
    !(composer && hasWorkbenchComposerSemantics(composer))
  ) {
    throw new PiServerError("pi_empty_prompt", 400);
  }
  const host = await getOrStartSession(id);
  return host.submit(mode, prompt, provenance);
}

export async function replacePromptQueue(
  id: string,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
): Promise<void> {
  const host = await getOrStartSession(id);
  await host.replaceQueue(steering, followUp);
}

export async function setPromptQueuePaused(
  id: string,
  paused: boolean,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
): Promise<void> {
  const host = await getOrStartSession(id);
  await host.setQueuePaused(paused, steering, followUp);
}

export async function steerQueuedPrompt(
  id: string,
  prompt: PiQueuedPrompt,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
): Promise<void> {
  if (!prompt.message.trim() && !prompt.images?.length) {
    throw new PiServerError("pi_empty_prompt", 400);
  }
  const host = await getOrStartSession(id);
  await host.steerQueued(prompt, steering, followUp);
}

export async function updatePromptQueueItem(
  id: string,
  itemId: string,
  mutation: PromptQueueMutation,
): Promise<void> {
  const host = await getOrStartSession(id);
  await host.updateQueueItem(itemId, mutation);
}

export function getRunningSessionIds(): string[] {
  return runningSessionIds();
}

export function getAttachedSessionCount(): number {
  return [...state().sessions.values()].filter((host) => host.isAlive).length;
}

export function subscribeRunningSessions(listener: RunningListener): () => void {
  state().runningListeners.add(listener);
  return () => state().runningListeners.delete(listener);
}

export type HostedSession = HostedPiSession;
