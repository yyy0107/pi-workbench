import type {
  AppendMessage,
  MessageTiming,
  ThreadAssistantMessage,
  ThreadMessage,
  ThreadUserMessage,
  ToolCallMessagePart,
  ToolCallTiming,
} from "@assistant-ui/react";

import {
  LEGACY_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
  parseWorkbenchComposerCommandResponseDetails,
  parseWorkbenchComposerResolutionDetails,
  parseWorkbenchComposerUserDetails,
  workbenchComposerSubmissionFromRunConfig,
  WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
} from "../../../composer-request";
import type {
  WorkbenchComposerCommandResponseDetails,
  WorkbenchComposerSubmission,
} from "../../../composer-request";

import type {
  PiAgentMessage,
  PiAssistantMessage,
  PiImageContent,
  PiModelChangeConversationEvent,
  PiSessionHistory,
  PiToolResultMessage,
} from "../../contracts";
import { stripWorkspaceFeedbackContext } from "../../../../components/right-workspace/feedback/feedback-adapter";
import { PI_CONVERSATION_EVENT_CUSTOM_TYPE } from "../../contracts";
import { terminationFromAssistantMessage } from "../../message-termination";

import { parsePiConversationEvent } from "./conversation-events";
import { aggregatePiTurnStatistics } from "./session-statistics";

function messageDate(timestamp: number | undefined, index: number): Date {
  return new Date(timestamp ?? index);
}

function metadata(custom: Record<string, unknown> = {}) {
  return { custom };
}

export function workbenchComposerCommandResponseId(
  response: Pick<WorkbenchComposerCommandResponseDetails, "submissionId" | "commandId">,
): string {
  return `workbench-command-response:${response.submissionId}:${response.commandId}`;
}

export function workbenchComposerCommandResponseThreadMessage(
  response: WorkbenchComposerCommandResponseDetails,
  timestamp: number,
): ThreadMessage {
  return {
    id: workbenchComposerCommandResponseId(response),
    role: "system",
    content: [{ type: "text", text: "" }],
    createdAt: new Date(timestamp),
    metadata: metadata({
      piCustomType: WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
      workbenchComposerCommandResponse: response,
    }),
  };
}

export function upsertWorkbenchComposerCommandResponse(
  messages: readonly ThreadMessage[],
  response: WorkbenchComposerCommandResponseDetails,
  timestamp: number,
): ThreadMessage[] {
  const id = workbenchComposerCommandResponseId(response);
  const index = messages.findIndex((message) => message.id === id);
  const next = workbenchComposerCommandResponseThreadMessage(response, timestamp);
  if (index < 0) return [...messages, next];
  const current = messages[index];
  const updated = [...messages];
  updated[index] = current ? { ...next, createdAt: current.createdAt } : next;
  return updated;
}

export function hasRunningWorkbenchCompactCommandResponse(
  messages: readonly ThreadMessage[],
): boolean {
  return messages.some((message) => {
    const response = parseWorkbenchComposerCommandResponseDetails(
      message.metadata.custom.workbenchComposerCommandResponse,
    );
    return response?.commandId === "compact" && response.status === "running";
  });
}

function imageUrl(image: PiImageContent): string {
  if (image.data.startsWith("data:") || /^https?:\/\//i.test(image.data)) return image.data;
  return `data:${image.mimeType};base64,${image.data}`;
}

function messageContentText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(part.type === "text" && typeof part.text === "string"),
    )
    .map((part) => part.text)
    .join("\n");
}

function toolExecutionOutput(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;

  const candidate = result as { content?: unknown; details?: unknown };
  if (!Array.isArray(candidate.content)) return result;

  const text = messageContentText(candidate.content as readonly { type: string; text?: string }[]);
  return candidate.details === undefined ? text : { text, details: candidate.details };
}

function assistantStatus(message: PiAssistantMessage, streaming: boolean) {
  if (streaming) return { type: "running" } as const;
  switch (message.stopReason) {
    case "aborted":
      return { type: "incomplete", reason: "cancelled" } as const;
    case "length":
      return { type: "incomplete", reason: "length" } as const;
    case "error":
      return {
        type: "incomplete",
        reason: "error",
        error: message.errorMessage ?? "pi_response_error",
      } as const;
    default:
      return { type: "complete", reason: "unknown" } as const;
  }
}

function persistedMessageTiming(
  message: PiAssistantMessage,
  completedAt: number | null | undefined,
  firstTokenAt?: number | null,
): MessageTiming | undefined {
  const streamStartTime = message.timestamp;
  if (
    streamStartTime === undefined ||
    completedAt === undefined ||
    completedAt === null ||
    !Number.isFinite(streamStartTime) ||
    !Number.isFinite(completedAt) ||
    completedAt < streamStartTime
  ) {
    return undefined;
  }

  const totalStreamTime = completedAt - streamStartTime;
  const tokenCount = message.usage?.output;
  const firstTokenTime =
    firstTokenAt !== undefined &&
    firstTokenAt !== null &&
    Number.isFinite(firstTokenAt) &&
    firstTokenAt >= streamStartTime &&
    firstTokenAt <= completedAt
      ? firstTokenAt - streamStartTime
      : undefined;
  return {
    streamStartTime,
    ...(firstTokenTime === undefined ? {} : { firstTokenTime }),
    totalStreamTime,
    ...(tokenCount === undefined ? {} : { tokenCount }),
    ...(tokenCount === undefined || totalStreamTime <= 0
      ? {}
      : { tokensPerSecond: tokenCount / (totalStreamTime / 1_000) }),
    totalChunks: 0,
    toolCallCount: message.content.filter((part) => part.type === "toolCall").length,
  };
}

function reasoningProviderMetadata(timing: MessageTiming | undefined) {
  if (!timing) return undefined;
  const startedAt = Number.isFinite(timing.streamStartTime) ? timing.streamStartTime : undefined;
  const durationMs =
    timing.totalStreamTime !== undefined &&
    Number.isFinite(timing.totalStreamTime) &&
    timing.totalStreamTime >= 0
      ? timing.totalStreamTime
      : undefined;
  if (startedAt === undefined && durationMs === undefined) return undefined;

  return {
    pi: {
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(durationMs === undefined ? {} : { durationMs }),
    },
  };
}

export function piAssistantToThreadMessage(
  message: PiAssistantMessage,
  id: string,
  {
    optimistic = false,
    streaming = false,
    timing,
    toolTimingById,
    createdAt,
    eventSeq,
  }: Readonly<{
    optimistic?: boolean;
    streaming?: boolean;
    timing?: MessageTiming;
    toolTimingById?: ReadonlyMap<string, ToolCallTiming>;
    createdAt?: number;
    eventSeq?: number;
  }> = {},
): ThreadMessage {
  const termination = terminationFromAssistantMessage(message);
  const parallelTools = message.content.filter((part) => part.type === "toolCall");
  const parallelToolCount = parallelTools.length;
  const parallelToolBatchId = parallelTools[0]?.id;
  const parallelToolMetadata =
    parallelToolCount > 1 && parallelToolBatchId
      ? {
          providerMetadata: {
            pi: {
              parallelToolBatchId,
              parallelToolBatchSize: parallelToolCount,
            },
          },
        }
      : {};
  let content: ThreadAssistantMessage["content"] = message.content.map((part) => {
    switch (part.type) {
      case "text":
        return {
          type: "text" as const,
          text: part.text,
          status: streaming ? ({ type: "running" } as const) : ({ type: "complete" } as const),
        };
      case "thinking":
        const providerMetadata = reasoningProviderMetadata(timing);
        return {
          type: "reasoning" as const,
          text: part.redacted ? "" : part.thinking,
          status: streaming ? ({ type: "running" } as const) : ({ type: "complete" } as const),
          ...(providerMetadata === undefined ? {} : { providerMetadata }),
        };
      case "image":
        return { type: "image" as const, image: imageUrl(part) };
      case "toolCall":
        const toolTiming =
          toolTimingById?.get(part.id) ??
          (parallelToolCount !== 1 || message.timestamp === undefined
            ? undefined
            : { startedAt: message.timestamp });
        return {
          type: "tool-call" as const,
          toolCallId: part.id,
          toolName: part.name,
          args: part.arguments as ToolCallMessagePart["args"],
          argsText: JSON.stringify(part.arguments),
          ...parallelToolMetadata,
          ...(toolTiming ? { timing: toolTiming } : {}),
        };
    }
  });
  if (streaming && content.length === 0) {
    content = [{ type: "text", text: "", status: { type: "running" } }];
  }

  return {
    id,
    role: "assistant",
    content,
    status: assistantStatus(message, streaming),
    createdAt: messageDate(message.timestamp ?? createdAt, 0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      ...(optimistic ? { isOptimistic: true } : {}),
      ...(timing ? { timing } : {}),
      custom: {
        piMessageTimestamp: message.timestamp ?? null,
        ...(eventSeq === undefined ? {} : { piEventSeq: eventSeq }),
        piModel: message.model,
        piProvider: message.provider,
        ...(message.rawStopReason ? { piRawStopReason: message.rawStopReason } : {}),
        ...(message.diagnostics ? { piDiagnostics: message.diagnostics } : {}),
        ...(termination ? { piTermination: termination } : {}),
        ...(message.usage
          ? {
              piUsage: {
                input: message.usage.input,
                output: message.usage.output,
                cacheRead: message.usage.cacheRead,
                cacheWrite: message.usage.cacheWrite,
                totalTokens: message.usage.totalTokens,
              },
            }
          : {}),
      },
    },
  };
}

export type PiToolExecutionUpdate =
  | {
      state: "running";
      toolCallId: string;
      partialResult?: unknown;
      startedAt?: number;
    }
  | {
      state: "complete";
      toolCallId: string;
      result: unknown;
      isError: boolean;
      completedAt?: number;
    };

export function applyToolExecutionUpdate(
  messages: ThreadMessage[],
  update: PiToolExecutionUpdate,
): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    if (
      !message.content.some(
        (part) => part.type === "tool-call" && part.toolCallId === update.toolCallId,
      )
    ) {
      continue;
    }

    const output = toolExecutionOutput(
      update.state === "running" ? update.partialResult : update.result,
    );
    const content = message.content.map((part) => {
      if (part.type !== "tool-call" || part.toolCallId !== update.toolCallId) return part;

      if (update.state === "running") {
        return {
          ...part,
          artifact: output,
          ...(part.timing || update.startedAt === undefined
            ? {}
            : { timing: { startedAt: update.startedAt } }),
        } satisfies ToolCallMessagePart;
      }

      const startedAt = part.timing?.startedAt;
      const completedAt = part.timing?.completedAt ?? update.completedAt;

      return {
        ...part,
        artifact: undefined,
        result: output,
        isError: update.isError,
        ...(startedAt === undefined
          ? {}
          : {
              timing: {
                startedAt,
                ...(completedAt === undefined ? {} : { completedAt }),
              },
            }),
      } satisfies ToolCallMessagePart;
    });
    const hasRunningTool = content.some(
      (part) => part.type === "tool-call" && part.result === undefined,
    );
    messages[index] = {
      ...message,
      content,
      status:
        update.state === "running" || hasRunningTool
          ? { type: "running" }
          : { type: "complete", reason: "unknown" },
    };
    return true;
  }

  return false;
}

function applyToolResult(messages: ThreadMessage[], result: PiToolResultMessage): void {
  applyToolExecutionUpdate(messages, {
    state: "complete",
    toolCallId: result.toolCallId,
    result,
    isError: result.isError === true,
    completedAt: result.timestamp,
  });
}

function isEmptyStreamingPlaceholder(message: ThreadAssistantMessage): boolean {
  return (
    message.status.type === "running" &&
    message.content.length === 1 &&
    message.content[0]?.type === "text" &&
    message.content[0].text === ""
  );
}

function messageSourceTimestamp(message: ThreadMessage): number | undefined {
  const sourceTimestamp = message.metadata.custom.piMessageTimestamp;
  if (sourceTimestamp === null) return undefined;
  if (typeof sourceTimestamp === "number" && Number.isFinite(sourceTimestamp)) {
    return sourceTimestamp;
  }

  const createdAt = message.createdAt.getTime();
  return Number.isFinite(createdAt) ? createdAt : undefined;
}

function assistantTurnTiming(
  messages: readonly ThreadAssistantMessage[],
  content: ThreadAssistantMessage["content"],
  turnStartedAt?: number,
): { startedAt: number; completedAt: number } | undefined {
  const starts = messages.flatMap((message) => {
    const streamStartedAt = message.metadata.timing?.streamStartTime;
    const sourceTimestamp = messageSourceTimestamp(message);
    return [
      ...(sourceTimestamp === undefined ? [] : [sourceTimestamp]),
      ...(streamStartedAt === undefined || !Number.isFinite(streamStartedAt)
        ? []
        : [streamStartedAt]),
    ];
  });
  if (turnStartedAt !== undefined && Number.isFinite(turnStartedAt)) starts.push(turnStartedAt);

  const completions = messages.flatMap((message) => {
    const timing = message.metadata.timing;
    return timing?.totalStreamTime === undefined
      ? []
      : [timing.streamStartTime + timing.totalStreamTime];
  });
  for (const part of content) {
    if (part.type === "tool-call" && part.timing?.completedAt !== undefined) {
      completions.push(part.timing.completedAt);
    }
  }

  if (starts.length === 0 || completions.length === 0) return undefined;
  const startedAt = Math.min(...starts);
  const completedAt = Math.max(...completions);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    return undefined;
  }

  return { startedAt, completedAt };
}

function modelChangeEvent(message: ThreadMessage): PiModelChangeConversationEvent | undefined {
  if (message.role !== "system") return undefined;
  const event = parsePiConversationEvent(message.metadata.custom.piConversationEvent);
  return event?.kind === "model-change" ? event : undefined;
}

function mergeModelChangeEvents(
  first: PiModelChangeConversationEvent,
  last: PiModelChangeConversationEvent,
): PiModelChangeConversationEvent {
  const previousModel = first.previousModel ?? first.model;
  const previousProvider = first.previousModel ? first.previousProvider : first.provider;

  return {
    kind: "model-change",
    model: last.model,
    ...(last.provider ? { provider: last.provider } : {}),
    ...(previousModel ? { previousModel } : {}),
    ...(previousProvider ? { previousProvider } : {}),
  };
}

export function coalesceConsecutiveAssistantMessages(
  messages: readonly ThreadMessage[],
): ThreadMessage[] {
  const coalesced: ThreadMessage[] = [];
  let assistantGroup: ThreadAssistantMessage[] = [];
  let turnStartedAt: number | undefined;

  const appendMessage = (message: ThreadMessage) => {
    const previous = coalesced.at(-1);
    const previousEvent = previous ? modelChangeEvent(previous) : undefined;
    const currentEvent = modelChangeEvent(message);

    if (previous?.role === "system" && message.role === "system" && previousEvent && currentEvent) {
      coalesced[coalesced.length - 1] = {
        ...previous,
        metadata: {
          ...previous.metadata,
          custom: {
            ...previous.metadata.custom,
            ...message.metadata.custom,
            piConversationEvent: mergeModelChangeEvents(previousEvent, currentEvent),
          },
        },
      };
      return;
    }

    coalesced.push(message);
  };

  const flushAssistantGroup = () => {
    const first = assistantGroup[0];
    if (!first) return;

    const content = [...first.content];
    let merged = first;
    for (let index = 1; index < assistantGroup.length; index += 1) {
      const next = assistantGroup[index];
      if (!next) continue;
      if (!isEmptyStreamingPlaceholder(next)) content.push(...next.content);
      merged = {
        ...merged,
        status: next.status,
        metadata: {
          ...merged.metadata,
          ...next.metadata,
          custom: {
            ...merged.metadata.custom,
            ...next.metadata.custom,
          },
        },
      };
    }
    const turnTiming = assistantTurnTiming(assistantGroup, content, turnStartedAt);
    const turnStatistics = aggregatePiTurnStatistics(assistantGroup);
    appendMessage({
      ...merged,
      id: first.id,
      content,
      metadata: {
        ...merged.metadata,
        custom: {
          ...merged.metadata.custom,
          ...(turnTiming ? { piTurnTiming: turnTiming } : {}),
          piTurnStatistics: turnStatistics,
        },
      },
    });
    assistantGroup = [];
    turnStartedAt = undefined;
  };

  for (const message of messages) {
    if (message.role === "assistant") {
      assistantGroup.push(message);
      continue;
    }
    flushAssistantGroup();
    if (message.role === "user") turnStartedAt = messageSourceTimestamp(message);
    appendMessage(message);
  }
  flushAssistantGroup();

  return coalesced;
}

export function piHistoryToThreadMessages(
  history: PiSessionHistory,
  timingByTimestamp?: ReadonlyMap<number, MessageTiming>,
  toolTimingById?: ReadonlyMap<string, ToolCallTiming>,
): ThreadMessage[] {
  const messages: ThreadMessage[] = [];
  const entryIdCounts = new Map<string, number>();
  const composerUserIndexes = new Map<string, number>();
  const composerCommandResponseIndexes = new Map<string, number>();
  const runningCompactCommandResponses = new Set<string>();
  const resolvedToolTimingById = new Map<string, ToolCallTiming>();
  for (const timing of history.context.toolTimings ?? []) {
    if (
      Number.isFinite(timing.startedAt) &&
      Number.isFinite(timing.completedAt) &&
      timing.completedAt >= timing.startedAt
    ) {
      resolvedToolTimingById.set(timing.toolCallId, {
        startedAt: timing.startedAt,
        completedAt: timing.completedAt,
      });
    }
  }
  for (const [toolCallId, timing] of toolTimingById ?? []) {
    resolvedToolTimingById.set(toolCallId, timing);
  }

  history.context.messages.forEach((message, index) => {
    const entryId = history.context.entryIds[index] ?? `message-${index}`;
    const previousMatches = entryIdCounts.get(entryId) ?? 0;
    entryIdCounts.set(entryId, previousMatches + 1);
    const id = previousMatches ? `${entryId}-${previousMatches}` : entryId;
    switch (message.role) {
      case "user": {
        const content =
          typeof message.content === "string"
            ? [{ type: "text" as const, text: message.content }]
            : message.content.map((part) =>
                part.type === "image"
                  ? { type: "image" as const, image: imageUrl(part) }
                  : { type: "text" as const, text: stripWorkspaceFeedbackContext(part.text) },
              );
        if (typeof message.content === "string" && content[0]?.type === "text") {
          content[0] = { ...content[0], text: stripWorkspaceFeedbackContext(content[0].text) };
        }
        const projection = message.workbenchComposer;
        const projectedIndex = projection
          ? composerUserIndexes.get(projection.submissionId)
          : undefined;
        if (projectedIndex !== undefined) {
          const projected = messages[projectedIndex];
          if (projected?.role === "user") {
            messages[projectedIndex] = {
              ...projected,
              content: [...projected.content, ...content.filter((part) => part.type === "image")],
              metadata: {
                ...projected.metadata,
                custom: {
                  ...projected.metadata.custom,
                  piResolvedEntryId: history.context.entryIds[index],
                  piResolvedMessageTimestamp: message.timestamp ?? null,
                },
              },
            };
            break;
          }
        }
        const visibleContent = projection
          ? [
              { type: "text" as const, text: projection.sourceText },
              ...content.filter((part) => part.type === "image"),
            ]
          : content;
        messages.push({
          id,
          role: "user",
          content: visibleContent,
          attachments: [],
          createdAt: messageDate(
            message.timestamp ?? history.context.entryCompletedAts?.[index] ?? undefined,
            index,
          ),
          metadata: metadata({
            piEntryId: history.context.entryIds[index],
            piMessageTimestamp: message.timestamp ?? null,
            ...(projection?.document === undefined
              ? {}
              : { workbenchComposerDocument: projection.document }),
          }),
        });
        break;
      }
      case "assistant":
        messages.push(
          piAssistantToThreadMessage(message, id, {
            timing:
              message.timestamp === undefined
                ? undefined
                : (timingByTimestamp?.get(message.timestamp) ??
                  persistedMessageTiming(
                    message,
                    history.context.entryCompletedAts?.[index],
                    history.context.entryFirstTokenAts?.[index],
                  )),
            toolTimingById: resolvedToolTimingById,
            createdAt: history.context.entryCompletedAts?.[index] ?? undefined,
            eventSeq: history.context.entrySeqs?.[index] ?? undefined,
          }),
        );
        break;
      case "toolResult":
        applyToolResult(messages, message);
        break;
      case "custom":
        if (
          message.customType === WORKBENCH_COMPOSER_USER_CUSTOM_TYPE ||
          message.customType === LEGACY_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE
        ) {
          const details = parseWorkbenchComposerUserDetails(message.details);
          if (details) {
            const messageIndex = messages.length;
            messages.push({
              id,
              role: "user",
              content: [{ type: "text", text: details.sourceText }],
              attachments: [],
              createdAt: messageDate(
                message.timestamp ?? history.context.entryCompletedAts?.[index] ?? undefined,
                index,
              ),
              metadata: metadata({
                piEntryId: history.context.entryIds[index],
                piMessageTimestamp: message.timestamp ?? null,
                workbenchComposerSubmissionId: details.submissionId,
                ...(details.document === undefined
                  ? {}
                  : { workbenchComposerDocument: details.document }),
                ...(details.commands === undefined
                  ? {}
                  : { workbenchComposerCommands: details.commands }),
                ...(details.composer === undefined
                  ? {}
                  : { workbenchComposerSubmission: details.composer }),
                ...(details.status === undefined
                  ? {}
                  : { workbenchComposerStatus: details.status }),
              }),
            });
            composerUserIndexes.set(details.submissionId, messageIndex);
          }
        } else if (message.customType === WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE) {
          const details = parseWorkbenchComposerResolutionDetails(message.details);
          const messageIndex = details ? composerUserIndexes.get(details.submissionId) : undefined;
          if (details && messageIndex !== undefined) {
            const projected = messages[messageIndex];
            if (projected?.role === "user") {
              messages[messageIndex] = {
                ...projected,
                metadata: {
                  ...projected.metadata,
                  custom: {
                    ...projected.metadata.custom,
                    workbenchComposerStatus: details.status,
                    workbenchComposerCommandTrace: details.commandTrace,
                  },
                },
              };
            }
          }
        } else if (message.customType === WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE) {
          const details = parseWorkbenchComposerCommandResponseDetails(message.details);
          if (details) {
            const responseId = workbenchComposerCommandResponseId(details);
            const responseIndex = composerCommandResponseIndexes.get(responseId);
            if (details.commandId === "compact") {
              if (details.status === "running") runningCompactCommandResponses.add(responseId);
              else runningCompactCommandResponses.delete(responseId);
            }
            if (responseIndex !== undefined) {
              const current = messages[responseIndex];
              messages[responseIndex] = {
                ...workbenchComposerCommandResponseThreadMessage(
                  details,
                  message.timestamp ??
                    history.context.entryCompletedAts?.[index] ??
                    current?.createdAt.getTime() ??
                    index,
                ),
                ...(current ? { createdAt: current.createdAt } : {}),
              };
              break;
            }
            const previous = messages.at(-1);
            const previousConversationEvent =
              previous?.role === "system"
                ? parsePiConversationEvent(previous.metadata.custom.piConversationEvent)
                : undefined;
            const isMatchingCompactionEvent =
              details.commandId === "compact" &&
              details.status === "success" &&
              previousConversationEvent?.kind === "compaction";
            if (isMatchingCompactionEvent && previous?.role === "system") {
              messages[messages.length - 1] = {
                ...previous,
                metadata: {
                  ...previous.metadata,
                  custom: {
                    ...previous.metadata.custom,
                    workbenchComposerCommandResponse: details,
                  },
                },
              };
              composerCommandResponseIndexes.set(responseId, messages.length - 1);
            } else {
              messages.push(
                workbenchComposerCommandResponseThreadMessage(
                  details,
                  message.timestamp ?? history.context.entryCompletedAts?.[index] ?? index,
                ),
              );
              composerCommandResponseIndexes.set(responseId, messages.length - 1);
            }
          }
        } else if (message.display) {
          const conversationEvent =
            message.customType === PI_CONVERSATION_EVENT_CUSTOM_TYPE
              ? parsePiConversationEvent(message.details)
              : undefined;
          if (conversationEvent?.kind === "compaction" && runningCompactCommandResponses.size > 0) {
            break;
          }
          messages.push({
            id,
            role: "system",
            content: [{ type: "text", text: messageContentText(message.content) }],
            createdAt: messageDate(
              message.timestamp ?? history.context.entryCompletedAts?.[index] ?? undefined,
              index,
            ),
            metadata: metadata({
              piCustomType: message.customType,
              ...(conversationEvent ? { piConversationEvent: conversationEvent } : {}),
            }),
          });
        }
        break;
      case "bashExecution":
        messages.push({
          id,
          role: "system",
          content: [
            {
              type: "text",
              text: `$ ${message.command}\n${message.output}`.trimEnd(),
            },
          ],
          createdAt: messageDate(
            message.timestamp ?? history.context.entryCompletedAts?.[index] ?? undefined,
            index,
          ),
          metadata: metadata({ piBashExecution: true }),
        });
        break;
    }
  });

  return coalesceConsecutiveAssistantMessages(messages);
}

export function sameUserPrompt(left: ThreadUserMessage, right: ThreadUserMessage): boolean {
  const leftPrompt = appendMessageToPiPrompt(left);
  const rightPrompt = appendMessageToPiPrompt(right);
  if (
    leftPrompt.text !== rightPrompt.text ||
    leftPrompt.images.length !== rightPrompt.images.length
  ) {
    return false;
  }
  return leftPrompt.images.every(
    (image, index) =>
      image.mimeType === rightPrompt.images[index]?.mimeType &&
      image.data === rightPrompt.images[index]?.data,
  );
}

export function reconcileLiveMessagesAfterHistory(
  liveMessages: readonly ThreadMessage[],
  authoritativeMessages: readonly ThreadMessage[],
  options: Readonly<{
    liveMessageIdsAtStart: ReadonlySet<string>;
    baseMessageIdsAtStart: ReadonlySet<string>;
    preserveUnpersistedOptimisticUsers: boolean;
  }>,
): ThreadMessage[] {
  const newAuthoritativeUsers = authoritativeMessages.filter(
    (message): message is ThreadUserMessage =>
      message.role === "user" && !options.baseMessageIdsAtStart.has(message.id),
  );

  return liveMessages.filter((message) => {
    if (!options.liveMessageIdsAtStart.has(message.id)) return true;
    if (
      !options.preserveUnpersistedOptimisticUsers ||
      message.role !== "user" ||
      message.metadata.custom.piOptimistic !== true
    ) {
      return false;
    }

    const replacementIndex = newAuthoritativeUsers.findIndex((candidate) =>
      sameUserPrompt(message, candidate),
    );
    if (replacementIndex < 0) return true;
    newAuthoritativeUsers.splice(replacementIndex, 1);
    return false;
  });
}

function splitDataUrl(value: string, fallbackMimeType: string): PiImageContent {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
  return {
    type: "image",
    mimeType: match?.[1] ?? fallbackMimeType,
    data: match?.[2] ?? value,
  };
}

export function appendMessageToPiPrompt(
  message: Pick<AppendMessage, "content" | "attachments"> &
    Partial<Pick<AppendMessage, "runConfig">>,
): {
  text: string;
  images: PiImageContent[];
  composer?: WorkbenchComposerSubmission;
} {
  const sourceText = message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const composer = workbenchComposerSubmissionFromRunConfig(message.runConfig);
  const text = composer?.text ?? sourceText;
  const images: PiImageContent[] = [];

  const collect = (part: (typeof message.content)[number]) => {
    if (part.type === "image") {
      images.push(splitDataUrl(part.image, "image/png"));
    } else if (part.type === "file" && part.mimeType.startsWith("image/")) {
      images.push(splitDataUrl(part.data, part.mimeType));
    }
  };
  message.content.forEach(collect);
  message.attachments?.forEach((attachment) => attachment.content.forEach(collect));

  return { text, images, ...(composer === undefined ? {} : { composer }) };
}

export function optimisticUserMessage(message: AppendMessage, id: string): ThreadMessage {
  const content: ThreadUserMessage["content"] = message.content.filter(
    (part): part is ThreadUserMessage["content"][number] =>
      part.type === "text" ||
      part.type === "image" ||
      part.type === "file" ||
      part.type === "data" ||
      part.type === "audio",
  );
  const composer = workbenchComposerSubmissionFromRunConfig(message.runConfig);
  const visibleContent: ThreadUserMessage["content"] = composer
    ? [
        { type: "text", text: composer.sourceText },
        ...content.filter((part) => part.type === "image"),
      ]
    : content;
  return {
    id,
    role: "user",
    content: visibleContent,
    attachments: message.attachments ?? [],
    createdAt: message.createdAt,
    metadata: {
      ...metadata({
        piOptimistic: true,
        ...(composer?.document === undefined
          ? {}
          : { workbenchComposerDocument: composer.document }),
      }),
      isOptimistic: true,
    },
  };
}

export function eventMessage(event: Record<string, unknown>): PiAgentMessage | undefined {
  const message = event.message;
  if (!message || typeof message !== "object" || !("role" in message)) return undefined;
  return message as PiAgentMessage;
}
