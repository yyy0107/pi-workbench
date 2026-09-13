"use client";
import { conversationTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { PastedTextAttachmentPreview } from "@workbench/ui-attachment";

import { useEffect, useState } from "react";

import type {
  ConversationError,
  DataBlock,
  FileBlock,
  ReasoningBlock,
  SourceBlock,
  TextBlock,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";
import type {
  ReadManagedFileAttachmentRequest,
  ReadManagedFileAttachmentResult,
} from "@workbench/agent-runtime-contracts/composer-attachments";
export type ManagedAttachmentReader = (
  request: ReadManagedFileAttachmentRequest,
) => Promise<ReadManagedFileAttachmentResult>;

import { File, getBase64Size, getFileDataKind } from "./file";
import { Image } from "./image";
import { MarkdownTextContentWithCitations } from "@workbench/markdown";
import { MessageSource, type MessageSourceVariant } from "./message-source";
import { ErrorState } from "./error-state";
import type { Source } from "@workbench/markdown";
import { ScrollCompensatedDetails } from "@workbench/ui-disclosure";

import {
  WorkbenchComposerMessageTextContent,
  type ComposerMessagePresentation,
} from "./composer-message-content";

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
  presentation,
  role,
  sources = EMPTY_SOURCES,
  streaming = false,
}: Readonly<{
  block: TextBlock;
  presentation?: ComposerMessagePresentation;
  role: "user" | "assistant" | "system";
  sources?: readonly Source[];
  streaming?: boolean;
}>) {
  if (role === "user") {
    return <WorkbenchComposerMessageTextContent text={block.text} presentation={presentation} />;
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

function ManagedFileAttachmentPreview({
  block,
  referenceLabel,
  readAttachment,
}: Readonly<{
  block: FileBlock;
  referenceLabel?: string;
  readAttachment?: ManagedAttachmentReader;
}>) {
  const attachment = block.fileAttachment ?? block.imageAttachment!;
  const isImage = attachment.mediaType.startsWith("image/");
  const [source, setSource] = useState<string>();

  useEffect(() => {
    let current = true;
    setSource(undefined);
    if (!isImage) return () => undefined;
    const read = readAttachment;
    if (!read) return () => undefined;
    void read({ id: attachment.id })
      .then((result) => {
        if (current) setSource(`data:${result.attachment.mediaType};base64,${result.data}`);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [attachment.id, isImage, readAttachment]);

  const content =
    isImage && source ? (
      <Image.Root>
        <Image.Zoom src={source} alt={block.name}>
          <Image.Preview src={source} alt={block.name} />
        </Image.Zoom>
      </Image.Root>
    ) : (
      <File.Root>
        <File.Icon mimeType={attachment.mediaType} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <File.Name>{block.name}</File.Name>
          <File.Size bytes={attachment.bytes} className="text-xs" />
        </div>
      </File.Root>
    );

  if (!referenceLabel) return content;
  return (
    <div data-slot="user-attachment-reference" className="relative max-w-full">
      {content}
      <span className="bg-background/85 text-foreground pointer-events-none absolute top-2 left-2 rounded-full border border-foreground/10 px-2 py-0.5 text-[11px] font-medium shadow-sm backdrop-blur-sm">
        {referenceLabel}
      </span>
    </div>
  );
}

export function WorkbenchMessageFileBlock({
  block,
  referenceLabel,
  assistant = false,
  readAttachment,
}: Readonly<{
  block: FileBlock;
  referenceLabel?: string;
  assistant?: boolean;
  readAttachment?: ManagedAttachmentReader;
}>) {
  if (block.textAttachment)
    return <PastedTextAttachmentPreview attachment={block.textAttachment} />;
  if (block.fileAttachment || block.imageAttachment)
    return (
      <ManagedFileAttachmentPreview
        block={block}
        referenceLabel={referenceLabel}
        readAttachment={readAttachment}
      />
    );
  const mediaType = resolvedMediaType(block);
  const source = playableFileSource(block, mediaType);
  const image = mediaType.startsWith("image/");

  const content =
    image && assistant && block.sourceType !== "id" ? (
      <Image
        image={source ?? ""}
        filename={block.name}
        status={
          block.status === "error" || block.status === "incomplete"
            ? { type: "incomplete", reason: block.status === "error" ? "error" : "other" }
            : { type: block.status ?? "complete" }
        }
      />
    ) : image && source ? (
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
  isLast,
  isRunning,
  retry,
  className,
}: Readonly<{
  error: ConversationError;
  nodeKey: string;
  isLast: boolean;
  isRunning: boolean;
  retry?: (nodeKey: string) => Promise<unknown>;
  className?: string;
}>) {
  const { t } = useI18n(conversationTranslationBundle);
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
