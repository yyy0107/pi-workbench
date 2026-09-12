"use client";

import { useConversationNode } from "@workbench/agent-runtime-client";

import { MarkdownTextContent } from "./markdown/lazy-markdown-text";
import { ComposerCommandToken } from "../elements/composer";
import {
  COMPOSER_CONVERSATION_MENTION_TYPE,
  COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
} from "@workbench/contracts/composer";
import { useI18n } from "../i18n";
import { useComposerCommandRegistry } from "@workbench/extension-host";
import { useWorkbenchAgentCommands } from "@workbench/agent-runtime-client/context";
import { parseWorkbenchComposerDocument } from "@workbench/contracts/composer/request";

import {
  formatAgentCommandLabel,
  parseAgentCommandText,
  removeAgentCommandBuffer,
} from "./agent-command";
import { ComposerCommandArguments } from "./composer-command-arguments";
import { parseComposerDocument } from "./composer-document";
import {
  ComposerCommandIcon,
  ComposerTokenIcon,
  type ComposerCommandIconKind,
} from "./composer-token-icon";
import { useConversationMessageContext } from "./conversation-message-context";

import { UserMessageTextBubble } from "./user-message-text-bubble";

/** Renders the serialized Composer document in a sent user message using the same Token UI. */
export function WorkbenchComposerMessageText({ text }: { text: string }) {
  const { messageId } = useConversationMessageContext();
  const persistedDocument = useConversationNode(
    messageId,
    (node) => node?.presentation?.custom?.workbenchComposerDocument,
  );
  return <WorkbenchComposerMessageTextContent text={text} persistedDocument={persistedDocument} />;
}

/** Stateless sent-message presentation used by the Headless Conversation Block renderer. */
export function WorkbenchComposerMessageTextContent({
  text,
  persistedDocument,
}: Readonly<{ text: string; persistedDocument?: unknown }>) {
  const { t } = useI18n();
  const commands = useWorkbenchAgentCommands();
  const composerCommandRegistry = useComposerCommandRegistry();
  const agentCommandKindsById = new Map(
    commands.map((command) => [command.invocationName, command.kind] as const),
  );
  const composerDocument =
    parseWorkbenchComposerDocument(persistedDocument) ??
    parseComposerDocument(text, composerCommandRegistry, commands);
  const hasTextPresentation = composerDocument.some(
    (node) => node.type !== "attachment" && (node.type !== "text" || node.text.length > 0),
  );
  const projectedArgumentFields = new Map<string, Set<string>>();
  for (const node of composerDocument) {
    if (node.type !== "command-argument") continue;
    const fields = projectedArgumentFields.get(node.commandNodeId) ?? new Set<string>();
    fields.add(node.field);
    projectedArgumentFields.set(node.commandNodeId, fields);
  }

  if (!hasTextPresentation) return null;

  if (composerDocument.some((node) => node.type === "command" || node.type === "mention")) {
    return (
      <UserMessageTextBubble key={text}>
        <p className="whitespace-pre-wrap">
          {composerDocument.map((node, index) => {
            switch (node.type) {
              case "text":
                return <span key={`text:${index}`}>{node.text}</span>;
              case "command-argument":
                return (
                  <span
                    key={node.id}
                    data-slot="composer-command-argument"
                    className="text-primary"
                  >
                    {node.text}
                  </span>
                );
              case "command": {
                const commandIconKind: ComposerCommandIconKind | undefined =
                  node.source === "workbench"
                    ? "workbench"
                    : agentCommandKindsById.get(node.commandId);
                return (
                  <span
                    key={node.id}
                    className="inline-flex max-w-full flex-wrap items-center gap-1.5 align-middle"
                  >
                    <ComposerCommandToken
                      icon={
                        commandIconKind ? <ComposerCommandIcon kind={commandIconKind} /> : undefined
                      }
                      iconSize="md-lg"
                      label={node.label}
                      className="align-baseline"
                    />
                    <ComposerCommandArguments
                      args={node.args}
                      omittedFields={projectedArgumentFields.get(node.id)}
                      fieldLabels={
                        node.commandId === "compact"
                          ? {
                              customInstructions: t(
                                "workbench.chat.commandArguments.customInstructions",
                              ),
                            }
                          : undefined
                      }
                      className="me-0.5 text-sm text-foreground/80"
                    />
                  </span>
                );
              }
              case "mention":
                return (
                  <ComposerCommandToken
                    key={node.id}
                    icon={
                      node.mentionType === COMPOSER_CONVERSATION_MENTION_TYPE ? (
                        <ComposerTokenIcon kind="conversation" />
                      ) : node.mentionType === COMPOSER_WORKSPACE_FILE_MENTION_TYPE ? (
                        <ComposerTokenIcon kind="workspace-file" />
                      ) : undefined
                    }
                    label={node.label}
                    className="me-0.5 align-baseline"
                  />
                );
              case "attachment":
                return null;
            }
          })}
        </p>
      </UserMessageTextBubble>
    );
  }

  const commandText = parseAgentCommandText(text, commands);
  if (commandText) {
    const argumentsText = removeAgentCommandBuffer(commandText.argumentsText);
    const commandOwnsArguments = commandText.command.argsBinding?.kind === "message-text";
    return (
      <UserMessageTextBubble key={text}>
        <p className="whitespace-pre-wrap">
          <ComposerCommandToken
            icon={<ComposerCommandIcon kind={commandText.command.kind} />}
            iconSize="md-lg"
            label={formatAgentCommandLabel(commandText.command.name)}
            className="me-1 align-baseline"
          />
          <span
            data-slot={commandOwnsArguments ? "composer-command-argument" : undefined}
            className={commandOwnsArguments ? "text-primary" : undefined}
          >
            {argumentsText}
          </span>
        </p>
      </UserMessageTextBubble>
    );
  }

  return (
    <UserMessageTextBubble key={text}>
      <MarkdownTextContent text={text} inheritLineHeight preserveWhitespace resetParagraphMargins />
    </UserMessageTextBubble>
  );
}
