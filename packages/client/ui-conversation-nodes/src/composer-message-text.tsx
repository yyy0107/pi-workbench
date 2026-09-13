"use client";
import { useWorkbenchAgentCommands } from "@workbench/agent-runtime-client/context";
import { useComposerCommandRegistry } from "@workbench/extension-host";
import { parseWorkbenchComposerDocument } from "@workbench/core-contracts/composer/request";
import { parseComposerDocument } from "@workbench/ui-composer/document";
import {
  parseAgentCommandText,
  formatAgentCommandLabel,
  removeAgentCommandBuffer,
} from "@workbench/ui-input-trigger/agent-command";
import { useConversationNode } from "@workbench/agent-runtime-client";
import { useConversationMessageContext } from "./conversation-message-context";
import { WorkbenchComposerMessageTextContent } from "@workbench/ui-message-blocks/composer-message-content";

/** Renders the serialized Composer document in a sent user message using the same Token UI. */
export function WorkbenchComposerMessageText({ text }: { text: string }) {
  const { messageId } = useConversationMessageContext();
  const persistedDocument = useConversationNode(
    messageId,
    (node) => node?.presentation?.custom?.workbenchComposerDocument,
  );
  return <ProjectedComposerMessageText text={text} persistedDocument={persistedDocument} />;
}

export function ProjectedComposerMessageText({
  text,
  persistedDocument,
}: {
  text: string;
  persistedDocument?: unknown;
}) {
  const presentation = useComposerMessagePresentation(text, persistedDocument);
  return <WorkbenchComposerMessageTextContent text={text} presentation={presentation} />;
}

export function useComposerMessagePresentation(text: string, persistedDocument?: unknown) {
  const commands = useWorkbenchAgentCommands();
  const registry = useComposerCommandRegistry();
  const match = parseAgentCommandText(text, commands);
  return {
    document:
      parseWorkbenchComposerDocument(persistedDocument) ??
      parseComposerDocument(text, registry, commands),
    commandKinds: new Map(
      commands.map((command) => [command.invocationName, command.kind] as const),
    ),
    commandText: match
      ? {
          kind: match.command.kind,
          label: formatAgentCommandLabel(match.command.name),
          argumentsText: removeAgentCommandBuffer(match.argumentsText),
          ownsArguments: match.command.argsBinding?.kind === "message-text",
        }
      : undefined,
  };
}
