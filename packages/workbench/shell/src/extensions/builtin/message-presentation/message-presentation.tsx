"use client";

import type { DataMessagePartComponent, GroupByContext, PartState } from "@assistant-ui/react";
import {
  groupPartByType,
  MessagePrimitive,
  useAuiState,
  useMessageTiming,
  useSmooth,
} from "@assistant-ui/react";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { File } from "../../../assistant-ui/file";
import { Image } from "../../../assistant-ui/image";
import { MarkdownText, MarkdownTextWithCitations } from "../../../assistant-ui/lazy-markdown-text";
import { ToolFallback } from "../../../assistant-ui/tool-fallback";
import { ScrollCompensatedDetails } from "../../../elements/scroll-compensated-details";
import { ReasoningPanel } from "../../../elements/reasoning-panel";
import { StreamingText } from "../../../elements/streaming-text";
import { useI18n } from "../../../i18n";
import {
  MessagePartRendererHost,
  RendererHost,
  useDataPresentationMap,
} from "@workbench/extension-host/hosts/renderer-host";
import {
  parseWorkbenchMessageTermination,
  readWorkbenchTurnTiming,
  resolveWorkbenchTurnDuration,
} from "@workbench/agent-runtime-contracts/message-metadata";
import { WorkbenchComposerMessageText } from "../../../chat/composer-message-text";

import {
  completedWorkBoundary,
  formatCompletedAt,
  formatCompletedDuration,
  partBelongsToCompletedWork,
} from "./completed-turn-model";
import { CompletedTurnPanel } from "./completed-turn-panel";
import { messageCitationLayout } from "./message-citations";
import { MessageDisclosureProvider, useMessageDisclosure } from "./message-disclosure-context";
import { messageAttachmentReference, messageTextPresentation } from "./message-presentation-policy";
import { MessageToolTimeline } from "./message-tool-timeline";
import { dataTimelineState, type DataTimelineState } from "./tool-timeline-model";

const DATA_TIMELINE_GROUP_PREFIX = "group-data-timeline:";
const STREAMING_TEXT_SETTLE_MS = 700;

function StreamingAssistantText({
  children,
  part,
}: PropsWithChildren<Readonly<{ part: Extract<PartState, { type: "text" }> }>>) {
  const smoothedPart = useSmooth(part, { drainMs: 250, maxCharsPerFrame: 3 });
  const segments = useMemo(() => [{ text: smoothedPart.text }], [smoothedPart.text]);
  const running = smoothedPart.status.type === "running";
  const [settled, setSettled] = useState(!running);

  useEffect(() => {
    if (running) {
      setSettled(false);
      return;
    }
    if (settled) return;

    const timer = window.setTimeout(
      () => setSettled(true),
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : STREAMING_TEXT_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [running, settled]);

  if (settled && !running) return children;

  return (
    <StreamingText
      className="min-h-0 max-w-none whitespace-pre-wrap"
      segments={segments}
      count={Number.POSITIVE_INFINITY}
      streaming={running}
      granularity="multilingual-word"
    />
  );
}

type PresentationGroup =
  | "group-completed-turn"
  | "group-tool-timeline"
  | `group-data-timeline:${string}`;

const groupTimelinePartByType = groupPartByType<PresentationGroup>({
  reasoning: ["group-tool-timeline"],
  "tool-call": ["group-tool-timeline"],
  "standalone-tool-call": [],
});

function serializeData(value: unknown) {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const MessageDataFallback: DataMessagePartComponent = ({ name, data }) => (
  <ScrollCompensatedDetails className="bg-muted/40 my-2 rounded-lg border px-3 py-2 text-sm">
    <summary className="cursor-pointer font-medium">{name}</summary>
    <pre className="text-muted-foreground mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
      {serializeData(data)}
    </pre>
  </ScrollCompensatedDetails>
);

function MessageDataTimelineGroup({
  children,
  group,
  indices,
  running,
}: PropsWithChildren<{
  group: NonNullable<DataTimelineState["group"]>;
  indices: readonly number[];
  running: boolean;
}>) {
  const { text } = useI18n();
  const [open, setOpen] = useMessageDisclosure("steps", `data-group:${indices[0] ?? "empty"}`);

  return (
    <ReasoningPanel
      steps={[{ marker: false, body: <div className="space-y-1">{children}</div> }]}
      visibleSteps={1}
      streaming={running}
      open={open}
      onOpenChange={setOpen}
      activeLabel={text(group.activeLabel)}
      restingLabel={text(group.label)}
      icon={group.icon}
      className="my-1 max-w-none [overflow-anchor:none]"
    />
  );
}

export function WorkbenchMessagePresentation() {
  const { t, date, locale, relativeTime } = useI18n();
  const timing = useMessageTiming();
  const messageCreatedAt = useAuiState((state) => state.message.createdAt);
  const messageRole = useAuiState((state) => state.message.role);
  const storedTurnTiming = useAuiState(
    (state) => state.message.metadata.custom.workbenchTurnTiming,
  );
  const storedTermination = useAuiState(
    (state) => state.message.metadata.custom.workbenchTermination,
  );
  const termination = parseWorkbenchMessageTermination(storedTermination);
  const turnTiming = readWorkbenchTurnTiming(storedTurnTiming);
  const turnStreaming = useAuiState((state) => state.thread.isRunning && state.message.isLast);
  const interruptedBySteering = useAuiState(
    (state) => state.message.metadata.custom.workbenchSteerInterrupted === true,
  );
  const messageParts = useAuiState((state) => state.message.parts);
  const dataPresentations = useDataPresentationMap();
  const completedBoundary = useMemo(() => completedWorkBoundary(messageParts), [messageParts]);
  const partIndices = useMemo(
    () => new Map(messageParts.map((part, index) => [part, index])),
    [messageParts],
  );
  const citationLayout = useMemo(() => messageCitationLayout(messageParts), [messageParts]);
  const completionTimestamp =
    turnTiming?.completedAt ??
    (timing?.totalStreamTime === undefined
      ? messageCreatedAt
      : timing.streamStartTime + timing.totalStreamTime);
  const turnDuration = resolveWorkbenchTurnDuration(storedTurnTiming, timing?.totalStreamTime);
  const completedLabel = t("extensions.messagePresentation.completedTurn", {
    completedAt: formatCompletedAt(completionTimestamp, Date.now(), { date, relativeTime }),
    duration: formatCompletedDuration(turnDuration, locale),
    kind: termination?.kind ?? "completed",
  });
  const groupTimelinePart = useCallback(
    (part: PartState, context: GroupByContext): readonly PresentationGroup[] => {
      const typePath = groupTimelinePartByType(part, context);
      if (typePath.length > 0) return typePath;
      if (part.type !== "data") return [];
      const timelineState = dataTimelineState(part, dataPresentations);
      if (!timelineState) return [];
      return timelineState.group
        ? [`${DATA_TIMELINE_GROUP_PREFIX}${part.name}:${timelineState.group.key}`]
        : ["group-tool-timeline"];
    },
    [dataPresentations],
  );
  const groupMessagePart = useCallback(
    (part: PartState, context: GroupByContext): readonly PresentationGroup[] => {
      const timelinePath = groupTimelinePart(part, context);
      const index = partIndices.get(part);

      if (
        !interruptedBySteering &&
        partBelongsToCompletedWork(messageRole, index, completedBoundary)
      ) {
        return ["group-completed-turn", ...timelinePath];
      }

      return timelinePath;
    },
    [completedBoundary, groupTimelinePart, interruptedBySteering, messageRole, partIndices],
  );
  const disclosurePhase = interruptedBySteering
    ? "steered"
    : turnStreaming
      ? "streaming"
      : "completed";

  return (
    <MessageDisclosureProvider phase={disclosurePhase}>
      <MessagePrimitive.GroupedParts groupBy={groupMessagePart}>
        {({ part, children }) => {
          const index = partIndices.get(part as PartState);
          const attachmentReference =
            messageRole === "user" && index !== undefined
              ? messageAttachmentReference(messageParts, index)
              : undefined;
          const attachmentReferenceLabel = attachmentReference
            ? t(
                attachmentReference.kind === "image"
                  ? "extensions.messagePresentation.attachmentReference.image"
                  : "extensions.messagePresentation.attachmentReference.pdf",
                { index: attachmentReference.sequence },
              )
            : undefined;

          if ("indices" in part && part.type.startsWith(DATA_TIMELINE_GROUP_PREFIX)) {
            const sourcePart = messageParts[part.indices[0] ?? -1];
            const group =
              sourcePart?.type === "data"
                ? dataTimelineState(sourcePart, dataPresentations)?.group
                : undefined;
            return group ? (
              <MessageDataTimelineGroup
                group={group}
                indices={part.indices}
                running={part.status.type === "running"}
              >
                {children}
              </MessageDataTimelineGroup>
            ) : (
              children
            );
          }

          switch (part.type) {
            case "group-completed-turn": {
              return (
                <CompletedTurnPanel completed={!turnStreaming} label={completedLabel}>
                  {children}
                </CompletedTurnPanel>
              );
            }
            case "group-tool-timeline": {
              return <MessageToolTimeline indices={part.indices}>{children}</MessageToolTimeline>;
            }
            case "text": {
              if (messageTextPresentation(messageRole) === "composer") {
                return <WorkbenchComposerMessageText text={part.text} />;
              }
              const citationSources =
                index === undefined ? undefined : citationLayout.byTextPart.get(index);
              const settledText = citationSources ? (
                <MarkdownTextWithCitations sources={citationSources} />
              ) : (
                <MarkdownText />
              );
              const fallback =
                messageRole === "assistant" ? (
                  <StreamingAssistantText part={part}>{settledText}</StreamingAssistantText>
                ) : (
                  settledText
                );
              return messageRole === "assistant" ? (
                <MessagePartRendererHost part={part} fallback={fallback} />
              ) : (
                fallback
              );
            }
            case "reasoning":
              return null;
            case "image":
              return attachmentReferenceLabel ? (
                <div data-slot="user-attachment-reference" className="relative max-w-full">
                  <Image {...part} />
                  <span className="bg-background/85 text-foreground pointer-events-none absolute top-2 left-2 rounded-full border border-foreground/10 px-2 py-0.5 text-[11px] font-medium shadow-sm backdrop-blur-sm">
                    {attachmentReferenceLabel}
                  </span>
                </div>
              ) : (
                <Image {...part} />
              );
            case "file":
              return attachmentReferenceLabel ? (
                <div
                  data-slot="user-attachment-reference"
                  className="flex max-w-full items-center gap-2"
                >
                  <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-1 text-[11px] font-medium">
                    {attachmentReferenceLabel}
                  </span>
                  <File {...part} />
                </div>
              ) : (
                <File {...part} />
              );
            case "source": {
              if (index !== undefined && citationLayout.inlineSourcePartIndices.has(index)) {
                return null;
              }

              const label =
                part.title || part.url || t("extensions.messagePresentation.sourceFallback");
              const isSafeUrl = part.sourceType === "url" && /^https?:\/\//i.test(part.url);

              if (!isSafeUrl) {
                return (
                  <span className="bg-muted text-muted-foreground my-1 inline-flex rounded-md px-2 py-1 text-xs">
                    {label}
                  </span>
                );
              }

              return (
                <a
                  href={part.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-muted/60 hover:bg-muted my-1 inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs underline-offset-2 hover:underline"
                >
                  <span className="truncate">{label}</span>
                  <ExternalLinkIcon className="size-3 shrink-0" />
                </a>
              );
            }
            case "tool-call":
            case "data":
              return (
                <RendererHost
                  part={part}
                  toolFallback={ToolFallback}
                  dataFallback={MessageDataFallback}
                />
              );
            case "audio": {
              const source = part.audio.data.startsWith("data:")
                ? part.audio.data
                : `data:audio/${part.audio.format};base64,${part.audio.data}`;
              return <audio controls src={source} className="my-2 max-w-full" />;
            }
            case "generative-ui": {
              const fallback = (
                <MessageDataFallback
                  type="data"
                  name="generative-ui"
                  data={part.spec}
                  status={part.status}
                />
              );
              return <MessagePartRendererHost part={part} fallback={fallback} />;
            }
            default:
              return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
    </MessageDisclosureProvider>
  );
}
