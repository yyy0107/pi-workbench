"use client";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { SessionContextTraceEventSummary } from "@/runtime/pi/rpc-contracts";

import { contextTraceEventLabel } from "./context-trace-detail";

interface TraceOverviewProps {
  events: readonly SessionContextTraceEventSummary[];
  selectedTraceId?: string;
  onSelect(event: SessionContextTraceEventSummary): void;
}

interface TraceSegment {
  event: SessionContextTraceEventSummary;
  endTime: number;
}

function matchingModelEnd(
  events: readonly SessionContextTraceEventSummary[],
  request: SessionContextTraceEventSummary,
): SessionContextTraceEventSummary | undefined {
  return (
    events.find(
      (candidate) =>
        candidate.seq > request.seq &&
        candidate.kind === "model-output" &&
        candidate.turnId === request.turnId,
    ) ??
    events.find(
      (candidate) =>
        candidate.seq > request.seq &&
        candidate.kind === "provider-response" &&
        candidate.requestId === request.requestId,
    ) ??
    events.find(
      (candidate) =>
        candidate.seq > request.seq &&
        candidate.kind === "turn-end" &&
        candidate.turnId === request.turnId,
    )
  );
}

function matchingToolEnd(
  events: readonly SessionContextTraceEventSummary[],
  start: SessionContextTraceEventSummary,
): SessionContextTraceEventSummary | undefined {
  return (
    events.find(
      (candidate) =>
        candidate.seq > start.seq &&
        candidate.kind === "tool-execution-end" &&
        candidate.toolCallId === start.toolCallId,
    ) ??
    events.find(
      (candidate) =>
        candidate.seq > start.seq &&
        candidate.kind === "turn-end" &&
        candidate.turnId === start.turnId,
    )
  );
}

export function ContextTraceOverview({ events, selectedTraceId, onSelect }: TraceOverviewProps) {
  const { t } = useI18n();
  const startTime = events[0]?.time ?? 0;
  const observedEndTime = events.at(-1)?.time ?? startTime;
  const endTime = Math.max(observedEndTime, startTime + 1);
  const range = endTime - startTime;
  const inputSegments: TraceSegment[] = events
    .filter((event) => event.kind === "prompt-composition" || event.kind === "context-snapshot")
    .map((event) => ({ event, endTime: event.time }));
  const modelSegments: TraceSegment[] = events
    .filter((event) => event.kind === "provider-request")
    .map((event) => ({
      event,
      endTime: matchingModelEnd(events, event)?.time ?? endTime,
    }));
  const toolSegments: TraceSegment[] = events
    .filter((event) => event.kind === "tool-execution-start")
    .map((event) => ({
      event,
      endTime: matchingToolEnd(events, event)?.time ?? endTime,
    }));
  const lifecycleSegments: TraceSegment[] = events
    .filter(
      (event) => event.kind === "turn-end" || event.kind === "retry" || event.kind === "compaction",
    )
    .map((event) => ({ event, endTime: event.time }));
  const lanes = [
    {
      key: "input",
      label: t("extensions.contextTrace.overviewLanes.input"),
      segments: inputSegments,
      tone: "bg-sky-500 dark:bg-sky-400",
      point: true,
    },
    {
      key: "model",
      label: t("extensions.contextTrace.overviewLanes.model"),
      segments: modelSegments,
      tone: "bg-violet-500/65 dark:bg-violet-400/70",
      point: false,
    },
    {
      key: "tool",
      label: t("extensions.contextTrace.overviewLanes.tool"),
      segments: toolSegments,
      tone: "bg-orange-500/75 dark:bg-orange-400/80",
      point: false,
    },
    {
      key: "lifecycle",
      label: t("extensions.contextTrace.overviewLanes.lifecycle"),
      segments: lifecycleSegments,
      tone: "bg-amber-500 dark:bg-amber-400",
      point: true,
    },
  ] as const;

  return (
    <div className="bg-muted/8 shrink-0 border-b px-2 py-1.5">
      {lanes.map((lane) => (
        <div key={lane.key} className="flex h-5 items-center gap-2">
          <span className="text-muted-foreground w-14 shrink-0 text-end text-[10px] whitespace-nowrap">
            {lane.label}
          </span>
          <div className="bg-muted/45 relative h-2 min-w-0 flex-1 overflow-hidden rounded-[2px]">
            {lane.segments.map(({ event, endTime: segmentEndTime }) => {
              const left = Math.min(99.5, Math.max(0, ((event.time - startTime) / range) * 100));
              const measuredWidth = ((segmentEndTime - event.time) / range) * 100;
              const width = lane.point ? 0.35 : Math.max(0.65, measuredWidth);
              return (
                <button
                  key={event.traceId}
                  type="button"
                  aria-label={contextTraceEventLabel(t, event.kind)}
                  title={contextTraceEventLabel(t, event.kind)}
                  className={cn(
                    "absolute inset-y-0 min-w-px rounded-[1px] outline-none transition-opacity hover:opacity-80 focus-visible:ring-1 focus-visible:ring-ring",
                    lane.tone,
                    selectedTraceId === event.traceId && "ring-1 ring-foreground ring-offset-1",
                  )}
                  style={{ left: `${left}%`, width: `${Math.min(100 - left, width)}%` }}
                  onClick={() => onSelect(event)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
