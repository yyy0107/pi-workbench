"use client";

import type { DataMessagePartComponent, GroupByContext, PartState } from "@assistant-ui/react";
import {
  groupPartByType,
  MessagePrimitive,
  useAuiState,
  useMessageTiming,
} from "@assistant-ui/react";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { File } from "@/components/assistant-ui/file";
import { Image } from "@/components/assistant-ui/image";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { ScrollCompensatedDetails } from "@/components/elements/scroll-compensated-details";
import { useI18n } from "@/i18n";
import { RendererHost } from "@/platform/extensions";
import { readPiTurnTiming, resolvePiTurnDuration } from "@/runtime/pi/client/messages/turn-timing";
import { parsePiMessageTermination } from "@/runtime/pi/message-termination";
import { WorkbenchComposerMessageText } from "@/workbench/chat/composer-message-text";

import {
  completedWorkBoundary,
  formatCompletedDuration,
  partBelongsToCompletedWork,
} from "./completed-turn-model";
import { CompletedTurnPanel } from "./completed-turn-panel";
import { MessageDisclosureProvider } from "./message-disclosure-context";
import { messageTextPresentation } from "./message-presentation-policy";
import { MessageToolTimeline } from "./message-tool-timeline";

type PresentationGroup = "group-completed-turn" | "group-tool-timeline";

const groupTimelinePart = groupPartByType<PresentationGroup>({
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

export function WorkbenchMessagePresentation() {
  const { t, date, locale } = useI18n();
  const timing = useMessageTiming();
  const messageCreatedAt = useAuiState((state) => state.message.createdAt);
  const messageRole = useAuiState((state) => state.message.role);
  const storedTurnTiming = useAuiState((state) => state.message.metadata.custom.piTurnTiming);
  const storedTermination = useAuiState((state) => state.message.metadata.custom.piTermination);
  const termination = parsePiMessageTermination(storedTermination);
  const turnTiming = readPiTurnTiming(storedTurnTiming);
  const turnStreaming = useAuiState((state) => state.thread.isRunning && state.message.isLast);
  const messageParts = useAuiState((state) => state.message.parts);
  const completedBoundary = useMemo(() => completedWorkBoundary(messageParts), [messageParts]);
  const partIndices = useMemo(
    () => new Map(messageParts.map((part, index) => [part, index])),
    [messageParts],
  );
  const completionTimestamp =
    turnTiming?.completedAt ??
    (timing?.totalStreamTime === undefined
      ? messageCreatedAt
      : timing.streamStartTime + timing.totalStreamTime);
  const turnDuration = resolvePiTurnDuration(storedTurnTiming, timing?.totalStreamTime);
  const completedLabel = t("extensions.messagePresentation.completedTurn", {
    completedAt: date(completionTimestamp, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    duration: formatCompletedDuration(turnDuration, locale),
    kind: termination?.kind ?? "completed",
  });
  const groupMessagePart = useCallback(
    (part: PartState, context: GroupByContext): readonly PresentationGroup[] => {
      const timelinePath = groupTimelinePart(part, context);
      const index = partIndices.get(part);

      if (partBelongsToCompletedWork(messageRole, part, index, completedBoundary)) {
        return ["group-completed-turn", ...timelinePath];
      }

      return timelinePath;
    },
    [completedBoundary, messageRole, partIndices],
  );
  const activeTimelinePartIndex = useAuiState((state) => {
    if (!state.thread.isRunning || !state.message.isLast) return -1;

    for (let index = state.message.content.length - 1; index >= 0; index -= 1) {
      const part = state.message.content[index];
      if (part?.type === "tool-call" && part.result === undefined) return index;
      if (index === state.message.content.length - 1 && part?.type === "reasoning") return index;
    }
    return -1;
  });

  const disclosurePhase = turnStreaming ? "streaming" : "completed";

  return (
    <MessageDisclosureProvider key={disclosurePhase} phase={disclosurePhase}>
      <MessagePrimitive.GroupedParts groupBy={groupMessagePart}>
        {({ part, children }) => {
          switch (part.type) {
            case "group-completed-turn": {
              return (
                <CompletedTurnPanel completed={!turnStreaming} label={completedLabel}>
                  {children}
                </CompletedTurnPanel>
              );
            }
            case "group-tool-timeline": {
              return (
                <MessageToolTimeline
                  indices={part.indices}
                  activePartIndex={activeTimelinePartIndex}
                  turnStreaming={turnStreaming}
                >
                  {children}
                </MessageToolTimeline>
              );
            }
            case "text":
              if (part.status.type === "running" && part.text === "") return null;
              if (messageTextPresentation(messageRole) === "composer") {
                return <WorkbenchComposerMessageText text={part.text} />;
              }
              return <MarkdownText />;
            case "reasoning":
              return null;
            case "image":
              return <Image {...part} />;
            case "file":
              return <File {...part} />;
            case "source": {
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
            case "generative-ui":
              return (
                <MessageDataFallback
                  type="data"
                  name="generative-ui"
                  data={part.spec}
                  status={part.status}
                />
              );
            default:
              return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
    </MessageDisclosureProvider>
  );
}
