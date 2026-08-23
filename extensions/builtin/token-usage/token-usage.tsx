"use client";

import { useAuiState } from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { formatAdaptiveDuration, formatCompactDuration } from "@/lib/format-duration";
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
  const reduceMotion = useReducedMotion();
  const messages = useAuiState((state) => state.thread.messages);
  const isRunning = useAuiState((state) => state.thread.isRunning);
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

  return (
    <div
      className="flex h-6 min-w-0 items-center overflow-hidden whitespace-nowrap text-[11px] tabular-nums"
      title={t("extensions.tokenUsage.description")}
    >
      <span>{t("extensions.tokenUsage.turns", { count: statistics.turns })}</span>
      <span className="px-1">·</span>
      <span>{t("extensions.tokenUsage.steps", { count: statistics.steps })}</span>
      <Separator />
      <span>
        {t("extensions.tokenUsage.llm")} {duration(statistics.llmDurationMs)}
      </span>
      <span className="px-1">·</span>
      <span>
        {t("extensions.tokenUsage.toolCalls")} {duration(statistics.toolDurationMs)}
      </span>
      <Separator />
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
      <Separator />
      <span>
        {t("extensions.tokenUsage.averageCacheHit")}{" "}
        {cacheHitRate === undefined
          ? unavailable
          : number(cacheHitRate, { style: "percent", maximumFractionDigits: 0 })}
      </span>
      <Separator />
      <span>
        {t("extensions.tokenUsage.input")} {compactTokens(promptTokens)}{" "}
        {t("extensions.tokenUsage.tokenUnit")}
      </span>
      <span className="px-1">·</span>
      <span>
        {t("extensions.tokenUsage.output")} {compactTokens(statistics.outputTokens)}{" "}
        {t("extensions.tokenUsage.tokenUnit")}
      </span>
    </div>
  );
}

export function TokenUsage() {
  const threadId = useAuiState((state) => state.threads.mainThreadId);
  return <ThreadTokenUsage key={threadId} />;
}
