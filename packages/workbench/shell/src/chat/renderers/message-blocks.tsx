"use client";

import { useState } from "react";

import type {
  ConversationError,
  DataBlock,
  FileBlock,
  ReasoningBlock,
  SourceBlock,
  TextBlock,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";
import { useConversationSession, useSessionState } from "@workbench/agent-runtime-client";

import { File, getBase64Size, getFileDataKind } from "./file";
import { Image } from "./image";
import { MarkdownTextContentWithCitations } from "../markdown/lazy-markdown-text";
import { MessageSource, type MessageSourceVariant } from "./message-source";
import { ErrorState } from "../../elements/error-state";
import type { Source } from "../../elements/inline-citation";
import { ScrollCompensatedDetails } from "../../elements/scroll-compensated-details";
import { useI18n } from "../../i18n";

import { WorkbenchComposerMessageTextContent } from "../composer-message-text";

const EMPTY_SOURCES: readonly Source[] = Object.freeze([]);

function resolvedMediaType(block: FileBlock): string {
  return block.mediaType ?? /^data:([^;,]+)/i.exec(block.source)?.[1] ?? "application/octet-stream";
}

function playableFileSource(block: FileBlock, mediaType: string): string | undefined {
  if (!block.source || block.sourceType === "id") return undefined;
  if (block.sourceType === "url" || /^(?:data:|https?:\/\/|blob:)/i.test(block.source)) {
    return block.source;
  }
  return `data:${mediaType};base64,${block.source}`;
}

export function WorkbenchMessageTextBlock({
  block,
  composerDocument,
  role,
  sources = EMPTY_SOURCES,
  streaming = false,
}: Readonly<{
  block: TextBlock;
  composerDocument?: unknown;
  role: "user" | "assistant" | "system";
  sources?: readonly Source[];
  streaming?: boolean;
}>) {
  if (role === "user") {
    return (
      <WorkbenchComposerMessageTextContent text={block.text} persistedDocument={composerDocument} />
    );
  }

  return (
    <MarkdownTextContentWithCitations text={block.text} sources={sources} isRunning={streaming} />
  );
}

export function WorkbenchMessageReasoningBlock({ block }: Readonly<{ block: ReasoningBlock }>) {
  return <pre className="text-muted-foreground my-2 whitespace-pre-wrap text-xs">{block.text}</pre>;
}

function serializeBlockValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function WorkbenchMessageToolBlock({ block }: Readonly<{ block: ToolCallBlock }>) {
  const value =
    block.error?.message ??
    block.result ??
    (block.argumentsText.length > 0 ? block.argumentsText : block.arguments);

  return (
    <ScrollCompensatedDetails className="bg-muted/40 my-2 rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-mono text-xs">{block.toolName}</summary>
      <pre
        className="text-muted-foreground mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs"
        role={block.status === "error" ? "alert" : undefined}
      >
        {serializeBlockValue(value)}
      </pre>
    </ScrollCompensatedDetails>
  );
}

export function WorkbenchMessageDataBlock({ block }: Readonly<{ block: DataBlock }>) {
  return (
    <ScrollCompensatedDetails className="bg-muted/40 my-2 rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">{block.name}</summary>
      <pre className="text-muted-foreground mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
        {serializeBlockValue(block.data)}
      </pre>
    </ScrollCompensatedDetails>
  );
}

export function WorkbenchMessageSourceBlock({
  block,
  fallbackLabel,
  variant = "plain",
}: Readonly<{
  block: SourceBlock;
  fallbackLabel: string;
  variant?: MessageSourceVariant;
}>) {
  return (
    <MessageSource
      label={block.title || block.filename || block.url || fallbackLabel}
      url={block.url}
      variant={variant}
    />
  );
}

export function WorkbenchMessageFileBlock({
  block,
  referenceLabel,
}: Readonly<{ block: FileBlock; referenceLabel?: string }>) {
  const mediaType = resolvedMediaType(block);
  const source = playableFileSource(block, mediaType);
  const image = mediaType.startsWith("image/");

  const content =
    image && source ? (
      <Image.Root>
        <Image.Zoom src={source} alt={block.name}>
          <Image.Preview src={source} alt={block.name} />
        </Image.Zoom>
      </Image.Root>
    ) : mediaType.startsWith("audio/") && source ? (
      <audio controls src={source} className="my-2 max-w-full" />
    ) : (
      <File.Root>
        <File.Icon mimeType={mediaType} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <File.Name>{block.name}</File.Name>
          {block.source &&
          block.sourceType !== "id" &&
          ["base64", "data-uri"].includes(getFileDataKind(block.source, block.sourceType)) ? (
            <File.Size bytes={getBase64Size(block.source)} className="text-xs" />
          ) : null}
        </div>
        {block.source && block.sourceType !== "id" ? (
          <File.Download
            data={block.source}
            mimeType={mediaType}
            filename={block.name}
            {...(block.sourceType === undefined ? {} : { sourceType: block.sourceType })}
          />
        ) : null}
      </File.Root>
    );

  if (!referenceLabel) return content;
  if (image) {
    return (
      <div data-slot="user-attachment-reference" className="relative max-w-full">
        {content}
        <span className="bg-background/85 text-foreground pointer-events-none absolute top-2 left-2 rounded-full border border-foreground/10 px-2 py-0.5 text-[11px] font-medium shadow-sm backdrop-blur-sm">
          {referenceLabel}
        </span>
      </div>
    );
  }
  return (
    <div data-slot="user-attachment-reference" className="flex max-w-full items-center gap-2">
      <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-1 text-[11px] font-medium">
        {referenceLabel}
      </span>
      {content}
    </div>
  );
}

export function WorkbenchConversationError({
  error,
  nodeKey,
  className,
}: Readonly<{ error: ConversationError; nodeKey: string; className?: string }>) {
  const { t } = useI18n();
  const session = useConversationSession();
  const isLast = useSessionState((snapshot) => snapshot.nodeKeys.at(-1) === nodeKey);
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  const retry = error.recoverable === false ? undefined : session.actions.retry;
  const [retrying, setRetrying] = useState(false);

  return (
    <ErrorState
      className={className}
      title={t("workbench.chat.errors.requestFailedTitle")}
      detail={error.message || t("workbench.chat.errors.unknownFailure")}
      retrying={retrying}
      retryDisabled={isRunning}
      retryLabel={t("workbench.chat.errors.retry")}
      retryingLabel={t("workbench.chat.errors.retrying")}
      onRetry={() => {
        if (!retry || !isLast || isRunning || retrying) return;
        setRetrying(true);
        void retry(nodeKey)
          .catch((retryError: unknown) => {
            console.warn("[workbench-agent] retry failed", retryError);
          })
          .finally(() => setRetrying(false));
      }}
      showAction={isLast && retry !== undefined}
    />
  );
}
