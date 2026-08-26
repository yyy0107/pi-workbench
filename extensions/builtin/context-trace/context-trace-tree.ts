import type {
  SessionContextTraceEventSummary,
  SessionContextTraceTokenUsage,
} from "@/runtime/pi/rpc-contracts";

export interface ContextTraceToolExecution {
  id: string;
  toolCallId: string;
  toolName?: string;
  start?: SessionContextTraceEventSummary;
  end?: SessionContextTraceEventSummary;
  duration?: number;
}

export interface ContextTraceModelStep {
  id: string;
  index: number;
  turnId: string;
  events: readonly SessionContextTraceEventSummary[];
  start?: SessionContextTraceEventSummary;
  context?: SessionContextTraceEventSummary;
  request?: SessionContextTraceEventSummary;
  output?: SessionContextTraceEventSummary;
  end?: SessionContextTraceEventSummary;
  toolExecutions: readonly ContextTraceToolExecution[];
  usage?: SessionContextTraceTokenUsage;
  model?: SessionContextTraceEventSummary["model"];
  thinkingLevel?: string;
  duration?: number;
  firstSeq: number;
}

export interface ContextTraceSystemEvent {
  type: "system-event";
  event: SessionContextTraceEventSummary;
  firstSeq: number;
}

export interface ContextTraceCompactionEvent {
  type: "compaction";
  start?: SessionContextTraceEventSummary;
  end?: SessionContextTraceEventSummary;
  firstSeq: number;
}

export interface ContextTraceStepItem {
  type: "model-step";
  step: ContextTraceModelStep;
  firstSeq: number;
}

export type ContextTraceTurnItem =
  | ContextTraceSystemEvent
  | ContextTraceCompactionEvent
  | ContextTraceStepItem;

export interface ContextTraceTurn {
  id: string;
  index: number;
  roundId?: string;
  events: readonly SessionContextTraceEventSummary[];
  start: SessionContextTraceEventSummary;
  prompt?: SessionContextTraceEventSummary;
  settled?: SessionContextTraceEventSummary;
  steps: readonly ContextTraceModelStep[];
  items: readonly ContextTraceTurnItem[];
  finalOutput?: SessionContextTraceEventSummary;
  duration?: number;
}

function bySequence(
  left: SessionContextTraceEventSummary,
  right: SessionContextTraceEventSummary,
): number {
  return left.seq - right.seq;
}

function durationBetween(
  start: SessionContextTraceEventSummary | undefined,
  end: SessionContextTraceEventSummary | undefined,
): number | undefined {
  return start && end ? Math.max(0, end.time - start.time) : undefined;
}

function projectToolExecutions(
  events: readonly SessionContextTraceEventSummary[],
): readonly ContextTraceToolExecution[] {
  const byCallId = new Map<string, SessionContextTraceEventSummary[]>();
  for (const event of events) {
    if (
      (event.kind !== "tool-execution-start" && event.kind !== "tool-execution-end") ||
      !event.toolCallId
    ) {
      continue;
    }
    const current = byCallId.get(event.toolCallId) ?? [];
    current.push(event);
    byCallId.set(event.toolCallId, current);
  }

  return [...byCallId.entries()]
    .map(([toolCallId, callEvents]) => {
      const start = callEvents.find((event) => event.kind === "tool-execution-start");
      const end = callEvents.find((event) => event.kind === "tool-execution-end");
      return {
        id: toolCallId,
        toolCallId,
        toolName: start?.toolName ?? end?.toolName,
        start,
        end,
        duration: durationBetween(start, end),
        firstSeq: Math.min(...callEvents.map((event) => event.seq)),
      };
    })
    .sort((left, right) => left.firstSeq - right.firstSeq)
    .map(({ firstSeq: _firstSeq, ...execution }) => execution);
}

function projectSteps(
  events: readonly SessionContextTraceEventSummary[],
): readonly ContextTraceModelStep[] {
  const byTurnId = new Map<string, SessionContextTraceEventSummary[]>();
  for (const event of events) {
    if (!event.turnId) continue;
    const current = byTurnId.get(event.turnId) ?? [];
    current.push(event);
    byTurnId.set(event.turnId, current);
  }

  return [...byTurnId.entries()]
    .map(([turnId, turnEvents]) => {
      const sorted = turnEvents.toSorted(bySequence);
      return { turnId, events: sorted, firstSeq: sorted[0]?.seq ?? Number.MAX_SAFE_INTEGER };
    })
    .sort((left, right) => left.firstSeq - right.firstSeq)
    .map(({ turnId, events: stepEvents, firstSeq }, index): ContextTraceModelStep => {
      const start = stepEvents.find((event) => event.kind === "turn-start");
      const context = stepEvents.find((event) => event.kind === "context-snapshot");
      const request = stepEvents.find((event) => event.kind === "provider-request");
      const modelOutput = stepEvents.findLast((event) => event.kind === "model-output");
      const end = stepEvents.findLast((event) => event.kind === "turn-end");
      // Journals created before model-output capture use turn-end as the authoritative fallback.
      const output = modelOutput ?? end;
      return {
        id: turnId,
        index: index + 1,
        turnId,
        events: stepEvents,
        start,
        context,
        request,
        output,
        end,
        toolExecutions: projectToolExecutions(stepEvents),
        usage: output?.usage ?? end?.usage,
        model: output?.model,
        thinkingLevel: output?.thinkingLevel,
        duration: durationBetween(request ?? start, output),
        firstSeq,
      };
    });
}

function projectRecoveryItems(
  events: readonly SessionContextTraceEventSummary[],
): readonly (ContextTraceSystemEvent | ContextTraceCompactionEvent)[] {
  const items: Array<ContextTraceSystemEvent | ContextTraceCompactionEvent> = [];
  let pendingCompaction: ContextTraceCompactionEvent | undefined;

  for (const event of events.toSorted(bySequence)) {
    if (event.kind === "retry") {
      items.push({ type: "system-event", event, firstSeq: event.seq });
      continue;
    }
    if (event.kind !== "compaction") continue;

    if (event.compaction?.phase === "start") {
      pendingCompaction = {
        type: "compaction",
        start: event,
        firstSeq: event.seq,
      };
      items.push(pendingCompaction);
      continue;
    }

    if (pendingCompaction && pendingCompaction.end === undefined) {
      pendingCompaction.end = event;
      pendingCompaction = undefined;
      continue;
    }

    items.push({ type: "compaction", end: event, firstSeq: event.seq });
  }

  return items;
}

/**
 * Projects low-level Pi lifecycle records into the semantic trace shown by the debugger.
 * A round is one user Turn. Pi turn indexes are deliberately ignored because they reset on retry.
 */
export function projectContextTraceTurns(
  events: readonly SessionContextTraceEventSummary[],
): readonly ContextTraceTurn[] {
  const ordered = events.toSorted(bySequence);
  const grouped = new Map<string, SessionContextTraceEventSummary[]>();
  for (const event of ordered) {
    const key = event.roundId ?? `unscoped:${event.activationId}`;
    const current = grouped.get(key) ?? [];
    current.push(event);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([id, roundEvents]) => ({ id, events: roundEvents, firstSeq: roundEvents[0]?.seq ?? 0 }))
    .sort((left, right) => left.firstSeq - right.firstSeq)
    .map(({ id, events: roundEvents }, index): ContextTraceTurn => {
      const start = roundEvents.find((event) => event.kind === "round-start") ?? roundEvents[0]!;
      const settled = roundEvents.findLast((event) => event.kind === "round-settled");
      const prompt = roundEvents.find((event) => event.kind === "prompt-composition");
      const steps = projectSteps(roundEvents);
      const recoveryItems = projectRecoveryItems(roundEvents);
      const stepItems = steps.map((step): ContextTraceStepItem => ({
        type: "model-step",
        step,
        firstSeq: step.firstSeq,
      }));
      const finalOutput = steps.findLast((step) => step.output)?.output;
      return {
        id,
        index: index + 1,
        roundId: start.roundId,
        events: roundEvents,
        start,
        prompt,
        settled,
        steps,
        items: [...stepItems, ...recoveryItems].sort(
          (left, right) => left.firstSeq - right.firstSeq,
        ),
        finalOutput,
        duration: settled
          ? durationBetween(start, settled)
          : durationBetween(start, roundEvents.at(-1)),
      };
    });
}

export function contextInputTokens(
  usage: SessionContextTraceTokenUsage | undefined,
): number | undefined {
  return usage ? usage.input + usage.cacheRead + usage.cacheWrite : undefined;
}
