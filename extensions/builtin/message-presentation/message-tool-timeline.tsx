"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import {
  MessagePrimitive,
  useAuiState,
  type DataMessagePart,
  type EnrichedPartState,
  type ReasoningMessagePart,
  type ToolCallMessagePart,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import {
  FileSearchIcon,
  ListChecksIcon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
  SquareTerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";

import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { ReasoningPanel, type ReasoningStep } from "@/components/elements/reasoning-panel";
import { ReviewableDiff, type HunkDecision } from "@/components/elements/reviewable-diff";
import { ShimmerLabel } from "@/components/elements/surfaces";
import { ToolCall } from "@/components/elements/tool-call";
import { useOpenerService, useWorkspaceContext } from "@/components/right-workspace";
import { useI18n } from "@/i18n";
import { formatCompactDuration } from "@/lib/format-duration";
import { cn } from "@/lib/utils";
import type { ToolPresentationDefinition } from "@/platform/extensions/authoring";
import {
  RendererHost,
  useDataPresentationMap,
  useToolPresentationMap,
  useToolRendererMap,
} from "@/platform/extensions/hosts/renderer-host";

import { useMessageDisclosure } from "./message-disclosure-context";
import { toolDiffModel } from "./tool-diff-model";
import {
  activeToolPresentationLabel,
  dataTimelineState,
  liveReasoningPreview,
  reasoningPartTiming,
  timelineEntries,
  timelineStats,
  timelineSteps,
  type TimelineSourcePart,
  type ToolTimelineStepKind,
} from "./tool-timeline-model";

type TimelineReasoningPart = ReasoningMessagePart;
type TimelineToolPart = ToolCallMessagePart;

const STEP_ICONS: Readonly<Record<ToolTimelineStepKind, LucideIcon>> = {
  thinking: SparklesIcon,
  read: FileSearchIcon,
  ran: SquareTerminalIcon,
  edited: PencilIcon,
  searched: SearchIcon,
  used: WrenchIcon,
};

const TimelineToolDetail: ToolCallMessagePartComponent = (part) => {
  const RegisteredToolUI = useAuiState((state) => state.tools.toolUIs[part.toolName]?.[0]?.render);
  const toolUI = RegisteredToolUI ? <RegisteredToolUI {...part} /> : null;

  return <RendererHost part={{ ...part, toolUI }} />;
};

const TIMELINE_TOOL_DETAIL_COMPONENTS = {
  tools: { Override: TimelineToolDetail },
};

function isTimelineSourcePart(
  value: unknown,
  dataPresentations: ReturnType<typeof useDataPresentationMap>,
): value is TimelineSourcePart {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  if (type === "reasoning" || type === "tool-call") return true;
  return (
    type === "data" && dataTimelineState(value as DataMessagePart, dataPresentations) !== undefined
  );
}

function serializeToolValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function useElapsedSeconds(
  running: boolean,
  timing?: ToolCallMessagePart["timing"],
): number | undefined {
  const fallbackStartedAt = useRef<number | undefined>(running ? Date.now() : undefined);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | undefined>(() => {
    if (timing?.completedAt !== undefined) {
      return Math.max(0, Math.floor((timing.completedAt - timing.startedAt) / 1_000));
    }
    return running ? 0 : undefined;
  });

  useEffect(() => {
    const startedAt =
      timing?.startedAt ?? fallbackStartedAt.current ?? (running ? Date.now() : undefined);
    if (startedAt === undefined) return;

    fallbackStartedAt.current = startedAt;
    const updateElapsed = (endedAt = timing?.completedAt ?? Date.now()) => {
      setElapsedSeconds(Math.max(0, Math.floor((endedAt - startedAt) / 1_000)));
    };

    updateElapsed();
    if (!running || timing?.completedAt !== undefined) return;

    const interval = window.setInterval(() => updateElapsed(), 1_000);
    return () => window.clearInterval(interval);
  }, [running, timing?.completedAt, timing?.startedAt]);

  return elapsedSeconds;
}

function TimelineReasoning({
  part,
  running,
  preview,
  disclosureId,
}: {
  part: TimelineReasoningPart;
  running: boolean;
  preview: string;
  disclosureId: string | number;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useMessageDisclosure("reasoning", disclosureId);
  const elapsedSeconds = useElapsedSeconds(running, reasoningPartTiming(part));
  const collapsedPreview = running
    ? liveReasoningPreview(part.text || part.unstable_summary || "") || preview
    : preview;

  return (
    <ReasoningPanel
      steps={[
        {
          marker: false,
          body: <div className="whitespace-pre-wrap">{part.text || part.unstable_summary}</div>,
        },
      ]}
      visibleSteps={1}
      streaming={running}
      open={open}
      onOpenChange={setOpen}
      activeLabel={t("extensions.messagePresentation.reasoning.active")}
      restingLabel={t("extensions.messagePresentation.reasoning.step")}
      icon={SparklesIcon}
      activeIcon={
        <ThinkingOrb
          state="composing"
          size={20}
          speed={3.0}
          style={{ width: "100%", height: "100%" }}
        />
      }
      collapsedPreview={collapsedPreview}
      collapsedPreviewEdge={running ? "end" : "start"}
      elapsed={
        elapsedSeconds === undefined
          ? undefined
          : t("extensions.messagePresentation.elapsed", {
              duration: formatCompactDuration(elapsedSeconds * 1_000, locale, {
                includeZero: true,
              }),
            })
      }
      className="max-w-none"
    />
  );
}

function TimelineToolCall({
  part,
  partIndex,
  kind,
  query,
  running,
  presentation,
}: {
  part: TimelineToolPart;
  partIndex: number;
  kind: ToolTimelineStepKind;
  query: string;
  running: boolean;
  presentation?: ToolPresentationDefinition;
}) {
  const { locale, number, t, text } = useI18n();
  const [open, setOpen] = useMessageDisclosure("tool", part.toolCallId);
  const openers = useOpenerService();
  const workspaceContext = useWorkspaceContext();
  const toolRenderers = useToolRendererMap();
  const hasAssistantToolUI = useAuiState(
    (state) => state.tools.toolUIs[part.toolName]?.[0]?.render !== undefined,
  );
  const hasToolDetail = Object.hasOwn(toolRenderers, part.toolName) || hasAssistantToolUI;
  const displayedResult = part.result ?? part.artifact;
  const elapsedSeconds = useElapsedSeconds(running, part.timing);
  const Icon = presentation?.icon ?? STEP_ICONS[kind];
  const DisclosureController = presentation?.disclosureController;
  const label = presentation
    ? text(presentation.label)
    : t(`extensions.messagePresentation.toolTimeline.steps.${kind}`);
  const presentationActiveLabel = activeToolPresentationLabel(part, presentation);
  const activeLabel = presentationActiveLabel
    ? text(presentationActiveLabel)
    : t(`extensions.messagePresentation.toolTimeline.activeSteps.${kind}`);
  const isFileMutation = part.toolName === "edit" || part.toolName === "write";
  const displayLabel =
    part.toolName === "write"
      ? t("extensions.messagePresentation.toolTimeline.steps.created")
      : label;
  const displayActiveLabel =
    part.toolName === "write"
      ? t("extensions.messagePresentation.toolTimeline.activeSteps.creating")
      : activeLabel;
  const failedLabel = t("extensions.messagePresentation.toolTimeline.failed");
  const fileDiff = useMemo(() => (part.isError ? undefined : toolDiffModel(part)), [part]);
  const [hunkDecisions, setHunkDecisions] = useState<Readonly<Record<string, HunkDecision>>>({});
  const reviewHunks = useMemo(
    () =>
      fileDiff?.hunks.map((hunk) => ({
        ...hunk,
        decision: hunkDecisions[hunk.id] ?? hunk.decision,
      })) ?? [],
    [fileDiff, hunkDecisions],
  );
  const decideHunk = useCallback((id: string, decision: HunkDecision) => {
    setHunkDecisions((current) => ({ ...current, [id]: decision }));
  }, []);
  const diffId = `file-diff:${workspaceContext.threadId ?? workspaceContext.applicationId}:${part.toolCallId}`;
  const openWorkspaceDiff = useCallback(() => {
    if (!fileDiff) return;

    void openers
      .open({
        resource: {
          scheme: "workspace-file",
          path: fileDiff.path,
          label: fileDiff.filename,
          metadata: {
            viewMode: "diff",
            diffId,
            lines: fileDiff.lines,
          },
        },
        context: workspaceContext,
        scope: workspaceContext.threadId
          ? { type: "thread", key: workspaceContext.threadId }
          : { type: "application", key: workspaceContext.applicationId },
        policy: "force-focus",
      })
      .catch((error: unknown) => {
        console.error("Failed to open file diff", error);
      });
  }, [diffId, fileDiff, openers, workspaceContext]);
  const fileMutationSummary = isFileMutation ? (
    <span
      data-slot="file-mutation-tool-summary"
      className={cn("flex min-w-0 items-center gap-1", part.isError && "text-destructive")}
    >
      <ShimmerLabel active={running} className="relative shrink-0 whitespace-nowrap leading-none">
        {running ? displayActiveLabel : part.isError ? failedLabel : displayLabel}
      </ShimmerLabel>
      {fileDiff ? (
        <button
          type="button"
          title={query}
          className="pointer-events-auto min-w-0 cursor-pointer truncate border-b border-dotted border-foreground/30 bg-transparent text-left leading-tight text-foreground/55 transition-colors group-hover/tool-summary:text-foreground group-focus-within/tool-summary:text-foreground focus-visible:outline-none"
          onClick={openWorkspaceDiff}
        >
          {query}
        </button>
      ) : (
        <span
          title={query}
          className="min-w-0 truncate border-b border-dotted border-foreground/30 leading-tight"
        >
          {query}
        </span>
      )}
      {fileDiff ? (
        <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
          <span className="text-[var(--tool-diff-additions)] transition-colors">
            <span data-diff-marker="">+</span>
            {number(fileDiff.additions)}
          </span>
          <span className="text-[var(--tool-diff-deletions)] transition-colors">
            <span data-diff-marker="">-</span>
            {number(fileDiff.deletions)}
          </span>
        </span>
      ) : null}
    </span>
  ) : undefined;

  return (
    <ToolCall
      label={displayLabel}
      activeLabel={displayActiveLabel}
      query={query}
      summary={fileMutationSummary}
      request={serializeToolValue(part.args)}
      result={serializeToolValue(displayedResult)}
      requestLabel={t("extensions.messagePresentation.toolTimeline.request")}
      resultLabel={t("extensions.messagePresentation.toolTimeline.result")}
      icon={Icon}
      running={running}
      failed={part.isError}
      failedLabel={failedLabel}
      showCompletionIcon={!isFileMutation}
      expandable={!isFileMutation || Boolean(fileDiff) || part.isError}
      open={open}
      onOpenChange={setOpen}
      disclosureController={
        DisclosureController
          ? ({ open: disclosureOpen, onOpenChange }) => (
              <DisclosureController
                part={part}
                running={running}
                open={disclosureOpen}
                onOpenChange={onOpenChange}
              />
            )
          : undefined
      }
      elapsed={
        elapsedSeconds === undefined
          ? undefined
          : t("extensions.messagePresentation.elapsed", {
              duration: formatCompactDuration(elapsedSeconds * 1_000, locale, {
                includeZero: true,
              }),
            })
      }
    >
      {fileDiff && reviewHunks.length > 0 ? (
        <ReviewableDiff
          filename={fileDiff.filename}
          hunks={reviewHunks}
          labels={{
            discard: t("extensions.shared.reviewableDiff.discard"),
            discardHunk: (range) => t("extensions.shared.reviewableDiff.discardHunk", { range }),
            keep: t("extensions.shared.reviewableDiff.keep"),
            keepAll: t("extensions.shared.reviewableDiff.keepAll"),
            keepHunk: (range) => t("extensions.shared.reviewableDiff.keepHunk", { range }),
            kept: t("extensions.shared.reviewableDiff.kept"),
            discarded: t("extensions.shared.reviewableDiff.discarded"),
            remaining: (count) => t("extensions.shared.reviewableDiff.remaining", { count }),
            allReviewed: t("extensions.shared.reviewableDiff.allReviewed"),
          }}
          onKeep={(id) => decideHunk(id, "kept")}
          onDiscard={(id) => decideHunk(id, "discarded")}
          className="max-w-none"
        />
      ) : !part.isError && hasToolDetail ? (
        <MessagePrimitive.PartByIndex
          index={partIndex}
          components={TIMELINE_TOOL_DETAIL_COMPONENTS}
        />
      ) : null}
    </ToolCall>
  );
}

function ParallelToolGroup({
  batchId,
  parts,
  partIndices,
  kinds,
  queries,
  presentations,
  turnStreaming,
}: {
  batchId: string;
  parts: readonly TimelineToolPart[];
  partIndices: readonly number[];
  kinds: readonly ToolTimelineStepKind[];
  queries: readonly string[];
  presentations: readonly (ToolPresentationDefinition | undefined)[];
  turnStreaming: boolean;
}) {
  const running = turnStreaming && parts.some((part) => !part.isError && part.result === undefined);
  const [open, setOpen] = useMessageDisclosure("parallel-tools", batchId);

  return (
    <ToolGroupRoot
      variant="ghost"
      open={open}
      onOpenChange={setOpen}
      className="max-w-none [overflow-anchor:none]"
    >
      <ToolGroupTrigger
        count={parts.length}
        active={running}
        icon={WrenchIcon}
        className="text-foreground/55 hover:text-foreground/90 gap-1.5 py-1 text-[13.5px] transition-colors outline-none"
      />
      <ToolGroupContent className="[&>div]:ms-1 [&>div]:border-s [&>div]:border-foreground/10 [&>div]:ps-3">
        {parts.map((part, index) => {
          const kind = kinds[index];
          const query = queries[index];
          const partIndex = partIndices[index];
          if (!kind || query === undefined || partIndex === undefined) return null;
          const toolRunning = turnStreaming && !part.isError && part.result === undefined;

          return (
            <TimelineToolCall
              key={part.toolCallId}
              part={part}
              partIndex={partIndex}
              kind={kind}
              query={query}
              running={toolRunning}
              presentation={presentations[index]}
            />
          );
        })}
      </ToolGroupContent>
    </ToolGroupRoot>
  );
}

export function MessageToolTimeline({
  indices,
  activePartIndex,
  turnStreaming,
}: PropsWithChildren<{
  indices: readonly number[];
  activePartIndex: number;
  turnStreaming: boolean;
}>) {
  const { t, text } = useI18n();
  const content = useAuiState((state) => state.message.content);
  const toolPresentations = useToolPresentationMap();
  const dataPresentations = useDataPresentationMap();
  const [open, setOpen] = useMessageDisclosure("steps", indices[0] ?? "empty");
  const activeStepIndex = indices.indexOf(activePartIndex);
  const parts = useMemo(
    () =>
      indices
        .map((index) => content[index])
        .filter((part): part is TimelineSourcePart =>
          isTimelineSourcePart(part, dataPresentations),
        ),
    [content, dataPresentations, indices],
  );
  const stepModels = useMemo(
    () => timelineSteps(parts, toolPresentations),
    [parts, toolPresentations],
  );
  const entries = useMemo(() => timelineEntries(parts), [parts]);
  const stats = useMemo(() => timelineStats(parts), [parts]);
  const steps: ReasoningStep[] = entries.map((entry) => {
    if (entry.kind === "parallel-tools") {
      const models = entry.sourceIndices.map((index) => stepModels[index]);
      return {
        marker: false,
        body: (
          <ParallelToolGroup
            batchId={entry.batchId}
            parts={entry.parts}
            partIndices={entry.sourceIndices.map((index) => indices[index] ?? index)}
            kinds={models.flatMap((model) => (model && model.kind !== "data" ? [model.kind] : []))}
            queries={models.flatMap((model) =>
              model && model.kind !== "data" ? [text(model.chip)] : [],
            )}
            presentations={models.map((model) =>
              model?.kind === "data" ? undefined : model?.presentation,
            )}
            turnStreaming={turnStreaming}
          />
        ),
      };
    }

    const { part, sourceIndex } = entry;
    const model = stepModels[sourceIndex];
    if (!model) return { body: null };

    if (part.type === "data") {
      const timelineState = dataTimelineState(part, dataPresentations);
      const enrichedPart = {
        ...part,
        status: { type: timelineState?.active ? "running" : "complete" },
        dataRendererUI: null,
      } satisfies EnrichedPartState;
      return {
        marker: false,
        body: <RendererHost part={enrichedPart} />,
      };
    }

    if (model.kind === "data") return { body: null };

    if (part.type === "reasoning") {
      return {
        marker: false,
        body: (
          <TimelineReasoning
            part={part}
            running={sourceIndex === activeStepIndex}
            preview={text(model.chip)}
            disclosureId={indices[sourceIndex] ?? sourceIndex}
          />
        ),
      };
    }

    return {
      marker: false,
      body: (
        <TimelineToolCall
          part={part}
          partIndex={indices[sourceIndex] ?? sourceIndex}
          kind={model.kind}
          query={text(model.chip)}
          running={turnStreaming && !part.isError && part.result === undefined}
          presentation={model.presentation}
        />
      ),
    };
  });

  const summaryArgs = { steps: entries.length, files: stats.length };

  return (
    <ReasoningPanel
      steps={steps}
      visibleSteps={entries.length}
      streaming={activeStepIndex >= 0}
      open={open}
      onOpenChange={setOpen}
      restingLabel={t("extensions.messagePresentation.toolTimeline.summary", summaryArgs)}
      activeLabel={t("extensions.messagePresentation.toolTimeline.active", summaryArgs)}
      icon={ListChecksIcon}
      className="my-1 max-w-none [overflow-anchor:none]"
    />
  );
}
