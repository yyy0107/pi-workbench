"use client";

import {
  useConversationNodes,
  useCurrentSession,
  useSessionState,
} from "@workbench/agent-runtime-client";
import { ChevronDownIcon, GaugeIcon, ScanSearchIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@workbench/shell/ui";
import { DropdownMenu, DropdownMenuRadioGroup } from "@workbench/shell/ui";
import { Input } from "@workbench/shell/ui";
import { useOpenerService, useWorkspaceContext } from "@workbench/shell/right-workspace/react";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workbench/shell/ui";
import {
  SettingsDropdownContent,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@workbench/shell/ui";
import { useI18n } from "@workbench/shell/i18n";
import { useReducedMotion } from "@workbench/shell/hooks";
import { formatAdaptiveDuration, formatCompactDuration } from "@workbench/shell/format-duration";
import { useMainViewService } from "@workbench/extension-host";
import {
  useWorkbenchSessionContextPolicy,
  useWorkbenchContextCapability,
} from "@workbench/agent-runtime-client/context";
import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client/capabilities";
import type {
  WorkbenchContextBreakdownCategory,
  WorkbenchContextPolicy,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";
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

import { TokenUsageSection } from "./token-usage-section";

const CONTEXT_BREAKDOWN_GROUPS = [
  {
    id: "instructions",
    categories: ["system-prompt", "skills", "context-files"],
    colorClassName: "bg-muted-foreground",
  },
  {
    id: "tools",
    categories: ["builtin-tools", "mcp-tools", "extension-tools"],
    colorClassName: "bg-chart-4",
  },
  {
    id: "conversation",
    categories: ["user-input", "assistant-history", "tool-results", "other"],
    colorClassName: "bg-info",
  },
] as const satisfies ReadonlyArray<{
  id: "instructions" | "tools" | "conversation";
  categories: readonly WorkbenchContextBreakdownCategory[];
  colorClassName: string;
}>;

const CONTEXT_BUDGET_MODES = [
  "inherit",
  "custom",
] as const satisfies readonly WorkbenchContextPolicy["mode"][];

type ContextActionErrorMessageKey =
  | "extensions.tokenUsage.contextActionBusy"
  | "extensions.tokenUsage.contextActionFailed"
  | "extensions.tokenUsage.contextAlreadyCompacted"
  | "extensions.tokenUsage.contextCompactionCancelled"
  | "extensions.tokenUsage.contextTooSmall";

function contextActionErrorMessageKey(error: unknown): ContextActionErrorMessageKey {
  if (!(error instanceof WorkbenchAgentCapabilityError))
    return "extensions.tokenUsage.contextActionFailed";
  if (error.code === "busy") return "extensions.tokenUsage.contextActionBusy";
  if (error.code !== "unavailable") {
    return "extensions.tokenUsage.contextActionFailed";
  }

  switch (error.details?.reason) {
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
  const { locale, number, t } = useI18n();
  const contextBudgetValidationId = useId();
  const remoteId = useCurrentSession().threadId;
  const reduceMotion = useReducedMotion();
  const nodes = useConversationNodes();
  const isRunning = useSessionState((state) => state.isRunning);
  const contextPolicy = useWorkbenchSessionContextPolicy(remoteId);
  const openers = useOpenerService();
  const workspaceContext = useWorkspaceContext();
  const openerHandlers = useSyncExternalStore(
    openers.subscribe,
    openers.getHandlers,
    openers.getHandlers,
  );
  const traceRequest = remoteId
    ? {
        resource: { scheme: "context-trace", path: remoteId },
        context: workspaceContext,
        policy: "reveal" as const,
      }
    : undefined;
  const canOpenContextTrace =
    traceRequest && openerHandlers.some((handler) => handler.canOpen(traceRequest) > 0);
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
      minimumFractionDigits: 0,
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
            contextUsedTokens === null || contextUsedTokens === undefined
              ? "—"
              : compactTokens(contextUsedTokens),
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
    if (remoteId) void contextPolicy.refresh().catch(() => undefined);
  }, [contextPolicy.refresh, isRunning, nodes.length, currentStatistics.steps, remoteId]);

  const updateContextPolicy = (policy: WorkbenchContextPolicy) => {
    setContextActionError(null);
    void contextPolicy.update(policy).catch((error: unknown) => setContextActionError(error));
  };

  const selectContextBudgetMode = (mode: WorkbenchContextPolicy["mode"]) => {
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
                  ? "text-warning-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            />
          }
        >
          {context?.nearingCompaction ? (
            <TriangleAlertIcon aria-hidden="true" className="size-(--icon-size-sm)" />
          ) : (
            <GaugeIcon aria-hidden="true" className="size-(--icon-size-sm)" />
          )}
          <span>{contextUsageLabel}</span>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={6}
          className="max-h-[calc(100vh-1rem)] w-[min(18rem,calc(100vw-1rem))] gap-1.5 overflow-y-auto p-2.5"
        >
          <PopoverHeader>
            <div className="flex items-center justify-between gap-3">
              <PopoverTitle className="text-xs font-medium">
                {t("extensions.tokenUsage.contextUsed")}
              </PopoverTitle>
              <span
                className="text-muted-foreground min-w-0 max-w-44 truncate text-xs"
                title={context?.model?.name}
              >
                {context?.model?.name ?? unavailable}
              </span>
            </div>
          </PopoverHeader>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 tabular-nums">
              <span className="text-foreground text-lg font-semibold tracking-tight">
                {contextUsedPercentLabel}
              </span>
              <span className="text-muted-foreground text-xs">{contextEstimateLabel}</span>
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
                  className={context?.nearingCompaction ? "h-full bg-warning" : "h-full bg-primary"}
                  style={{
                    width: `${Math.min(100, Math.max(0, contextUsedPercent ?? 0))}%`,
                  }}
                />
              )}
            </div>
            {context?.nearingCompaction ? (
              <p className="text-warning-foreground flex items-start gap-1.5 text-xs">
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="mt-0.5 size-(--icon-size-sm) shrink-0"
                />
                <span>{t("extensions.tokenUsage.nearingCompaction")}</span>
              </p>
            ) : null}
          </div>

          {contextBreakdown ? (
            <div role="list" aria-label={t("extensions.tokenUsage.modelInputBreakdown")}>
              {contextBreakdownGroups.map((group) => (
                <div key={group.id} role="listitem">
                  <TokenUsageSection
                    label={t(`extensions.tokenUsage.breakdownGroups.${group.id}`)}
                    markerClassName={group.colorClassName}
                    value={t("extensions.tokenUsage.estimatedTokenValue", {
                      tokens: compactTokens(group.tokens),
                    })}
                  >
                    <div className="text-muted-foreground ml-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 border-l border-border py-1 pl-3 text-xs">
                      {group.categories.map((category) => {
                        const tokens = contextBreakdownItems.get(category)?.tokens ?? 0;
                        return (
                          <div key={category} className="contents">
                            <span>
                              {t(`extensions.tokenUsage.breakdownCategories.${category}`)}
                            </span>
                            <span className="text-right tabular-nums">
                              {t("extensions.tokenUsage.estimatedTokenValue", {
                                tokens: compactTokens(tokens),
                              })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </TokenUsageSection>
                </div>
              ))}
            </div>
          ) : null}

          <div className="border-t border-border pt-1">
            <TokenUsageSection
              label={t("extensions.tokenUsage.contextSettings")}
              value={selectedContextBudgetModeLabel}
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium">{t("extensions.tokenUsage.contextBudget")}</p>
                  <DropdownMenu>
                    <SettingsDropdownTrigger
                      aria-label={t("extensions.tokenUsage.contextBudgetControlLabel", {
                        mode: selectedContextBudgetModeLabel,
                        tokens: displayedContextBudgetLabel,
                      })}
                      className="-me-2 ms-auto h-[var(--button-height-compact)] justify-between gap-1 px-2 text-xs"
                      disabled={
                        isRunning ||
                        contextPolicy.status === "saving" ||
                        !remoteId ||
                        !context?.model
                      }
                    >
                      <span className="flex min-w-0 items-center gap-1">
                        <span>{selectedContextBudgetModeLabel}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {displayedContextBudgetLabel}
                        </span>
                      </span>
                      <ChevronDownIcon
                        aria-hidden="true"
                        className="text-muted-foreground size-(--icon-size-sm) shrink-0"
                      />
                    </SettingsDropdownTrigger>
                    <SettingsDropdownContent align="end" side="bottom">
                      <DropdownMenuRadioGroup
                        value={selectedContextBudgetMode}
                        aria-label={t("extensions.tokenUsage.contextBudget")}
                        onValueChange={(nextMode) => {
                          const mode = CONTEXT_BUDGET_MODES.find(
                            (candidate) => candidate === nextMode,
                          );
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
                        aria-describedby={
                          invalidCustomBudget ? contextBudgetValidationId : undefined
                        }
                        className="text-xs tabular-nums"
                        onChange={(event) => {
                          setCustomBudget(event.currentTarget.value.replace(/\D+/gu, ""));
                          setContextActionError(null);
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
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
                  {canOpenContextTrace ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="-me-2 ms-auto"
                      disabled={!remoteId}
                      onClick={() => {
                        if (!traceRequest) return;
                        void openers
                          .open(traceRequest)
                          .catch((error: unknown) => setContextActionError(error));
                        setDetailsOpen(false);
                      }}
                    >
                      <ScanSearchIcon aria-hidden="true" />
                      {t("extensions.tokenUsage.viewContextTrace")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </TokenUsageSection>
            {contextActionFailure !== undefined && contextActionFailure !== null ? (
              <p className="text-destructive text-xs" role="alert">
                {t(contextActionErrorMessageKey(contextActionFailure))}
              </p>
            ) : null}

            <TokenUsageSection label={t("extensions.tokenUsage.cumulativeTitle")}>
              <div className="text-foreground flex flex-col gap-1.5 text-xs tabular-nums">
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
            </TokenUsageSection>
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

function AvailableTokenUsage() {
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  const { sessionId, isNewThread } = useCurrentSession();

  if (activeMainView || isNewThread) return null;

  return <ThreadTokenUsage key={sessionId} />;
}

export function TokenUsage() {
  return useWorkbenchContextCapability() ? <AvailableTokenUsage /> : null;
}
