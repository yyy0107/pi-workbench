"use client";

import { AlertCircleIcon, CheckCircle2Icon, ImportIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@workbench/shell/ui";
import { Skeleton } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import { cn } from "@workbench/shell/utils";
import type { SettingsItemComponentProps } from "@workbench/extension-sdk";
import { usePiExternalImportClient } from "@workbench/agent-runtime-pi-client/external-import";
import type {
  ExternalSessionImportScanValue,
  ExternalSessionImportView,
  ExternalSessionSource,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { withTooltip } from "@workbench/shell/ui";

const IMPORT_BATCH_SIZE = 200;

function selectionKey(session: ExternalSessionImportView): string {
  return `${session.source}\0${session.sourceSessionId}`;
}

function SourceName({ source }: { source: ExternalSessionSource }) {
  const { t } = usePiI18n();
  return <>{t(`extensions.externalSessionImport.sources.${source}`)}</>;
}

function ImportSkeleton() {
  return (
    <div className="space-y-2 p-4" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-xl border px-4 py-3">
          <Skeleton className="size-4 rounded" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-48 max-w-full" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function SessionRow({
  checked,
  onCheckedChange,
  session,
}: {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  session: ExternalSessionImportView;
}) {
  const { date, number, t } = usePiI18n();
  const issueLabel = session.alreadyImported
    ? t("extensions.externalSessionImport.states.imported")
    : session.issue
      ? t(`extensions.externalSessionImport.issues.${session.issue}`)
      : undefined;
  const label = t("extensions.externalSessionImport.selectSession", { title: session.title });

  return (
    <label
      className={cn(
        "flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
        session.importable ? "hover:bg-muted/50 cursor-pointer" : "opacity-65",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={!session.importable}
        aria-label={label}
        className="accent-primary size-4 shrink-0"
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{session.title}</span>
          {session.subagent ? (
            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px]">
              {t("extensions.externalSessionImport.states.subagent")}
            </span>
          ) : null}
        </span>
        {withTooltip(
          <span
            className="text-muted-foreground mt-1 block truncate font-mono text-xs"
            title={session.cwd}
          >
            {session.cwd || t("extensions.externalSessionImport.states.unknownProject")}
          </span>,
        )}
      </span>
      <span className="text-muted-foreground shrink-0 text-right text-xs">
        <span className="block">
          {date(session.updatedAt, { dateStyle: "medium", timeStyle: "short" })}
        </span>
        <span className={cn("mt-1 block", issueLabel && "text-amber-600 dark:text-amber-400")}>
          {issueLabel ??
            (session.messageCount === undefined
              ? t("extensions.externalSessionImport.states.ready")
              : t("extensions.externalSessionImport.messageCount", {
                  count: number(session.messageCount),
                }))}
        </span>
      </span>
    </label>
  );
}

export function ExternalSessionImportSettingsItem({
  sectionId,
  itemId,
}: SettingsItemComponentProps) {
  const externalImportClient = usePiExternalImportClient();
  const { number, t } = usePiI18n();
  const [snapshot, setSnapshot] = useState<ExternalSessionImportScanValue>();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const next = await externalImportClient.scan();
      setSnapshot(next);
      setSelected((current) => {
        const available = new Set(
          next.sources.flatMap((source) =>
            source.sessions.filter((session) => session.importable).map(selectionKey),
          ),
        );
        return new Set([...current].filter((key) => available.has(key)));
      });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const available = useMemo(
    () =>
      snapshot?.sources.flatMap((source) =>
        source.sessions.filter((session) => session.importable),
      ) ?? [],
    [snapshot],
  );
  const selectedSessions = available.filter((session) => selected.has(selectionKey(session)));

  const importSelected = async () => {
    if (selectedSessions.length === 0) return;
    setImporting(true);
    setError(false);
    let importedCount = 0;
    let skippedCount = 0;
    try {
      for (let offset = 0; offset < selectedSessions.length; offset += IMPORT_BATCH_SIZE) {
        const imported = await externalImportClient.import({
          sessions: selectedSessions
            .slice(offset, offset + IMPORT_BATCH_SIZE)
            .map(({ source, sourceSessionId }) => ({ source, sourceSessionId })),
        });
        importedCount += imported.imported.length;
        skippedCount += imported.skipped.length;
      }
      setResult({ imported: importedCount, skipped: skippedCount });
      setSelected(new Set());
      await load();
    } catch {
      if (importedCount > 0 || skippedCount > 0) {
        setResult({ imported: importedCount, skipped: skippedCount });
        await load();
      }
      setError(true);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="min-w-0">
      <div className="flex justify-end border-b py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || importing}
          onClick={() => void load()}
        >
          <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
          {t("extensions.externalSessionImport.refresh")}
        </Button>
      </div>

      {result ? (
        <div
          className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"
          role="status"
        >
          <CheckCircle2Icon className="me-2 inline size-4" />
          {t("extensions.externalSessionImport.result", {
            imported: number(result.imported),
            skipped: number(result.skipped),
          })}
        </div>
      ) : null}
      {error ? (
        <div
          className="bg-destructive/8 text-destructive mt-4 rounded-xl border border-destructive/20 px-4 py-3 text-sm"
          role="alert"
        >
          <AlertCircleIcon className="me-2 inline size-4" />
          {t("extensions.externalSessionImport.errors.requestFailed")}
        </div>
      ) : null}

      <div>
        {loading && !snapshot ? <ImportSkeleton /> : null}
        {!loading &&
        snapshot &&
        snapshot.sources.every((source) => source.sessions.length === 0) ? (
          <div className="text-muted-foreground flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center">
            <ImportIcon className="size-8 opacity-50" />
            <p className="text-sm">{t("extensions.externalSessionImport.empty")}</p>
          </div>
        ) : null}
        {snapshot?.sources.map((source) => (
          <section key={source.source} className="border-b py-5 last:border-b-0">
            <div className="mb-3 flex items-center gap-2 px-1">
              <h2 className="text-sm font-semibold">
                <SourceName source={source.source} />
              </h2>
              <span className="text-muted-foreground text-xs">
                {number(source.sessions.length)}
              </span>
              {source.status !== "ready" ? (
                <span className="text-muted-foreground ms-auto text-xs">
                  {t(`extensions.externalSessionImport.sourceStatus.${source.status}`)}
                </span>
              ) : null}
            </div>
            <div className="space-y-2">
              {source.sessions.map((session) => {
                const key = selectionKey(session);
                return (
                  <SessionRow
                    key={key}
                    session={session}
                    checked={selected.has(key)}
                    onCheckedChange={(checked) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(key);
                        else next.delete(key);
                        return next;
                      });
                    }}
                  />
                );
              })}
              {source.sessions.length === 0 && source.status === "ready" ? (
                <p className="text-muted-foreground px-1 py-4 text-sm">
                  {t("extensions.externalSessionImport.noSessions")}
                </p>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      <div className="bg-background/95 sticky -bottom-5 z-10 flex flex-wrap items-center gap-3 border-t py-3 backdrop-blur-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={available.length === 0 || importing}
          onClick={() =>
            setSelected(
              selectedSessions.length === available.length
                ? new Set()
                : new Set(available.map(selectionKey)),
            )
          }
        >
          {selectedSessions.length === available.length && available.length > 0
            ? t("extensions.externalSessionImport.clearSelection")
            : t("extensions.externalSessionImport.selectAll")}
        </Button>
        <span className="text-muted-foreground text-sm">
          {t("extensions.externalSessionImport.selectedCount", {
            count: number(selectedSessions.length),
          })}
        </span>
        <Button
          type="button"
          className="ms-auto"
          disabled={selectedSessions.length === 0 || importing}
          onClick={() => void importSelected()}
        >
          <ImportIcon className="size-4" />
          {importing
            ? t("extensions.externalSessionImport.importing")
            : t("extensions.externalSessionImport.importSelected")}
        </Button>
      </div>
    </div>
  );
}
