"use client";

import { FileTextIcon, PlayIcon, PlusIcon } from "lucide-react";

import { expandPromptTemplateContent } from "@workbench/agent-runtime-pi-shared/commands";
import { Button } from "@workbench/shell/ui";
import { usePiI18n, type PiTranslate } from "../../i18n";
import { skillDocumentBody } from "./toolbox-capability-presentation";

export const BUILTIN_PROMPT_NAMES = [
  "pi-extension",
  "pi-hook",
  "pi-tool",
  "pi-skill",
  "code-review",
  "debug-issue",
  "implement-feature",
  "safe-refactor",
  "write-tests",
] as const;

export interface PromptTemplateDraft {
  name: string;
  content: string;
}

export function builtinPromptCommandName(name: string) {
  return `prompts-${name}`;
}

export function expandBuiltinPromptTemplate(template: PromptTemplateDraft, arguments_: string) {
  return expandPromptTemplateContent(skillDocumentBody(template.content), arguments_, 1024 * 1024);
}

export function getBuiltinPromptTemplates(t: PiTranslate) {
  return BUILTIN_PROMPT_NAMES.map((name) => ({
    name,
    title: t(`extensions.toolbox.prompts.builtins.${name}.title`),
    description: t(`extensions.toolbox.prompts.builtins.${name}.description`),
    content: t(`extensions.toolbox.prompts.builtins.${name}.content`),
  }));
}

export function BuiltinPromptTemplates({
  query,
  createDisabled,
  onCreate,
  onUse,
}: {
  query: string;
  createDisabled: boolean;
  onCreate(template: PromptTemplateDraft): void;
  onUse(commandName: string): void;
}) {
  const { t, locale } = usePiI18n();
  const normalized = query.trim().toLocaleLowerCase(locale);
  const templates = getBuiltinPromptTemplates(t).filter((template) =>
    `/${builtinPromptCommandName(template.name)} ${template.title} ${template.description}`
      .toLocaleLowerCase(locale)
      .includes(normalized),
  );
  if (templates.length === 0) return null;

  return (
    <section aria-label={t("extensions.toolbox.prompts.builtinTitle")} className="mb-6">
      <h2 className="px-3 text-base font-medium">{t("extensions.toolbox.prompts.builtinTitle")}</h2>
      <p className="text-muted-foreground mt-1 px-3 text-sm leading-6">
        {t("extensions.toolbox.prompts.builtinDescription")}
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 @2xl:grid-cols-2">
        {templates.map((template) => (
          <li key={template.name} className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              disabled={createDisabled}
              className="h-auto min-w-0 flex-1 justify-start gap-3 px-3 py-[calc(var(--control-content-padding-block-default)*1.5)] text-left font-normal whitespace-normal"
              aria-label={t("extensions.toolbox.prompts.createFromBuiltin", {
                name: template.title,
              })}
              onClick={() => onCreate({ name: template.name, content: template.content })}
            >
              <span className="bg-muted/30 text-info-foreground flex size-(--button-height-large) shrink-0 items-center justify-center rounded-(--button-radius)">
                <FileTextIcon
                  aria-hidden="true"
                  className="[--button-icon-size:calc(var(--icon-size-md)*1.75)]"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base leading-5">{template.title}</span>
                <span className="text-muted-foreground mt-1 block text-sm leading-5">
                  {template.description}
                </span>
                <code className="text-muted-foreground mt-2 block text-xs">
                  /{builtinPromptCommandName(template.name)}
                </code>
              </span>
              <PlusIcon aria-hidden="true" className="text-muted-foreground shrink-0" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="me-3 shrink-0"
              aria-label={t("extensions.toolbox.prompts.useNowNamed", { name: template.title })}
              onClick={() => onUse(builtinPromptCommandName(template.name))}
            >
              <PlayIcon aria-hidden="true" />
              {t("extensions.toolbox.prompts.useNow")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
