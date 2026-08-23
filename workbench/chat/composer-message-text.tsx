"use client";

import { CuboidIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ComposerCommandToken } from "@/components/elements/composer";
import { useComposerCommandRegistry } from "@/platform/extensions";
import { usePiCommands } from "@/runtime/pi/client/runtime/command-context";
import { parseWorkbenchComposerDocument } from "@/runtime/composer-request";

import { parseComposerDocument } from "./composer-document";
import { formatPiCommandLabel, parsePiCommandText, removePiCommandBuffer } from "./pi-command";

/** Renders the serialized Composer document in a sent user message using the same Token UI. */
export function WorkbenchComposerMessageText({ text }: { text: string }) {
  const commands = usePiCommands();
  const persistedDocument = useAuiState(
    (state) => state.message.metadata.custom.workbenchComposerDocument,
  );
  const composerCommandRegistry = useComposerCommandRegistry();
  const getComposerCommands = useCallback(
    () => composerCommandRegistry.getAll(),
    [composerCommandRegistry],
  );
  const composerCommands = useSyncExternalStore(
    composerCommandRegistry.subscribe,
    getComposerCommands,
    getComposerCommands,
  );
  const composerCommandsById = useMemo(
    () => new Map(composerCommands.map((command) => [command.id, command])),
    [composerCommands],
  );
  const composerDocument =
    parseWorkbenchComposerDocument(persistedDocument) ??
    parseComposerDocument(text, composerCommandRegistry, commands);

  if (composerDocument.some((node) => node.type === "command")) {
    return (
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
                  icon={composerCommandsById.get(node.commandId)?.icon ?? CuboidIcon}
                  className="mx-0.5 align-baseline"
                />
              );
            case "mention":
            case "attachment":
              return <span key={node.id}>{node.label}</span>;
          }
        })}
      </p>
    );
  }

  const commandText = parsePiCommandText(text, commands);
  if (commandText) {
    const argumentsText = removePiCommandBuffer(commandText.argumentsText);
    const commandOwnsArguments = commandText.command.argsBinding?.kind === "message-text";
    return (
      <p className="whitespace-pre-wrap">
        <ComposerCommandToken
          label={formatPiCommandLabel(commandText.command.name)}
          icon={CuboidIcon}
          className="me-1 align-baseline"
        />
        <span
          data-slot={commandOwnsArguments ? "composer-command-argument" : undefined}
          className={commandOwnsArguments ? "text-blue-500 dark:text-blue-400" : undefined}
        >
          {argumentsText}
        </span>
      </p>
    );
  }

  return <MarkdownText />;
}
