"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircleIcon,
  GitBranchIcon,
  GitForkIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  TagIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import { Button } from "@workbench/shell/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import { cn } from "@workbench/shell/utils";
import { usePiWorkspaceClient } from "@workbench/agent-runtime-pi-client/workspace";
import type {
  WorkspaceGitCommit,
  WorkspaceGitCommitRef,
  WorkspaceGitLogValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import {
  createGitGraphLayout,
  type GitGraphRowLayout,
  type GitGraphSegment,
} from "./git-graph-layout";

const GRAPH_ROW_HEIGHT = 52;
const GRAPH_LANE_INSET = 12;
const GRAPH_MIN_WIDTH = 88;
const GRAPH_MAX_WIDTH = 176;
const GRAPH_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

function graphColor(colorIndex: number): string {
  return GRAPH_COLORS[colorIndex % GRAPH_COLORS.length] ?? "var(--foreground)";
}

function graphPath(
  segment: GitGraphSegment,
  laneX: (lane: number) => number,
  fromY: number,
  toY: number,
): string {
  const fromX = laneX(segment.fromLane);
  const toX = laneX(segment.toLane);
  const middleY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${middleY}, ${toX} ${middleY}, ${toX} ${toY}`;
}

function GitGraphCell({
  graphWidth,
  layout,
  maxLaneCount,
  selected,
}: Readonly<{
  graphWidth: number;
  layout: GitGraphRowLayout;
  maxLaneCount: number;
  selected: boolean;
}>) {
  const laneSpacing =
    maxLaneCount <= 1 ? 14 : Math.min(14, (graphWidth - GRAPH_LANE_INSET * 2) / (maxLaneCount - 1));
  const laneX = (lane: number) => GRAPH_LANE_INSET + lane * laneSpacing;
  const nodeX = laneX(layout.lane);
  const nodeY = GRAPH_ROW_HEIGHT / 2;
  const nodeColor = graphColor(layout.colorIndex);
  const isHead = layout.commit.refs.some((ref) => ref.kind === "head");

  return (
    <svg
      aria-hidden="true"
      className="block shrink-0 overflow-visible"
      width={graphWidth}
      height={GRAPH_ROW_HEIGHT}
      viewBox={`0 0 ${graphWidth} ${GRAPH_ROW_HEIGHT}`}
    >
      {layout.throughSegments.map((segment, index) => (
        <path
          key={`through:${segment.fromLane}:${segment.toLane}:${index}`}
          d={graphPath(segment, laneX, 0, GRAPH_ROW_HEIGHT)}
          fill="none"
          stroke={graphColor(segment.colorIndex)}
          strokeLinecap="round"
          strokeWidth="2"
        />
      ))}
      {!layout.introduced ? (
        <line
          x1={nodeX}
          x2={nodeX}
          y1="0"
          y2={nodeY}
          stroke={nodeColor}
          strokeLinecap="round"
          strokeWidth="2"
        />
      ) : null}
      {layout.parentSegments.map((segment, index) => (
        <path
          key={`parent:${segment.fromLane}:${segment.toLane}:${index}`}
          d={graphPath(segment, laneX, nodeY, GRAPH_ROW_HEIGHT)}
          fill="none"
          stroke={graphColor(segment.colorIndex)}
          strokeLinecap="round"
          strokeWidth="2"
        />
      ))}
      {selected ? (
        <circle
          cx={nodeX}
          cy={nodeY}
          r="6"
          fill="var(--background)"
          stroke="var(--foreground)"
          strokeWidth="1.5"
        />
      ) : null}
      <circle
        cx={nodeX}
        cy={nodeY}
        r={isHead ? 4.5 : 3.5}
        fill={isHead ? "var(--background)" : nodeColor}
        stroke={isHead ? "var(--warning)" : nodeColor}
        strokeWidth={isHead ? 2 : 1.5}
      />
    </svg>
  );
}

function GitRefChip({ ref: commitRef }: Readonly<{ ref: WorkspaceGitCommitRef }>) {
  const Icon = commitRef.kind === "tag" ? TagIcon : GitBranchIcon;
  return (
    <span
      title={commitRef.name}
      className={cn(
        "inline-flex h-6 max-w-44 shrink-0 items-center gap-1 rounded-[min(var(--radius),8px)] border px-1.5 text-xs font-medium",
        commitRef.kind === "head"
          ? "border-warning/70 bg-warning/10 text-warning-foreground"
          : "border-border bg-muted/70 text-muted-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      <span className="truncate">{commitRef.name}</span>
    </span>
  );
}

function CommitRefs({ refs }: Readonly<{ refs: readonly WorkspaceGitCommitRef[] }>) {
  if (!refs.length) return null;
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1">
      {refs.map((ref) => (
        <GitRefChip key={`${ref.kind}:${ref.name}`} ref={ref} />
      ))}
    </span>
  );
}

function formatCommitDate(
  authoredAt: string,
  format: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string,
  options: Intl.DateTimeFormatOptions,
): string {
  const timestamp = Date.parse(authoredAt);
  return Number.isNaN(timestamp) ? authoredAt : format(timestamp, options);
}

export function GitGraphDialog({
  onOpenChange,
  open,
  workspaceId,
}: Readonly<{
  onOpenChange(open: boolean): void;
  open: boolean;
  workspaceId: string;
}>) {
  const { date, t } = usePiI18n();
  const workspaceClient = usePiWorkspaceClient();
  const [data, setData] = useState<WorkspaceGitLogValue>();
  const [selectedHash, setSelectedHash] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const requestController = useRef<AbortController | undefined>(undefined);
  const requestRevision = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (initial: boolean) => {
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      const revision = ++requestRevision.current;
      setError(false);
      if (initial) {
        setData(undefined);
        setSelectedHash(undefined);
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const value = await workspaceClient.readGitLog(
          { workspaceId },
          { signal: controller.signal },
        );
        if (controller.signal.aborted || revision !== requestRevision.current) return;
        setData(value);
        setSelectedHash((current) =>
          current && value.commits.some((commit) => commit.hash === current)
            ? current
            : value.commits[0]?.hash,
        );
      } catch {
        if (!controller.signal.aborted && revision === requestRevision.current) setError(true);
      } finally {
        if (!controller.signal.aborted && revision === requestRevision.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [workspaceClient, workspaceId],
  );

  useEffect(() => {
    if (!open) {
      requestController.current?.abort();
      return;
    }
    void load(true);
    return () => requestController.current?.abort();
  }, [load, open]);

  const graph = useMemo(() => createGitGraphLayout(data?.commits ?? []), [data?.commits]);
  const graphWidth = Math.min(
    GRAPH_MAX_WIDTH,
    Math.max(GRAPH_MIN_WIDTH, graph.maxLaneCount * 14 + GRAPH_LANE_INSET * 2),
  );
  const gridStyle = {
    gridTemplateColumns: `${graphWidth}px minmax(360px, 1fr) 148px 120px 92px`,
  } satisfies CSSProperties;
  const selectedCommit =
    data?.commits.find((commit) => commit.hash === selectedHash) ?? data?.commits[0];
  const rowVirtualizer = useVirtualizer({
    count: graph.rows.length,
    estimateSize: () => GRAPH_ROW_HEIGHT,
    getItemKey: (index) => graph.rows[index]?.commit.hash ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 16,
    useFlushSync: false,
  });

  const focusRow = (index: number) => {
    const nextIndex = Math.max(0, Math.min(graph.rows.length - 1, index));
    const hash = graph.rows[nextIndex]?.commit.hash;
    if (!hash) return;
    setSelectedHash(hash);
    rowVirtualizer.scrollToIndex(nextIndex, { align: "auto" });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-git-graph-row="${nextIndex}"]`)
          ?.focus();
      });
    });
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusRow(graph.rows.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedHash(graph.rows[index]?.commit.hash);
    }
  };

  const renderTable = () => {
    if (loading && !data) {
      return (
        <div role="status" className="flex size-full items-center justify-center gap-2">
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-5 animate-spin motion-reduce:animate-none"
          />
          <span>{t("extensions.gitBranch.graph.loading")}</span>
        </div>
      );
    }
    if (error && !data) {
      return (
        <div role="alert" className="flex size-full flex-col items-center justify-center gap-3 p-6">
          <AlertCircleIcon aria-hidden="true" className="size-7 text-destructive" />
          <p className="text-muted-foreground">{t("extensions.gitBranch.graph.loadError")}</p>
          <Button type="button" variant="outline" onClick={() => void load(true)}>
            <RefreshCwIcon aria-hidden="true" />
            {t("extensions.gitBranch.graph.retry")}
          </Button>
        </div>
      );
    }
    if (!data?.commits.length) {
      return (
        <div
          role="status"
          className="flex size-full items-center justify-center text-muted-foreground"
        >
          {t("extensions.gitBranch.graph.empty")}
        </div>
      );
    }

    return (
      <div
        role="grid"
        aria-label={t("extensions.gitBranch.graph.tableLabel")}
        aria-colcount={5}
        aria-rowcount={data.commits.length + 1}
        className="min-w-[920px]"
      >
        <div role="rowgroup" className="bg-popover sticky top-0 z-20 border-b shadow-xs">
          <div
            role="row"
            className="grid h-11 items-center font-medium text-muted-foreground"
            style={gridStyle}
          >
            <div role="columnheader" className="h-full border-e px-4 py-3">
              {t("extensions.gitBranch.graph.columns.graph")}
            </div>
            <div role="columnheader" className="h-full border-e px-4 py-3">
              {t("extensions.gitBranch.graph.columns.subject")}
            </div>
            <div role="columnheader" className="h-full border-e px-4 py-3">
              {t("extensions.gitBranch.graph.columns.date")}
            </div>
            <div role="columnheader" className="h-full border-e px-4 py-3">
              {t("extensions.gitBranch.graph.columns.author")}
            </div>
            <div role="columnheader" className="h-full px-4 py-3">
              {t("extensions.gitBranch.graph.columns.commit")}
            </div>
          </div>
        </div>

        <div role="rowgroup" className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const layout = graph.rows[virtualRow.index];
            if (!layout) return null;
            const commit = layout.commit;
            const selected = commit.hash === selectedCommit?.hash;
            return (
              <div
                key={virtualRow.key}
                data-git-graph-row={virtualRow.index}
                role="row"
                aria-rowindex={virtualRow.index + 2}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                title={commit.subject}
                className={cn(
                  "absolute top-0 left-0 grid w-full min-w-[920px] cursor-default items-center border-b outline-none transition-colors hover:bg-muted/45 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected && "bg-muted/70",
                )}
                style={{
                  ...gridStyle,
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => setSelectedHash(commit.hash)}
                onKeyDown={(event) => handleRowKeyDown(event, virtualRow.index)}
              >
                <div role="gridcell" className="h-full border-e">
                  <GitGraphCell
                    graphWidth={graphWidth}
                    layout={layout}
                    maxLaneCount={graph.maxLaneCount}
                    selected={selected}
                  />
                </div>
                <div role="gridcell" className="flex min-w-0 items-center gap-2 border-e px-4">
                  <CommitRefs refs={commit.refs} />
                  <span className="min-w-0 truncate text-[0.95rem]">
                    {commit.subject || t("extensions.gitBranch.graph.noSubject")}
                  </span>
                </div>
                <div
                  role="gridcell"
                  className="truncate border-e px-4 text-muted-foreground tabular-nums"
                >
                  {formatCommitDate(commit.authoredAt, date, {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                <div role="gridcell" className="truncate border-e px-4 text-muted-foreground">
                  {commit.authorName}
                </div>
                <div role="gridcell" className="truncate px-4 font-mono text-muted-foreground">
                  {commit.shortHash}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("extensions.gitBranch.graph.close")}
        className="grid h-[min(88vh,60rem)] max-h-[calc(100vh-2rem)] w-[min(96vw,88rem)] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogHeader className="min-w-0 gap-1 border-b px-4 py-3 pe-24">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-lg">
            <GitForkIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{t("extensions.gitBranch.graph.title")}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("extensions.gitBranch.graph.description")}
          </DialogDescription>
          {data ? (
            <p className="text-xs text-muted-foreground">
              {data.truncated
                ? t("extensions.gitBranch.graph.truncated", { count: data.commits.length })
                : t("extensions.gitBranch.graph.commitCount", { count: data.commits.length })}
            </p>
          ) : null}
        </DialogHeader>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("extensions.gitBranch.graph.refresh")}
          title={t("extensions.gitBranch.graph.refresh")}
          disabled={loading || refreshing}
          className="absolute top-3 right-11 z-10"
          onClick={() => void load(false)}
        >
          <RefreshCwIcon
            aria-hidden="true"
            className={cn(refreshing && "animate-spin motion-reduce:animate-none")}
          />
        </Button>

        <div
          ref={scrollRef}
          className="min-h-0 overflow-auto overscroll-contain [scrollbar-gutter:stable]"
        >
          {error && data ? (
            <div role="alert" className="border-b bg-destructive/10 px-4 py-2 text-destructive">
              {t("extensions.gitBranch.graph.refreshError")}
            </div>
          ) : null}
          {renderTable()}
        </div>

        {selectedCommit ? (
          <CommitDetails commit={selectedCommit} />
        ) : (
          <div className="hidden" aria-hidden="true" />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CommitDetails({ commit }: Readonly<{ commit: WorkspaceGitCommit }>) {
  const { date, t } = usePiI18n();
  return (
    <section
      aria-label={t("extensions.gitBranch.graph.details.label")}
      className="grid max-h-48 grid-cols-1 gap-x-8 gap-y-3 overflow-auto border-t bg-muted/25 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)_minmax(10rem,0.8fr)]"
    >
      <div className="min-w-0">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("extensions.gitBranch.graph.details.subject")}
        </h3>
        <p className="mt-1 truncate text-sm font-medium" title={commit.subject}>
          {commit.subject || t("extensions.gitBranch.graph.noSubject")}
        </p>
        <div className="mt-2 flex min-w-0 flex-wrap gap-1">
          <CommitRefs refs={commit.refs} />
        </div>
      </div>
      <div className="min-w-0">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("extensions.gitBranch.graph.details.commit")}
        </h3>
        <p className="mt-1 truncate font-mono text-sm" title={commit.hash}>
          {commit.hash}
        </p>
        <h3 className="mt-3 text-xs font-medium text-muted-foreground">
          {t("extensions.gitBranch.graph.details.date")}
        </h3>
        <p className="mt-1 text-sm tabular-nums">
          {formatCommitDate(commit.authoredAt, date, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      </div>
      <div className="min-w-0">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("extensions.gitBranch.graph.details.author")}
        </h3>
        <p className="mt-1 truncate text-sm" title={commit.authorName}>
          {commit.authorName}
        </p>
        <h3 className="mt-3 text-xs font-medium text-muted-foreground">
          {t("extensions.gitBranch.graph.details.parents")}
        </h3>
        <p className="mt-1 truncate font-mono text-sm" title={commit.parentHashes.join(", ")}>
          {commit.parentHashes.length
            ? commit.parentHashes.map((hash) => hash.slice(0, 8)).join(", ")
            : t("extensions.gitBranch.graph.details.noParents")}
        </p>
      </div>
    </section>
  );
}
