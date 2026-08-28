import {
  COMPOSER_COMMAND_EFFECTS,
  isComposerJsonValue,
  type ComposerCommandArgsBinding,
  type ComposerCommandArgsSchema,
  type ComposerCommandEffect,
  type ComposerCommandSubmission,
  type ComposerDocument,
  type ComposerDocumentNode,
  type ComposerJsonValue,
  type ComposerSubmission,
  type ComposerUserProjection,
} from "@/contracts/composer";

export const WORKBENCH_COMPOSER_RUN_CONFIG_KEY = "workbenchComposer";
export const LEGACY_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE = "workbench.composer-user.v1";
export const LEGACY_STRUCTURED_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE = "workbench.composer-user.v2";
export const WORKBENCH_COMPOSER_USER_CUSTOM_TYPE = "workbench.composer-user.v3";
export const LEGACY_WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE = "workbench.composer-resolution.v1";
export const WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE = "workbench.composer-resolution.v2";
export const LEGACY_WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE =
  "workbench.composer-command-response.v1";
export const WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE =
  "workbench.composer-command-response.v2";

export function isWorkbenchComposerUserCustomType(value: unknown): value is string {
  return (
    value === LEGACY_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE ||
    value === LEGACY_STRUCTURED_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE ||
    value === WORKBENCH_COMPOSER_USER_CUSTOM_TYPE
  );
}

export function isWorkbenchComposerResolutionCustomType(value: unknown): value is string {
  return (
    value === LEGACY_WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE ||
    value === WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE
  );
}

export function isWorkbenchComposerCommandResponseCustomType(value: unknown): value is string {
  return (
    value === LEGACY_WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE ||
    value === WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE
  );
}

export type WorkbenchComposerJsonValue = ComposerJsonValue;

/** JSON-Schema-compatible command argument description shared by catalog and Composer clients. */
export type WorkbenchComposerCommandArgsSchema = ComposerCommandArgsSchema;

/**
 * Identifies the primary free-text field rendered by the structured command parameter panel.
 * `consumeText` remains part of the wire contract for legacy clients that sent inline arguments.
 */
export type WorkbenchComposerCommandArgsBinding = ComposerCommandArgsBinding;

export type WorkbenchComposerCommandEffect = ComposerCommandEffect;

export type WorkbenchComposerCommandSubmission = ComposerCommandSubmission;
export type WorkbenchComposerDocumentNode = ComposerDocumentNode;

export type WorkbenchComposerSubmission = ComposerSubmission;

/** Display-only attachment persisted when preprocessing removes content from the Pi prompt. */
export interface WorkbenchComposerAttachmentProjection {
  data: string;
  mimeType: string;
  name?: string;
}

/** @deprecated Old composer markers used an image-specific field name. */
export type WorkbenchComposerImageProjection = WorkbenchComposerAttachmentProjection;

export interface WorkbenchComposerUserDetails {
  version: 1 | 2 | 3;
  submissionId: string;
  sourceText: string;
  text?: string;
  document?: ComposerDocument;
  commands?: readonly WorkbenchComposerCommandSubmission[];
  composer?: WorkbenchComposerSubmission;
  attachments?: WorkbenchComposerAttachmentProjection[];
  /** @deprecated Read-only compatibility for persisted v2 image markers. */
  images?: WorkbenchComposerImageProjection[];
  status?: "accepted";
}

export type WorkbenchComposerUserProjection = ComposerUserProjection;

export interface WorkbenchComposerCommandTrace {
  source: "workbench" | "agent";
  commandId: string;
  label: string;
  scope: "message" | "segment";
  effect: WorkbenchComposerCommandEffect;
  status: "success" | "execution-failed";
  args?: WorkbenchComposerJsonValue;
  failureReason?: WorkbenchComposerCommandFailureReason;
}

export interface WorkbenchComposerResolutionDetails {
  version: 2;
  submissionId: string;
  status: "completed" | "command_error" | "resolved";
  commandTrace: WorkbenchComposerCommandTrace[];
}

export type WorkbenchComposerCommandResponseStatus = "running" | "success" | "execution-failed";

export const WORKBENCH_COMPOSER_COMMAND_FAILURE_REASONS = [
  "context-too-small",
  "already-compacted",
  "cancelled",
  "model-unavailable",
  "authentication-failed",
  "quota-exhausted",
  "rate-limited",
  "network-error",
  "timeout",
  "provider-unavailable",
  "session-data-invalid",
  "summary-generation-failed",
  "reload-failed",
  "unknown",
] as const;

export type WorkbenchComposerCommandFailureReason =
  (typeof WORKBENCH_COMPOSER_COMMAND_FAILURE_REASONS)[number];

function normalizeWorkbenchComposerCommandFailureReason(
  value: unknown,
): WorkbenchComposerCommandFailureReason | undefined {
  // Normalize the short-lived pre-canonical name at the persistence boundary. Internally, manual
  // compaction uses the same `context-too-small` reason as the Context Policy RPC.
  if (value === "nothing-to-compact") return "context-too-small";
  return WORKBENCH_COMPOSER_COMMAND_FAILURE_REASONS.find((reason) => reason === value);
}

/** A user-visible outcome for an Agent built-in command. It intentionally excludes raw errors. */
export interface WorkbenchComposerCommandResponse {
  source: "agent";
  commandId: string;
  label: string;
  status: WorkbenchComposerCommandResponseStatus;
  /** Safe structured arguments retained for visible status and durable audit projections. */
  args?: WorkbenchComposerJsonValue;
  /** Stable, redacted failure classification. Raw runtime/provider errors never cross this wire. */
  failureReason?: WorkbenchComposerCommandFailureReason;
}

export interface WorkbenchComposerCommandResponseDetails extends WorkbenchComposerCommandResponse {
  version: 2;
  submissionId: string;
}

export interface WorkbenchResolvedInstruction {
  source: string;
  trust: "trusted-instruction";
  content: string;
}

/** A Skill selected through the trusted Composer command catalog for the current turn. */
export interface WorkbenchResolvedSkillSelection {
  invocationName: string;
  name: string;
  location: string;
  baseDir: string;
  selectedBy: "user";
}

export interface WorkbenchResolvedContext {
  source: string;
  trust: "trusted-config" | "untrusted-context";
  value: WorkbenchComposerJsonValue;
}

export interface WorkbenchResolvedAgentRequest {
  version: 1;
  userText: string;
  config: {
    mode?: string;
    model?: string;
    metadata: Record<string, WorkbenchComposerJsonValue>;
  };
  selectedSkills: WorkbenchResolvedSkillSelection[];
  instructions: WorkbenchResolvedInstruction[];
  trustedContext: WorkbenchResolvedContext[];
  untrustedContext: WorkbenchResolvedContext[];
  commandTrace: WorkbenchComposerCommandTrace[];
}

export function hasWorkbenchComposerSemantics(submission: WorkbenchComposerSubmission): boolean {
  return (
    submission.commands.length > 0 ||
    submission.mode !== undefined ||
    submission.model !== undefined ||
    submission.context.length > 0 ||
    Object.keys(submission.metadata).length > 0
  );
}

export function hasWorkbenchComposerDocument(submission: WorkbenchComposerSubmission): boolean {
  return submission.document !== undefined;
}

export function composerDocumentMatchesCommands(submission: WorkbenchComposerSubmission): boolean {
  if (!submission.document) return true;
  const documentCommands = submission.document
    .filter(
      (node): node is Extract<WorkbenchComposerDocumentNode, { type: "command" }> =>
        node.type === "command" && node.inactive !== true,
    )
    .map(({ inactive: _inactive, type: _type, ...command }) => command);

  // The compiler marks superseded display tokens explicitly. Every remaining active document
  // command must therefore match the executable projection one-for-one and in order.
  return (
    documentCommands.length === submission.commands.length &&
    documentCommands.every((command, index) => {
      const projected = submission.commands[index];
      return (
        projected !== undefined &&
        command.id === projected.id &&
        command.commandId === projected.commandId &&
        command.label === projected.label &&
        command.scope === projected.scope &&
        command.source === projected.source &&
        JSON.stringify(command.args) === JSON.stringify(projected.args)
      );
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ComposerWireGeneration = "legacy-pi" | "agent" | "either";

function normalizeComposerCommandSource(
  source: unknown,
  generation: ComposerWireGeneration,
): "workbench" | "agent" | undefined {
  if (source === "workbench") return source;
  if (source === "agent" && generation !== "legacy-pi") return source;
  if (source === "pi" && generation !== "agent") return "agent";
  return undefined;
}

function composerCommand(
  value: unknown,
  generation: ComposerWireGeneration = "either",
): WorkbenchComposerCommandSubmission | undefined {
  if (!isRecord(value)) return undefined;
  const { id, commandId, label, scope, source, args } = value;
  const normalizedSource = normalizeComposerCommandSource(source, generation);
  if (
    typeof id !== "string" ||
    typeof commandId !== "string" ||
    typeof label !== "string" ||
    (scope !== "message" && scope !== "segment") ||
    normalizedSource === undefined ||
    (args !== undefined && !isComposerJsonValue(args))
  ) {
    return undefined;
  }
  return {
    id,
    commandId,
    label,
    scope,
    source: normalizedSource,
    ...(args === undefined ? {} : { args }),
  };
}

function composerDocumentNode(
  value: unknown,
  generation: ComposerWireGeneration,
): WorkbenchComposerDocumentNode | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "text" && typeof value.text === "string") {
    return { type: "text", text: value.text };
  }
  if (value.type === "command") {
    if (value.inactive !== undefined && value.inactive !== true) return undefined;
    const command = composerCommand(value, generation);
    return command
      ? {
          type: "command",
          ...command,
          ...(value.inactive === true ? { inactive: true as const } : {}),
        }
      : undefined;
  }
  if (value.type === "command-argument") {
    const { id, commandNodeId, field, text } = value;
    return typeof id === "string" &&
      typeof commandNodeId === "string" &&
      typeof field === "string" &&
      typeof text === "string"
      ? { type: "command-argument", id, commandNodeId, field, text }
      : undefined;
  }
  if (value.type === "mention" || value.type === "attachment") {
    const { id, value: entityValue, label } = value;
    const kind = value.type === "mention" ? value.mentionType : value.attachmentType;
    if (
      typeof id !== "string" ||
      typeof kind !== "string" ||
      typeof entityValue !== "string" ||
      typeof label !== "string"
    ) {
      return undefined;
    }
    return value.type === "mention"
      ? { type: "mention", id, mentionType: kind, value: entityValue, label }
      : { type: "attachment", id, attachmentType: kind, value: entityValue, label };
  }
  return undefined;
}

function parseComposerDocument(
  value: unknown,
  generation: ComposerWireGeneration,
): WorkbenchComposerDocumentNode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const document = value.map((node) => composerDocumentNode(node, generation));
  return document.some((node) => node === undefined)
    ? undefined
    : (document as WorkbenchComposerDocumentNode[]);
}

/** Reads both current Agent documents and persisted Pi documents into the canonical model. */
export function parseWorkbenchComposerDocument(
  value: unknown,
): WorkbenchComposerDocumentNode[] | undefined {
  return parseComposerDocument(value, "either");
}

export function parseWorkbenchComposerSubmission(
  value: unknown,
): WorkbenchComposerSubmission | undefined {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return undefined;
  if (
    typeof value.sourceText !== "string" ||
    typeof value.text !== "string" ||
    (value.mode !== undefined && typeof value.mode !== "string") ||
    (value.model !== undefined && typeof value.model !== "string") ||
    (value.document !== undefined && !Array.isArray(value.document)) ||
    !Array.isArray(value.context) ||
    !Array.isArray(value.commands) ||
    !isRecord(value.metadata)
  ) {
    return undefined;
  }
  const generation = value.version === 1 ? "legacy-pi" : "agent";
  const document =
    value.document === undefined ? undefined : parseComposerDocument(value.document, generation);
  const context = value.context.flatMap((item) => {
    if (!isRecord(item) || typeof item.type !== "string" || !isComposerJsonValue(item.value)) {
      return [];
    }
    return [{ type: item.type, value: item.value }];
  });
  const commands = value.commands.map((command) => composerCommand(command, generation));
  if (
    (value.document !== undefined && document === undefined) ||
    context.length !== value.context.length ||
    commands.some((command) => command === undefined) ||
    !Object.values(value.metadata).every(isComposerJsonValue)
  ) {
    return undefined;
  }
  return {
    version: 2,
    ...(document === undefined ? {} : { document: document as WorkbenchComposerDocumentNode[] }),
    sourceText: value.sourceText,
    text: value.text,
    ...(value.mode === undefined ? {} : { mode: value.mode }),
    ...(value.model === undefined ? {} : { model: value.model }),
    context,
    metadata: value.metadata as Record<string, WorkbenchComposerJsonValue>,
    commands: commands as WorkbenchComposerCommandSubmission[],
  };
}

function composerAttachmentProjection(
  value: unknown,
): WorkbenchComposerAttachmentProjection | undefined {
  if (
    !isRecord(value) ||
    typeof value.data !== "string" ||
    typeof value.mimeType !== "string" ||
    (value.name !== undefined && typeof value.name !== "string")
  ) {
    return undefined;
  }
  return {
    data: value.data,
    mimeType: value.mimeType,
    ...(value.name === undefined ? {} : { name: value.name }),
  };
}

export function workbenchComposerSubmissionFromRunConfig(
  runConfig: unknown,
): WorkbenchComposerSubmission | undefined {
  if (!isRecord(runConfig) || !isRecord(runConfig.custom)) return undefined;
  return parseWorkbenchComposerSubmission(runConfig.custom[WORKBENCH_COMPOSER_RUN_CONFIG_KEY]);
}

export function compiledComposerTextFromRunConfig(runConfig: unknown): string | undefined {
  return workbenchComposerSubmissionFromRunConfig(runConfig)?.text;
}

export function parseWorkbenchComposerUserDetails(
  value: unknown,
): WorkbenchComposerUserDetails | undefined {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2 && value.version !== 3) ||
    typeof value.submissionId !== "string" ||
    typeof value.sourceText !== "string"
  ) {
    return undefined;
  }
  if (value.version === 1) {
    return { version: 1, submissionId: value.submissionId, sourceText: value.sourceText };
  }
  const generation = value.version === 2 ? "legacy-pi" : "agent";
  const document = parseComposerDocument(value.document, generation);
  const commands = Array.isArray(value.commands)
    ? value.commands.map((command) => composerCommand(command, generation))
    : [];
  const composer = parseWorkbenchComposerSubmission(value.composer);
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.map(composerAttachmentProjection)
    : [];
  const images = Array.isArray(value.images) ? value.images.map(composerAttachmentProjection) : [];
  if (
    typeof value.text !== "string" ||
    value.status !== "accepted" ||
    document === undefined ||
    commands.some((command) => command === undefined) ||
    attachments.some((attachment) => attachment === undefined) ||
    images.some((image) => image === undefined)
  ) {
    return undefined;
  }
  return {
    version: value.version,
    submissionId: value.submissionId,
    sourceText: value.sourceText,
    text: value.text,
    document,
    commands: commands as WorkbenchComposerCommandSubmission[],
    ...(composer === undefined ? {} : { composer }),
    ...(value.attachments === undefined
      ? {}
      : { attachments: attachments as WorkbenchComposerAttachmentProjection[] }),
    ...(value.images === undefined ? {} : { images: images as WorkbenchComposerImageProjection[] }),
    status: "accepted",
  };
}

export function parseWorkbenchComposerUserProjection(
  value: unknown,
): WorkbenchComposerUserProjection | undefined {
  if (!isRecord(value)) return undefined;
  if (
    (value.version !== 1 && value.version !== 2) ||
    value.hidden !== true ||
    typeof value.submissionId !== "string" ||
    typeof value.sourceText !== "string"
  ) {
    return undefined;
  }
  const generation = value.version === 1 ? "legacy-pi" : "agent";
  const document =
    value.document === undefined ? undefined : parseComposerDocument(value.document, generation);
  if (value.document !== undefined && document === undefined) return undefined;
  return {
    version: 2,
    submissionId: value.submissionId,
    sourceText: value.sourceText,
    ...(document === undefined ? {} : { document }),
    hidden: true,
  };
}

function commandTraceEntry(
  value: unknown,
  generation: ComposerWireGeneration,
): WorkbenchComposerCommandTrace | undefined {
  if (!isRecord(value)) return undefined;
  const { source, commandId, label, scope, effect, status, args, failureReason } = value;
  const normalizedSource = normalizeComposerCommandSource(source, generation);
  const normalizedFailureReason = normalizeWorkbenchComposerCommandFailureReason(failureReason);
  if (
    normalizedSource === undefined ||
    typeof commandId !== "string" ||
    typeof label !== "string" ||
    (scope !== "message" && scope !== "segment") ||
    !COMPOSER_COMMAND_EFFECTS.some((candidate) => candidate === effect) ||
    (status !== "success" && status !== "execution-failed") ||
    (args !== undefined && !isComposerJsonValue(args)) ||
    (failureReason !== undefined &&
      (status !== "execution-failed" || normalizedFailureReason === undefined))
  ) {
    return undefined;
  }
  return {
    source: normalizedSource,
    commandId,
    label,
    scope,
    effect: effect as WorkbenchComposerCommandEffect,
    status,
    ...(args === undefined ? {} : { args }),
    ...(normalizedFailureReason === undefined ? {} : { failureReason: normalizedFailureReason }),
  };
}

export function parseWorkbenchComposerResolutionDetails(
  value: unknown,
): WorkbenchComposerResolutionDetails | undefined {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    typeof value.submissionId !== "string" ||
    (value.status !== "completed" &&
      value.status !== "command_error" &&
      value.status !== "resolved") ||
    !Array.isArray(value.commandTrace)
  ) {
    return undefined;
  }
  const generation = value.version === 1 ? "legacy-pi" : "agent";
  const commandTrace = value.commandTrace.map((entry) => commandTraceEntry(entry, generation));
  if (commandTrace.some((entry) => entry === undefined)) return undefined;
  return {
    version: 2,
    submissionId: value.submissionId,
    status: value.status,
    commandTrace: commandTrace as WorkbenchComposerCommandTrace[],
  };
}

export function parseWorkbenchComposerCommandResponseDetails(
  value: unknown,
): WorkbenchComposerCommandResponseDetails | undefined {
  const normalizedFailureReason = isRecord(value)
    ? normalizeWorkbenchComposerCommandFailureReason(value.failureReason)
    : undefined;
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    typeof value.submissionId !== "string" ||
    (value.version === 1 ? value.source !== "pi" : value.source !== "agent") ||
    typeof value.commandId !== "string" ||
    typeof value.label !== "string" ||
    (value.status !== "running" &&
      value.status !== "success" &&
      value.status !== "execution-failed") ||
    (value.args !== undefined && !isComposerJsonValue(value.args)) ||
    (value.failureReason !== undefined &&
      (value.status !== "execution-failed" || normalizedFailureReason === undefined))
  ) {
    return undefined;
  }
  return {
    version: 2,
    submissionId: value.submissionId,
    source: "agent",
    commandId: value.commandId,
    label: value.label,
    status: value.status,
    ...(value.args === undefined ? {} : { args: value.args }),
    ...(normalizedFailureReason === undefined ? {} : { failureReason: normalizedFailureReason }),
  };
}
