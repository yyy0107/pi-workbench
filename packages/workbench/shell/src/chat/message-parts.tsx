"use client";

import { Loader2Icon } from "lucide-react";

import { useConversationNode } from "@workbench/agent-runtime-client";
import type {
  MessageBlock,
  SystemNode,
  UserMessageNode,
  AssistantMessageNode,
} from "@workbench/agent-runtime-contracts/conversation";
import { MessageRendererHost, RendererHost } from "@workbench/extension-host/hosts/renderer-host";

import { useI18n } from "../i18n";

import { useConversationMessageContext } from "./conversation-message-context";
import {
  WorkbenchMessageDataBlock,
  WorkbenchMessageFileBlock,
  WorkbenchMessageReasoningBlock,
  WorkbenchMessageSourceBlock,
  WorkbenchMessageTextBlock,
  WorkbenchMessageToolBlock,
} from "./renderers/message-blocks";

type MessageNode = UserMessageNode | AssistantMessageNode | SystemNode;

function DefaultBlock({
  block,
  index,
  node,
}: Readonly<{ block: MessageBlock; index: number; node: MessageNode }>) {
  const { t } = useI18n();
  const role = node.kind;
  const streaming =
    node.kind === "assistant" && node.status === "running" && index === node.blocks.length - 1;
  const composerDocument = node.presentation?.custom?.workbenchComposerDocument;
  const fallback = (() => {
    switch (block.kind) {
      case "text":
        return streaming && block.text === "" ? (
          <span className="my-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="aui-chat-icon-size-default animate-spin" />
            {t("workbench.chat.generating")}
          </span>
        ) : (
          <WorkbenchMessageTextBlock
            block={block}
            composerDocument={composerDocument}
            role={role}
            streaming={streaming}
          />
        );
      case "reasoning":
        return <WorkbenchMessageReasoningBlock block={block} />;
      case "tool-call":
        return <WorkbenchMessageToolBlock block={block} />;
      case "data":
        return <WorkbenchMessageDataBlock block={block} />;
      case "file":
        return <WorkbenchMessageFileBlock block={block} assistant={node.kind === "assistant"} />;
      case "source":
        return (
          <WorkbenchMessageSourceBlock
            block={block}
            fallbackLabel={t("workbench.chat.sourceFallback")}
          />
        );
      case "error":
        return null;
    }
  })();

  return <RendererHost node={node} block={block} fallback={fallback} />;
}

export function DefaultWorkbenchMessageParts({ node }: Readonly<{ node: MessageNode }>) {
  return node.blocks.map((block, index) => (
    <DefaultBlock key={block.key} node={node} block={block} index={index} />
  ));
}

export function WorkbenchMessageParts() {
  const { messageId } = useConversationMessageContext();
  const node = useConversationNode(messageId);
  if (!node || !("blocks" in node)) return null;

  const fallback = <DefaultWorkbenchMessageParts node={node} />;
  return node.kind === "user" || node.kind === "assistant" ? (
    <MessageRendererHost node={node} fallback={fallback} />
  ) : (
    fallback
  );
}
