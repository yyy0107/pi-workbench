"use client";

import { memo } from "react";
import {
  useConversationNode,
  useSessionState,
  useConversationSession,
} from "@workbench/agent-runtime-client";
import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";
import { WorkbenchConversationError } from "@workbench/ui-message-blocks/message-blocks";
import { ConversationMessageProvider } from "./conversation-message-context";
import {
  WorkbenchAssistantMessage,
  WorkbenchSystemMessage,
  WorkbenchUserMessage,
} from "./workbench-message";

function nodeRole(node: ConversationNode): "user" | "assistant" | "system" {
  return node.kind === "user" || node.kind === "assistant" ? node.kind : "system";
}

const messageComponents = {
  UserMessage: WorkbenchUserMessage,
  AssistantMessage: WorkbenchAssistantMessage,
  SystemMessage: WorkbenchSystemMessage,
};

export const ConversationNodeSeat = memo(function ConversationNodeSeat({
  index,
  nodeKey,
}: Readonly<{ index: number; nodeKey: string }>) {
  const node = useConversationNode(nodeKey);
  const session = useConversationSession();
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  const isLast = useSessionState((snapshot) => snapshot.nodeKeys.at(-1) === nodeKey);
  if (!node) return null;
  if (node.kind === "error") {
    return (
      <WorkbenchConversationError
        error={node.error}
        nodeKey={node.key}
        isLast={isLast}
        isRunning={isRunning}
        retry={node.error.recoverable === false ? undefined : session.actions.retry}
      />
    );
  }
  const role = nodeRole(node);
  const Message =
    messageComponents[
      role === "user" ? "UserMessage" : role === "assistant" ? "AssistantMessage" : "SystemMessage"
    ];
  return (
    <ConversationMessageProvider value={{ messageId: node.key, role, isLast, index }}>
      <div
        data-message-id={node.key}
        data-conversation-node-key={node.key}
        data-conversation-node-kind={node.kind}
      >
        <Message />
      </div>
    </ConversationMessageProvider>
  );
});
