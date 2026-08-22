"use client";

import { RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import type { SettingsItemComponentProps } from "@/platform/extensions";
import { usePiActiveSessionId } from "@/runtime/pi/client/runtime/context";
import { listPiSkills, PiApiError } from "@/runtime/pi/client/transport/api";
import type { SkillView } from "@/runtime/pi/rpc-contracts";

type LoadState = "idle" | "loading" | "ready" | "failed";

function SkillsSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-2xl border p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function SkillsSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { locale, t } = useI18n();
  const sessionId = usePiActiveSessionId();
  const [skills, setSkills] = useState<readonly SkillView[]>([]);
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const request = useRef(0);

  const load = useCallback(() => {
    const requestId = ++request.current;
    setSessionUnavailable(false);
    if (!sessionId) {
      setSkills([]);
      setLoadState("idle");
      return;
    }

    setLoadState("loading");
    void listPiSkills({ sessionId }).then(
      ({ skills: nextSkills }) => {
        if (request.current !== requestId) return;
        setSkills(nextSkills);
        setLoadState("ready");
      },
      (error: unknown) => {
        if (request.current !== requestId) return;
        setSessionUnavailable(error instanceof PiApiError && error.code === "session-not-found");
        setLoadState("failed");
      },
    );
  }, [sessionId]);

  useEffect(() => {
    setQuery("");
    load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    if (!normalizedQuery) return skills;
    return skills.filter((skill) =>
      `${skill.name} ${skill.description} ${skill.whenToUse ?? ""}`
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery),
    );
  }, [locale, query, skills]);

  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="min-h-0 pb-4">
      {!sessionId ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed px-5 py-10 text-center text-sm leading-6">
          {t("extensions.skills.noSession")}
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="relative min-w-48 flex-1">
              <span className="sr-only">{t("extensions.skills.searchLabel")}</span>
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                type="search"
                value={query}
                placeholder={t("extensions.skills.searchPlaceholder")}
                className="pl-8"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("extensions.skills.refresh")}
              title={t("extensions.skills.refresh")}
              onClick={load}
              disabled={loadState === "loading"}
            >
              <RefreshCwIcon
                className={`size-3.5 ${loadState === "loading" ? "animate-spin" : ""}`}
              />
            </Button>
          </div>

          {loadState === "loading" ? (
            <div aria-live="polite" aria-label={t("extensions.skills.loading")} aria-busy="true">
              <SkillsSkeleton />
            </div>
          ) : loadState === "failed" ? (
            <div
              role="alert"
              className="rounded-2xl border border-destructive/30 px-5 py-8 text-center"
            >
              <p className="text-sm font-medium">
                {t(
                  sessionUnavailable
                    ? "extensions.skills.sessionUnavailable"
                    : "extensions.skills.loadFailed",
                )}
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={load}>
                {t("extensions.skills.retry")}
              </Button>
            </div>
          ) : (
            <>
              <p className="text-muted-foreground mb-3 text-xs">
                {t("extensions.skills.count", { count: filteredSkills.length })}
              </p>

              {skills.length === 0 ? (
                <div className="text-muted-foreground rounded-2xl border border-dashed px-5 py-10 text-center text-sm leading-6">
                  {t("extensions.skills.empty")}
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className="text-muted-foreground rounded-2xl border border-dashed px-5 py-10 text-center text-sm leading-6">
                  {t("extensions.skills.noMatches")}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSkills.map((skill) => (
                    <article key={skill.name} className="rounded-2xl border px-4 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 flex-1 font-mono text-sm font-medium break-all">
                          {skill.name}
                        </h3>
                        <span
                          className={
                            skill.modelInvocable
                              ? "rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground rounded-full px-2 py-1 text-[11px] font-medium"
                          }
                        >
                          {t(
                            skill.modelInvocable
                              ? "extensions.skills.modelInvocable"
                              : "extensions.skills.manualOnly",
                          )}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-2 text-sm leading-5">
                        {skill.description}
                      </p>
                      {skill.whenToUse ? (
                        <p className="text-muted-foreground mt-2 text-xs leading-5">
                          <span className="text-foreground font-medium">
                            {t("extensions.skills.whenToUse")}
                          </span>{" "}
                          {skill.whenToUse}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
