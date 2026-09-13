"use client";
import { conversationTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";
import { MarkdownTextContent } from "@workbench/markdown";
import { ComposerCommandToken } from "@workbench/ui-input-trigger/tokens";
import {
  COMPOSER_CONVERSATION_MENTION_TYPE,
  COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
} from "@workbench/core-contracts/composer";

import { ComposerCommandArguments } from "@workbench/ui-input-trigger/composer-command-arguments";
import {
  ComposerCommandIcon,
  ComposerTokenIcon,
  type ComposerCommandIconKind,
} from "@workbench/ui-input-trigger/tokens";
import { UserMessageTextBubble } from "./user-message-text-bubble";

export interface ComposerMessagePresentation {
  readonly document: import("@workbench/core-contracts/composer").ComposerDocument;
  readonly commandKinds: ReadonlyMap<string, ComposerCommandIconKind>;
  readonly commandText?: {
    kind: ComposerCommandIconKind;
    label: string;
    argumentsText: string;
    ownsArguments: boolean;
  };
}

/** Sent-message view; runtime projection is supplied by the node adapter. */
export function WorkbenchComposerMessageTextContent({
  text,
  presentation,
}: Readonly<{
  text: string;
  presentation?: ComposerMessagePresentation;
}>) {
  const { t } = useI18n(conversationTranslationBundle);
  const composerDocument = presentation?.document ?? [{ type: "text" as const, text }];
  const agentCommandKindsById = presentation?.commandKinds;
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
                    : agentCommandKindsById?.get(node.commandId);
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

  const commandText = presentation?.commandText;
  if (commandText) {
    const argumentsText = commandText.argumentsText;
    const commandOwnsArguments = commandText.ownsArguments;
    return (
      <UserMessageTextBubble key={text}>
        <p className="whitespace-pre-wrap">
          <ComposerCommandToken
            icon={<ComposerCommandIcon kind={commandText.kind} />}
            iconSize="md-lg"
            label={commandText.label}
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
