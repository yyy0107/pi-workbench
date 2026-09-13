import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";

export interface ConversationRow {
  readonly createdAt: number;
  readonly id: string;
  readonly index: number;
  readonly role: "user" | "assistant" | "system";
  readonly steering: boolean;
  readonly steerInterrupted: boolean;
  readonly kind: ConversationNode["kind"];
}

export function conversationNodeRole(node: ConversationNode): ConversationRow["role"] {
  return node.kind === "user" || node.kind === "assistant" ? node.kind : "system";
}

export function selectConversationRow(node: ConversationNode) {
  return {
    id: node.key,
    kind: node.kind,
    role: conversationNodeRole(node),
    createdAt: node.createdAt,
    steering: node.presentation?.custom?.workbenchSteering === true,
    steerInterrupted: node.presentation?.custom?.workbenchSteerInterrupted === true,
  };
}

export function sameConversationRow(
  left: ReturnType<typeof selectConversationRow>,
  right: ReturnType<typeof selectConversationRow>,
) {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.role === right.role &&
    left.createdAt === right.createdAt &&
    left.steering === right.steering &&
    left.steerInterrupted === right.steerInterrupted
  );
}

export function localConversationDayKey(timestamp: number): string | undefined {
  if (timestamp < Date.UTC(2000, 0, 1)) return undefined;
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) return undefined;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
