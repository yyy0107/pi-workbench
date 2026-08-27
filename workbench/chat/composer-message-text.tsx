"use client";

import { useAuiState } from "@assistant-ui/react";

import { CompactMarkdownText } from "@/components/assistant-ui/markdown-text";
import { ComposerCommandToken } from "@/components/elements/composer";
import { useComposerCommandRegistry } from "@/platform/extensions";
import { useWorkbenchAgentCommands } from "@/runtime/assistant-ui/agent-runtime-context";
import { parseWorkbenchComposerDocument } from "@/runtime/shared/composer/request";

import {
  formatAgentCommandLabel,
  parseAgentCommandText,
  removeAgentCommandBuffer,
} from "./agent-command";
import { parseComposerDocument } from "./composer-document";

function UserMessageTextBubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-slot="user-message-bubble"
      className="w-fit max-w-full min-w-0 self-end rounded-[12px] bg-muted/50 px-4 py-2.5 text-start text-base leading-6 text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]"
    >
      {children}
    </div>
  );
}

/** Renders the serialized Composer document in a sent user message using the same Token UI. */
export function WorkbenchComposerMessageText({ text }: { text: string }) {
  const commands = useWorkbenchAgentCommands();
  const persistedDocument = useAuiState(
    (state) => state.message.metadata.custom.workbenchComposerDocument,
  );
  const composerCommandRegistry = useComposerCommandRegistry();
  const composerDocument =
    parseWorkbenchComposerDocument(persistedDocument) ??
    parseComposerDocument(text, composerCommandRegistry, commands);
  const hasTextPresentation = composerDocument.some(
    (node) => node.type !== "attachment" && (node.type !== "text" || node.text.length > 0),
  );

  if (!hasTextPresentation) return null;

  if (composerDocument.some((node) => node.type === "command")) {
    return (
      <UserMessageTextBubble>
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
                    className="text-blue-500 dark:text-blue-400"
                  >
                    {node.text}
                  </span>
                );
              case "command":
                return (
                  <ComposerCommandToken
                    key={node.id}
                    label={node.label}
                    className="mx-0.5 align-baseline"
                  />
                );
              case "mention":
                return <span key={node.id}>{node.label}</span>;
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
      <UserMessageTextBubble>
        <p className="whitespace-pre-wrap">
          <ComposerCommandToken
            label={formatAgentCommandLabel(commandText.command.name)}
            className="me-1 align-baseline"
          />
          <span
            data-slot={commandOwnsArguments ? "composer-command-argument" : undefined}
            className={commandOwnsArguments ? "text-blue-500 dark:text-blue-400" : undefined}
          >
            {argumentsText}
          </span>
        </p>
      </UserMessageTextBubble>
    );
  }

  return (
    <UserMessageTextBubble>
      <CompactMarkdownText />
    </UserMessageTextBubble>
  );
}
