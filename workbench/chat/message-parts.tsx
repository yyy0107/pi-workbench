"use client";

import type { DataMessagePartComponent } from "@assistant-ui/react";
import { MessagePrimitive } from "@assistant-ui/react";
import { ExternalLinkIcon, Loader2Icon } from "lucide-react";

import { File } from "@/components/assistant-ui/file";
import { Image } from "@/components/assistant-ui/image";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Reasoning } from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { RendererHost } from "@/platform/extensions";

function serializeData(value: unknown) {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const WorkbenchDataFallback: DataMessagePartComponent = ({ name, data }) => (
  <details className="bg-muted/40 my-2 rounded-lg border px-3 py-2 text-sm">
    <summary className="cursor-pointer font-medium">{name}</summary>
    <pre className="text-muted-foreground mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
      {serializeData(data)}
    </pre>
  </details>
);

export function WorkbenchMessageParts() {
  return (
    <MessagePrimitive.Parts>
      {({ part }) => {
        switch (part.type) {
          case "text":
            if (part.status.type === "running" && part.text === "") {
              return (
                <span className="my-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Thinking…
                </span>
              );
            }
            return <MarkdownText />;
          case "reasoning":
            return <Reasoning {...part} />;
          case "image":
            return <Image {...part} />;
          case "file":
            return <File {...part} />;
          case "source": {
            const label = part.title || part.url || "Source";
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
                dataFallback={WorkbenchDataFallback}
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
              <WorkbenchDataFallback
                type="data"
                name="Generative UI"
                data={part.spec}
                status={part.status}
              />
            );
          default:
            return null;
        }
      }}
    </MessagePrimitive.Parts>
  );
}
