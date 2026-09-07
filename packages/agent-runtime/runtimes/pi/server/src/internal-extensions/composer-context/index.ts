import type { ContextEvent, ExtensionFactory, SessionEntry } from "@earendil-works/pi-coding-agent";

import {
  PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE,
  type PiComposerModelInput,
} from "../../commands/pi-composer-prompt";

function modelInput(value: unknown): PiComposerModelInput | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Partial<PiComposerModelInput>;
  return input.version === 1 &&
    typeof input.prompt === "string" &&
    typeof input.userText === "string" &&
    Array.isArray(input.context) &&
    input.context.every((text) => typeof text === "string")
    ? (input as PiComposerModelInput)
    : undefined;
}

/** Project only host-recorded requests; arbitrary XML in user text stays untouched. */
export function projectPiComposerContext(
  messages: ContextEvent["messages"],
  branch: readonly SessionEntry[],
): ContextEvent["messages"] {
  const inputs = new Map<string, PiComposerModelInput>();
  for (const entry of branch) {
    if (entry.type !== "custom" || entry.customType !== PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE)
      continue;
    const input = modelInput(entry.data);
    if (input) inputs.set(input.prompt, input);
  }
  // Empty custom messages carry UI metadata; Pi would turn them into empty user input.
  const modelMessages = messages.filter(
    (message) => message.role !== "custom" || message.content.length > 0,
  );
  if (inputs.size === 0) return modelMessages.length === messages.length ? messages : modelMessages;

  return modelMessages.flatMap((message): ContextEvent["messages"] => {
    if (message.role !== "user") return [message];
    const content =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;
    const promptPart = content.find((part) => part.type === "text" && inputs.has(part.text));
    const input = promptPart?.type === "text" ? inputs.get(promptPart.text) : undefined;
    if (!input) return [message];

    const userContent = content.flatMap((part) =>
      part === promptPart
        ? input.userText
          ? [{ type: "text" as const, text: input.userText }]
          : []
        : [part],
    );
    return [
      ...input.context.map((text) => ({
        role: "custom" as const,
        customType: PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE,
        content: text,
        display: false,
        timestamp: message.timestamp,
      })),
      ...(userContent.length > 0 ? [{ ...message, content: userContent }] : []),
    ];
  });
}

export const composerContextExtension: ExtensionFactory = (pi) => {
  pi.on("context", (event, context) => ({
    messages: projectPiComposerContext(event.messages, context.sessionManager.getBranch()),
  }));
};
