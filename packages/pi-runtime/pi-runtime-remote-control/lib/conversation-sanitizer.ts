import {
  canonicalJson,
  REMOTE_PROTOCOL_LIMITS,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteConversationBlockV1,
  RemoteConversationItemV1,
  RemoteConversationNodeV1,
  RemoteJsonValue,
  RemoteOrdinaryQuestionV1,
  RemoteToolCallV1,
} from "@workbench/remote-control-contracts/protocol";

const MAXIMUM_LABEL_BYTES = 512;
const MAXIMUM_QUESTION_BYTES = 4 * 1024;
const MAXIMUM_BASH_INPUT_BYTES = 32 * 1024;
const MAXIMUM_TOOL_CALLS = 32;
const IDENTIFIER = /^[\x21-\x7e]{1,128}$/u;

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function identifier(value: unknown, fallback: string): string {
  return typeof value === "string" && IDENTIFIER.test(value) ? value : fallback;
}

function timestamp(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.endsWith("Z") && Number.isFinite(Date.parse(value))) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return fallback;
}

function bounded(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && remoteUtf8ByteLength(value) <= maximumBytes
  );
}

function truncateUtf8(
  value: string,
  maximumBytes: number,
): { readonly value: string; readonly truncated: boolean } {
  if (remoteUtf8ByteLength(value) <= maximumBytes) return { value, truncated: false };
  const characters: string[] = [];
  let usedBytes = 0;
  for (const character of value) {
    const characterBytes = remoteUtf8ByteLength(character);
    if (usedBytes + characterBytes > maximumBytes) break;
    characters.push(character);
    usedBytes += characterBytes;
  }
  return { value: characters.join(""), truncated: true };
}

function textContent(content: unknown): string | undefined {
  if (typeof content === "string") return content || undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => record(part))
    .filter(
      (part): part is Readonly<Record<string, unknown>> =>
        part?.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text as string)
    .join("\n");
  return text || undefined;
}

function visibleMessageText(content: unknown) {
  const text = textContent(content);
  return text ? truncateUtf8(text, REMOTE_PROTOCOL_LIMITS.assistantTextBytes) : undefined;
}

function toolName(value: unknown): string {
  return bounded(value, MAXIMUM_LABEL_BYTES) ? value : "tool";
}

function serializeToolArguments(value: unknown, maximumBytes: number) {
  try {
    return truncateUtf8(canonicalJson(value ?? {}), maximumBytes);
  } catch {
    return { value: "", truncated: true } as const;
  }
}

function remoteJson(
  value: unknown,
  maximumBytes: number,
): { readonly value: RemoteJsonValue; readonly truncated: boolean } {
  try {
    const serialized = canonicalJson(value ?? null);
    if (remoteUtf8ByteLength(serialized) <= maximumBytes) {
      return { value: JSON.parse(serialized) as RemoteJsonValue, truncated: false };
    }
    const truncated = truncateUtf8(serialized, maximumBytes);
    return { value: truncated.value, truncated: true };
  } catch {
    return { value: "", truncated: true };
  }
}

function remoteError(value: unknown): { readonly code: string; readonly message: string } {
  const candidate = record(value);
  const message = truncateUtf8(
    typeof candidate?.message === "string" ? candidate.message : "Conversation error",
    REMOTE_PROTOCOL_LIMITS.activitySummaryBytes,
  ).value;
  return {
    code: bounded(candidate?.code, MAXIMUM_LABEL_BYTES) ? candidate.code : "remote-error",
    message,
  };
}

function remoteConversationBlock(
  value: unknown,
  nodeIndex: number,
  blockIndex: number,
): RemoteConversationBlockV1 | undefined {
  const block = record(value);
  if (!block || typeof block.kind !== "string") return undefined;
  const key = identifier(block.key, `remote-block-${nodeIndex}-${blockIndex}`);
  switch (block.kind) {
    case "text": {
      if (typeof block.text !== "string" || block.text.length === 0) return undefined;
      const text = truncateUtf8(block.text, REMOTE_PROTOCOL_LIMITS.assistantTextBytes);
      return {
        kind: "text",
        key,
        text: text.value,
        ...(text.truncated ? { truncated: true } : {}),
      };
    }
    case "reasoning": {
      if (typeof block.text !== "string") return undefined;
      const text = truncateUtf8(block.text, REMOTE_PROTOCOL_LIMITS.assistantTextBytes);
      const status = ["running", "complete", "incomplete"].includes(String(block.status))
        ? (block.status as "running" | "complete" | "incomplete")
        : undefined;
      return {
        kind: "reasoning",
        key,
        text: text.value,
        ...(status ? { status } : {}),
        ...(text.truncated ? { truncated: true } : {}),
      };
    }
    case "tool-call": {
      const argumentsText = truncateUtf8(
        typeof block.argumentsText === "string" ? block.argumentsText : "",
        REMOTE_PROTOCOL_LIMITS.toolArgumentsBytes,
      );
      const result =
        block.result === undefined
          ? undefined
          : remoteJson(block.result, REMOTE_PROTOCOL_LIMITS.toolOutputBytes);
      const sourceStatus = String(block.status);
      const status = ["running", "complete", "incomplete", "error"].includes(sourceStatus)
        ? (sourceStatus as "running" | "complete" | "incomplete" | "error")
        : "incomplete";
      return {
        kind: "tool-call",
        key,
        callId: identifier(block.callId, `remote-tool-${nodeIndex}-${blockIndex}`),
        toolName: toolName(block.toolName),
        argumentsText: argumentsText.value,
        status,
        ...(result ? { result: result.value } : {}),
        ...(block.error === undefined ? {} : { error: remoteError(block.error) }),
        truncated: argumentsText.truncated || (result?.truncated ?? false),
      };
    }
    case "data": {
      if (block.name !== "workbench.pi-context-trace-event") return undefined;
      const data = remoteJson(block.data, REMOTE_PROTOCOL_LIMITS.toolArgumentsBytes);
      return data.truncated ? undefined : { kind: "data", key, name: block.name, data: data.value };
    }
    case "error":
      return { kind: "error", key, error: remoteError(block.error) };
    default:
      return undefined;
  }
}

function remoteConversationNode(
  source: Readonly<Record<string, unknown>>,
  index: number,
  fallbackTimestamp: string,
): RemoteConversationNodeV1 | undefined {
  if (
    !["user", "assistant", "system", "command", "compaction", "error"].includes(String(source.kind))
  ) {
    return undefined;
  }
  const kind = source.kind as RemoteConversationNodeV1["kind"];
  const itemId = identifier(source.key, `remote-node-${index}`);
  const createdAt = timestamp(source.createdAt, fallbackTimestamp);
  const blocks = Array.isArray(source.blocks)
    ? source.blocks
        .slice(0, 128)
        .map((block, blockIndex) => remoteConversationBlock(block, index, blockIndex))
        .filter((block): block is RemoteConversationBlockV1 => block !== undefined)
    : undefined;
  const status =
    kind === "assistant"
      ? ["running", "complete", "incomplete", "error"].includes(String(source.status))
        ? (source.status as "running" | "complete" | "incomplete" | "error")
        : "incomplete"
      : kind === "command"
        ? ["running", "complete", "error"].includes(String(source.status))
          ? (source.status as "running" | "complete" | "error")
          : "error"
        : undefined;
  const name = bounded(source.name, MAXIMUM_LABEL_BYTES) ? source.name : undefined;
  const commandInput =
    typeof source.input === "string"
      ? truncateUtf8(source.input, REMOTE_PROTOCOL_LIMITS.toolArgumentsBytes).value
      : undefined;
  const commandOutput =
    typeof source.output === "string"
      ? truncateUtf8(source.output, REMOTE_PROTOCOL_LIMITS.toolOutputBytes).value
      : undefined;
  const summary =
    typeof source.summary === "string"
      ? truncateUtf8(source.summary, REMOTE_PROTOCOL_LIMITS.activitySummaryBytes).value
      : undefined;
  return {
    type: "conversation-node",
    itemId,
    createdAt,
    kind,
    ...(blocks && blocks.length > 0 ? { blocks } : {}),
    ...(status ? { status } : {}),
    ...(name ? { name } : {}),
    ...(commandInput !== undefined ? { input: commandInput } : {}),
    ...(commandOutput !== undefined ? { output: commandOutput } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(kind === "error" ? { error: remoteError(source.error) } : {}),
  };
}

function assistantToolCalls(
  content: unknown,
  itemIndex: number,
): readonly RemoteToolCallV1[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter((part) => record(part)?.type === "toolCall")
    .slice(0, MAXIMUM_TOOL_CALLS);
  if (parts.length === 0) return undefined;

  let remainingArgumentBytes = REMOTE_PROTOCOL_LIMITS.toolArgumentsBytes;
  return parts.map((rawPart, toolIndex) => {
    const part = record(rawPart)!;
    const serialized = serializeToolArguments(part.arguments, remainingArgumentBytes);
    remainingArgumentBytes -= remoteUtf8ByteLength(serialized.value);
    return {
      toolCallId: identifier(part.id, `remote-tool-${itemIndex}-${toolIndex}`),
      toolName: toolName(part.name),
      arguments: serialized.value,
      truncated: serialized.truncated,
    };
  });
}

function systemStatus(
  itemId: string,
  createdAt: string,
  status: "failed",
): RemoteConversationItemV1 {
  return { type: "system-status", itemId, createdAt, status };
}

function ordinaryQuestion(
  source: Readonly<Record<string, unknown>>,
  itemId: string,
  sessionId: string,
): RemoteOrdinaryQuestionV1 | undefined {
  if (source.type !== "question/requested" || !Array.isArray(source.questions)) return undefined;
  const questions: Array<{
    questionId: string;
    prompt: string;
    options?: Array<{ optionId: string; label: string }>;
  }> = [];
  for (const rawQuestion of source.questions.slice(0, 32)) {
    const question = record(rawQuestion);
    if (!question) return undefined;
    const questionId = identifier(question.questionId ?? question.id, "");
    const prompt = question.prompt ?? question.question;
    if (!questionId || !bounded(prompt, MAXIMUM_QUESTION_BYTES)) return undefined;
    let options: Array<{ optionId: string; label: string }> | undefined;
    if (question.options !== undefined) {
      if (!Array.isArray(question.options) || question.options.length > 32) return undefined;
      options = [];
      for (const rawOption of question.options) {
        const option = record(rawOption);
        const optionId = identifier(option?.optionId ?? option?.value ?? option?.label, "");
        const label = option?.label ?? option?.value;
        if (!optionId || !bounded(label, MAXIMUM_LABEL_BYTES)) return undefined;
        options.push({ optionId, label });
      }
    }
    questions.push({ questionId, prompt, ...(options ? { options } : {}) });
  }
  if (questions.length === 0) return undefined;
  const expiresAt = timestamp(source.expiresAt, "");
  if (!expiresAt) return undefined;
  return {
    type: "ordinary-question",
    interactionId: identifier(source.interactionId ?? source.rpcId ?? itemId, itemId),
    sessionId,
    revision: identifier(source.revision, itemId),
    expiresAt,
    questions,
  };
}

export function sanitizePiConversationEntry(input: {
  readonly entry: unknown;
  readonly index: number;
  readonly sessionId: string;
  readonly fallbackTimestamp: string;
}): readonly RemoteConversationItemV1[] {
  const wrapper = record(input.entry);
  if (!wrapper) return [];
  const projectedNode = remoteConversationNode(wrapper, input.index, input.fallbackTimestamp);
  if (projectedNode) return [projectedNode];
  const event = record(wrapper.event);
  const eventData = record(event?.data);
  // The persisted Workbench journal contains several lifecycle records for one logical message.
  // Only message_end is the authoritative history entry; message_start, message_update and
  // turn_end otherwise project the same user/assistant content under different journal IDs.
  if (eventData?.message !== undefined && event?.type !== "message_end") return [];
  const nestedMessage = event?.type === "message_end" ? record(eventData?.message) : undefined;
  const source = nestedMessage ?? record(wrapper.message) ?? wrapper;
  const itemId = identifier(
    wrapper.entryId ?? event?.entryId ?? source.id,
    `remote-item-${input.index}`,
  );
  const createdAt = timestamp(
    source.timestamp ?? event?.time ?? wrapper.timestamp,
    input.fallbackTimestamp,
  );

  const question = ordinaryQuestion(source, itemId, input.sessionId);
  if (question) return [question];

  if (source.role === "user") {
    const text = visibleMessageText(source.content);
    return text
      ? [
          {
            type: "user-message",
            itemId,
            createdAt,
            text: text.value,
            ...(text.truncated ? { textTruncated: true } : {}),
            state: "complete",
          },
        ]
      : [];
  }

  if (source.role === "assistant") {
    const text = visibleMessageText(source.content);
    const toolCalls = assistantToolCalls(source.content, input.index);
    if (!text && !toolCalls) return [];
    return [
      {
        type: "assistant-message",
        itemId,
        createdAt,
        ...(text ? { text: text.value } : {}),
        ...(text?.truncated ? { textTruncated: true } : {}),
        ...(toolCalls ? { toolCalls } : {}),
        state:
          source.stopReason === undefined
            ? "streaming"
            : source.stopReason === "error"
              ? "failed"
              : "complete",
      },
    ];
  }

  if (source.role === "toolResult") {
    const rawOutput = textContent(source.content) ?? "";
    const output = truncateUtf8(rawOutput, REMOTE_PROTOCOL_LIMITS.toolOutputBytes);
    return [
      {
        type: "tool-result",
        itemId,
        createdAt,
        toolCallId: identifier(source.toolCallId, `remote-tool-result-${input.index}`),
        toolName: toolName(source.toolName),
        output: output.value,
        isError: source.isError === true,
        truncated: output.truncated,
      },
    ];
  }

  if (source.role === "bashExecution") {
    const rawInput = typeof source.command === "string" ? source.command : "";
    const rawOutput = typeof source.output === "string" ? source.output : "";
    const command = truncateUtf8(rawInput, MAXIMUM_BASH_INPUT_BYTES);
    const output = truncateUtf8(rawOutput, REMOTE_PROTOCOL_LIMITS.toolOutputBytes);
    return [
      {
        type: "tool-result",
        itemId,
        createdAt,
        toolCallId: identifier(source.toolCallId, `remote-bash-${input.index}`),
        toolName: "bash",
        input: command.value,
        output: output.value,
        isError: source.cancelled === true || Number(source.exitCode) > 0,
        truncated: source.truncated === true || command.truncated || output.truncated,
      },
    ];
  }

  if (source.type === "error" || source.error !== undefined) {
    return [systemStatus(itemId, createdAt, "failed")];
  }
  return [];
}
