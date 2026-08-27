"use client";

import { XIcon } from "lucide-react";
import { useId } from "react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import type {
  ComposerCommandArgsBinding,
  ComposerCommandArgsSchema,
  ComposerJsonValue,
} from "@/platform/extensions";

interface ComposerCommandParameterField {
  readonly id: string;
  readonly schema: Readonly<Record<string, ComposerJsonValue>>;
  readonly required: boolean;
}

interface ComposerCommandParameterPanelProps {
  readonly command: {
    readonly label: string;
    readonly argsSchema: ComposerCommandArgsSchema;
    readonly argsBinding?: ComposerCommandArgsBinding;
  };
  readonly values: Readonly<Record<string, ComposerJsonValue>>;
  readonly onChange: (values: Readonly<Record<string, ComposerJsonValue>>) => void;
  readonly onClose: () => void;
}

function isRecord(value: unknown): value is Readonly<Record<string, ComposerJsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: ComposerJsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: ComposerJsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function composerCommandParameterFields(
  argsSchema: ComposerCommandArgsSchema,
  argsBinding?: ComposerCommandArgsBinding,
): readonly ComposerCommandParameterField[] {
  const properties = isRecord(argsSchema.properties) ? argsSchema.properties : {};
  const required = new Set(
    Array.isArray(argsSchema.required)
      ? argsSchema.required.filter((value): value is string => typeof value === "string")
      : [],
  );
  const fieldIds = argsBinding
    ? [argsBinding.field, ...Object.keys(properties).filter((field) => field !== argsBinding.field)]
    : Object.keys(properties);

  return fieldIds.map((id) => ({
    id,
    schema: isRecord(properties[id]) ? properties[id] : { type: "string" },
    required: required.has(id),
  }));
}

function CommandParameterFieldEditor({
  field,
  binding,
  value,
  autoFocus,
  onChange,
}: Readonly<{
  field: ComposerCommandParameterField;
  binding?: ComposerCommandArgsBinding;
  value?: ComposerJsonValue;
  autoFocus: boolean;
  onChange(value: ComposerJsonValue | undefined): void;
}>) {
  const { t } = useI18n();
  const inputId = useId();
  const schemaTitle = stringValue(field.schema.title);
  const description = stringValue(field.schema.description);
  const schemaType = stringValue(field.schema.type) ?? "string";
  const enumValues = Array.isArray(field.schema.enum)
    ? field.schema.enum.filter(
        (option): option is string | number =>
          typeof option === "string" || typeof option === "number",
      )
    : [];
  const placeholder = t("workbench.chat.composer.commandParameters.valuePlaceholder", {
    parameter: field.id,
  });

  return (
    <div className="grid grid-cols-[minmax(8rem,0.9fr)_minmax(0,2fr)] items-start gap-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-1 pt-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor={inputId} className="min-w-0 truncate font-mono text-sm font-medium">
            {field.id}
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
          <span className="text-muted-foreground truncate text-xs">{schemaTitle}</span>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-1.5">
        {enumValues.length > 0 ? (
          <select
            id={inputId}
            autoFocus={autoFocus}
            value={value === undefined ? "" : String(value)}
            className="h-[var(--input-control-height)] w-full rounded-[var(--input-control-radius)] border [border-color:var(--input-control-border)] [background:var(--input-control-background)] px-2.5 text-sm outline-none"
            onChange={(event) => {
              const selected = enumValues.find((option) => String(option) === event.target.value);
              onChange(selected);
            }}
          >
            <option value="">{placeholder}</option>
            {enumValues.map((option) => (
              <option key={`${typeof option}:${option}`} value={String(option)}>
                {String(option)}
              </option>
            ))}
          </select>
        ) : schemaType === "boolean" ? (
          <label className="flex min-h-[var(--input-control-height)] items-center gap-2 rounded-[var(--input-control-radius)] border [border-color:var(--input-control-border)] [background:var(--input-control-background)] px-2.5 text-sm">
            <input
              id={inputId}
              type="checkbox"
              autoFocus={autoFocus}
              checked={value === true}
              className="accent-blue-500"
              onChange={(event) => onChange(event.target.checked)}
            />
            <span>{t("workbench.chat.composer.commandParameters.enabled")}</span>
          </label>
        ) : binding?.field === field.id ? (
          <Textarea
            id={inputId}
            autoFocus={autoFocus}
            value={stringValue(value) ?? ""}
            maxLength={numberValue(field.schema.maxLength)}
            placeholder={placeholder}
            className="min-h-20 resize-y text-base leading-6 md:text-sm"
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
            maxLength={numberValue(field.schema.maxLength)}
            placeholder={placeholder}
            className="h-[var(--input-control-height)]"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            onChange={(event) => {
              if (schemaType === "number" || schemaType === "integer") {
                onChange(event.target.value === "" ? undefined : Number(event.target.value));
              } else {
                onChange(event.target.value || undefined);
              }
            }}
          />
        )}

        {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      </div>
    </div>
  );
}

export function ComposerCommandParameterPanel({
  command,
  values,
  onChange,
  onClose,
}: ComposerCommandParameterPanelProps) {
  const { t } = useI18n();
  const fields = composerCommandParameterFields(command.argsSchema, command.argsBinding);

  return (
    <section
      data-slot="composer-command-parameter-panel"
      aria-label={t("workbench.chat.composer.commandParameters.edit", {
        command: command.label,
      })}
      className="bg-background mb-2 grid w-full gap-4 rounded-[22px] border p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 text-sm font-medium text-blue-500 dark:text-blue-400">
          <span className="truncate">{command.label}</span>
        </div>
        <TooltipIconButton
          type="button"
          tooltip={t("workbench.chat.composer.commandParameters.close")}
          aria-label={t("workbench.chat.composer.commandParameters.close")}
          className="text-muted-foreground hover:text-foreground size-7 rounded-full"
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </TooltipIconButton>
      </div>

      <div className="divide-border grid divide-y">
        {fields.map((field, index) => (
          <CommandParameterFieldEditor
            key={field.id}
            field={field}
            binding={command.argsBinding}
            value={values[field.id]}
            autoFocus={index === 0}
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
