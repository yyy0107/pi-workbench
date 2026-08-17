"use client";

import type { DataMessagePartComponent } from "@assistant-ui/react";
import { groupPartByType, MessagePrimitive } from "@assistant-ui/react";
import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState, type PropsWithChildren } from "react";

import { File } from "@/components/assistant-ui/file";
import { Image } from "@/components/assistant-ui/image";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { ReasoningPanel } from "@/components/elements/reasoning-panel";
import { StreamingText } from "@/components/elements/streaming-text";
import { useI18n } from "@/i18n";
import { RendererHost } from "@/platform/extensions";

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

function MessageReasoningGroup({ children, streaming }: PropsWithChildren<{ streaming: boolean }>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(streaming);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAt = useRef<number | null>(streaming ? Date.now() : null);
  const wasStreaming = useRef(streaming);

  useEffect(() => {
    if (streaming && !wasStreaming.current) {
      startedAt.current = Date.now();
      setElapsedSeconds(0);
      setOpen(true);
    } else if (!streaming && wasStreaming.current) {
      if (startedAt.current !== null) {
        setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt.current) / 1_000)));
      }
      setOpen(false);
    }
    wasStreaming.current = streaming;

    if (!streaming) return;
    startedAt.current ??= Date.now();

    const updateElapsed = () => {
      if (startedAt.current === null) return;
      setElapsedSeconds(Math.floor((Date.now() - startedAt.current) / 1_000));
    };
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  const elapsed = t("extensions.messagePresentation.reasoning.elapsed", {
    seconds: elapsedSeconds,
  });
  const restingLabel =
    elapsedSeconds > 0
      ? t("extensions.messagePresentation.reasoning.completeWithDuration", {
          seconds: elapsedSeconds,
        })
      : t("extensions.messagePresentation.reasoning.complete");

  return (
    <ReasoningPanel
      steps={[
        {
          title: t("extensions.messagePresentation.reasoning.step"),
          body: children,
        },
      ]}
      visibleSteps={1}
      streaming={streaming}
      open={open}
      onOpenChange={setOpen}
      activeLabel={t("extensions.messagePresentation.reasoning.active")}
      restingLabel={restingLabel}
      elapsed={streaming ? elapsed : undefined}
      className="mb-4 max-w-none"
    />
  );
}

export function WorkbenchMessagePresentation() {
  const { t } = useI18n();

  return (
    <MessagePrimitive.GroupedParts
      groupBy={groupPartByType({
        reasoning: ["group-reasoning"],
        "tool-call": ["group-tool"],
      })}
    >
      {({ part, children }) => {
        switch (part.type) {
          case "group-reasoning": {
            const streaming = part.status.type === "running";
            return <MessageReasoningGroup streaming={streaming}>{children}</MessageReasoningGroup>;
          }
          case "group-tool": {
            const streaming = part.status.type === "running";
            return (
              <ToolGroupRoot defaultOpen={streaming} variant="ghost">
                <ToolGroupTrigger count={part.indices.length} active={streaming} />
                <ToolGroupContent>{children}</ToolGroupContent>
              </ToolGroupRoot>
            );
          }
          case "text":
            if (part.status.type === "running" && part.text === "") {
              return (
                <span className="my-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {t("extensions.messagePresentation.generating")}
                </span>
              );
            }
            if (part.status.type === "running") {
              return (
                <StreamingText
                  segments={[{ text: part.text }]}
                  count={part.text.split(" ").length}
                  streaming
                  className="min-h-0 max-w-none whitespace-pre-wrap"
                />
              );
            }
            return <MarkdownText />;
          case "reasoning":
            return <MarkdownText />;
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
