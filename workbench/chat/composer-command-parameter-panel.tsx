"use client";

import { SlidersHorizontalIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import type {
  ComposerCommandArgsBinding,
  ComposerCommandArgsSchema,
  ComposerJsonValue,
} from "@/platform/extensions";

import {
  composerCommandParameterEnumValues,
  composerCommandParameterDefaults,
  composerCommandParameterFields,
  composerCommandParameterIssues,
  type ComposerCommandParameterField,
  type ComposerCommandParameterIssue,
} from "./composer-command-parameters";

interface ComposerCommandParameterPanelProps {
  readonly command: {
    readonly label: string;
    readonly argsSchema: ComposerCommandArgsSchema;
    readonly argsBinding?: ComposerCommandArgsBinding;
  };
  readonly values: Readonly<Record<string, ComposerJsonValue>>;
  readonly revealValidation: boolean;
  readonly onChange: (values: Readonly<Record<string, ComposerJsonValue>>) => void;
  readonly onClose: () => void;
}

function stringValue(value: ComposerJsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: ComposerJsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parameterIssueMessage(
  issue: ComposerCommandParameterIssue,
  t: ReturnType<typeof useI18n>["t"],
  number: ReturnType<typeof useI18n>["number"],
): string {
  switch (issue.code) {
    case "required":
      return t("workbench.chat.composer.commandParameters.errors.required");
    case "invalidChoice":
      return t("workbench.chat.composer.commandParameters.errors.invalidChoice");
    case "invalidNumber":
      return t("workbench.chat.composer.commandParameters.errors.invalidNumber");
    case "integer":
      return t("workbench.chat.composer.commandParameters.errors.integer");
    case "minimum":
      return t("workbench.chat.composer.commandParameters.errors.minimum", {
        limit: number(issue.limit),
      });
    case "maximum":
      return t("workbench.chat.composer.commandParameters.errors.maximum", {
        limit: number(issue.limit),
      });
    case "minLength":
      return t("workbench.chat.composer.commandParameters.errors.minLength", {
        limit: number(issue.limit),
      });
    case "maxLength":
      return t("workbench.chat.composer.commandParameters.errors.maxLength", {
        limit: number(issue.limit),
      });
  }
}

function CommandParameterFieldEditor({
  field,
  binding,
  value,
  autoFocus,
  issue,
  revealIssue,
  onBlur,
  onChange,
}: Readonly<{
  field: ComposerCommandParameterField;
  binding?: ComposerCommandArgsBinding;
  value?: ComposerJsonValue;
  autoFocus: boolean;
  issue?: ComposerCommandParameterIssue;
  revealIssue: boolean;
  onBlur(): void;
  onChange(value: ComposerJsonValue | undefined): void;
}>) {
  const { t, number } = useI18n();
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const schemaTitle = stringValue(field.schema.title);
  const description = stringValue(field.schema.description);
  const schemaType = stringValue(field.schema.type) ?? "string";
  const enumValues = composerCommandParameterEnumValues(field.schema);
  const selectableValues = enumValues.length > 0 ? enumValues : [true, false];
  const selectedIndex = selectableValues.findIndex((option) => Object.is(option, value));
  const visibleIssue = revealIssue ? issue : undefined;
  const issueMessage = visibleIssue ? parameterIssueMessage(visibleIssue, t, number) : undefined;
  const describedBy = [description ? descriptionId : undefined, issueMessage ? errorId : undefined]
    .filter(Boolean)
    .join(" ");
  const placeholder = t("workbench.chat.composer.commandParameters.valuePlaceholder", {
    parameter: field.id,
  });

  return (
    <div className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(8rem,0.9fr)_minmax(0,2fr)] sm:items-start sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1 sm:pt-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor={inputId} className="min-w-0 truncate text-sm font-medium">
            {schemaTitle ?? field.id}
          </label>
          <span
            className={
              field.required
                ? "inline-flex rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] leading-none font-medium text-blue-600 dark:text-blue-400"
                : "bg-muted text-muted-foreground inline-flex rounded-md px-1.5 py-0.5 text-[11px] leading-none font-medium"
            }
          >
            {field.required
              ? t("workbench.chat.composer.commandParameters.required")
              : t("workbench.chat.composer.commandParameters.optional")}
          </span>
        </div>
        {schemaTitle && schemaTitle !== field.id ? (
          <code className="text-muted-foreground truncate text-xs">{field.id}</code>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-1.5">
        {enumValues.length > 0 || schemaType === "boolean" ? (
          <select
            id={inputId}
            autoFocus={autoFocus}
            value={value === undefined ? "" : selectedIndex < 0 ? "" : String(selectedIndex + 1)}
            aria-invalid={visibleIssue ? true : undefined}
            aria-describedby={describedBy || undefined}
            className="h-[var(--input-control-height)] w-full rounded-[var(--input-control-radius)] border [border-color:var(--input-control-border)] [background:var(--input-control-background)] px-2.5 text-sm outline-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
            onBlur={onBlur}
            onChange={(event) => {
              const selectedIndex = Number(event.target.value) - 1;
              onChange(selectedIndex >= 0 ? selectableValues[selectedIndex] : undefined);
            }}
          >
            <option value="">
              {field.required
                ? t("workbench.chat.composer.commandParameters.selectPlaceholder")
                : t("workbench.chat.composer.commandParameters.notSet")}
            </option>
            {enumValues.map((option, index) => (
              <option key={`${index}:${typeof option}:${option}`} value={String(index + 1)}>
                {typeof option === "boolean"
                  ? t(
                      option
                        ? "workbench.chat.composer.commandParameters.enabled"
                        : "workbench.chat.composer.commandParameters.disabled",
                    )
                  : String(option)}
              </option>
            ))}
            {enumValues.length === 0 && schemaType === "boolean" ? (
              <>
                <option value="1">{t("workbench.chat.composer.commandParameters.enabled")}</option>
                <option value="2">{t("workbench.chat.composer.commandParameters.disabled")}</option>
              </>
            ) : null}
          </select>
        ) : binding?.field === field.id ? (
          <Textarea
            id={inputId}
            autoFocus={autoFocus}
            rows={1}
            value={stringValue(value) ?? ""}
            maxLength={numberValue(field.schema.maxLength)}
            placeholder={placeholder}
            aria-invalid={visibleIssue ? true : undefined}
            aria-describedby={describedBy || undefined}
            className="min-h-[var(--input-control-height)] resize-y py-1 text-base leading-6 md:text-sm"
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.value || undefined)}
          />
        ) : (
          <Input
            id={inputId}
            autoFocus={autoFocus}
            type={schemaType === "number" || schemaType === "integer" ? "number" : "text"}
            value={
              schemaType === "number" || schemaType === "integer"
                ? (numberValue(value) ?? "")
                : (stringValue(value) ?? "")
            }
            min={numberValue(field.schema.minimum)}
            max={numberValue(field.schema.maximum)}
            step={schemaType === "integer" ? 1 : schemaType === "number" ? "any" : undefined}
            maxLength={numberValue(field.schema.maxLength)}
            placeholder={placeholder}
            aria-invalid={visibleIssue ? true : undefined}
            aria-describedby={describedBy || undefined}
            className="h-[var(--input-control-height)]"
            onBlur={onBlur}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            onChange={(event) => {
              if (schemaType === "number" || schemaType === "integer") {
                const number = event.target.valueAsNumber;
                onChange(
                  event.target.value === "" || !Number.isFinite(number) ? undefined : number,
                );
              } else {
                onChange(event.target.value || undefined);
              }
            }}
          />
        )}

        {description ? (
          <p id={descriptionId} className="text-muted-foreground text-xs leading-5">
            {description}
          </p>
        ) : null}
        {issueMessage ? (
          <p id={errorId} role="alert" className="text-destructive text-xs leading-5">
            {issueMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ComposerCommandParameterPanel({
  command,
  values,
  revealValidation,
  onChange,
  onClose,
}: ComposerCommandParameterPanelProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLElement>(null);
  const [touchedFields, setTouchedFields] = useState<ReadonlySet<string>>(() => new Set());
  const fields = composerCommandParameterFields(command.argsSchema, command.argsBinding);
  const issues = composerCommandParameterIssues(command.argsSchema, command.argsBinding, values);
  const defaultValues = composerCommandParameterDefaults(command.argsSchema, command.argsBinding);
  const canReset =
    Object.keys(values).some((field) => !Object.hasOwn(defaultValues, field)) ||
    fields.some((field) => !Object.is(values[field.id], defaultValues[field.id]));

  useEffect(() => {
    if (!revealValidation) return;
    panelRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [revealValidation]);

  return (
    <section
      ref={panelRef}
      data-slot="composer-command-parameter-panel"
      aria-label={t("workbench.chat.composer.commandParameters.edit", {
        command: command.label,
      })}
      className="bg-background mb-2 grid w-full overflow-hidden rounded-[var(--composer-inner-radius)] border shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 border-b px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 flex size-8 shrink-0 items-center justify-center rounded-lg">
            <SlidersHorizontalIcon aria-hidden="true" className="size-4" />
          </span>
          <div className="grid min-w-0 gap-0.5">
            <h2 className="truncate text-sm font-medium">{command.label}</h2>
            <p className="text-muted-foreground truncate text-xs">
              {t("workbench.chat.composer.commandParameters.title")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2.5"
            disabled={!canReset}
            onClick={() => {
              setTouchedFields(new Set());
              onChange(defaultValues);
            }}
          >
            {t("workbench.chat.composer.commandParameters.reset")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 px-2.5"
            onClick={onClose}
          >
            {t("workbench.chat.composer.commandParameters.done")}
          </Button>
          <TooltipIconButton
            type="button"
            tooltip={t("workbench.chat.composer.commandParameters.close")}
            aria-label={t("workbench.chat.composer.commandParameters.close")}
            className="text-muted-foreground hover:text-foreground size-8 rounded-[var(--button-radius)]"
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </TooltipIconButton>
        </div>
      </div>

      <div className="divide-border grid max-h-[min(24rem,50vh)] overflow-y-auto px-3 divide-y sm:px-4">
        {fields.map((field, index) => (
          <CommandParameterFieldEditor
            key={field.id}
            field={field}
            binding={command.argsBinding}
            value={values[field.id]}
            autoFocus={index === 0}
            issue={issues[field.id]}
            revealIssue={revealValidation || touchedFields.has(field.id)}
            onBlur={() => {
              setTouchedFields((current) => new Set(current).add(field.id));
            }}
            onChange={(value) => {
              const next = { ...values };
              if (value === undefined) delete next[field.id];
              else next[field.id] = value;
              onChange(next);
            }}
          />
        ))}
      </div>
    </section>
  );
}
