"use client";

import type {
  DataMessagePartComponent,
  EnrichedPartState,
  ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { ExternalLinkIcon } from "lucide-react";

import {
  MessagePartRendererHost,
  RendererHost,
} from "@workbench/extension-host/hosts/renderer-host";

import { ScrollCompensatedDetails } from "../elements/scroll-compensated-details";

type SharedMessagePartLeaf = Extract<
  EnrichedPartState,
  { type: "source" | "tool-call" | "data" | "audio" | "generative-ui" }
>;

export type MessageSourceVariant = "plain" | "chip";

/** Serialize unknown message payloads without letting cyclic or non-JSON values break rendering. */
export function serializeMessagePartValue(value: unknown): string {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Accept only browser-safe external source protocols used by message citations. */
export function safeExternalMessageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

export const DefaultMessageToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
  isError,
}) => (
  <ScrollCompensatedDetails className="bg-muted/40 my-2 rounded-lg border px-3 py-2 text-sm">
    <summary className="cursor-pointer font-mono text-xs">{toolName}</summary>
    <pre
      className="text-muted-foreground mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs"
      role={isError ? "alert" : undefined}
    >
      {serializeMessagePartValue(result === undefined ? args : result)}
    </pre>
  </ScrollCompensatedDetails>
);

export const DefaultMessageDataFallback: DataMessagePartComponent = ({ name, data }) => (
  <ScrollCompensatedDetails className="bg-muted/40 my-2 rounded-lg border px-3 py-2 text-sm">
    <summary className="cursor-pointer font-medium">{name}</summary>
    <pre className="text-muted-foreground mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
      {serializeMessagePartValue(data)}
    </pre>
  </ScrollCompensatedDetails>
);

function MessageSourceLeaf({
  fallbackLabel,
  part,
  variant,
}: Readonly<{
  fallbackLabel: string;
  part: Extract<SharedMessagePartLeaf, { type: "source" }>;
  variant: MessageSourceVariant;
}>) {
  const label = part.title || part.url || fallbackLabel;
  const url = part.sourceType === "url" ? safeExternalMessageUrl(part.url) : undefined;
  const plain = variant === "plain";

  if (!url) {
    return (
      <span
        className={
          plain
            ? "text-xs"
            : "bg-muted text-muted-foreground my-1 inline-flex rounded-md px-2 py-1 text-xs"
        }
      >
        {label}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        plain
          ? "inline-flex max-w-full items-center gap-1 text-xs underline"
          : "bg-muted/60 hover:bg-muted my-1 inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs underline-offset-2 hover:underline"
      }
    >
      <span className="truncate">{label}</span>
      <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0" />
    </a>
  );
}

function messageAudioSource(part: Extract<SharedMessagePartLeaf, { type: "audio" }>): string {
  return part.audio.data.startsWith("data:")
    ? part.audio.data
    : `data:audio/${part.audio.format};base64,${part.audio.data}`;
}

/**
 * Stateless rendering for message leaves shared by the basic fallback and the richer built-in
 * presentation. Runtime grouping, message role, citations, and attachment layout stay in callers.
 */
export function MessagePartLeaf({
  dataFallback: DataFallback = DefaultMessageDataFallback,
  part,
  sourceFallbackLabel,
  sourceVariant = "plain",
  toolFallback = DefaultMessageToolFallback,
}: Readonly<{
  dataFallback?: DataMessagePartComponent;
  part: SharedMessagePartLeaf;
  sourceFallbackLabel: string;
  sourceVariant?: MessageSourceVariant;
  toolFallback?: ToolCallMessagePartComponent;
}>) {
  switch (part.type) {
    case "source":
      return (
        <MessageSourceLeaf
          part={part}
          fallbackLabel={sourceFallbackLabel}
          variant={sourceVariant}
        />
      );
    case "tool-call":
    case "data":
      return <RendererHost part={part} toolFallback={toolFallback} dataFallback={DataFallback} />;
    case "audio":
      return <audio controls src={messageAudioSource(part)} className="my-2 max-w-full" />;
    case "generative-ui": {
      const fallback = (
        <DataFallback type="data" name="generative-ui" data={part.spec} status={part.status} />
      );
      return <MessagePartRendererHost part={part} fallback={fallback} />;
    }
  }
}

export function isSharedMessagePartLeaf(
  part: EnrichedPartState | Readonly<{ type: string }>,
): part is SharedMessagePartLeaf {
  return (
    part.type === "source" ||
    part.type === "tool-call" ||
    part.type === "data" ||
    part.type === "audio" ||
    part.type === "generative-ui"
  );
}
