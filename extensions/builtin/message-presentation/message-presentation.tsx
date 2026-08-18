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
import { useI18n } from "@/i18n";
import { RendererHost } from "@/platform/extensions";

import { formatCompletedDuration, completedWorkBoundary } from "./completed-turn-model";
import { CompletedTurnPanel } from "./completed-turn-panel";
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
  <details className="bg-muted/40 my-2 rounded-lg border px-3 py-2 text-sm">
    <summary className="cursor-pointer font-medium">{name}</summary>
    <pre className="text-muted-foreground mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
      {serializeData(data)}
    </pre>
  </details>
);

export function WorkbenchMessagePresentation() {
  const { t } = useI18n();
  const timing = useMessageTiming();
  const turnStreaming = useAuiState((state) => state.thread.isRunning && state.message.isLast);
  const messageParts = useAuiState((state) => state.message.parts);
  const completedBoundary = useMemo(() => completedWorkBoundary(messageParts), [messageParts]);
  const partIndices = useMemo(
    () => new Map(messageParts.map((part, index) => [part, index])),
    [messageParts],
  );
  const completedLabel = t("extensions.messagePresentation.completedTurn", {
    duration: formatCompletedDuration(timing?.totalStreamTime),
  });
  const groupMessagePart = useCallback(
    (part: PartState, context: GroupByContext): readonly PresentationGroup[] => {
      const timelinePath = groupTimelinePart(part, context);
      const index = partIndices.get(part);

      if (index !== undefined && index < completedBoundary) {
        return ["group-completed-turn", ...timelinePath];
      }

      return timelinePath;
    },
    [completedBoundary, partIndices],
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

  return (
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
  );
}
