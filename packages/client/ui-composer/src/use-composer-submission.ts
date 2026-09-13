"use client";

import { type LexicalEditor } from "lexical";
import { useCallback } from "react";

import type { ComposerCommandRegistry } from "@workbench/extension-sdk";

import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";
import { useConversationSession } from "@workbench/agent-runtime-client";

import {
  applyComposerCommandArguments,
  compileComposerDocument,
  composerCommandArgumentKey,
  parseComposerDocument,
} from "./composer-document";

import {
  composerCommandParameterIssues,
  withComposerCommandParameterDefaults,
} from "@workbench/ui-input-trigger/composer-command-parameters";

import { getComposerInputHistory } from "../lib/composer-input-history";

import {
  canSubmitWorkbenchComposer,
  runningComposerMode,
  submitWorkbenchComposer,
} from "./composer-submit";

import {
  suggestionHasParameterFields,
  type WorkbenchComposerSuggestion,
  type ComposerCommandParameterValues,
  type ComposerCommandParametersByKey,
} from "../lib/composer-suggestion-model";
export function useComposerSubmission({
  session,
  preferredRunningMode,
  canSubmit,
  submissionGuards,
  setSubmissionBlocked,
  composerCommandRegistry,
  agentCommands,
  commandParametersByKey,
  composerSuggestionsByCommandKey,
  updateCommandParameterValues,
  setCommandParameterValidationKey,
  setActiveCommandParameterKey,
  setComposerCommandError,
  lexicalEditorRef,
  inputHistory,
  clearCommandParameterValues,
  reportComposerCommandError,
}: {
  session: ReturnType<typeof useConversationSession>;
  preferredRunningMode: Parameters<typeof runningComposerMode>[1];
  canSubmit: boolean;
  submissionGuards: import("react").RefObject<Set<() => boolean>>;
  setSubmissionBlocked: (blocked: boolean) => void;
  composerCommandRegistry: ComposerCommandRegistry;
  agentCommands: readonly WorkbenchAgentCommand[];
  commandParametersByKey: ComposerCommandParametersByKey;
  composerSuggestionsByCommandKey: ReadonlyMap<string, WorkbenchComposerSuggestion>;
  updateCommandParameterValues: (key: string, values: ComposerCommandParameterValues) => void;
  setCommandParameterValidationKey: (key: string | undefined) => void;
  setActiveCommandParameterKey: (key: string | undefined) => void;
  setComposerCommandError: (error: boolean) => void;
  lexicalEditorRef: import("react").RefObject<LexicalEditor | null>;
  inputHistory: ReturnType<typeof getComposerInputHistory>;
  clearCommandParameterValues: () => void;
  reportComposerCommandError: (error: unknown, commandId?: string) => void;
}) {
  const dispatchComposer = useCallback(
    (invertMode = false) => {
      const steer =
        runningComposerMode(session.actions, preferredRunningMode, invertMode) === "steer";
      const snapshot = session.snapshot.getSnapshot();
      if (snapshot.composer.phase === "submitting") return;
      if (!canSubmitWorkbenchComposer(canSubmit, submissionGuards.current)) {
        setSubmissionBlocked(true);
        return;
      }
      if (
        snapshot.isRunning &&
        (steer ? session.actions.steer === undefined : session.actions.queue === undefined)
      ) {
        return;
      }

      try {
        const parsedDocument = parseComposerDocument(
          snapshot.composer.text,
          composerCommandRegistry,
          agentCommands,
        );
        let normalizedParameters = commandParametersByKey;
        for (const node of parsedDocument) {
          if (node.type !== "command") continue;
          const parameterKey = composerCommandArgumentKey(node.source, node.commandId);
          const suggestion = composerSuggestionsByCommandKey.get(parameterKey);
          if (!suggestion?.argsSchema || !suggestionHasParameterFields(suggestion)) continue;
          const values = withComposerCommandParameterDefaults(
            suggestion.argsSchema,
            suggestion.argsBinding,
            commandParametersByKey[parameterKey],
          );
          const issues = composerCommandParameterIssues(
            suggestion.argsSchema,
            suggestion.argsBinding,
            values,
          );
          if (Object.keys(issues).length > 0) {
            updateCommandParameterValues(parameterKey, values);
            setCommandParameterValidationKey(parameterKey);
            setActiveCommandParameterKey(parameterKey);
            setComposerCommandError(false);
            return;
          }
          normalizedParameters = { ...normalizedParameters, [parameterKey]: values };
        }
        const document = applyComposerCommandArguments(parsedDocument, normalizedParameters);
        const commandNodes = document.filter((node) => node.type === "command");
        if (
          commandNodes.length > 1 &&
          commandNodes.some(
            (node) =>
              composerSuggestionsByCommandKey.get(
                composerCommandArgumentKey(node.source, node.commandId),
              )?.exclusive,
          )
        ) {
          throw new Error("Exclusive Composer commands must be submitted separately");
        }
        const request = compileComposerDocument(document, composerCommandRegistry, agentCommands);
        lexicalEditorRef.current?.focus();
        void submitWorkbenchComposer(session, request, { steer }).then(
          (dispatched) => {
            if (!dispatched) return;
            inputHistory.record(session, snapshot.composer.text);
            setComposerCommandError(false);
            clearCommandParameterValues();
          },
          () => undefined,
        );
      } catch (error) {
        reportComposerCommandError(error);
      }
    },
    [
      canSubmit,
      clearCommandParameterValues,
      commandParametersByKey,
      composerCommandRegistry,
      composerSuggestionsByCommandKey,
      agentCommands,
      inputHistory,
      reportComposerCommandError,
      preferredRunningMode,
      session,
      updateCommandParameterValues,
    ],
  );

  return dispatchComposer;
}
