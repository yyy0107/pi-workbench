"use client";

import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { Loader2Icon } from "lucide-react";
import { useMemo } from "react";

import { File } from "../assistant-ui/file";
import { Image } from "../assistant-ui/image";
import { isSharedMessagePartLeaf, MessagePartLeaf } from "../assistant-ui/message-part-leaves";
import { useI18n } from "../i18n";
import { useConversationNode } from "@workbench/agent-runtime-client";
import {
  LegacyMessagePartRendererHost,
  LegacyMessageRendererHost,
  LegacyToolDataRenderer,
} from "../assistant-ui/renderer-compat";

import {
  WorkbenchMessageFileBlock,
  WorkbenchMessageDataBlock,
  WorkbenchMessageReasoningBlock,
  WorkbenchMessageSourceBlock,
  WorkbenchMessageTextBlock,
  WorkbenchMessageToolBlock,
} from "./renderers/message-blocks";
import { WorkbenchComposerMessageText } from "./composer-message-text";

function DefaultWorkbenchMessageParts() {
  const { t } = useI18n();
  const role = useAuiState((state) => state.message.role);
  const messageId = useAuiState((state) => state.message.id);
  const messageParts = useAuiState((state) => state.message.parts);
  const composerDocument = useAuiState(
    (state) => state.message.metadata.custom.workbenchComposerDocument,
  );
  const node = useConversationNode(messageId);
  const blocks = node && "blocks" in node ? node.blocks : undefined;
  const partIndices = useMemo(
    () => new Map(messageParts.map((part, index) => [part, index])),
    [messageParts],
  );

  return (
    <MessagePrimitive.Parts>
      {({ part }) => {
        const index = partIndices.get(part);
        const block = index === undefined ? undefined : blocks?.[index];

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

            if (block?.kind === "text") {
              const fallback = (
                <WorkbenchMessageTextBlock
                  block={block}
                  composerDocument={composerDocument}
                  role={role}
                  streaming={part.status.type === "running"}
                />
              );
              return role === "assistant" ? (
                <LegacyMessagePartRendererHost part={part} fallback={fallback} />
              ) : (
                fallback
              );
            }

            if (role === "user") return <WorkbenchComposerMessageText text={part.text} />;
            const fallback = <p className="whitespace-pre-wrap">{part.text}</p>;
            return <LegacyMessagePartRendererHost part={part} fallback={fallback} />;
          }
          case "reasoning":
            return block?.kind === "reasoning" ? (
              <WorkbenchMessageReasoningBlock block={block} />
            ) : (
              <pre className="text-muted-foreground my-2 whitespace-pre-wrap text-xs">
                {part.text}
              </pre>
            );
          case "image":
          case "file":
            return block?.kind === "file" ? (
              <WorkbenchMessageFileBlock block={block} />
            ) : part.type === "image" ? (
              <Image {...part} />
            ) : (
              <File {...part} />
            );
          case "source":
            return block?.kind === "source" ? (
              <WorkbenchMessageSourceBlock
                block={block}
                fallbackLabel={t("workbench.chat.sourceFallback")}
              />
            ) : isSharedMessagePartLeaf(part) ? (
              <MessagePartLeaf
                part={part}
                sourceFallbackLabel={t("workbench.chat.sourceFallback")}
              />
            ) : null;
          case "tool-call":
          case "data":
            return index !== undefined &&
              ((part.type === "tool-call" && block?.kind === "tool-call") ||
                (part.type === "data" && block?.kind === "data")) ? (
              <LegacyToolDataRenderer
                block={block}
                partIndex={index}
                fallback={
                  block.kind === "tool-call" ? (
                    <WorkbenchMessageToolBlock block={block} />
                  ) : (
                    <WorkbenchMessageDataBlock block={block} />
                  )
                }
              />
            ) : isSharedMessagePartLeaf(part) ? (
              <MessagePartLeaf
                part={part}
                sourceFallbackLabel={t("workbench.chat.sourceFallback")}
              />
            ) : null;
          case "generative-ui": {
            const fallback =
              block?.kind === "data" ? <WorkbenchMessageDataBlock block={block} /> : null;
            return <LegacyMessagePartRendererHost part={part} fallback={fallback} />;
          }
          default:
            return isSharedMessagePartLeaf(part) ? (
              <MessagePartLeaf
                part={part}
                sourceFallbackLabel={t("workbench.chat.sourceFallback")}
              />
            ) : null;
        }
      }}
    </MessagePrimitive.Parts>
  );
}

export function WorkbenchMessageParts() {
  return <LegacyMessageRendererHost fallback={<DefaultWorkbenchMessageParts />} />;
}
