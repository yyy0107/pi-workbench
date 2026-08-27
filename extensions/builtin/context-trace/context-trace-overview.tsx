"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import type { SessionContextTraceEventSummary } from "@/runtime/pi/contracts/rpc";

import { contextTraceEventLabel } from "./context-trace-detail";
import css from "./context-trace-overview.module.css";
import {
  projectContextTraceOverviewSpans,
  type ContextTraceOverviewSpan,
} from "./context-trace-overview-spans";
import {
  createContextTraceTimelineScale,
  type ContextTraceTimelineScale,
} from "./context-trace-timeline-scale";

const MINIMUM_DRAG_PX = 3;
const TIMELINE_TOOLTIP_DELAY_MS = 500;

export interface ContextTraceTimeRange {
  start: number;
  end: number;
}

interface TraceOverviewProps {
  events: readonly SessionContextTraceEventSummary[];
  matchingTraceIds?: ReadonlySet<string> | null;
  range: ContextTraceTimeRange | null;
  selectedTraceId?: string;
  onRangeChange(range: ContextTraceTimeRange | null): void;
  onSelect(event: SessionContextTraceEventSummary): void;
}

interface FractionRange {
  start: number;
  end: number;
}

interface HoverPoint {
  fraction: number;
  traceId: string | null;
}

interface DragGesture {
  anchorClientX: number;
  anchorTime: number;
  pointerId: number;
}

function orderedRange(left: number, right: number): ContextTraceTimeRange {
  return left <= right ? { start: left, end: right } : { start: right, end: left };
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rangeFraction(
  value: ContextTraceTimeRange,
  scale: ContextTraceTimelineScale,
): FractionRange {
  const bounded = orderedRange(
    Math.min(scale.endTime, Math.max(scale.startTime, value.start)),
    Math.min(scale.endTime, Math.max(scale.startTime, value.end)),
  );
  return {
    start: scale.fractionAt(bounded.start),
    end: scale.fractionAt(bounded.end),
  };
}

function traceIdAt(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>("[data-trace-id]")?.dataset.traceId ?? null;
}

export function ContextTraceOverview({
  events,
  matchingTraceIds = null,
  range,
  selectedTraceId,
  onRangeChange,
  onSelect,
}: TraceOverviewProps) {
  const { t } = useI18n();
  const timelineScale = useMemo(
    () => createContextTraceTimelineScale(events.map((event) => event.time)),
    [events],
  );
  const { startTime, endTime } = timelineScale;
  const dragRef = useRef<DragGesture | null>(null);
  const [draft, setDraft] = useState<ContextTraceTimeRange | null>(null);
  const [hover, setHover] = useState<HoverPoint | null>(null);

  const spans = useMemo(() => projectContextTraceOverviewSpans(events, endTime), [endTime, events]);

  const turnBoundaries = events.filter(
    (event) => event.kind === "turn-start" && event.time > startTime,
  );
  const activeRange = draft ?? range;
  const visibleRange = activeRange ? rangeFraction(activeRange, timelineScale) : null;

  useEffect(() => {
    if (range && (range.end < startTime || range.start > endTime)) onRangeChange(null);
  }, [endTime, onRangeChange, range, startTime]);

  const fractionAt = (event: PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clampFraction((event.clientX - rect.left) / Math.max(1, rect.width));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || traceIdAt(event.target) !== null) return;
    const fraction = fractionAt(event);
    const anchorTime = timelineScale.timeAt(fraction);
    dragRef.current = {
      anchorClientX: event.clientX,
      anchorTime,
      pointerId: event.pointerId,
    };
    setDraft({ start: anchorTime, end: anchorTime });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const fraction = fractionAt(event);
    setHover({ fraction, traceId: traceIdAt(event.target) });
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDraft(orderedRange(drag.anchorTime, timelineScale.timeAt(fraction)));
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const fraction = fractionAt(event);
    const pointTime = timelineScale.timeAt(fraction);
    const nextRange = orderedRange(drag.anchorTime, pointTime);
    const click = Math.abs(event.clientX - drag.anchorClientX) < MINIMUM_DRAG_PX;
    dragRef.current = null;
    setDraft(null);

    if (click) {
      onRangeChange(null);
      const nearest = spans.reduce<ContextTraceOverviewSpan | undefined>((candidate, span) => {
        if (!candidate) return span;
        const distanceTo = (value: ContextTraceOverviewSpan) =>
          pointTime < value.start
            ? value.start - pointTime
            : pointTime > value.end
              ? pointTime - value.end
              : 0;
        const candidateDistance = distanceTo(candidate);
        const spanDistance = distanceTo(span);
        return spanDistance < candidateDistance ? span : candidate;
      }, undefined);
      if (nearest) onSelect(nearest.event);
      return;
    }

    onRangeChange(nextRange);
  };

  const onPointerCancel = () => {
    dragRef.current = null;
    setDraft(null);
    setHover(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || range === null) return;
    event.preventDefault();
    onRangeChange(null);
  };

  return (
    <TooltipProvider delay={TIMELINE_TOOLTIP_DELAY_MS}>
      <section className={css.root} aria-label={t("extensions.contextTrace.timeline.label")}>
        <div className={css.plot}>
          <div className={css.labels} aria-hidden="true">
            <span>{t("extensions.contextTrace.overviewLanes.input")}</span>
            <span>{t("extensions.contextTrace.overviewLanes.model")}</span>
            <span>{t("extensions.contextTrace.overviewLanes.tool")}</span>
          </div>
          <div
            className={css.track}
            aria-label={t("extensions.contextTrace.timeline.instructions")}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerCancel}
            onPointerLeave={() => {
              if (dragRef.current === null) setHover(null);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              onRangeChange(null);
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {hover && hover.traceId === null && draft === null ? (
              <div
                className={css.hoverLine}
                aria-hidden="true"
                style={{ "--trace-hover-left": `${hover.fraction * 100}%` } as CSSProperties}
              />
            ) : null}

            {visibleRange ? (
              <>
                <div
                  className={css.selection}
                  data-dragging={draft ? "true" : undefined}
                  aria-hidden="true"
                  style={
                    {
                      "--trace-selection-left": `${visibleRange.start * 100}%`,
                      "--trace-selection-width": `${(visibleRange.end - visibleRange.start) * 100}%`,
                    } as CSSProperties
                  }
                />
                <div
                  className={css.selectionEdges}
                  data-dragging={draft ? "true" : undefined}
                  aria-hidden="true"
                  style={
                    {
                      "--trace-selection-left": `${visibleRange.start * 100}%`,
                      "--trace-selection-width": `${(visibleRange.end - visibleRange.start) * 100}%`,
                    } as CSSProperties
                  }
                />
              </>
            ) : null}

            <div className={css.turnBoundaries} aria-hidden="true">
              {turnBoundaries.map((event) => (
                <span
                  key={event.traceId}
                  className={css.turnBoundary}
                  style={
                    {
                      "--trace-turn-left": `${timelineScale.fractionAt(event.time) * 100}%`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>

            {spans.length === 0 ? (
              <span className={css.empty}>{t("extensions.contextTrace.timeline.empty")}</span>
            ) : (
              <div className={css.lanes}>
                {spans.map((span, index) => {
                  const previousSpan = spans[index - 1];
                  const hasLaneDivider =
                    previousSpan !== undefined &&
                    previousSpan.lane === span.lane &&
                    previousSpan.end === span.start &&
                    previousSpan.event.activationId === span.event.activationId &&
                    previousSpan.event.roundId === span.event.roundId;
                  const left = timelineScale.fractionAt(span.start) * 100;
                  const width = Math.max(
                    0,
                    (timelineScale.fractionAt(span.end) - timelineScale.fractionAt(span.start)) *
                      100,
                  );
                  const label = contextTraceEventLabel(t, span.event.kind);
                  const title = [
                    span.event.toolName ? `${label} · ${span.event.toolName}` : label,
                    t("extensions.contextTrace.relativeTime", {
                      value: Math.max(0, span.event.time - startTime),
                    }),
                    span.duration === undefined
                      ? undefined
                      : t("extensions.contextTrace.duration", { value: span.duration }),
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  const matchesRange =
                    activeRange === null ||
                    (span.start <= activeRange.end && span.end >= activeRange.start);
                  return (
                    <Tooltip key={span.event.traceId}>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className={css.span}
                            data-trace-id={span.event.traceId}
                            data-trace-tone={span.tone}
                            data-trace-divider={hasLaneDivider ? "true" : undefined}
                            data-current={
                              selectedTraceId === span.event.traceId ? "true" : undefined
                            }
                            data-hovered={
                              hover?.traceId === span.event.traceId ? "true" : undefined
                            }
                            data-range-match={matchesRange ? undefined : "false"}
                            data-search-match={
                              matchingTraceIds === null
                                ? undefined
                                : matchingTraceIds.has(span.event.traceId)
                                  ? "true"
                                  : "false"
                            }
                            aria-label={title}
                            aria-pressed={selectedTraceId === span.event.traceId}
                            style={
                              {
                                "--trace-span-left": `${left}%`,
                                "--trace-span-width": `${width}%`,
                                "--trace-span-lane": span.lane,
                              } as CSSProperties
                            }
                            onClick={() => {
                              onRangeChange(null);
                              onSelect(span.event);
                            }}
                          />
                        }
                      />
                      <TooltipContent side="bottom" className="font-mono text-[11px]">
                        {title}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </TooltipProvider>
  );
}
