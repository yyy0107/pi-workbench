"use client";

import { FileTextIcon, PlayIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { expandPromptTemplateContent } from "@workbench/agent-runtime-pi-shared/commands";
import { BUILTIN_PROMPT_PREFERENCE_KEYS } from "@workbench/agent-runtime-contracts/settings";
import {
  useToolCapabilityPreferences,
  useToolCapabilityPreferencesController,
} from "@workbench/shell/tool-capability-preferences";
import { Button, Switch } from "@workbench/shell/ui";
import { usePiI18n, type PiTranslate } from "../../i18n";
import { skillDocumentBody } from "./toolbox-capability-presentation";

export const BUILTIN_PROMPT_NAMES = ["pi-extension", "pi-hook", "pi-tool", "pi-skill"] as const;

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
  onOpen,
  onUse,
}: {
  query: string;
  onOpen(
    template: ReturnType<typeof getBuiltinPromptTemplates>[number],
    event: MouseEvent<HTMLButtonElement>,
  ): void;
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
          <BuiltinPromptTemplateRow
            key={template.name}
            template={template}
            onOpen={onOpen}
            onUse={onUse}
          />
        ))}
      </ul>
    </section>
  );
}

function BuiltinPromptTemplateRow({
  template,
  onOpen,
  onUse,
}: {
  template: ReturnType<typeof getBuiltinPromptTemplates>[number];
  onOpen: Parameters<typeof BuiltinPromptTemplates>[0]["onOpen"];
  onUse: Parameters<typeof BuiltinPromptTemplates>[0]["onUse"];
}) {
  const { t } = usePiI18n();
  const key = BUILTIN_PROMPT_PREFERENCE_KEYS[template.name];
  const preference = useToolCapabilityPreferences(key);
  const controller = useToolCapabilityPreferencesController(key);
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        className="h-auto min-w-0 flex-1 items-start justify-start gap-3 px-3 py-[calc(var(--control-content-padding-block-default)*1.5)] text-left font-normal whitespace-normal"
        aria-label={t("extensions.toolbox.openDetails", {
          name: template.title,
        })}
        onClick={(event) => onOpen(template, event)}
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
          <code className="text-muted-foreground mt-1 block text-xs">
            /{builtinPromptCommandName(template.name)}
          </code>
        </span>
      </Button>
      <Switch
        size="compact"
        checked={preference.enabled}
        disabled={preference.status !== "ready"}
        aria-label={t("extensions.toolbox.prompts.enabledNamed", { name: template.title })}
        onCheckedChange={(checked) => void controller.setEnabled(checked).catch(() => undefined)}
      />
      <Button
        variant="outline"
        size="sm"
        className="me-3 shrink-0"
        aria-label={t("extensions.toolbox.prompts.useNowNamed", { name: template.title })}
        disabled={!preference.enabled || preference.status !== "ready"}
        onClick={() => onUse(builtinPromptCommandName(template.name))}
      >
        <PlayIcon aria-hidden="true" />
        {t("extensions.toolbox.prompts.useNow")}
      </Button>
      {preference.saveFailed ? (
        <p role="alert" className="text-destructive px-3 text-sm">
          {t("extensions.toolbox.prompts.failed")}
        </p>
      ) : null}
    </li>
  );
}
