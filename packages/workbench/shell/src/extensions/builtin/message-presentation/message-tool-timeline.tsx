"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import {
  createLucideIcon,
  FileSearchIcon,
  ListChecksIcon,
  PencilIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type {
  DataBlock,
  MessageBlock,
  MessageBlockTiming,
  ReasoningBlock,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";

import { useConversationPreferences } from "../../../chat/conversation-preferences";
import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from "../../../chat/tool-group";
import { ReasoningPanel, type ReasoningStep } from "../../../elements/reasoning-panel";
import { ReviewableDiff } from "../../../elements/reviewable-diff";
import { ShimmerLabel } from "../../../ui/surface";
import { useToastManager } from "../../../ui/toast";
import { ToolCall, ToolCallDetails } from "../../../elements/tool-call";
import { useOpenerService, useWorkspaceContext } from "../../../right-workspace-react";
import { useI18n } from "../../../i18n";
import { formatCompactDuration } from "../../../format-duration";
import { cn } from "../../../utils";
import type { MessageRendererNode, ToolPresentationDefinition } from "@workbench/extension-sdk";
import {
  RendererHost,
  useDataPresentationMap,
  useToolPresentationMap,
} from "@workbench/extension-host/hosts/renderer-host";

import { MessageDisclosureScope, useMessageDisclosure } from "./message-disclosure-context";
import { toolDiffModel } from "./tool-diff-model";
import {
  activeToolPresentationLabel,
  dataTimelineState,
  liveReasoningPreview,
  timelineEntries,
  timelineStats,
  timelineSteps,
  toolTimelineCallState,
  type ToolTimelineStepKind,
} from "./tool-timeline-model";
import { withTooltip } from "../../../ui/tooltip";

type TimelineBlock = ReasoningBlock | ToolCallBlock | DataBlock;

const ReasoningIcon = createLucideIcon("Reasoning", [
  [
    "path",
    {
      d: "M7 16.5h10a4 4 0 0 0 1.1-7.85A4.5 4.5 0 0 0 10 5.5a3.5 3.5 0 0 0-5.5 3.8A4 4 0 0 0 7 16.5Z",
      key: "thought",
    },
  ],
  [
    "circle",
    { cx: "7.5", cy: "19.5", r: "1.25", fill: "currentColor", stroke: "none", key: "near" },
  ],
  ["circle", { cx: "4", cy: "21.5", r: "0.85", fill: "currentColor", stroke: "none", key: "far" }],
]);

const STEP_ICONS: Readonly<Record<ToolTimelineStepKind, LucideIcon>> = {
  thinking: ReasoningIcon,
  read: FileSearchIcon,
  ran: SquareTerminalIcon,
  edited: PencilIcon,
  searched: SearchIcon,
  used: WrenchIcon,
};

const REASONING_STALL_DELAY_MS = 3_000;

function isTimelineBlock(
  block: MessageBlock | undefined,
  dataPresentations: ReturnType<typeof useDataPresentationMap>,
): block is TimelineBlock {
  if (block?.kind === "reasoning" || block?.kind === "tool-call") return true;
  return block?.kind === "data" && dataTimelineState(block, dataPresentations) !== undefined;
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

function useElapsedSeconds(running: boolean, timing?: MessageBlockTiming): number | undefined {
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

export function useReasoningStalled(running: boolean, content: string): boolean {
  const activity = useMemo(() => ({ running, content }), [running, content]);
  const [stalledActivity, setStalledActivity] = useState<typeof activity>();

  useEffect(() => {
    if (!activity.running) return;

    const timer = window.setTimeout(() => setStalledActivity(activity), REASONING_STALL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activity]);

  // A new activity resets the label during render, without a synchronous effect update.
  return running && stalledActivity === activity;
}

function TimelineReasoning({
  block,
  running,
  transportRecovering,
  preview,
  disclosureId,
}: {
  block: ReasoningBlock;
  running: boolean;
  transportRecovering: boolean;
  preview: string;
  disclosureId: string | number;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useMessageDisclosure("reasoning", disclosureId);
  const elapsedSeconds = useElapsedSeconds(running, block.timing);
  const content = block.text;
  const stalled = useReasoningStalled(running, content);
  const collapsedPreview = running ? liveReasoningPreview(content) || preview : preview;

  return (
    <ReasoningPanel
      steps={[
        {
          marker: false,
          body: <div className="whitespace-pre-wrap">{content}</div>,
        },
      ]}
      visibleSteps={1}
      streaming={running}
      open={open}
      onOpenChange={setOpen}
      activeLabel={t(
        transportRecovering
          ? "extensions.messagePresentation.reasoning.recovering"
          : stalled
            ? "extensions.messagePresentation.reasoning.stalled"
            : "extensions.messagePresentation.reasoning.active",
      )}
      restingLabel={t("extensions.messagePresentation.reasoning.step")}
      icon={ReasoningIcon}
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
  block,
  kind,
  node,
  query,
  presentation,
}: {
  block: ToolCallBlock;
  kind: ToolTimelineStepKind;
  node: MessageRendererNode;
  query: string;
  presentation?: ToolPresentationDefinition;
}) {
  const { locale, number, t, text } = useI18n();
  const { add: addToast } = useToastManager();
  const [open, setOpen] = useMessageDisclosure("tool", block.callId);
  const openers = useOpenerService();
  const workspaceContext = useWorkspaceContext();
  const state = toolTimelineCallState(block);
  const elapsedSeconds = useElapsedSeconds(state.running, block.timing);
  const Icon = presentation?.icon ?? STEP_ICONS[kind];
  const DisclosureController = presentation?.disclosureController;
  const label = presentation
    ? text(presentation.label)
    : t(`extensions.messagePresentation.toolTimeline.steps.${kind}`);
  const presentationActiveLabel = activeToolPresentationLabel(block, presentation);
  const activeLabel = presentationActiveLabel
    ? text(presentationActiveLabel)
    : t(`extensions.messagePresentation.toolTimeline.activeSteps.${kind}`);
  const isFileMutation = block.toolName === "edit" || block.toolName === "write";
  const displayLabel =
    block.toolName === "write"
      ? t("extensions.messagePresentation.toolTimeline.steps.created")
      : label;
  const displayActiveLabel =
    block.toolName === "write"
      ? t("extensions.messagePresentation.toolTimeline.activeSteps.creating")
      : activeLabel;
  const failedLabel = t("extensions.messagePresentation.toolTimeline.failed");
  const terminalLabel = state.cancelled ? t("assistant.tool.cancelled") : failedLabel;
  const fileDiff = useMemo(
    () =>
      block.status === "complete"
        ? toolDiffModel({
            toolName: block.toolName,
            toolCallId: block.callId,
            args: block.arguments,
            result: block.result,
          })
        : undefined,
    [block],
  );
  const diffId = `file-diff:${workspaceContext.threadId ?? workspaceContext.applicationId}:${block.callId}`;
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
      .catch(() => {
        addToast({
          id: "workspace-file-open-error",
          type: "error",
          priority: "high",
          title: t("extensions.shared.fileTree.openError", { name: fileDiff.filename }),
        });
      });
  }, [addToast, diffId, fileDiff, openers, t, workspaceContext]);
  const fileMutationSummary = isFileMutation ? (
    <span
      data-slot="file-mutation-tool-summary"
      className={cn(
        "flex min-w-0 items-center gap-1",
        state.failed && "text-destructive",
        state.cancelled && "text-muted-foreground",
      )}
    >
      <ShimmerLabel
        active={state.running}
        className={cn(
          "relative shrink-0 whitespace-nowrap leading-none",
          state.cancelled && "line-through",
        )}
      >
        {state.running || state.requiresAction
          ? displayActiveLabel
          : state.failed || state.cancelled
            ? terminalLabel
            : displayLabel}
      </ShimmerLabel>
      {fileDiff
        ? withTooltip(
            <button
              type="button"
              title={query}
              className="pointer-events-auto min-w-0 cursor-pointer truncate border-b border-dotted border-foreground/30 bg-transparent text-left leading-tight text-foreground/55 transition-colors group-hover/tool-summary:text-foreground group-focus-within/tool-summary:text-foreground"
              onClick={openWorkspaceDiff}
            >
              {query}
            </button>,
          )
        : withTooltip(
            <span
              title={query}
              className="min-w-0 truncate border-b border-dotted border-foreground/30 leading-tight"
            >
              {query}
            </span>,
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
  const requestLabel = t("extensions.messagePresentation.toolTimeline.request");
  const resultLabel = t("extensions.messagePresentation.toolTimeline.result");
  const request = state.request;
  const result = serializeToolValue(state.result);
  const fallbackDetail = (
    <ToolCallDetails
      request={request}
      result={result}
      requestLabel={requestLabel}
      resultLabel={resultLabel}
    />
  );

  return (
    <ToolCall
      label={displayLabel}
      activeLabel={displayActiveLabel}
      query={query}
      summary={fileMutationSummary}
      request={request}
      result={result}
      requestLabel={requestLabel}
      resultLabel={resultLabel}
      icon={Icon}
      running={state.running}
      requiresAction={state.requiresAction}
      failed={state.failed}
      cancelled={state.cancelled}
      failedLabel={terminalLabel}
      showCompletionIcon={!isFileMutation}
      expandable={
        !isFileMutation ||
        Boolean(fileDiff) ||
        state.failed ||
        state.cancelled ||
        state.requiresAction
      }
      open={open}
      onOpenChange={setOpen}
      disclosureController={
        DisclosureController
          ? ({ open: disclosureOpen, onOpenChange }) => (
              <DisclosureController
                block={block}
                running={state.running}
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
      {fileDiff && fileDiff.hunks.length > 0 ? (
        <ReviewableDiff
          filename={fileDiff.filename}
          hunks={fileDiff.hunks}
          className="max-w-none"
        />
      ) : (
        <RendererHost node={node} block={block} fallback={fallbackDetail} />
      )}
    </ToolCall>
  );
}

function ParallelToolGroup({
  batchId,
  category,
  blocks,
  kinds,
  node,
  queries,
  presentations,
}: {
  batchId: string;
  category?: "exploration" | "terminal" | "changes";
  blocks: readonly ToolCallBlock[];
  kinds: readonly ToolTimelineStepKind[];
  node: MessageRendererNode;
  queries: readonly string[];
  presentations: readonly (ToolPresentationDefinition | undefined)[];
}) {
  const { t } = useI18n();
  const running = blocks.some((block) => block.status === "running");
  const [open, setOpen] = useMessageDisclosure("parallel-tools", batchId);

  return (
    <MessageDisclosureScope kind="parallel-tools" id={batchId}>
      <ToolGroupRoot
        variant="ghost"
        open={open}
        onOpenChange={setOpen}
        className="max-w-none [overflow-anchor:none]"
      >
        <ToolGroupTrigger
          count={blocks.length}
          label={
            category
              ? t(`extensions.settings.conversation.${category}Group`, { count: blocks.length })
              : undefined
          }
          active={running}
          icon={WrenchIcon}
          className="text-foreground/55 hover:text-foreground/90 gap-1.5 py-1 text-[13.5px] transition-colors outline-none"
        />
        <ToolGroupContent className="[&>div]:ms-1 [&>div]:border-s [&>div]:border-foreground/10 [&>div]:ps-3">
          {blocks.map((block, index) => {
            const kind = kinds[index];
            const query = queries[index];
            if (!kind || query === undefined) return null;
            return (
              <TimelineToolCall
                key={block.callId}
                block={block}
                kind={kind}
                node={node}
                query={query}
                presentation={presentations[index]}
              />
            );
          })}
        </ToolGroupContent>
      </ToolGroupRoot>
    </MessageDisclosureScope>
  );
}

export function MessageToolTimeline({
  blocks,
  children,
  groupParallelTools = true,
  indices,
  node,
  transportRecovering,
}: PropsWithChildren<{
  blocks?: readonly MessageBlock[];
  groupParallelTools?: boolean;
  indices: readonly number[];
  node: MessageRendererNode;
  transportRecovering: boolean;
}>) {
  const { t, text } = useI18n();
  const groups = useConversationPreferences((state) => state.preferences);
  const toolPresentations = useToolPresentationMap();
  const dataPresentations = useDataPresentationMap();
  const [open, setOpen] = useMessageDisclosure("steps", indices[0] ?? "empty");
  const timeline = useMemo(() => {
    const timelineBlocks: TimelineBlock[] = [];
    const blockIndices: number[] = [];

    for (const blockIndex of indices) {
      const block = blocks?.[blockIndex];
      if (!isTimelineBlock(block, dataPresentations)) continue;
      timelineBlocks.push(block);
      blockIndices.push(blockIndex);
    }

    return { blocks: timelineBlocks, blockIndices };
  }, [blocks, dataPresentations, indices]);
  const timelineBlocks = timeline.blocks;
  const stepModels = useMemo(
    () => timelineSteps(timelineBlocks, toolPresentations),
    [timelineBlocks, toolPresentations],
  );
  const entries = useMemo(
    () => timelineEntries(timelineBlocks, groupParallelTools, groups),
    [timelineBlocks, groupParallelTools, groups],
  );
  const stats = useMemo(
    () =>
      timelineStats(
        timelineBlocks.filter((block) => block.kind !== "tool-call" || block.status === "complete"),
      ),
    [timelineBlocks],
  );
  const timelineRunning = timelineBlocks.some((block) =>
    block.kind === "data"
      ? dataTimelineState(block, dataPresentations)?.active === true
      : block.status === "running",
  );
  const steps: ReasoningStep[] = entries.map((entry) => {
    if (entry.kind === "parallel-tools") {
      const models = entry.sourceIndices.map((index) => stepModels[index]);
      const parallelBlocks = entry.sourceIndices.flatMap((index) => {
        const block = timelineBlocks[index];
        return block?.kind === "tool-call" ? [block] : [];
      });
      return {
        marker: false,
        body: (
          <ParallelToolGroup
            batchId={entry.batchId}
            category={entry.category}
            blocks={parallelBlocks}
            kinds={models.flatMap((model) => (model && model.kind !== "data" ? [model.kind] : []))}
            node={node}
            queries={models.flatMap((model) =>
              model && model.kind !== "data" ? [text(model.chip)] : [],
            )}
            presentations={models.map((model) =>
              model?.kind === "data" ? undefined : model?.presentation,
            )}
          />
        ),
      };
    }

    const { sourceIndex } = entry;
    const block = timelineBlocks[sourceIndex];
    if (!block) return { body: null };
    const model = stepModels[sourceIndex];
    if (!model) return { body: null };

    if (block.kind === "data") {
      return {
        marker: false,
        body: <RendererHost node={node} block={block} fallback={null} />,
      };
    }

    if (model.kind === "data") return { body: null };

    if (block.kind === "reasoning") {
      return {
        marker: false,
        body: (
          <TimelineReasoning
            block={block}
            running={block.status === "running"}
            transportRecovering={transportRecovering}
            preview={text(model.chip)}
            disclosureId={timeline.blockIndices[sourceIndex] ?? sourceIndex}
          />
        ),
      };
    }

    return {
      marker: false,
      body: (
        <TimelineToolCall
          block={block}
          kind={model.kind}
          node={node}
          query={text(model.chip)}
          presentation={model.presentation}
        />
      ),
    };
  });

  const summaryArgs = { steps: entries.length, files: stats.length };
  if (timelineBlocks.length === 0) return children;

  return (
    <MessageDisclosureScope kind="steps" id={indices[0] ?? "empty"}>
      <ReasoningPanel
        steps={steps}
        visibleSteps={entries.length}
        streaming={timelineRunning}
        open={open}
        onOpenChange={setOpen}
        restingLabel={t("extensions.messagePresentation.toolTimeline.summary", summaryArgs)}
        activeLabel={t("extensions.messagePresentation.toolTimeline.active", summaryArgs)}
        icon={ListChecksIcon}
        className="my-1 max-w-none [overflow-anchor:none]"
      />
    </MessageDisclosureScope>
  );
}
