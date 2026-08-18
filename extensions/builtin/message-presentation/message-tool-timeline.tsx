"use client";

import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import type { ReasoningMessagePart, ToolCallMessagePart } from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/react";
import {
  FileSearchIcon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
  SquareTerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";

import { ReasoningPanel, type ReasoningStep } from "@/components/elements/reasoning-panel";
import { ToolCall } from "@/components/elements/tool-call";
import { useI18n } from "@/i18n";

import { BashTerminal } from "../terminal/bash-tool-renderer";
import { timelineStats, timelineSteps, type ToolTimelineStepKind } from "./tool-timeline-model";

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

function useOpenDuringStreaming(streaming: boolean) {
  const [open, setOpen] = useState(streaming);
  const wasStreaming = useRef(streaming);

  useEffect(() => {
    if (streaming && !wasStreaming.current) setOpen(true);
    if (!streaming && wasStreaming.current) setOpen(false);
    wasStreaming.current = streaming;
  }, [streaming]);

  return [open, setOpen] as const;
}

function TimelineReasoning({
  part,
  running,
  preview,
}: {
  part: ReasoningMessagePart;
  running: boolean;
  preview: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

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
      collapsedPreview={preview}
      className="max-w-none"
    />
  );
}

function TimelineToolCall({
  part,
  kind,
  query,
  running,
  sessionStreaming,
}: {
  part: ToolCallMessagePart;
  kind: ToolTimelineStepKind;
  query: string;
  running: boolean;
  sessionStreaming: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useOpenDuringStreaming(sessionStreaming);
  const displayedResult = part.result ?? part.artifact;

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
  const [open, setOpen] = useOpenDuringStreaming(turnStreaming);
  const activeStepIndex = indices.indexOf(activePartIndex);
  const parts = useMemo(
    () => indices.map((index) => content[index]).filter(isTimelineSourcePart),
    [content, indices],
  );
  const stepModels = useMemo(() => timelineSteps(parts), [parts]);
  const stats = useMemo(() => timelineStats(parts), [parts]);
  const steps: ReasoningStep[] = parts.map((part, index) => {
    const model = stepModels[index];
    if (!model) return { body: null };

    if (part.type === "reasoning") {
      return {
        marker: false,
        body: (
          <TimelineReasoning part={part} running={index === activeStepIndex} preview={model.chip} />
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
          sessionStreaming={turnStreaming}
        />
      ),
    };
  });

  const summaryArgs = { steps: parts.length, files: stats.length };

  return (
    <ReasoningPanel
      steps={steps}
      visibleSteps={parts.length}
      streaming={activeStepIndex >= 0}
      open={open}
      onOpenChange={setOpen}
      restingLabel={t("extensions.messagePresentation.toolTimeline.summary", summaryArgs)}
      activeLabel={t("extensions.messagePresentation.toolTimeline.active", summaryArgs)}
      className="mb-1 max-w-none [overflow-anchor:none]"
    />
  );
}
