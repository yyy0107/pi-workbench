"use client";

import {
  ArrowDownIcon,
  BracesIcon,
  ClockIcon,
  DatabaseIcon,
  ListTreeIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRightWorkspace } from "@workbench/shell/right-workspace/react";
import { Button } from "@workbench/shell/ui";
import { Input } from "@workbench/shell/ui";
import { definePiMessage, usePiI18n } from "../../i18n";
import { cn } from "@workbench/shell/utils";
import { useExtensionErrorReporter } from "@workbench/extension-host";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import {
  usePiContextTraceClient,
  usePiThreadStateSnapshot,
} from "@workbench/agent-runtime-pi-client/context-trace";
import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import type {
  SessionContextTraceEventSummary,
  SessionContextTraceKind,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import {
  ContextTraceDetail,
  contextTraceDetailVariant,
  contextTraceDetailViews,
  contextTraceEventLabel,
  type ContextTraceDetailFocus,
  type ContextTraceDetailState,
  type ContextTraceDetailView,
  type ContextTraceToolDetailContext,
} from "./context-trace-detail";
import { cacheContextTraceDetail } from "./context-trace-detail-cache";
import { ContextTraceContextView } from "./context-trace-context-view";
import { ContextTraceOverview, type ContextTraceTimeRange } from "./context-trace-overview";
import { projectContextTraceTurns } from "./context-trace-tree";
import type { ContextTraceSurfaceParams } from "./context-trace-workspace";
import { useContextTrace, useContextTraceTarget } from "./use-context-trace";

const TRACE_LOAD_FAILED = definePiMessage("extensions.contextTrace.loadFailed");
const TRACE_PERMISSION_REQUIRED = definePiMessage("extensions.contextTrace.permissionDescription");
const TRACE_PERSISTENCE_UNAVAILABLE = definePiMessage(
  "extensions.contextTrace.persistenceUnavailable",
);
type TraceViewMode = "duration" | "turns" | "calls";
type TraceEventCategory =
  | "round"
  | "prompt"
  | "run"
  | "turn"
  | "context"
  | "model"
  | "tool"
  | "recovery";

function eventCategory(kind: SessionContextTraceKind): TraceEventCategory {
  switch (kind) {
    case "prompt-composition":
      return "prompt";
    case "context-snapshot":
      return "context";
    case "provider-request":
    case "provider-response":
    case "model-output":
      return "model";
    case "tool-execution-start":
    case "tool-execution-end":
      return "tool";
    case "retry":
    case "compaction":
      return "recovery";
    case "run-start":
    case "run-end":
      return "run";
    case "turn-start":
    case "turn-end":
      return "turn";
    default:
      return "round";
  }
}

function eventCategoryTone(category: TraceEventCategory): string {
  switch (category) {
    case "prompt":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "context":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "model":
      return "bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "tool":
      return "bg-orange-500/10 text-orange-700 dark:text-orange-300";
    case "recovery":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "turn":
      return "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
    case "run":
      return "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300";
    case "round":
      return "bg-muted text-muted-foreground";
  }
}

function eventCategoryLabel(
  t: ReturnType<typeof usePiI18n>["t"],
  category: TraceEventCategory,
): string {
  return t(`extensions.contextTrace.eventCategories.${category}`);
}

function matchesView(event: SessionContextTraceEventSummary, view: TraceViewMode): boolean {
  if (view === "duration") return true;
  if (view === "turns") return true;
  return (
    event.kind === "provider-request" ||
    event.kind === "provider-response" ||
    event.kind === "model-output" ||
    event.kind === "tool-execution-start" ||
    event.kind === "tool-execution-end"
  );
}

function pairedDuration(
  events: readonly SessionContextTraceEventSummary[],
  event: SessionContextTraceEventSummary,
): number | undefined {
  let startKind: SessionContextTraceKind | undefined;
  let sameCoordinate: (candidate: SessionContextTraceEventSummary) => boolean = () => false;
  switch (event.kind) {
    case "provider-response":
      startKind = "provider-request";
      sameCoordinate = (candidate) => candidate.requestId === event.requestId;
      break;
    case "tool-execution-end":
      startKind = "tool-execution-start";
      sameCoordinate = (candidate) => candidate.toolCallId === event.toolCallId;
      break;
    case "turn-end":
      startKind = "turn-start";
      sameCoordinate = (candidate) => candidate.turnId === event.turnId;
      break;
    case "run-end":
      startKind = "run-start";
      sameCoordinate = (candidate) => candidate.runId === event.runId;
      break;
    case "round-settled":
      startKind = "round-start";
      sameCoordinate = (candidate) => candidate.roundId === event.roundId;
      break;
    default:
      return undefined;
  }
  const start = events.findLast(
    (candidate) =>
      candidate.seq < event.seq && candidate.kind === startKind && sameCoordinate(candidate),
  );
  return start ? Math.max(0, event.time - start.time) : undefined;
}

function viewLabel(t: ReturnType<typeof usePiI18n>["t"], view: TraceViewMode): string {
  switch (view) {
    case "duration":
      return t("extensions.contextTrace.views.duration");
    case "turns":
      return t("extensions.contextTrace.views.turns");
    case "calls":
      return t("extensions.contextTrace.views.calls");
  }
}

function detailViewLabel(
  t: ReturnType<typeof usePiI18n>["t"],
  view: ContextTraceDetailView,
): string {
  switch (view) {
    case "summary":
      return t("extensions.contextTrace.detailTabs.summary");
    case "preview":
      return t("extensions.contextTrace.detailTabs.preview");
    case "raw":
      return t("extensions.contextTrace.detailTabs.raw");
    case "source":
      return t("extensions.contextTrace.detailTabs.source");
    case "payload":
      return t("extensions.contextTrace.detailTabs.payload");
    case "result":
      return t("extensions.contextTrace.detailTabs.result");
    case "schema":
      return t("extensions.contextTrace.detailTabs.schema");
    case "timing":
      return t("extensions.contextTrace.detailTabs.timing");
  }
}

function TraceViewTabs({
  compact,
  value,
  onChange,
}: {
  compact: boolean;
  value: TraceViewMode;
  onChange(value: TraceViewMode): void;
}) {
  const { t } = usePiI18n();
  const views = ["duration", "turns", "calls"] as const;
  return (
    <div className="flex shrink-0 items-center gap-0.5" role="tablist">
      {views.map((view) => {
        const label = viewLabel(t, view);
        const Icon = view === "duration" ? ClockIcon : view === "turns" ? ListTreeIcon : SendIcon;
        return (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={value === view}
            aria-label={label}
            title={label}
            className={cn(
              "hover:bg-muted/70 focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-xs leading-[var(--control-text-line-height)]! outline-none focus-visible:ring-2",
              value === view ? "bg-muted text-foreground font-medium" : "text-muted-foreground",
            )}
            onClick={() => onChange(view)}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {compact ? null : <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

function useWideSurface() {
  const rootRef = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const update = () => setWide(element.getBoundingClientRect().width >= 720);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { rootRef, wide };
}

function Timeline({
  events,
  firstTime,
  onSelect,
  selectedTraceId,
}: {
  events: readonly SessionContextTraceEventSummary[];
  firstTime: number;
  onSelect(event: SessionContextTraceEventSummary): void;
  selectedTraceId?: string;
}) {
  const { t } = usePiI18n();
  return (
    <div>
      {events.map((event, index) => {
        const duration = pairedDuration(events, event);
        const previous = events[index - 1];
        const startsTurn = Boolean(event.turnId && event.turnId !== previous?.turnId);
        const coordinateLabel = startsTurn
          ? t("extensions.contextTrace.turnNumber", {
              index: (event.turnIndex ?? 0) + 1,
            })
          : event.kind === "round-start"
            ? t("extensions.contextTrace.round")
            : undefined;
        const category = eventCategory(event.kind);
        const correlationId =
          event.toolCallId ?? event.requestId ?? event.turnId ?? event.runId ?? event.roundId;
        return (
          <button
            key={event.traceId}
            type="button"
            className={cn(
              "hover:bg-muted/45 focus-visible:ring-ring relative flex min-h-10 w-full items-center border-b pe-2 text-start text-xs outline-none focus-visible:z-10 focus-visible:ring-2",
              selectedTraceId === event.traceId && "bg-blue-500/7",
            )}
            aria-pressed={selectedTraceId === event.traceId}
            onClick={() => onSelect(event)}
          >
            {selectedTraceId === event.traceId ? (
              <span className="absolute inset-y-0 start-0 w-0.5 bg-blue-500" />
            ) : null}
            <span className="text-blue-600/75 dark:text-blue-300/70 w-14 shrink-0 truncate px-1 text-center font-mono text-[9px]">
              {coordinateLabel}
            </span>
            <span className="relative me-2 flex h-10 w-2 shrink-0 items-center justify-center">
              <span className="bg-border absolute inset-y-0 start-1/2 w-px -translate-x-1/2" />
              <span
                className={cn(
                  "bg-muted-foreground/45 relative size-1.5 rounded-full ring-2 ring-background",
                  selectedTraceId === event.traceId && "bg-blue-500",
                )}
              />
            </span>
            <span
              className={cn(
                "me-2 inline-flex min-w-15 shrink-0 justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                eventCategoryTone(category),
              )}
            >
              {eventCategoryLabel(t, category)}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {contextTraceEventLabel(t, event.kind)}
            </span>
            {event.truncated ? (
              <TriangleAlertIcon
                className="me-1 size-3 shrink-0 text-amber-500"
                aria-label={t("extensions.contextTrace.flagTruncated")}
              />
            ) : null}
            {event.redacted ? (
              <span
                className="text-sky-600 dark:text-sky-300 me-1"
                aria-label={t("extensions.contextTrace.flagRedacted")}
              >
                •
              </span>
            ) : null}
            {correlationId ? (
              <span
                className="text-muted-foreground mx-2 hidden max-w-28 truncate font-mono text-[10px] sm:block"
                title={correlationId}
              >
                {correlationId}
              </span>
            ) : null}
            {duration !== undefined ? (
              <span className="text-muted-foreground me-2 hidden shrink-0 font-mono text-[10px] md:block">
                {t("extensions.contextTrace.duration", { value: duration })}
              </span>
            ) : null}
            <span className="text-muted-foreground shrink-0 font-mono text-[10px] tabular-nums">
              {t("extensions.contextTrace.relativeTime", { value: event.time - firstTime })} · #
              {event.seq}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ContextTraceSurface({
  retryToken = 0,
  surface,
}: WorkspaceSurfaceProps<ContextTraceSurfaceParams>) {
  const traceClient = usePiContextTraceClient();
  const { number, t } = usePiI18n();
  const controller = useRightWorkspace();
  const reportError = useExtensionErrorReporter();
  const { metadata } = usePiThreadStateSnapshot(surface.params.sessionId);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const revision = refreshRevision + retryToken;
  const target = useContextTraceTarget(surface.params.sessionId, revision, metadata.running);
  const trace = useContextTrace(surface.params.sessionId, revision, target.activationId);
  const showingPreviousActivation = target.activationId !== undefined;
  const [selectedTraceId, setSelectedTraceId] = useState<string>();
  const [selectedContextFocus, setSelectedContextFocus] = useState<ContextTraceDetailFocus>();
  const [detailByTraceId, setDetailByTraceId] = useState<
    ReadonlyMap<string, ContextTraceDetailState>
  >(new Map());
  const detailByTraceIdRef = useRef<ReadonlyMap<string, ContextTraceDetailState>>(new Map());
  const detailGenerationRef = useRef(0);
  const [viewMode, setViewMode] = useState<TraceViewMode>("turns");
  const [detailView, setDetailView] = useState<ContextTraceDetailView>("summary");
  const [query, setQuery] = useState("");
  const [followLive, setFollowLive] = useState(true);
  const [timelineRange, setTimelineRange] = useState<ContextTraceTimeRange | null>(null);
  const { rootRef, wide } = useWideSurface();
  const timelineBottomRef = useRef<HTMLDivElement>(null);
  const lastReportedError = useRef<unknown>(undefined);
  const storeDetail = useCallback((traceId: string, detail: ContextTraceDetailState) => {
    const next = cacheContextTraceDetail(detailByTraceIdRef.current, traceId, detail);
    detailByTraceIdRef.current = next;
    setDetailByTraceId(next);
  }, []);

  useEffect(() => {
    const status =
      trace.status === "permission-required"
        ? "permission-required"
        : trace.status === "error" || trace.capabilities?.durable === false
          ? "error"
          : trace.status === "loading"
            ? "loading"
            : "ready";
    controller.update(surface.id, {
      status,
      statusMessage:
        status === "permission-required"
          ? TRACE_PERMISSION_REQUIRED
          : status === "error"
            ? trace.capabilities?.durable === false
              ? TRACE_PERSISTENCE_UNAVAILABLE
              : TRACE_LOAD_FAILED
            : undefined,
    });
  }, [controller, surface.id, trace.capabilities?.durable, trace.status]);

  useEffect(() => {
    const error = trace.status === "error" ? trace.error : target.error;
    if (!error || lastReportedError.current === error) return;
    lastReportedError.current = error;
    reportError(error, { source: "workspace", contributionId: surface.id });
  }, [reportError, surface.id, target.error, trace.error, trace.status]);

  useEffect(() => {
    detailGenerationRef.current += 1;
    const empty = new Map<string, ContextTraceDetailState>();
    detailByTraceIdRef.current = empty;
    setDetailByTraceId(empty);
    setSelectedTraceId(undefined);
    setSelectedContextFocus(undefined);
    setDetailView("summary");
    setFollowLive(true);
    setTimelineRange(null);
  }, [trace.activationId, surface.params.sessionId]);

  useEffect(() => {
    if (!followLive) return;
    timelineBottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [followLive, trace.events]);

  const loadDetail = useCallback(
    (traceId: string) => {
      const cached = detailByTraceIdRef.current.get(traceId);
      if (
        cached?.status === "loading" ||
        cached?.status === "ready" ||
        cached?.status === "evicted"
      ) {
        return;
      }
      const generation = detailGenerationRef.current;
      storeDetail(traceId, { status: "loading" });
      void traceClient
        .read({
          sessionId: surface.params.sessionId,
          traceId,
        })
        .then(({ event }) => {
          if (generation !== detailGenerationRef.current) return;
          storeDetail(traceId, { status: "ready", event });
        })
        .catch((error: unknown) => {
          if (generation !== detailGenerationRef.current) return;
          const evicted = error instanceof PiApiError && error.code === "context-trace-not-found";
          storeDetail(traceId, { status: evicted ? "evicted" : "error" });
          if (!evicted) {
            reportError(error, { source: "workspace", contributionId: surface.id });
          }
        });
    },
    [reportError, storeDetail, surface.id, surface.params.sessionId],
  );

  useEffect(() => {
    if (!selectedTraceId) return;
    loadDetail(selectedTraceId);
  }, [loadDetail, selectedTraceId]);

  const selectedSummary = trace.events.find((event) => event.traceId === selectedTraceId);
  const selectedTreeLocation = useMemo(() => {
    if (!selectedTraceId) return undefined;
    for (const turn of projectContextTraceTurns(trace.events)) {
      if (!turn.events.some((event) => event.traceId === selectedTraceId)) continue;
      const step = turn.steps.find((candidate) =>
        candidate.events.some((event) => event.traceId === selectedTraceId),
      );
      return { turn, step };
    }
    return undefined;
  }, [selectedTraceId, trace.events]);
  const selectedDetail = selectedTraceId
    ? (detailByTraceId.get(selectedTraceId) ?? { status: "loading" as const })
    : ({ status: "idle" } as const);
  const selectedDetailFocus = viewMode === "turns" ? selectedContextFocus : undefined;
  const selectedDetailVariant = contextTraceDetailVariant(selectedSummary, selectedDetailFocus);
  const detailViews = useMemo(
    () => contextTraceDetailViews(selectedSummary, selectedDetailFocus),
    [selectedDetailFocus, selectedSummary],
  );

  useEffect(() => {
    if (!detailViews.includes(detailView)) setDetailView("summary");
  }, [detailView, detailViews]);

  const selectedToolExecution = useMemo(() => {
    if (selectedDetailVariant !== "tool-execution" || !selectedSummary?.toolCallId)
      return undefined;
    return selectedTreeLocation?.step?.toolExecutions.find(
      (execution) => execution.toolCallId === selectedSummary.toolCallId,
    );
  }, [selectedDetailVariant, selectedSummary?.toolCallId, selectedTreeLocation?.step]);
  const selectedToolStart =
    selectedToolExecution?.start ??
    (selectedSummary?.kind === "tool-execution-start" ? selectedSummary : undefined);
  const selectedToolEnd =
    selectedToolExecution?.end ??
    (selectedSummary?.kind === "tool-execution-end" ? selectedSummary : undefined);
  const selectedToolSchemaSummary =
    selectedDetailVariant === "tool-execution" ? selectedTreeLocation?.turn.prompt : undefined;

  useEffect(() => {
    if (selectedDetailVariant !== "tool-execution") return;
    for (const related of [selectedToolStart, selectedToolEnd, selectedToolSchemaSummary]) {
      if (related) loadDetail(related.traceId);
    }
  }, [
    loadDetail,
    selectedDetailVariant,
    selectedToolEnd,
    selectedToolSchemaSummary,
    selectedToolStart,
  ]);

  const selectedToolContext = useMemo<ContextTraceToolDetailContext | undefined>(() => {
    if (selectedDetailVariant !== "tool-execution") return undefined;
    const startDetail = selectedToolStart
      ? (detailByTraceId.get(selectedToolStart.traceId) ?? { status: "loading" as const })
      : undefined;
    const endDetail = selectedToolEnd
      ? (detailByTraceId.get(selectedToolEnd.traceId) ?? { status: "loading" as const })
      : undefined;
    const schemaDetail = selectedToolSchemaSummary
      ? (detailByTraceId.get(selectedToolSchemaSummary.traceId) ?? { status: "loading" as const })
      : undefined;
    const schema =
      schemaDetail?.status === "ready" && schemaDetail.event.kind === "prompt-composition"
        ? schemaDetail.event.detail.tools.find(
            (tool) => tool.name === (selectedSummary?.toolName ?? selectedToolExecution?.toolName),
          )
        : undefined;
    return {
      start: selectedToolStart ? { summary: selectedToolStart, detail: startDetail! } : undefined,
      end: selectedToolEnd ? { summary: selectedToolEnd, detail: endDetail! } : undefined,
      schema,
      schemaDetail,
    };
  }, [
    detailByTraceId,
    selectedDetailVariant,
    selectedSummary?.toolName,
    selectedToolEnd,
    selectedToolExecution?.toolName,
    selectedToolSchemaSummary,
    selectedToolStart,
  ]);
  const normalizedQuery = query.trim().toLowerCase();
  const viewEvents = useMemo(
    () => trace.events.filter((event) => matchesView(event, viewMode)),
    [trace.events, viewMode],
  );
  const matchingTraceIds = useMemo(() => {
    if (!normalizedQuery) return null;
    return new Set(
      trace.events
        .filter((event) =>
          [
            event.kind,
            contextTraceEventLabel(t, event.kind),
            eventCategoryLabel(t, eventCategory(event.kind)),
            event.traceId,
            event.roundId,
            event.runId,
            event.turnId,
            event.requestId,
            event.toolCallId,
            event.toolName,
            String(event.seq),
          ].some((value) => value?.toLowerCase().includes(normalizedQuery)),
        )
        .map((event) => event.traceId),
    );
  }, [normalizedQuery, t, trace.events]);
  const filteredEvents = useMemo(
    () =>
      viewEvents.filter((event) => {
        if (timelineRange && (event.time < timelineRange.start || event.time > timelineRange.end)) {
          return false;
        }
        return matchingTraceIds === null || matchingTraceIds.has(event.traceId);
      }),
    [matchingTraceIds, timelineRange, viewEvents],
  );
  const unseenCount = selectedSummary
    ? trace.events.filter((event) => event.seq > selectedSummary.seq).length
    : trace.events.length;
  const evictedCount = trace.retainedFromSeq > 0 ? trace.retainedFromSeq : 0;

  const selectEvent = (event: SessionContextTraceEventSummary) => {
    setSelectedContextFocus(undefined);
    setSelectedTraceId(event.traceId);
    setDetailView("summary");
    setFollowLive(false);
  };

  const updateTimelineRange = useCallback((nextRange: ContextTraceTimeRange | null) => {
    setTimelineRange(nextRange);
    if (nextRange) setFollowLive(false);
  }, []);

  const selectContextEvent = (
    event: SessionContextTraceEventSummary,
    focus?: ContextTraceDetailFocus,
  ) => {
    setSelectedContextFocus(focus);
    setSelectedTraceId(event.traceId);
    setDetailView("summary");
    setFollowLive(false);
    loadDetail(event.traceId);
  };

  const resumeLive = () => {
    setFollowLive(true);
    setTimelineRange(null);
    const latest = trace.events.at(-1);
    if (latest) {
      setSelectedContextFocus(undefined);
      setSelectedTraceId(latest.traceId);
      setDetailView("summary");
    }
  };

  const searchControl = (
    <div className="relative min-w-0 flex-1">
      <SearchIcon className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-[var(--input-control-icon-size)] -translate-y-1/2" />
      <Input
        value={query}
        aria-label={t("extensions.contextTrace.search")}
        placeholder={t("extensions.contextTrace.searchPlaceholder")}
        className="ps-8 text-xs"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
    </div>
  );

  const timeline = (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {trace.status === "loading" && trace.events.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 p-8 text-xs">
            <DatabaseIcon className="size-4 animate-pulse" />
            {t("extensions.contextTrace.loading")}
          </div>
        ) : trace.status === "permission-required" ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-xs">
            <TriangleAlertIcon className="size-7 text-amber-500" />
            <p className="text-foreground font-medium">
              {t("extensions.contextTrace.permissionTitle")}
            </p>
            <p>{t("extensions.contextTrace.permissionDescription")}</p>
          </div>
        ) : trace.status === "error" ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-xs">
            <TriangleAlertIcon className="text-destructive size-7" />
            <p className="text-foreground font-medium">{t("extensions.contextTrace.loadFailed")}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRefreshRevision((value) => value + 1)}
            >
              <RefreshCwIcon />
              {t("extensions.contextTrace.retry")}
            </Button>
          </div>
        ) : viewMode === "turns" && trace.events.length > 0 ? (
          <>
            <ContextTraceContextView
              events={trace.events}
              firstTime={trace.events[0]?.time ?? 0}
              focusRange={timelineRange}
              query={query}
              selectedFocus={selectedContextFocus}
              selectedTraceId={selectedTraceId}
              detailByTraceId={detailByTraceId}
              onLoadDetail={loadDetail}
              onSelect={selectContextEvent}
            />
            {trace.hasMore ? (
              <div className="flex justify-center px-2 pb-3 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={trace.loadingMore}
                  onClick={() => void trace.loadMore()}
                >
                  <DatabaseIcon className={cn(trace.loadingMore && "animate-pulse")} />
                  {trace.loadingMore
                    ? t("extensions.contextTrace.loadingMore")
                    : t("extensions.contextTrace.loadMore")}
                </Button>
              </div>
            ) : null}
            <div ref={timelineBottomRef} />
          </>
        ) : filteredEvents.length > 0 ? (
          <>
            <Timeline
              events={filteredEvents}
              firstTime={trace.events[0]?.time ?? 0}
              selectedTraceId={selectedTraceId}
              onSelect={selectEvent}
            />
            {trace.hasMore ? (
              <div className="flex justify-center px-2 pb-3 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={trace.loadingMore}
                  onClick={() => void trace.loadMore()}
                >
                  <DatabaseIcon className={cn(trace.loadingMore && "animate-pulse")} />
                  {trace.loadingMore
                    ? t("extensions.contextTrace.loadingMore")
                    : t("extensions.contextTrace.loadMore")}
                </Button>
              </div>
            ) : null}
            <div ref={timelineBottomRef} />
          </>
        ) : trace.events.length > 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-xs">
            {t("extensions.contextTrace.noMatches")}
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-xs">
            <BracesIcon className="size-7 opacity-45" />
            <p className="text-foreground font-medium">{t("extensions.contextTrace.emptyTitle")}</p>
            <p>{t("extensions.contextTrace.emptyDescription")}</p>
          </div>
        )}
      </div>

      {!showingPreviousActivation && !followLive && unseenCount > 0 ? (
        <button
          type="button"
          className="bg-background hover:bg-muted absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] shadow-sm"
          onClick={resumeLive}
        >
          <ArrowDownIcon className="size-3" />
          {t("extensions.contextTrace.resumeWithCount", { count: unseenCount })}
        </button>
      ) : null}
    </div>
  );

  const selectedCategory = selectedSummary ? eventCategory(selectedSummary.kind) : undefined;
  const selectedContextPresentation = (() => {
    if (viewMode !== "turns") return undefined;
    if (selectedContextFocus?.type === "prompt-section") {
      switch (selectedContextFocus.section) {
        case "user-prompt":
          return {
            badge: t("extensions.contextTrace.contextRoles.user"),
            title: t("extensions.contextTrace.userPrompt"),
            tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
          };
        case "system-prompt":
          return {
            badge: t("extensions.contextTrace.contextRoles.system"),
            title: t("extensions.contextTrace.systemPromptWithoutSkills"),
            tone: "bg-muted text-foreground",
          };
        case "skills":
          return {
            badge: t("extensions.contextTrace.contextEvents.skills"),
            title: t("extensions.contextTrace.skills"),
            tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          };
        case "context-files":
          return {
            badge: t("extensions.contextTrace.tree.instructions"),
            title: t("extensions.contextTrace.contextFiles"),
            tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          };
        case "tool-schema":
          return {
            badge: t("extensions.contextTrace.contextEvents.toolSchema"),
            title: t("extensions.contextTrace.toolSchemas"),
            tone: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
          };
        case "attachments":
          return {
            badge: t("extensions.contextTrace.tree.runtime"),
            title: t("extensions.contextTrace.images"),
            tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          };
      }
    }
    if (selectedContextFocus?.type === "system-prompt-source") {
      const source =
        selectedDetail.status === "ready" && selectedDetail.event.kind === "prompt-composition"
          ? selectedDetail.event.detail.systemPromptSources?.[selectedContextFocus.index]
          : undefined;
      return {
        badge: t("extensions.contextTrace.tree.system"),
        title:
          source?.path?.split(/[\\/]/).at(-1) ??
          (source
            ? t(`extensions.contextTrace.systemPromptSourceKinds.${source.kind}`)
            : t("extensions.contextTrace.systemPromptLoading")),
        tone: "bg-muted text-foreground",
      };
    }
    if (selectedContextFocus?.type === "prompt-tool") {
      return {
        badge: t("extensions.contextTrace.tree.tools"),
        title: selectedContextFocus.toolName,
        tone: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
      };
    }
    if (selectedContextFocus?.type === "context-message") {
      return {
        badge: t("extensions.contextTrace.tree.conversation"),
        title: t("extensions.contextTrace.contextMessage"),
        tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
      };
    }
    if (selectedContextFocus?.type === "trace-node") {
      const node = selectedContextFocus.node;
      return {
        badge:
          node === "context" || node === "conversation"
            ? t("extensions.contextTrace.tree.context")
            : t("extensions.contextTrace.tree.output"),
        title:
          node === "model-step"
            ? t("extensions.contextTrace.modelOutput")
            : node === "context"
              ? t("extensions.contextTrace.modelContext")
              : node === "conversation"
                ? t("extensions.contextTrace.tree.conversation")
                : t("extensions.contextTrace.tree.finalResponse"),
        tone:
          node === "context" || node === "conversation"
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "bg-violet-500/10 text-violet-700 dark:text-violet-300",
      };
    }
    if (
      selectedContextFocus?.type === "output-message" ||
      selectedContextFocus?.type === "output-block"
    ) {
      return {
        badge: t("extensions.contextTrace.tree.output"),
        title: t("extensions.contextTrace.modelOutput"),
        tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
      };
    }
    if (selectedContextFocus?.type === "compaction-section") {
      const title =
        selectedContextFocus.section === "summary"
          ? t("extensions.contextTrace.compactionSummary")
          : selectedContextFocus.section === "messages-to-summarize"
            ? t("extensions.contextTrace.compactionMessagesToSummarize")
            : selectedContextFocus.section === "turn-prefix"
              ? t("extensions.contextTrace.compactionTurnPrefix")
              : t("extensions.contextTrace.compactionDetail");
      return {
        badge: t("extensions.contextTrace.tree.compaction"),
        title,
        tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    }
    if (selectedContextFocus?.type === "message-role") {
      const role = selectedContextFocus.role;
      return {
        badge: t(`extensions.contextTrace.contextRoles.${role}`),
        title: t(`extensions.contextTrace.contextRoleDetails.${role}`),
        tone:
          role === "user"
            ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
            : role === "assistant"
              ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
              : "bg-orange-500/10 text-orange-700 dark:text-orange-300",
      };
    }
    return undefined;
  })();
  const selectedCoordinate = selectedSummary
    ? [
        selectedTreeLocation === undefined
          ? undefined
          : t("extensions.contextTrace.tree.turn", {
              index: selectedTreeLocation.turn.index,
            }),
        selectedTreeLocation?.step
          ? t("extensions.contextTrace.tree.modelStep", {
              index: selectedTreeLocation.step.index,
            })
          : undefined,
        selectedSummary.requestIndex === undefined
          ? undefined
          : t("extensions.contextTrace.requestNumber", {
              index: selectedSummary.requestIndex + 1,
            }),
        selectedSummary.toolName,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const selectedSemanticCoordinate =
    selectedDetailVariant === "user-message"
      ? [
          selectedTreeLocation
            ? t("extensions.contextTrace.tree.turn", {
                index: selectedTreeLocation.turn.index,
              })
            : undefined,
          t("extensions.contextTrace.detailCoordinates.message"),
        ]
          .filter(Boolean)
          .join(" · ")
      : selectedDetailVariant === "tool-execution"
        ? [
            selectedTreeLocation
              ? t("extensions.contextTrace.tree.turn", {
                  index: selectedTreeLocation.turn.index,
                })
              : undefined,
            selectedTreeLocation?.step
              ? t("extensions.contextTrace.detailCoordinates.step", {
                  index: selectedTreeLocation.step.index,
                })
              : undefined,
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
  const selectedHeaderTitle =
    selectedSemanticCoordinate ||
    selectedContextPresentation?.title ||
    (selectedSummary ? contextTraceEventLabel(t, selectedSummary.kind) : "");
  const selectedHeaderMeta =
    selectedDetailVariant === "event" ? selectedCoordinate || selectedSummary?.traceId || "" : "";
  const closeDetail = () => {
    setSelectedTraceId(undefined);
    setSelectedContextFocus(undefined);
    setFollowLive(false);
  };
  const detail = (
    <div className="flex min-h-0 flex-1 flex-col">
      {selectedSummary && selectedCategory ? (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
          <span
            className={cn(
              "inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
              selectedDetailVariant === "tool-execution"
                ? "bg-orange-500/10 text-orange-700 dark:text-orange-300"
                : (selectedContextPresentation?.tone ?? eventCategoryTone(selectedCategory)),
            )}
          >
            {selectedDetailVariant === "tool-execution"
              ? t("extensions.contextTrace.contextRoles.tool")
              : (selectedContextPresentation?.badge ?? eventCategoryLabel(t, selectedCategory))}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-xs",
                selectedDetailVariant === "event"
                  ? "font-medium"
                  : "text-muted-foreground font-mono",
              )}
            >
              {selectedHeaderTitle}
            </p>
            {selectedHeaderMeta ? (
              <p className="text-muted-foreground truncate font-mono text-[10px]">
                {selectedHeaderMeta}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("extensions.contextTrace.closeDetail")}
            title={t("extensions.contextTrace.closeDetail")}
            onClick={closeDetail}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      {selectedSummary ? (
        <div className="flex h-10 shrink-0 items-end gap-4 border-b px-3" role="tablist">
          {detailViews.map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={detailView === view}
              className={cn(
                "hover:text-foreground focus-visible:ring-ring relative inline-flex h-full items-center px-0.5 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-xs leading-[var(--control-text-line-height)]! outline-none focus-visible:ring-2",
                detailView === view ? "text-foreground" : "text-muted-foreground",
              )}
              onClick={() => setDetailView(view)}
            >
              {detailViewLabel(t, view)}
              {detailView === view ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-500" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ContextTraceDetail
          summary={selectedSummary}
          detail={selectedDetail}
          view={detailView}
          focus={selectedDetailFocus}
          toolContext={selectedToolContext}
          onViewChange={setDetailView}
        />
      </div>
    </div>
  );

  return (
    <section ref={rootRef} className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2 text-xs">
        <TraceViewTabs compact={!wide} value={viewMode} onChange={setViewMode} />
        <div className="ms-auto flex min-w-24 flex-1 sm:max-w-sm">{searchControl}</div>
        {!showingPreviousActivation ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              followLive
                ? t("extensions.contextTrace.pauseFollow")
                : t("extensions.contextTrace.resumeFollow")
            }
            title={
              followLive
                ? t("extensions.contextTrace.pauseFollow")
                : t("extensions.contextTrace.resumeFollow")
            }
            onClick={() => (followLive ? setFollowLive(false) : resumeLive())}
          >
            {followLive ? <PauseIcon /> : <PlayIcon />}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("extensions.contextTrace.refresh")}
          title={t("extensions.contextTrace.refresh")}
          onClick={() => setRefreshRevision((value) => value + 1)}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      {trace.status === "ready" && trace.capabilities?.durable === false ? (
        <div className="border-destructive/20 bg-destructive/6 text-destructive flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[11px]">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          {t("extensions.contextTrace.persistenceUnavailable")}
        </div>
      ) : null}

      {evictedCount > 0 ? (
        <div className="border-amber-500/20 bg-amber-500/6 flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          {t("extensions.contextTrace.evictionNotice", {
            count: number(evictedCount),
            retainedFrom: number(trace.retainedFromSeq),
          })}
        </div>
      ) : null}

      {trace.events.length > 0 ? (
        <ContextTraceOverview
          events={trace.events}
          matchingTraceIds={matchingTraceIds}
          range={timelineRange}
          selectedTraceId={selectedTraceId}
          onRangeChange={updateTimelineRange}
          onSelect={selectEvent}
        />
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.58fr)_minmax(0,0.42fr)]">
        <div className="flex min-h-0 min-w-0 flex-col border-e">{timeline}</div>
        <div className="flex min-h-0 min-w-0 flex-col">{detail}</div>
      </div>
    </section>
  );
}
