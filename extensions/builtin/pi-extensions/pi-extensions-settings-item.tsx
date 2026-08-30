"use client";

import { ChevronDownIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import type { SettingsItemComponentProps } from "@/platform/extensions";
import {
  listPiExtensions,
  usePiSessionCatalog,
} from "@/workbench/runtime-contributions/pi/client/resources";
import type { ExtensionView } from "@/workbench/runtime-contributions/pi/protocol/rpc";

interface PiExtensionsCatalog {
  readonly extensions: readonly ExtensionView[];
  readonly loadErrorCount: number;
}

const EMPTY_PI_EXTENSIONS_CATALOG: PiExtensionsCatalog = {
  extensions: [],
  loadErrorCount: 0,
};

async function loadPiExtensionsCatalog(sessionId: string): Promise<PiExtensionsCatalog> {
  return listPiExtensions({ sessionId });
}

function capabilityNames(extension: ExtensionView): string[] {
  return [...extension.eventNames, ...extension.toolNames, ...extension.commandNames];
}

function extensionKey(extension: ExtensionView, index: number): string {
  return `${extension.scope}:${extension.origin}:${extension.source}:${extension.name}:${index}`;
}

function PiExtensionsSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-2xl border p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-3 w-48" />
          <Skeleton className="mt-3 h-6 w-64 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function CapabilityDetails({
  emptyLabel,
  label,
  names,
}: Readonly<{ emptyLabel: string; label: string; names: readonly string[] }>) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="mt-1.5 flex flex-wrap gap-1.5">
        {names.length > 0 ? (
          names.map((name) => (
            <code key={name} className="bg-muted rounded-md px-2 py-1 text-[11px] break-all">
              {name}
            </code>
          ))
        ) : (
          <span className="text-muted-foreground text-xs">{emptyLabel}</span>
        )}
      </dd>
    </div>
  );
}

export function PiExtensionsSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { locale, t } = useI18n();
  const {
    sessionId,
    value: { extensions, loadErrorCount },
    loadState,
    sessionUnavailable,
    refresh,
  } = usePiSessionCatalog(loadPiExtensionsCatalog, EMPTY_PI_EXTENSIONS_CATALOG);
  const [query, setQuery] = useState("");
  const [expandedExtensionKey, setExpandedExtensionKey] = useState<string>();

  useEffect(() => {
    setQuery("");
    setExpandedExtensionKey(undefined);
  }, [sessionId]);

  const filteredExtensions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return extensions
      .map((extension, index) => ({ extension, key: extensionKey(extension, index) }))
      .filter(
        ({ extension }) =>
          !normalizedQuery ||
          [
            extension.name,
            extension.source,
            extension.scope,
            extension.origin,
            ...capabilityNames(extension),
          ]
            .join(" ")
            .toLocaleLowerCase(locale)
            .includes(normalizedQuery),
      );
  }, [extensions, locale, query]);

  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="min-h-0 pb-4">
      {!sessionId ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed px-5 py-10 text-center text-sm leading-6">
          {t("extensions.piExtensions.noSession")}
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="relative min-w-48 flex-1">
              <span className="sr-only">{t("extensions.piExtensions.searchLabel")}</span>
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                type="search"
                value={query}
                placeholder={t("extensions.piExtensions.searchPlaceholder")}
                className="pl-8"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("extensions.piExtensions.refresh")}
              title={t("extensions.piExtensions.refresh")}
              onClick={refresh}
              disabled={loadState === "loading"}
            >
              <RefreshCwIcon
                className={`size-3.5 ${loadState === "loading" ? "animate-spin" : ""}`}
              />
            </Button>
          </div>

          {loadState === "loading" ? (
            <div
              aria-live="polite"
              aria-label={t("extensions.piExtensions.loading")}
              aria-busy="true"
            >
              <PiExtensionsSkeleton />
            </div>
          ) : loadState === "failed" ? (
            <div
              role="alert"
              className="rounded-2xl border border-destructive/30 px-5 py-8 text-center"
            >
              <p className="text-sm font-medium">
                {t(
                  sessionUnavailable
                    ? "extensions.piExtensions.sessionUnavailable"
                    : "extensions.piExtensions.loadFailed",
                )}
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={refresh}>
                {t("extensions.piExtensions.retry")}
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  {t("extensions.piExtensions.count", { count: filteredExtensions.length })}
                </p>
                {loadErrorCount > 0 ? (
                  <p className="text-destructive text-xs" role="status">
                    {t("extensions.piExtensions.loadErrors", { count: loadErrorCount })}
                  </p>
                ) : null}
              </div>

              {extensions.length === 0 ? (
                <div className="text-muted-foreground rounded-2xl border border-dashed px-5 py-10 text-center text-sm leading-6">
                  {t("extensions.piExtensions.empty")}
                </div>
              ) : filteredExtensions.length === 0 ? (
                <div className="text-muted-foreground rounded-2xl border border-dashed px-5 py-10 text-center text-sm leading-6">
                  {t("extensions.piExtensions.noMatches")}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredExtensions.map(({ extension, key }, index) => {
                    const expanded = expandedExtensionKey === key;
                    const detailsId = `pi-extension-details-${index}`;

                    return (
                      <article key={key} className="overflow-hidden rounded-2xl border">
                        <button
                          type="button"
                          className="hover:bg-muted/40 focus-visible:ring-ring w-full px-4 py-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
                          aria-expanded={expanded}
                          aria-controls={detailsId}
                          title={t(
                            expanded
                              ? "extensions.piExtensions.hideDetails"
                              : "extensions.piExtensions.showDetails",
                            { name: extension.name },
                          )}
                          onClick={() => setExpandedExtensionKey(expanded ? undefined : key)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="min-w-0 flex-1 font-mono text-sm font-medium break-all">
                              {extension.name}
                            </h3>
                            <span className="bg-muted text-muted-foreground rounded-full px-2 py-1 text-[11px] font-medium">
                              {t(`extensions.piExtensions.scopes.${extension.scope}`)}
                            </span>
                            <span className="bg-muted text-muted-foreground rounded-full px-2 py-1 text-[11px] font-medium">
                              {t(`extensions.piExtensions.origins.${extension.origin}`)}
                            </span>
                            <ChevronDownIcon
                              aria-hidden="true"
                              className={`text-muted-foreground size-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                            />
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <span className="rounded-full border px-2 py-1 text-[11px]">
                              {t("extensions.piExtensions.events", {
                                count: extension.eventNames.length,
                              })}
                            </span>
                            <span className="rounded-full border px-2 py-1 text-[11px]">
                              {t("extensions.piExtensions.tools", {
                                count: extension.toolNames.length,
                              })}
                            </span>
                            <span className="rounded-full border px-2 py-1 text-[11px]">
                              {t("extensions.piExtensions.commands", {
                                count: extension.commandNames.length,
                              })}
                            </span>
                          </div>
                        </button>

                        {expanded ? (
                          <div
                            id={detailsId}
                            role="region"
                            aria-label={t("extensions.piExtensions.detailsLabel", {
                              name: extension.name,
                            })}
                            className="border-t px-4 py-4"
                          >
                            <dl className="space-y-4">
                              <div>
                                <dt className="text-muted-foreground text-xs font-medium">
                                  {t("extensions.piExtensions.source")}
                                </dt>
                                <dd className="mt-1.5 font-mono text-xs break-all">
                                  {extension.source}
                                </dd>
                              </div>
                              <CapabilityDetails
                                label={t("extensions.piExtensions.registeredEvents")}
                                names={extension.eventNames}
                                emptyLabel={t("extensions.piExtensions.none")}
                              />
                              <CapabilityDetails
                                label={t("extensions.piExtensions.registeredTools")}
                                names={extension.toolNames}
                                emptyLabel={t("extensions.piExtensions.none")}
                              />
                              <CapabilityDetails
                                label={t("extensions.piExtensions.registeredCommands")}
                                names={extension.commandNames}
                                emptyLabel={t("extensions.piExtensions.none")}
                              />
                            </dl>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
