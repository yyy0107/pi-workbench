import { composerTranslationBundle as inputTriggerTranslationBundle } from "@workbench/ui-input-trigger/i18n";

import type { CatalogTranslate } from "@workbench/i18n/runtime";

import type {
  ComposerCommandArgsSchema,
  ComposerCommandDefinition,
  ComposerCommandArgsBinding,
  ComposerJsonValue,
  ComposerCommandRegistry,
} from "@workbench/extension-sdk";

import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";

import {
  composerCommandArgumentKey,
  isAgentComposerDirectiveType,
  WORKBENCH_COMMAND_DIRECTIVE_TYPE,
} from "../src/composer-document";

import { composerCommandParameterFields } from "@workbench/ui-input-trigger/composer-command-parameters";

import { type ComposerTriggerItem } from "../src/composer-directive";

import {
  type WorkbenchComposerMenuSuggestion,
  type WorkbenchComposerSuggestionGroup,
} from "../src/workbench-composer-view";

export interface WorkbenchComposerSuggestion extends WorkbenchComposerMenuSuggestion {
  readonly group: WorkbenchAgentCommand["kind"] | "workbench";
  readonly exclusive: boolean;
  readonly argsSchema?: ComposerCommandArgsSchema;
  readonly argsBinding?: ComposerCommandArgsBinding;
  readonly definition?: ComposerCommandDefinition;
}

export type ComposerCommandParameterValues = Readonly<Record<string, ComposerJsonValue>>;
export type ComposerCommandParametersByKey = Readonly<
  Record<string, ComposerCommandParameterValues>
>;

export function suggestionKey(item: Pick<ComposerTriggerItem, "id" | "type">): string {
  return `${item.type}:${item.id}`;
}

export function suggestionParameterKey(item: Pick<ComposerTriggerItem, "id" | "type">): string {
  return composerCommandArgumentKey(
    isAgentComposerDirectiveType(item.type) ? "agent" : "workbench",
    item.id,
  );
}

export function suggestionHasParameterFields(
  suggestion: WorkbenchComposerSuggestion | undefined,
): boolean {
  return Boolean(
    suggestion?.argsSchema &&
    composerCommandParameterFields(suggestion.argsSchema, suggestion.argsBinding).length > 0,
  );
}

export function suggestionGroupLabel(
  group: WorkbenchComposerSuggestionGroup,
  t: CatalogTranslate<(typeof inputTriggerTranslationBundle.messages)["en-US"]>,
  runtimeName: string,
  count: number,
): string {
  switch (group) {
    case "builtin":
      return t("workbench.chat.composer.commandGroups.builtin", { runtimeName, count });
    case "extension":
      return t("workbench.chat.composer.commandGroups.extension", { count });
    case "prompt":
      return t("workbench.chat.composer.commandGroups.prompt", { count });
    case "skill":
      return t("workbench.chat.composer.commandGroups.skill", { count });
    case "workbench":
      return t("workbench.chat.composer.commandGroups.workbench", { count });
  }
}

export function commandSourceMeta(
  command: WorkbenchAgentCommand,
  t: CatalogTranslate<(typeof inputTriggerTranslationBundle.messages)["en-US"]>,
): string | undefined {
  if (command.kind === "builtin") return undefined;
  return t(`workbench.chat.composer.commandScopes.${command.source.scope}`);
}

export function builtinCommandPresentation(
  command: WorkbenchAgentCommand,
  t: CatalogTranslate<(typeof inputTriggerTranslationBundle.messages)["en-US"]>,
): { label: string; description: string; argumentHint?: string } | undefined {
  if (command.kind !== "builtin") return undefined;
  switch (command.name) {
    case "compact":
      return {
        label: t("workbench.chat.composer.builtinCommands.compact.label"),
        description: t("workbench.chat.composer.builtinCommands.compact.description"),
        argumentHint: t("workbench.chat.composer.builtinCommands.compact.argumentHint"),
      };
    case "reload":
      return {
        label: t("workbench.chat.composer.builtinCommands.reload.label"),
        description: t("workbench.chat.composer.builtinCommands.reload.description"),
      };
  }
  return undefined;
}

export function directiveGroup(
  item: Pick<ComposerTriggerItem, "id" | "type">,
  registry: Pick<ComposerCommandRegistry, "get">,
): string | undefined {
  if (item.type !== WORKBENCH_COMMAND_DIRECTIVE_TYPE && !isAgentComposerDirectiveType(item.type)) {
    return undefined;
  }
  const definition = registry.get(item.id);
  if (!definition) return undefined;
  return (
    definition.composer.group ??
    (definition.composer.behavior === "modifier" ? `modifier:${definition.id}` : undefined)
  );
}
