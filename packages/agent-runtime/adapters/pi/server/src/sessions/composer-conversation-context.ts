import {
  COMPOSER_CONVERSATION_CONTEXT_TYPE,
  type ComposerJsonValue,
} from "@workbench/contracts/composer";
import type {
  PiAgentMessage,
  PiSessionHistory,
} from "@workbench/agent-runtime-pi-protocol/messages";
import type { WorkbenchResolvedContext } from "@workbench/contracts/composer/request";

const MAX_REFERENCED_CONVERSATIONS = 8;
const MAX_TRANSCRIPT_MESSAGES = 48;
const MAX_TRANSCRIPT_CHARACTERS = 60_000;
const MAX_MESSAGE_CHARACTERS = 12_000;

interface ConversationReference {
  readonly conversationId: string;
  readonly title: string;
}

interface ConversationTranscriptMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

function record(value: ComposerJsonValue): Readonly<Record<string, ComposerJsonValue>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, ComposerJsonValue>>;
}

function conversationReference(
  context: WorkbenchResolvedContext,
): ConversationReference | undefined {
  if (
    context.source !== COMPOSER_CONVERSATION_CONTEXT_TYPE ||
    context.trust !== "untrusted-context"
  ) {
    return undefined;
  }
  const value = record(context.value);
  const conversationId = value?.conversationId;
  const title = value?.title;
  if (
    value?.version !== 1 ||
    typeof conversationId !== "string" ||
    conversationId.length === 0 ||
    conversationId.length > 2048 ||
    typeof title !== "string" ||
    title.length === 0 ||
    title.length > 4096
  ) {
    return undefined;
  }
  return { conversationId, title };
}

function messageText(message: PiAgentMessage): ConversationTranscriptMessage | undefined {
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content
          .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
          .join("\n");
  const normalized = text.trim();
  return normalized ? { role: message.role, text: normalized } : undefined;
}

export function boundedConversationTranscript(
  history: PiSessionHistory,
  maximumCharacters = MAX_TRANSCRIPT_CHARACTERS,
): {
  readonly messages: readonly ConversationTranscriptMessage[];
  readonly truncated: boolean;
} {
  const available = history.context.messages.flatMap((message) => {
    const projected = messageText(message);
    return projected ? [projected] : [];
  });
  const selected: ConversationTranscriptMessage[] = [];
  let remainingCharacters = Math.max(0, Math.min(maximumCharacters, MAX_TRANSCRIPT_CHARACTERS));
  let truncated = false;

  for (let index = available.length - 1; index >= 0; index -= 1) {
    if (selected.length >= MAX_TRANSCRIPT_MESSAGES || remainingCharacters <= 0) {
      truncated = true;
      break;
    }
    const message = available[index]!;
    const characterLimit = Math.min(MAX_MESSAGE_CHARACTERS, remainingCharacters);
    const text = message.text.slice(0, characterLimit);
    if (text.length < message.text.length) truncated = true;
    selected.push({ ...message, text });
    remainingCharacters -= text.length;
  }

  if (selected.length < available.length) truncated = true;
  return { messages: selected.reverse(), truncated };
}

function resolvedContextValue(
  reference: ConversationReference,
  status: "available" | "current" | "limit-reached" | "unavailable",
  transcript?: ReturnType<typeof boundedConversationTranscript>,
): ComposerJsonValue {
  const value: Record<string, ComposerJsonValue> = {
    version: 1,
    kind: "conversation-reference",
    conversationId: reference.conversationId,
    title: reference.title,
    status,
  };
  if (transcript) {
    value.transcript = {
      messages: transcript.messages.map((message) => ({
        role: message.role,
        text: message.text,
      })),
      truncated: transcript.truncated,
    };
  }
  return value;
}

export async function resolveConversationReferenceContexts({
  contexts,
  currentConversationId,
  getHistory,
}: Readonly<{
  contexts: readonly WorkbenchResolvedContext[];
  currentConversationId: string;
  getHistory(conversationId: string): Promise<PiSessionHistory>;
}>): Promise<WorkbenchResolvedContext[]> {
  let referencedCount = 0;
  let remainingCharacters = MAX_TRANSCRIPT_CHARACTERS;
  const resolved: WorkbenchResolvedContext[] = [];

  for (const context of contexts) {
    const reference = conversationReference(context);
    if (!reference) {
      resolved.push(context);
      continue;
    }
    referencedCount += 1;

    if (referencedCount > MAX_REFERENCED_CONVERSATIONS || remainingCharacters <= 0) {
      resolved.push({ ...context, value: resolvedContextValue(reference, "limit-reached") });
      continue;
    }
    if (reference.conversationId === currentConversationId) {
      resolved.push({ ...context, value: resolvedContextValue(reference, "current") });
      continue;
    }

    try {
      const transcript = boundedConversationTranscript(
        await getHistory(reference.conversationId),
        remainingCharacters,
      );
      remainingCharacters -= transcript.messages.reduce(
        (total, message) => total + message.text.length,
        0,
      );
      resolved.push({
        ...context,
        value: resolvedContextValue(reference, "available", transcript),
      });
    } catch {
      resolved.push({ ...context, value: resolvedContextValue(reference, "unavailable") });
    }
  }

  return resolved;
}
