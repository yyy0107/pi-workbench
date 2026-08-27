import type { SessionContextTraceEventSummary } from "@/runtime/pi/contracts/rpc";

export interface ContextTraceOverviewSpan {
  event: SessionContextTraceEventSummary;
  start: number;
  end: number;
  duration?: number;
  lane: 0 | 1 | 2;
  tone: "input" | "context" | "model" | "tool" | "recovery";
}

interface ContextTraceOverviewMarker {
  event: SessionContextTraceEventSummary;
  durationEnd?: number;
  lane: ContextTraceOverviewSpan["lane"];
  tone: ContextTraceOverviewSpan["tone"];
}

function byTimeline(
  left: SessionContextTraceEventSummary,
  right: SessionContextTraceEventSummary,
): number {
  return left.time - right.time || left.seq - right.seq;
}

function matchingModelEnd(
  events: readonly SessionContextTraceEventSummary[],
  request: SessionContextTraceEventSummary,
): SessionContextTraceEventSummary | undefined {
  return (
    events.find(
      (candidate) =>
        candidate.activationId === request.activationId &&
        candidate.seq > request.seq &&
        candidate.kind === "model-output" &&
        candidate.turnId === request.turnId,
    ) ??
    events.find(
      (candidate) =>
        candidate.activationId === request.activationId &&
        candidate.seq > request.seq &&
        candidate.kind === "provider-response" &&
        candidate.requestId === request.requestId,
    ) ??
    events.find(
      (candidate) =>
        candidate.activationId === request.activationId &&
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
        candidate.activationId === start.activationId &&
        candidate.seq > start.seq &&
        candidate.kind === "tool-execution-end" &&
        candidate.toolCallId === start.toolCallId,
    ) ??
    events.find(
      (candidate) =>
        candidate.activationId === start.activationId &&
        candidate.seq > start.seq &&
        candidate.kind === "turn-end" &&
        candidate.turnId === start.turnId,
    )
  );
}

function markerFor(
  events: readonly SessionContextTraceEventSummary[],
  event: SessionContextTraceEventSummary,
): ContextTraceOverviewMarker | undefined {
  switch (event.kind) {
    case "prompt-composition":
      return { event, lane: 0, tone: "input" };
    case "context-snapshot":
      return { event, lane: 0, tone: "context" };
    case "provider-request":
      return {
        event,
        durationEnd: matchingModelEnd(events, event)?.time,
        lane: 1,
        tone: "model",
      };
    case "tool-execution-start":
      return {
        event,
        durationEnd: matchingToolEnd(events, event)?.time,
        lane: 2,
        tone: "tool",
      };
    case "retry":
    case "compaction":
      return { event, lane: 1, tone: "recovery" };
    default:
      return undefined;
  }
}

function roundKey(event: SessionContextTraceEventSummary): string {
  return `${event.activationId}:${event.roundId ?? "unscoped"}`;
}

/**
 * Projects event markers into a continuous phase timeline.
 *
 * Low-level trace events between two visible phases still belong to the phase that preceded them,
 * so each colored span reaches the next visible marker. Round boundaries remain authoritative to
 * avoid painting idle time between separate user interactions as active work.
 */
export function projectContextTraceOverviewSpans(
  events: readonly SessionContextTraceEventSummary[],
  endTime: number,
): readonly ContextTraceOverviewSpan[] {
  const orderedEvents = events.toSorted(byTimeline);
  const eventsByRound = new Map<string, SessionContextTraceEventSummary[]>();

  for (const event of orderedEvents) {
    const key = roundKey(event);
    const roundEvents = eventsByRound.get(key) ?? [];
    roundEvents.push(event);
    eventsByRound.set(key, roundEvents);
  }

  const spans: ContextTraceOverviewSpan[] = [];
  for (const roundEvents of eventsByRound.values()) {
    const markers = roundEvents
      .map((event) => markerFor(roundEvents, event))
      .filter((marker): marker is ContextTraceOverviewMarker => marker !== undefined);
    if (markers.length === 0) continue;

    const roundStart = roundEvents.find((event) => event.kind === "round-start")?.time;
    const roundEnd = roundEvents.findLast((event) => event.kind === "round-settled")?.time;

    markers.forEach((marker, index) => {
      const start =
        index === 0 ? (roundStart ?? roundEvents[0]?.time ?? marker.event.time) : marker.event.time;
      const end = Math.max(start, markers[index + 1]?.event.time ?? roundEnd ?? endTime);
      spans.push({
        event: marker.event,
        start,
        end,
        duration:
          marker.durationEnd === undefined
            ? undefined
            : Math.max(0, marker.durationEnd - marker.event.time),
        lane: marker.lane,
        tone: marker.tone,
      });
    });
  }

  return spans.sort(
    (left, right) =>
      left.start - right.start ||
      left.event.time - right.event.time ||
      left.event.seq - right.event.seq,
  );
}
