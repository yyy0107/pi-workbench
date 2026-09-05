"use client";

import { useLayoutEffect } from "react";
import { FileTextIcon } from "lucide-react";
import type { ComposerCommandDefinition } from "@workbench/extension-sdk";
import { definePiMessage, usePiI18n, type PiTranslate } from "../../i18n";
import {
  BUILTIN_PROMPT_NAMES,
  builtinPromptCommandName,
  expandBuiltinPromptTemplate,
} from "./builtin-prompt-templates";

/** Each Toolbox activation resolves template content in its own Shell's current language. */
export function createBuiltinPromptCommands() {
  let translate: PiTranslate | undefined;

  function BuiltinPromptCommandLocale() {
    const { t } = usePiI18n();
    useLayoutEffect(() => {
      translate = t;
      return () => {
        translate = undefined;
      };
    }, [t]);
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
        draft.text = expandBuiltinPromptTemplate(
          { name, content: translate(`extensions.toolbox.prompts.builtins.${name}.content`) },
          draft.text,
        );
      },
    },
  }));

  return { commands, component: BuiltinPromptCommandLocale };
}
