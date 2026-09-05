"use client";

import { Fragment, createElement, useLayoutEffect } from "react";
import { BUILTIN_PROMPT_PREFERENCE_KEYS } from "@workbench/agent-runtime-contracts/settings";
import { useToolCapabilityPreferences } from "@workbench/shell/tool-capability-preferences";
import { FileTextIcon } from "lucide-react";
import type { ComposerCommandDefinition, ComposerCommandRegistry } from "@workbench/extension-sdk";
import { definePiMessage, usePiI18n, type PiTranslate } from "../../i18n";
import {
  BUILTIN_PROMPT_NAMES,
  builtinPromptCommandName,
  expandBuiltinPromptTemplate,
} from "./builtin-prompt-templates";

/** Each Toolbox activation resolves template content in its own Shell's current language. */
export function createBuiltinPromptCommands(registry: ComposerCommandRegistry) {
  const available = new Set<string>();
  let translate: PiTranslate | undefined;

  function BuiltinPromptCommandLocale() {
    const { t } = usePiI18n();
    useLayoutEffect(() => {
      translate = t;
      return () => {
        translate = undefined;
      };
    }, [t]);
    return createElement(
      Fragment,
      null,
      ...commands.map((command, index) =>
        createElement(BuiltinPromptCommandBinding, {
          key: command.id,
          command,
          name: BUILTIN_PROMPT_NAMES[index],
        }),
      ),
    );
  }

  function BuiltinPromptCommandBinding({
    command,
    name,
  }: {
    command: ComposerCommandDefinition;
    name: (typeof BUILTIN_PROMPT_NAMES)[number];
  }) {
    const preference = useToolCapabilityPreferences(BUILTIN_PROMPT_PREFERENCE_KEYS[name]);
    useLayoutEffect(() => {
      if (preference.status !== "ready" || !preference.enabled) return;
      available.add(command.id);
      const registration = registry.register(command);
      return () => {
        available.delete(command.id);
        registration.dispose();
      };
    }, [command, preference.status, preference.enabled]);
    return null;
  }

  const commands: ComposerCommandDefinition[] = BUILTIN_PROMPT_NAMES.map((name) => ({
    id: builtinPromptCommandName(name),
    label: `/${builtinPromptCommandName(name)}`,
    description: definePiMessage(`extensions.toolbox.prompts.builtins.${name}.description`),
    icon: FileTextIcon,
    composer: {
      behavior: "transform",
      effect: "prompt-transform",
      group: "prompt-template",
      scope: "message",
      apply(draft) {
        if (!translate) throw new Error("Builtin prompt commands are not mounted");
        if (!available.has(builtinPromptCommandName(name)))
          throw new Error(translate("extensions.toolbox.prompts.disabledUse"));
        draft.text = expandBuiltinPromptTemplate(
          { name, content: translate(`extensions.toolbox.prompts.builtins.${name}.content`) },
          draft.text,
        );
      },
    },
  }));

  return { commands, component: BuiltinPromptCommandLocale };
}
