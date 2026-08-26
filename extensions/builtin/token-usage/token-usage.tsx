"use client";

import { useAuiState } from "@assistant-ui/react";
import { GaugeIcon, ScanSearchIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOpenerService, useWorkspaceContext } from "@/components/right-workspace";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { formatAdaptiveDuration, formatCompactDuration } from "@/lib/format-duration";
import { useMainViewService } from "@/platform/extensions";
import { useSessionContextPolicy } from "@/runtime/pi/client/context-policy/use-session-context-policy";
import { PiApiError } from "@/runtime/pi/client/transport/api";
import type {
  SessionContextBreakdownCategory,
  SessionContextPolicy,
} from "@/runtime/pi/rpc-contracts";
import {
  aggregatePiSessionStatistics,
  mergeMonotonicPiSessionStatistics,
  type PiSessionStatistics,
} from "@/runtime/pi/client/messages/session-statistics";

import {
  interpolateTokenQuantities,
  TOKEN_ANIMATION_DURATION_MS,
  tokenQuantities,
  tokenQuantitiesEqual,
  type TokenQuantities,
} from "./token-animation";

const CONTEXT_BREAKDOWN_GROUPS = [
  {
    id: "instructions",
    categories: ["system-prompt", "skills", "context-files"],
    colorClassName: "bg-slate-400 dark:bg-slate-500",
  },
  {
    id: "tools",
    categories: ["builtin-tools", "mcp-tools", "extension-tools"],
    colorClassName: "bg-violet-500 dark:bg-violet-400",
  },
  {
    id: "conversation",
    categories: ["user-input", "assistant-history", "tool-results", "other"],
    colorClassName: "bg-blue-500 dark:bg-blue-400",
  },
] as const satisfies ReadonlyArray<{
  id: "instructions" | "tools" | "conversation";
  categories: readonly SessionContextBreakdownCategory[];
  colorClassName: string;
}>;

type ContextActionErrorMessageKey =
  | "extensions.tokenUsage.contextActionBusy"
  | "extensions.tokenUsage.contextActionFailed"
  | "extensions.tokenUsage.contextAlreadyCompacted"
  | "extensions.tokenUsage.contextCompactionCancelled"
  | "extensions.tokenUsage.contextTooSmall";

function contextActionErrorMessageKey(error: unknown): ContextActionErrorMessageKey {
  if (!(error instanceof PiApiError)) return "extensions.tokenUsage.contextActionFailed";
  if (error.code === "agent-busy") return "extensions.tokenUsage.contextActionBusy";
  if (error.code !== "compaction-unavailable") {
    return "extensions.tokenUsage.contextActionFailed";
  }

  switch (error.details.reason) {
    case "already-compacted":
      return "extensions.tokenUsage.contextAlreadyCompacted";
    case "cancelled":
      return "extensions.tokenUsage.contextCompactionCancelled";
    case "context-too-small":
      return "extensions.tokenUsage.contextTooSmall";
    default:
      return "extensions.tokenUsage.contextActionFailed";
  }
}

function Separator() {
  return (
    <span aria-hidden="true" className="px-2 text-border">
      |
    </span>
  );
}

function useLiveStatisticsTime(isRunning: boolean): number {
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  return currentTime;
}

function useMonotonicSessionStatistics(current: PiSessionStatistics): PiSessionStatistics {
  const snapshot = useRef(current);
  snapshot.current = mergeMonotonicPiSessionStatistics(snapshot.current, current);
  return snapshot.current;
}

interface TokenAnimationState {
  displayed: TokenQuantities;
  from: TokenQuantities;
  target: TokenQuantities;
  startedAt: number;
  frameId?: number;
}

function useAnimatedTokenStatistics(
  statistics: PiSessionStatistics,
  reduceMotion: boolean,
): PiSessionStatistics {
  const target = useMemo(
    () => tokenQuantities(statistics),
    [
      statistics.cacheReadTokens,
      statistics.cacheWriteTokens,
      statistics.inputTokens,
      statistics.outputTokens,
    ],
  );
  const [displayed, setDisplayed] = useState(target);
  const animation = useRef<TokenAnimationState>({
    displayed: target,
    from: target,
    target,
    startedAt: 0,
  });

  useEffect(() => {
    const state = animation.current;
    if (reduceMotion) {
      if (state.frameId !== undefined) window.cancelAnimationFrame(state.frameId);
      state.displayed = target;
      state.from = target;
      state.target = target;
      state.frameId = undefined;
      return;
    }
    const now = performance.now();
    const progress =
      state.frameId === undefined ? 1 : (now - state.startedAt) / TOKEN_ANIMATION_DURATION_MS;
    const current = interpolateTokenQuantities(state.from, state.target, progress);
    state.displayed = current;
    state.from = current;
    state.target = target;
    state.startedAt = now;

    if (tokenQuantitiesEqual(current, target) || state.frameId !== undefined) return;

    const animate = (time: number) => {
      const active = animation.current;
      const next = interpolateTokenQuantities(
        active.from,
        active.target,
        (time - active.startedAt) / TOKEN_ANIMATION_DURATION_MS,
      );
      active.displayed = next;
      setDisplayed(next);
      if (tokenQuantitiesEqual(next, active.target)) {
        active.frameId = undefined;
        return;
      }
      active.frameId = window.requestAnimationFrame(animate);
    };

    state.frameId = window.requestAnimationFrame(animate);
  }, [reduceMotion, target]);

  useEffect(
    () => () => {
      const frameId = animation.current.frameId;
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    },
    [],
  );

  return { ...statistics, ...(reduceMotion ? target : displayed) };
}

function ThreadTokenUsage() {
  const { locale, number, t } = useI18n();
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
  const reduceMotion = useReducedMotion();
  const messages = useAuiState((state) => state.thread.messages);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const contextPolicy = useSessionContextPolicy(remoteId);
  const openers = useOpenerService();
  const workspaceContext = useWorkspaceContext();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [customBudget, setCustomBudget] = useState("");
  const [contextActionError, setContextActionError] = useState<unknown>(null);
  const currentTime = useLiveStatisticsTime(isRunning);
  const currentStatistics = useMemo(
    () => aggregatePiSessionStatistics(messages, isRunning ? currentTime : undefined),
    [currentTime, isRunning, messages],
  );
  const monotonicStatistics = useMonotonicSessionStatistics(currentStatistics);
  const statistics = useAnimatedTokenStatistics(monotonicStatistics, reduceMotion);
  const promptTokens =
    statistics.inputTokens + statistics.cacheReadTokens + statistics.cacheWriteTokens;
  const averageFirstToken =
    statistics.firstTokenSamples > 0
      ? statistics.firstTokenDurationMs / statistics.firstTokenSamples
      : undefined;
  const tokensPerSecond =
    statistics.llmDurationMs > 0
      ? statistics.outputTokens / (statistics.llmDurationMs / 1_000)
      : undefined;
  const cacheHitRate = promptTokens > 0 ? statistics.cacheReadTokens / promptTokens : undefined;
  const compactTokens = (tokens: number) =>
    number(Math.round(tokens), {
      notation: "compact",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  const duration = (milliseconds: number) =>
    formatCompactDuration(milliseconds, locale, { includeZero: true });
  const averageDuration = (milliseconds: number) =>
    formatAdaptiveDuration(milliseconds, locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  const unavailable = t("extensions.tokenUsage.unavailable");
  const description = t("extensions.tokenUsage.description");
  const context = contextPolicy.value;
  const modelCapacity = context?.model?.capacity;
  const parsedCustomBudget = Number(customBudget);
  const invalidCustomBudget =
    !Number.isInteger(parsedCustomBudget) ||
    parsedCustomBudget < 1 ||
    modelCapacity === undefined ||
    parsedCustomBudget > modelCapacity;
  const contextTokens = context?.usage.tokens;
  const contextBudget = context?.model?.effectiveBudget;
  const contextPercent = context?.usage.percent;
  const contextBreakdown = context?.breakdown;
  const contextBreakdownItems = new Map(
    contextBreakdown?.items.map((item) => [item.category, item]) ?? [],
  );
  const contextBreakdownGroups = CONTEXT_BREAKDOWN_GROUPS.map((group) => ({
    ...group,
    tokens: group.categories.reduce(
      (sum, category) => sum + (contextBreakdownItems.get(category)?.tokens ?? 0),
      0,
    ),
  }));
  const contextUsedTokens = contextBreakdown?.totalTokens ?? contextTokens;
  const contextUsedPercent =
    contextPercent ??
    (contextUsedTokens !== null &&
    contextUsedTokens !== undefined &&
    contextBudget !== undefined &&
    contextBudget > 0
      ? (contextUsedTokens / contextBudget) * 100
      : undefined);
  const contextUsedPercentLabel =
    contextUsedPercent === undefined
      ? unavailable
      : number(contextUsedPercent / 100, {
          style: "percent",
          maximumFractionDigits: 1,
        });
  const contextEstimateLabel =
    contextUsedTokens === null || contextUsedTokens === undefined || contextBudget === undefined
      ? unavailable
      : t("extensions.tokenUsage.estimatedContextValue", {
          used: compactTokens(contextUsedTokens),
          budget: compactTokens(contextBudget),
        });
  const contextBarScale =
    contextBreakdown && contextBudget && contextBreakdown.totalTokens > contextBudget
      ? contextBudget / contextBreakdown.totalTokens
      : 1;
  const contextUsageLabel =
    contextBudget === undefined
      ? unavailable
      : t("extensions.tokenUsage.currentContextValue", {
          used:
            contextTokens === null || contextTokens === undefined
              ? "—"
              : compactTokens(contextTokens),
          budget: compactTokens(contextBudget),
        });

  useEffect(() => {
    setCustomBudget(
      String(
        context?.policy.desiredContextTokens ??
          context?.model?.effectiveBudget ??
          context?.model?.capacity ??
          "",
      ),
    );
    setContextActionError(null);
  }, [
    context?.model?.capacity,
    context?.model?.effectiveBudget,
    context?.policy.desiredContextTokens,
  ]);

  useEffect(() => {
    if (!isRunning && remoteId) void contextPolicy.refresh().catch(() => undefined);
  }, [contextPolicy.refresh, isRunning, messages.length, remoteId]);

  const updateContextPolicy = (policy: SessionContextPolicy) => {
    setContextActionError(null);
    void contextPolicy.update(policy).catch((error: unknown) => setContextActionError(error));
  };

  const contextActionFailure =
    contextActionError ?? (contextPolicy.status === "failed" ? contextPolicy.error : undefined);

  return (
    <div
      className="flex h-6 min-w-0 items-center overflow-hidden whitespace-nowrap text-[11px] tabular-nums"
      title={description}
    >
      <Popover
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (open) void contextPolicy.refresh().catch(() => undefined);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("extensions.tokenUsage.showDetails")}
              className={`h-6 gap-1 rounded-sm px-1 text-[11px] tabular-nums ${
                context?.nearingCompaction
                  ? "text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            />
          }
        >
          {context?.nearingCompaction ? (
            <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <GaugeIcon aria-hidden="true" className="size-3.5" />
          )}
          <span>{contextUsageLabel}</span>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={6}
          className="max-h-[calc(100vh-1rem)] w-[min(23rem,calc(100vw-1rem))] gap-4 overflow-y-auto rounded-2xl p-4"
        >
          <PopoverHeader className="sr-only">
            <PopoverTitle>{t("extensions.tokenUsage.currentContextTitle")}</PopoverTitle>
            <PopoverDescription>
              {t("extensions.tokenUsage.currentContextDescription")}
            </PopoverDescription>
          </PopoverHeader>
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4 tabular-nums">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t("extensions.tokenUsage.contextUsed")}
                </span>
                <span className="text-foreground font-semibold">{contextUsedPercentLabel}</span>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-foreground text-sm font-semibold">{contextEstimateLabel}</p>
                <p className="text-muted-foreground mt-0.5 max-w-44 truncate text-[11px]">
                  {context?.model?.name ?? unavailable}
                </p>
              </div>
            </div>
            <div
              className="bg-muted flex h-1.5 overflow-hidden rounded-full"
              role="progressbar"
              aria-label={t("extensions.tokenUsage.currentContextTitle")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                contextUsedPercent === undefined
                  ? undefined
                  : Math.min(100, Math.round(contextUsedPercent))
              }
            >
              {contextBreakdown && contextBudget ? (
                contextBreakdownGroups.map((group) => (
                  <div
                    key={group.id}
                    aria-hidden="true"
                    className={`h-full ${group.colorClassName}`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, (group.tokens * contextBarScale * 100) / contextBudget),
                      )}%`,
                    }}
                  />
                ))
              ) : (
                <div
                  aria-hidden="true"
                  className={
                    context?.nearingCompaction ? "h-full bg-amber-500" : "h-full bg-primary"
                  }
                  style={{
                    width: `${Math.min(100, Math.max(0, contextUsedPercent ?? 0))}%`,
                  }}
                />
              )}
            </div>
            {context?.nearingCompaction ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{t("extensions.tokenUsage.nearingCompaction")}</span>
              </p>
            ) : null}
          </div>

          {contextBreakdown ? (
            <div
              className="space-y-3"
              role="list"
              aria-label={t("extensions.tokenUsage.modelInputBreakdown")}
            >
              {contextBreakdownGroups.map((group) => (
                <section key={group.id} role="listitem">
                  <div className="flex items-center gap-2.5 text-sm">
                    <span
                      aria-hidden="true"
                      className={`size-3 shrink-0 rounded-[3px] ${group.colorClassName}`}
                    />
                    <span className="min-w-0 flex-1">
                      {t(`extensions.tokenUsage.breakdownGroups.${group.id}`)}
                    </span>
                    <span className="text-foreground shrink-0 font-medium tabular-nums">
                      {t("extensions.tokenUsage.estimatedTokenValue", {
                        tokens: compactTokens(group.tokens),
                      })}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1.5 ml-5.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[11px] leading-4">
                    {group.categories.map((category) => {
                      const tokens = contextBreakdownItems.get(category)?.tokens ?? 0;
                      return (
                        <div key={category} className="contents">
                          <span>{t(`extensions.tokenUsage.breakdownCategories.${category}`)}</span>
                          <span className="text-right tabular-nums">
                            {t("extensions.tokenUsage.estimatedTokenValue", {
                              tokens: compactTokens(tokens),
                            })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              <p className="text-muted-foreground text-[11px] leading-4">
                {contextBreakdown.basis === "provider-reconciled"
                  ? t("extensions.tokenUsage.breakdownProviderReconciled")
                  : t("extensions.tokenUsage.breakdownHeuristic")}
              </p>
            </div>
          ) : null}

          <div className="border-t pt-3">
            <p className="text-xs font-medium">{t("extensions.tokenUsage.contextBudget")}</p>
            <div className="mt-2 grid grid-cols-4 gap-1" role="radiogroup">
              {(["inherit", "auto", "maximum", "custom"] as const).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={context?.policy.mode === mode ? "default" : "outline"}
                  role="radio"
                  aria-checked={context?.policy.mode === mode}
                  className="h-7 rounded-full px-2 text-xs"
                  disabled={
                    isRunning ||
                    contextPolicy.status === "saving" ||
                    !remoteId ||
                    (mode === "custom" && invalidCustomBudget)
                  }
                  onClick={() => {
                    if (mode === "custom") {
                      if (!invalidCustomBudget) {
                        updateContextPolicy({
                          mode,
                          desiredContextTokens: parsedCustomBudget,
                          ...(context?.policy.compaction
                            ? { compaction: context.policy.compaction }
                            : {}),
                        });
                      }
                      return;
                    }
                    updateContextPolicy({
                      mode,
                      ...(mode === "inherit" || !context?.policy.compaction
                        ? {}
                        : { compaction: context.policy.compaction }),
                    });
                  }}
                >
                  {t(`extensions.tokenUsage.contextBudgetModes.${mode}`)}
                </Button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                value={customBudget}
                disabled={isRunning || contextPolicy.status === "saving" || !modelCapacity}
                aria-label={t("extensions.tokenUsage.customContextBudget")}
                aria-invalid={invalidCustomBudget}
                aria-describedby={
                  invalidCustomBudget ? "statusbar-context-budget-validation" : undefined
                }
                className="h-8 tabular-nums"
                onChange={(event) => {
                  setCustomBudget(event.currentTarget.value.replace(/\D+/gu, ""));
                  setContextActionError(null);
                }}
              />
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full"
                disabled={
                  isRunning || contextPolicy.status === "saving" || invalidCustomBudget || !remoteId
                }
                onClick={() =>
                  updateContextPolicy({
                    mode: "custom",
                    desiredContextTokens: parsedCustomBudget,
                    ...(context?.policy.compaction
                      ? { compaction: context.policy.compaction }
                      : {}),
                  })
                }
              >
                {t("extensions.tokenUsage.applyContextBudget")}
              </Button>
            </div>
            {invalidCustomBudget && modelCapacity ? (
              <p
                id="statusbar-context-budget-validation"
                className="text-destructive mt-1 text-xs"
                role="alert"
              >
                {t("extensions.tokenUsage.customContextBudgetInvalid", {
                  tokens: number(modelCapacity),
                })}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={isRunning || contextPolicy.status === "saving" || !remoteId}
              onClick={() => {
                setContextActionError(null);
                void contextPolicy
                  .compact()
                  .catch((error: unknown) => setContextActionError(error));
              }}
            >
              {t("extensions.tokenUsage.compactNow")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-full"
              disabled={!remoteId}
              onClick={() => {
                if (!remoteId) return;
                void openers.open({
                  resource: { scheme: "context-trace", path: remoteId },
                  context: workspaceContext,
                  policy: "reveal",
                });
                setDetailsOpen(false);
              }}
            >
              <ScanSearchIcon aria-hidden="true" />
              {t("extensions.tokenUsage.viewContextTrace")}
            </Button>
          </div>
          {contextActionFailure !== undefined && contextActionFailure !== null ? (
            <p className="text-destructive text-xs" role="alert">
              {t(contextActionErrorMessageKey(contextActionFailure))}
            </p>
          ) : null}

          <div className="border-t pt-3">
            <p className="mb-2 text-xs font-medium">{t("extensions.tokenUsage.cumulativeTitle")}</p>
            <div className="text-foreground flex flex-col gap-2 text-xs tabular-nums">
              <div className="flex flex-wrap items-center gap-x-1">
                <span>{t("extensions.tokenUsage.turns", { count: statistics.turns })}</span>
                <span aria-hidden="true">·</span>
                <span>{t("extensions.tokenUsage.steps", { count: statistics.steps })}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-1">
                <span>
                  {t("extensions.tokenUsage.llm")} {duration(statistics.llmDurationMs)}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t("extensions.tokenUsage.toolCalls")} {duration(statistics.toolDurationMs)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-1">
                <span>
                  {t("extensions.tokenUsage.averageFirstToken")}{" "}
                  {averageFirstToken === undefined
                    ? unavailable
                    : averageDuration(averageFirstToken)}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {tokensPerSecond === undefined
                    ? unavailable
                    : number(tokensPerSecond, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{" "}
                  {t("extensions.tokenUsage.tokensPerSecondUnit")}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t("extensions.tokenUsage.averageCacheHit")}{" "}
                  {cacheHitRate === undefined
                    ? unavailable
                    : number(cacheHitRate, { style: "percent", maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-1">
                <span>
                  {t("extensions.tokenUsage.input")} {compactTokens(promptTokens)}{" "}
                  {t("extensions.tokenUsage.tokenUnit")}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t("extensions.tokenUsage.output")} {compactTokens(statistics.outputTokens)}{" "}
                  {t("extensions.tokenUsage.tokenUnit")}
                </span>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <div className="@min-[240px]/statusbar-right:flex hidden min-w-0 items-center">
        <span className="@min-[560px]/statusbar-right:inline-flex hidden shrink-0 items-center">
          <Separator />
          <span>{t("extensions.tokenUsage.turns", { count: statistics.turns })}</span>
          <span className="px-1">·</span>
          <span>{t("extensions.tokenUsage.steps", { count: statistics.steps })}</span>
          <Separator />
        </span>
        <span className="@min-[760px]/statusbar-right:inline-flex hidden shrink-0 items-center">
          <span>
            {t("extensions.tokenUsage.llm")} {duration(statistics.llmDurationMs)}
          </span>
          <span className="px-1">·</span>
          <span>
            {t("extensions.tokenUsage.toolCalls")} {duration(statistics.toolDurationMs)}
          </span>
          <Separator />
        </span>
        <span className="@min-[1000px]/statusbar-right:inline-flex hidden shrink-0 items-center">
          <span>
            {t("extensions.tokenUsage.averageFirstToken")}{" "}
            {averageFirstToken === undefined ? unavailable : averageDuration(averageFirstToken)}
          </span>
          <span className="px-1">·</span>
          <span>
            {tokensPerSecond === undefined
              ? unavailable
              : number(tokensPerSecond, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}{" "}
            {t("extensions.tokenUsage.tokensPerSecondUnit")}
          </span>
          <span className="px-1">·</span>
          <span>
            {t("extensions.tokenUsage.averageCacheHit")}{" "}
            {cacheHitRate === undefined
              ? unavailable
              : number(cacheHitRate, { style: "percent", maximumFractionDigits: 0 })}
          </span>
          <Separator />
        </span>
        <span className="inline-flex min-w-0 shrink-0 items-center">
          <span>
            {t("extensions.tokenUsage.input")} {compactTokens(promptTokens)}{" "}
            {t("extensions.tokenUsage.tokenUnit")}
          </span>
          <span className="px-1">·</span>
          <span>
            {t("extensions.tokenUsage.output")} {compactTokens(statistics.outputTokens)}{" "}
            {t("extensions.tokenUsage.tokenUnit")}
          </span>
        </span>
      </div>
    </div>
  );
}

export function TokenUsage() {
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  const threadId = useAuiState((state) => state.threads.mainThreadId);

  if (activeMainView) return null;

  return <ThreadTokenUsage key={threadId} />;
}
