import {
  canonicalJson,
  REMOTE_PROTOCOL_LIMITS,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteConversationItemV1,
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
  const event = record(wrapper.event);
  const eventData = record(event?.data);
  const nestedMessage = record(eventData?.message);
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
