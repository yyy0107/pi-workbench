import { cn } from "../utils";
import type { WorkbenchComposerJsonValue } from "@workbench/contracts/composer/request";

interface ComposerCommandArgumentEntry {
  readonly field?: string;
  readonly value: string;
}

function isRecord(
  value: WorkbenchComposerJsonValue,
): value is Readonly<Record<string, WorkbenchComposerJsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatArgumentValue(value: WorkbenchComposerJsonValue): string {
  if (typeof value === "string") return value || '""';
  return JSON.stringify(value) ?? "null";
}

export function composerCommandArgumentEntries(
  args: WorkbenchComposerJsonValue | undefined,
  omittedFields: ReadonlySet<string> = new Set(),
): readonly ComposerCommandArgumentEntry[] {
  if (args === undefined) return [];
  if (!isRecord(args)) return [{ value: formatArgumentValue(args) }];
  return Object.entries(args).flatMap(([field, value]) =>
    omittedFields.has(field) ? [] : [{ field, value: formatArgumentValue(value) }],
  );
}

/** Presents the safe structured arguments already stored on a Composer command. */
export function ComposerCommandArguments({
  args,
  omittedFields,
  fieldLabels,
  className,
}: Readonly<{
  args?: WorkbenchComposerJsonValue;
  omittedFields?: ReadonlySet<string>;
  fieldLabels?: Readonly<Record<string, string>>;
  className?: string;
}>) {
  const entries = composerCommandArgumentEntries(args, omittedFields);
  if (entries.length === 0) return null;

  return (
    <span
      data-slot="composer-command-arguments"
      className={cn("inline-flex max-w-full min-w-0 flex-wrap gap-1", className)}
    >
      {entries.map((entry, index) => (
        <span
          key={entry.field ?? index}
          data-field={entry.field}
          className={cn(
            "bg-foreground/[0.055] inline-grid max-w-full min-w-0 rounded-md px-2 py-0.5 leading-5",
            entry.field && "grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-1.5",
          )}
        >
          {entry.field ? (
            <span className="text-muted-foreground whitespace-nowrap">
              {fieldLabels?.[entry.field] ?? entry.field}
            </span>
          ) : null}
          <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {entry.value}
          </span>
        </span>
      ))}
    </span>
  );
}
