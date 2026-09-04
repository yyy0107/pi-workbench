"use client";

import {
  useConversationNodes,
  useCurrentSession,
  useSessionState,
} from "@workbench/agent-runtime-client";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GaugeIcon,
  ScanSearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ScrollCompensatedDetails } from "@workbench/shell/elements";
import { Button } from "@workbench/shell/ui";
import { DropdownMenu, DropdownMenuRadioGroup } from "@workbench/shell/ui";
import { Input } from "@workbench/shell/ui";
import { useOpenerService, useWorkspaceContext } from "@workbench/shell/right-workspace/react";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workbench/shell/ui";
import {
  SettingsDropdownContent,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import { useReducedMotion } from "@workbench/shell/hooks";
import { formatAdaptiveDuration, formatCompactDuration } from "@workbench/shell/format-duration";
import { useMainViewService } from "@workbench/extension-host";
import { useSessionContextPolicy } from "@workbench/agent-runtime-pi-client/configuration";
import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import type {
  SessionContextBreakdownCategory,
  SessionContextPolicy,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  aggregateWorkbenchSessionStatistics,
  mergeMonotonicWorkbenchSessionStatistics,
  type WorkbenchSessionStatistics,
} from "@workbench/agent-runtime-client/message-statistics";

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

const CONTEXT_BUDGET_MODES = [
  "inherit",
  "custom",
] as const satisfies readonly SessionContextPolicy["mode"][];

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

function useMonotonicSessionStatistics(
  current: WorkbenchSessionStatistics,
): WorkbenchSessionStatistics {
  const snapshot = useRef(current);
  snapshot.current = mergeMonotonicWorkbenchSessionStatistics(snapshot.current, current);
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
  statistics: WorkbenchSessionStatistics,
  reduceMotion: boolean,
): WorkbenchSessionStatistics {
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
  const { locale, number, t } = usePiI18n();
  const contextBudgetValidationId = useId();
  const remoteId = useCurrentSession().threadId;
  const reduceMotion = useReducedMotion();
  const nodes = useConversationNodes();
  const isRunning = useSessionState((state) => state.isRunning);
  const contextPolicy = useSessionContextPolicy(remoteId);
  const openers = useOpenerService();
  const workspaceContext = useWorkspaceContext();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [customBudget, setCustomBudget] = useState("");
  const [customBudgetEditing, setCustomBudgetEditing] = useState(false);
  const [contextActionError, setContextActionError] = useState<unknown>(null);
  const currentTime = useLiveStatisticsTime(isRunning);
  const currentStatistics = useMemo(
    () => aggregateWorkbenchSessionStatistics(nodes, isRunning ? currentTime : undefined),
    [currentTime, isRunning, nodes],
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
  const contextBudgetMode = context?.policy.mode ?? "inherit";
  const selectedContextBudgetMode = customBudgetEditing ? "custom" : contextBudgetMode;
  const modelCapacity = context?.model?.capacity;
  const parsedCustomBudget = Number(customBudget);
  const invalidCustomBudget =
    !Number.isInteger(parsedCustomBudget) ||
    parsedCustomBudget < 1 ||
    modelCapacity === undefined ||
    parsedCustomBudget > modelCapacity;
  const contextTokens = context?.usage.tokens;
  const contextBudget = context?.model?.effectiveBudget;
  const displayedContextBudget =
    customBudgetEditing && !invalidCustomBudget ? parsedCustomBudget : contextBudget;
  const selectedContextBudgetModeLabel = t(
    `extensions.tokenUsage.contextBudgetModes.${selectedContextBudgetMode}`,
  );
  const displayedContextBudgetLabel =
    displayedContextBudget === undefined ? unavailable : compactTokens(displayedContextBudget);
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
    setCustomBudgetEditing(false);
    setContextActionError(null);
  }, [
    context?.model?.capacity,
    context?.model?.effectiveBudget,
    context?.policy.desiredContextTokens,
  ]);

  useEffect(() => {
    if (!isRunning && remoteId) void contextPolicy.refresh().catch(() => undefined);
  }, [contextPolicy.refresh, isRunning, nodes.length, remoteId]);

  const updateContextPolicy = (policy: SessionContextPolicy) => {
    setContextActionError(null);
    void contextPolicy.update(policy).catch((error: unknown) => setContextActionError(error));
  };

  const selectContextBudgetMode = (mode: SessionContextPolicy["mode"]) => {
    if (mode === "custom") {
      setCustomBudgetEditing(true);
      setContextActionError(null);
      return;
    }
    setCustomBudgetEditing(false);
    updateContextPolicy({
      mode,
      ...(mode === "inherit" || !context?.policy.compaction
        ? {}
        : { compaction: context.policy.compaction }),
    });
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
              className="space-y-1"
              role="list"
              aria-label={t("extensions.tokenUsage.modelInputBreakdown")}
            >
              {contextBreakdownGroups.map((group) => (
                <ScrollCompensatedDetails key={group.id} role="listitem" className="group">
                  <summary className="hover:bg-muted/60 focus-visible:ring-ring -mx-1 flex min-h-7 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-xs outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-3 shrink-0 transition-transform group-open:rotate-90"
                    />
                    <span
                      aria-hidden="true"
                      className={`size-2.5 shrink-0 rounded-[3px] ${group.colorClassName}`}
                    />
                    <span className="min-w-0 flex-1">
                      {t(`extensions.tokenUsage.breakdownGroups.${group.id}`)}
                    </span>
                    <span className="text-foreground shrink-0 font-medium tabular-nums">
                      {t("extensions.tokenUsage.estimatedTokenValue", {
                        tokens: compactTokens(group.tokens),
                      })}
                    </span>
                  </summary>
                  <div className="text-muted-foreground mt-0.5 ml-7 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-[11px] leading-4">
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
                </ScrollCompensatedDetails>
              ))}
            </div>
          ) : null}

          <div className="border-t pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">{t("extensions.tokenUsage.contextBudget")}</p>
              <DropdownMenu>
                <SettingsDropdownTrigger
                  aria-label={t("extensions.tokenUsage.contextBudgetControlLabel", {
                    mode: selectedContextBudgetModeLabel,
                    tokens: displayedContextBudgetLabel,
                  })}
                  className="min-w-28 justify-between gap-1.5 px-2.5 text-xs"
                  disabled={
                    isRunning || contextPolicy.status === "saving" || !remoteId || !context?.model
                  }
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span>{selectedContextBudgetModeLabel}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {displayedContextBudgetLabel}
                    </span>
                  </span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className="text-muted-foreground size-3 shrink-0"
                  />
                </SettingsDropdownTrigger>
                <SettingsDropdownContent align="end" side="bottom">
                  <DropdownMenuRadioGroup
                    value={selectedContextBudgetMode}
                    aria-label={t("extensions.tokenUsage.contextBudget")}
                    onValueChange={(nextMode) => {
                      const mode = CONTEXT_BUDGET_MODES.find((candidate) => candidate === nextMode);
                      if (mode) selectContextBudgetMode(mode);
                    }}
                  >
                    {CONTEXT_BUDGET_MODES.map((mode) => (
                      <SettingsDropdownRadioItem
                        key={mode}
                        value={mode}
                        className="py-1 text-xs"
                        disabled={isRunning || contextPolicy.status === "saving" || !remoteId}
                      >
                        {t(`extensions.tokenUsage.contextBudgetModes.${mode}`)}
                      </SettingsDropdownRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </SettingsDropdownContent>
              </DropdownMenu>
            </div>
            {selectedContextBudgetMode === "custom" && modelCapacity ? (
              <div className="mt-1.5">
                <div className="flex gap-2">
                  <Input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={customBudget}
                    disabled={isRunning || contextPolicy.status === "saving"}
                    aria-label={t("extensions.tokenUsage.customContextBudget")}
                    aria-invalid={invalidCustomBudget}
                    aria-describedby={invalidCustomBudget ? contextBudgetValidationId : undefined}
                    className="text-xs tabular-nums"
                    onChange={(event) => {
                      setCustomBudget(event.currentTarget.value.replace(/\D+/gu, ""));
                      setContextActionError(null);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full"
                    disabled={
                      isRunning ||
                      contextPolicy.status === "saving" ||
                      invalidCustomBudget ||
                      !remoteId
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
                {invalidCustomBudget ? (
                  <p
                    id={contextBudgetValidationId}
                    className="text-destructive mt-1 text-[11px] leading-4"
                    role="alert"
                  >
                    {t("extensions.tokenUsage.customContextBudgetInvalid", {
                      tokens: number(modelCapacity),
                    })}
                  </p>
                ) : null}
              </div>
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
  const threadId = useCurrentSession().sessionId;

  if (activeMainView) return null;

  return <ThreadTokenUsage key={threadId} />;
}
