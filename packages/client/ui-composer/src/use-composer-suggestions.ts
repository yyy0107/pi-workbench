"use client";

import { composerTranslationBundle as inputTriggerTranslationBundle } from "@workbench/ui-input-trigger/i18n";
import { useI18n } from "@workbench/i18n";
import type { CatalogTranslate } from "@workbench/i18n/runtime";

import { useMemo } from "react";

import type { ComposerCommandDefinition } from "@workbench/extension-sdk";

import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";

import {
  AGENT_COMMAND_DIRECTIVE_TYPE,
  agentSkillDirectiveType,
  composerCommandArgumentKey,
  isAgentComposerDirectiveType,
  WORKBENCH_COMMAND_DIRECTIVE_TYPE,
} from "./composer-document";
import { composerCommandArgumentHint } from "@workbench/ui-input-trigger/public-composer-command-argument-hint";
import { sortComposerSuggestions } from "@workbench/ui-input-trigger/public-composer-command-group-order";

import { formatAgentCommandLabel } from "@workbench/ui-input-trigger/public-agent-command";

import {
  suggestionKey,
  commandSourceMeta,
  builtinCommandPresentation,
  type WorkbenchComposerSuggestion,
} from "../lib/composer-suggestion-model";
export function useComposerSuggestions({
  agentCommands,
  registeredComposerCommands,
  localize,
  triggerT,
}: {
  agentCommands: readonly WorkbenchAgentCommand[];
  registeredComposerCommands: readonly ComposerCommandDefinition[];
  localize: ReturnType<typeof useI18n>["text"];
  triggerT: CatalogTranslate<(typeof inputTriggerTranslationBundle.messages)["en-US"]>;
}) {
  const composerSuggestions = useMemo<readonly WorkbenchComposerSuggestion[]>(() => {
    const definitions = new Map(
      registeredComposerCommands.map((definition) => [definition.id, definition]),
    );
    const agentCommandIds = new Set<string>();
    const suggestions: WorkbenchComposerSuggestion[] = [];

    for (const command of agentCommands) {
      agentCommandIds.add(command.invocationName);
      const definition = definitions.get(command.invocationName);
      const builtin = builtinCommandPresentation(command, triggerT);
      const label = definition
        ? localize(definition.label)
        : (builtin?.label ?? formatAgentCommandLabel(command.name));
      const description = definition?.description
        ? localize(definition.description)
        : (builtin?.description ?? command.description ?? command.name);
      const argsSchema = definition?.composer.argsSchema ?? command.argsSchema;
      const argsBinding = definition?.composer.argsBinding ?? command.argsBinding;
      const argumentHint = composerCommandArgumentHint({
        explicitHint: builtin?.argumentHint ?? command.argumentHint,
        argsSchema,
        argsBinding,
      });
      const type =
        command.kind === "skill"
          ? (agentSkillDirectiveType(command.source.scope) ?? AGENT_COMMAND_DIRECTIVE_TYPE)
          : AGENT_COMMAND_DIRECTIVE_TYPE;
      suggestions.push({
        item: { id: command.invocationName, type, label, description },
        command: {
          name: command.invocationName,
          label,
          description,
          meta: commandSourceMeta(command, triggerT),
          ...(argumentHint ? { argumentHint } : {}),
        },
        group: command.kind,
        exclusive: command.exclusive,
        ...(argsSchema ? { argsSchema } : {}),
        ...(argsBinding ? { argsBinding } : {}),
        ...(definition ? { definition } : {}),
      });
    }

    for (const definition of registeredComposerCommands) {
      if (agentCommandIds.has(definition.id)) continue;
      const label = localize(definition.label);
      const description = definition.description ? localize(definition.description) : label;
      const argumentHint = composerCommandArgumentHint({
        argsSchema: definition.composer.argsSchema,
        argsBinding: definition.composer.argsBinding,
      });
      suggestions.push({
        item: {
          id: definition.id,
          type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
          label,
          description,
        },
        command: {
          name: definition.id,
          label,
          description,
          ...(argumentHint ? { argumentHint } : {}),
        },
        group: "workbench",
        exclusive: definition.composer.exclusive ?? false,
        ...(definition.composer.argsSchema ? { argsSchema: definition.composer.argsSchema } : {}),
        ...(definition.composer.argsBinding
          ? { argsBinding: definition.composer.argsBinding }
          : {}),
        definition,
      });
    }

    return sortComposerSuggestions(suggestions);
  }, [agentCommands, localize, registeredComposerCommands, triggerT]);
  const composerSuggestionsByKey = useMemo(
    () =>
      new Map(
        composerSuggestions.map((suggestion) => [suggestionKey(suggestion.item), suggestion]),
      ),
    [composerSuggestions],
  );
  const composerSuggestionsByCommandKey = useMemo(
    () =>
      new Map(
        composerSuggestions.map((suggestion) => [
          composerCommandArgumentKey(
            isAgentComposerDirectiveType(suggestion.item.type) ? "agent" : "workbench",
            suggestion.item.id,
          ),
          suggestion,
        ]),
      ),
    [composerSuggestions],
  );
  return { composerSuggestions, composerSuggestionsByKey, composerSuggestionsByCommandKey };
}
