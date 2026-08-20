"use client";

import type { DataMessagePartComponent, ToolCallMessagePartComponent } from "@assistant-ui/react";
import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { ExternalLinkIcon, Loader2Icon } from "lucide-react";

import { File } from "@/components/assistant-ui/file";
import { Image } from "@/components/assistant-ui/image";
import { useI18n } from "@/i18n";
import { MessageRendererHost, RendererHost } from "@/platform/extensions";

import { WorkbenchComposerMessageText } from "./composer-message-text";

function serialize(value: unknown) {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const DefaultToolFallback: ToolCallMessagePartComponent = ({ toolName, args, result, isError }) => (
  <details className="my-2 rounded border px-3 py-2 text-sm">
    <summary className="cursor-pointer font-mono text-xs">{toolName}</summary>
    <pre
      className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs"
      role={isError ? "alert" : undefined}
    >
      {serialize(result === undefined ? args : result)}
    </pre>
  </details>
);

const DefaultDataFallback: DataMessagePartComponent = ({ name, data }) => (
  <details className="my-2 rounded border px-3 py-2 text-sm">
    <summary className="cursor-pointer font-mono text-xs">{name}</summary>
    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
      {serialize(data)}
    </pre>
  </details>
);

function DefaultWorkbenchMessageParts() {
  const { t } = useI18n();
  const role = useAuiState((state) => state.message.role);

  return (
    <MessagePrimitive.Parts>
      {({ part }) => {
        switch (part.type) {
          case "text": {
            if (part.status.type === "running" && part.text === "") {
              return (
                <span className="my-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {t("workbench.chat.generating")}
                </span>
              );
            }

            if (role === "user") return <WorkbenchComposerMessageText text={part.text} />;

            return <p className="whitespace-pre-wrap">{part.text}</p>;
          }
          case "reasoning":
            return (
              <pre className="text-muted-foreground my-2 whitespace-pre-wrap text-xs">
                {part.text}
              </pre>
            );
          case "image":
            return <Image {...part} />;
          case "file":
            return <File {...part} />;
          case "source": {
            const label = part.title || part.url || t("workbench.chat.sourceFallback");
            const isSafeUrl = part.sourceType === "url" && /^https?:\/\//i.test(part.url);

            if (!isSafeUrl) return <span className="text-xs">{label}</span>;
            return (
              <a
                href={part.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 text-xs underline"
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
                toolFallback={DefaultToolFallback}
                dataFallback={DefaultDataFallback}
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
              <DefaultDataFallback
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
    </MessagePrimitive.Parts>
  );
}

export function WorkbenchMessageParts() {
  return <MessageRendererHost fallback={<DefaultWorkbenchMessageParts />} />;
}
