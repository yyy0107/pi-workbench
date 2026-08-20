"use client";

import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import type { ReasoningMessagePart, ToolCallMessagePart } from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/react";
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
import { ToolCall } from "@/components/elements/tool-call";
import { useI18n } from "@/i18n";
import { formatCompactDuration } from "@/lib/format-duration";

import { BashTerminal } from "../terminal/bash-tool-renderer";
import { useMessageDisclosure } from "./message-disclosure-context";
import {
  liveReasoningPreview,
  reasoningPartTiming,
  timelineEntries,
  timelineStats,
  timelineSteps,
  type ToolTimelineStepKind,
} from "./tool-timeline-model";

type TimelineSourcePart = ReasoningMessagePart | ToolCallMessagePart;

const STEP_ICONS: Readonly<Record<ToolTimelineStepKind, LucideIcon>> = {
  thinking: SparklesIcon,
  read: FileSearchIcon,
  ran: SquareTerminalIcon,
  edited: PencilIcon,
  searched: SearchIcon,
  used: WrenchIcon,
};

function isTimelineSourcePart(value: unknown): value is TimelineSourcePart {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "reasoning" || type === "tool-call";
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
  part: ReasoningMessagePart;
  running: boolean;
  preview: string;
  disclosureId: string | number;
}) {
  const { t } = useI18n();
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
      activeIcon={<ThinkingOrb state="composing" size={20} speed={3.0} />}
      collapsedPreview={collapsedPreview}
      elapsed={
        elapsedSeconds === undefined
          ? undefined
          : t("extensions.messagePresentation.elapsed", {
              duration: formatCompactDuration(elapsedSeconds * 1_000, { zeroValue: "0s" }),
            })
      }
      className="max-w-none"
    />
  );
}

function TimelineToolCall({
  part,
  kind,
  query,
  running,
}: {
  part: ToolCallMessagePart;
  kind: ToolTimelineStepKind;
  query: string;
  running: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useMessageDisclosure("tool", part.toolCallId);
  const displayedResult = part.result ?? part.artifact;
  const elapsedSeconds = useElapsedSeconds(running, part.timing);

  return (
    <ToolCall
      label={t(`extensions.messagePresentation.toolTimeline.steps.${kind}`)}
      activeLabel={t(`extensions.messagePresentation.toolTimeline.activeSteps.${kind}`)}
      query={query}
      request={serializeToolValue(part.args)}
      result={serializeToolValue(displayedResult)}
      requestLabel={t("extensions.messagePresentation.toolTimeline.request")}
      resultLabel={t("extensions.messagePresentation.toolTimeline.result")}
      icon={STEP_ICONS[kind]}
      running={running}
      open={open}
      onOpenChange={setOpen}
      elapsed={
        elapsedSeconds === undefined
          ? undefined
          : t("extensions.messagePresentation.elapsed", {
              duration: formatCompactDuration(elapsedSeconds * 1_000, { zeroValue: "0s" }),
            })
      }
    >
      {part.toolName === "bash" && !part.isError ? (
        <BashTerminal
          command={
            typeof part.args === "object" &&
            part.args !== null &&
            "command" in part.args &&
            typeof part.args.command === "string"
              ? part.args.command
              : undefined
          }
          result={displayedResult}
          running={running}
        />
      ) : null}
    </ToolCall>
  );
}

function ParallelToolGroup({
  batchId,
  parts,
  kinds,
  queries,
  turnStreaming,
}: {
  batchId: string;
  parts: readonly ToolCallMessagePart[];
  kinds: readonly ToolTimelineStepKind[];
  queries: readonly string[];
  turnStreaming: boolean;
}) {
  const running = turnStreaming && parts.some((part) => part.result === undefined);
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
          if (!kind || query === undefined) return null;
          const toolRunning = turnStreaming && part.result === undefined;

          return (
            <TimelineToolCall
              key={part.toolCallId}
              part={part}
              kind={kind}
              query={query}
              running={toolRunning}
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
  const { t } = useI18n();
  const content = useAuiState((state) => state.message.content);
  const [open, setOpen] = useMessageDisclosure("steps", indices[0] ?? "empty");
  const activeStepIndex = indices.indexOf(activePartIndex);
  const parts = useMemo(
    () => indices.map((index) => content[index]).filter(isTimelineSourcePart),
    [content, indices],
  );
  const stepModels = useMemo(() => timelineSteps(parts), [parts]);
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
            kinds={models.flatMap((model) => (model ? [model.kind] : []))}
            queries={models.flatMap((model) => (model ? [model.chip] : []))}
            turnStreaming={turnStreaming}
          />
        ),
      };
    }

    const { part, sourceIndex } = entry;
    const model = stepModels[sourceIndex];
    if (!model) return { body: null };

    if (part.type === "reasoning") {
      return {
        marker: false,
        body: (
          <TimelineReasoning
            part={part}
            running={sourceIndex === activeStepIndex}
            preview={model.chip}
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
          kind={model.kind}
          query={model.chip}
          running={turnStreaming && part.result === undefined}
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
