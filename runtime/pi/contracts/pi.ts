import type {
  ComposerSubmission as WorkbenchComposerSubmission,
  ComposerUserProjection as WorkbenchComposerUserProjection,
} from "@/contracts/composer";
import type { ExecutionSessionOrigin } from "@/runtime/shared/execution";

export interface PiSessionSummary {
  id: string;
  cwd: string;
  workspace: PiWorkspaceSummary;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  transient: boolean;
  /** Pi-authoritative agent run state projected from AgentSession.isStreaming. */
  running: boolean;
  waitingForUserInput?: boolean;
  runTiming?: PiRunTiming;
  executionOrigin?: ExecutionSessionOrigin;
}

/** Server-authoritative timing snapshot for the currently active Pi run. */
export interface PiRunTiming {
  /** Epoch milliseconds recorded by the Workbench host when the run became active. */
  startedAt: number;
  /** Elapsed milliseconds calculated by the host when this snapshot was serialized. */
  elapsedMs: number;
}

export interface PiWorkspaceSummary {
  id: string;
  name: string;
  cwd: string;
  pinned?: boolean;
}

export interface PiTextContent {
  type: "text";
  text: string;
  textSignature?: string;
}

export interface PiThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

export interface PiImageContent {
  type: "image";
  data: string;
  mimeType: string;
  name?: string;
}

/** Display/preprocessing-only document content. Pi's model prompt never receives this part. */
export interface PiDocumentContent {
  type: "file";
  data: string;
  mimeType: "application/pdf";
  name?: string;
}

export interface PiToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
  namespace?: string;
}

export type PiAssistantContent =
  | PiTextContent
  | PiThinkingContent
  | PiImageContent
  | PiToolCallContent;

export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface PiAssistantMessageDiagnosticError {
  name?: string;
  message: string;
  stack?: string;
  code?: string | number;
}

export interface PiAssistantMessageDiagnostic {
  type: string;
  timestamp: number;
  error?: PiAssistantMessageDiagnosticError;
  details?: Record<string, unknown>;
}

export interface PiUserMessage {
  role: "user";
  content: string | Array<PiTextContent | PiImageContent>;
  timestamp?: number;
  workbenchComposer?: WorkbenchComposerUserProjection;
}

export interface PiAssistantMessage {
  role: "assistant";
  content: PiAssistantContent[];
  model?: string;
  provider?: string;
  usage?: PiUsage;
  stopReason?: string;
  rawStopReason?: string;
  errorMessage?: string;
  diagnostics?: PiAssistantMessageDiagnostic[];
  timestamp?: number;
}

export interface PiToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName?: string;
  content: Array<PiTextContent | PiImageContent>;
  isError?: boolean;
  details?: unknown;
  timestamp?: number;
}

export interface PiCustomMessage {
  role: "custom";
  customType: string;
  content: string | Array<PiTextContent | PiImageContent>;
  display: boolean;
  details?: unknown;
  timestamp?: number;
}

export const PI_CONVERSATION_EVENT_CUSTOM_TYPE = "workbench.conversation-event.v1";
export const PI_MODEL_CHANGED_EVENT = "model_changed";
export const PI_SESSION_FORKED_EVENT = "session_forked";

export interface PiModelChangeConversationEvent {
  kind: "model-change";
  provider?: string;
  model: string;
  previousProvider?: string;
  previousModel?: string;
}

export interface PiCompactionConversationEvent {
  kind: "compaction";
  reason: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
}

export interface PiForkConversationEvent {
  kind: "fork";
  sourceSessionId?: string;
  sourceEventSeq?: number;
}

export type PiConversationEvent =
  | PiModelChangeConversationEvent
  | PiCompactionConversationEvent
  | PiForkConversationEvent;

export interface PiBashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode?: number;
  cancelled?: boolean;
  timestamp?: number;
}

export type PiAgentMessage =
  | PiUserMessage
  | PiAssistantMessage
  | PiToolResultMessage
  | PiCustomMessage
  | PiBashExecutionMessage;

export interface PiToolCallTiming {
  toolCallId: string;
  startedAt: number;
  completedAt: number;
}

export interface PiSessionHistory {
  sessionId: string;
  context: {
    messages: PiAgentMessage[];
    entryIds: string[];
    entrySeqs?: Array<number | null>;
    entryCompletedAts?: Array<number | null>;
    entryFirstTokenAts?: Array<number | null>;
    toolTimings?: PiToolCallTiming[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

export interface PiModelSummary {
  provider: string;
  providerName: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  input?: Array<"text" | "image">;
}

export interface PiModelListResponse {
  models: PiModelSummary[];
  defaultModel: { provider: string; modelId: string } | null;
}

export interface PiApiErrorBody {
  error: {
    code: string;
  };
}

export interface PiEvent {
  type: string;
  sequence?: number;
  /** Authoritative epoch milliseconds from the server's canonical session event. */
  eventTime?: number;
  /** Server-authoritative timing for the active run when this event was published. */
  runTiming?: PiRunTiming;
  /** Browser-side raw JSON buffers for in-flight tool calls, keyed by content index. */
  rawToolArgsText?: Readonly<Record<string, string>>;
  [key: string]: unknown;
}

export const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export interface PiModelSelection {
  provider: string;
  modelId: string;
  thinkingLevel?: PiThinkingLevel;
}

export interface PiPromptCommand {
  type: "prompt";
  message: string;
  images?: PiImageContent[];
  model?: PiModelSelection;
}

export type PiQueueMode = "steer" | "followUp";

export interface PiQueuedPrompt {
  message: string;
  images?: PiImageContent[];
  documents?: PiDocumentContent[];
  composer?: WorkbenchComposerSubmission;
}

export interface PiQueueCommand extends PiQueuedPrompt {
  type: PiQueueMode;
}

export interface PiReplaceQueueCommand {
  type: "replaceQueue";
  steering: PiQueuedPrompt[];
  followUp: PiQueuedPrompt[];
}

export interface PiSetQueuePausedCommand {
  type: "setQueuePaused";
  paused: boolean;
  steering: PiQueuedPrompt[];
  followUp: PiQueuedPrompt[];
}

export interface PiSteerQueuedCommand {
  type: "steerQueued";
  prompt: PiQueuedPrompt;
  steering: PiQueuedPrompt[];
  followUp: PiQueuedPrompt[];
}

export interface PiCancelCommand {
  type: "cancel";
}
