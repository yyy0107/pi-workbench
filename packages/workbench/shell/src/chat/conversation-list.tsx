"use client";

import { memo, useMemo, type ReactNode } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";

import {
  useConversationNode,
  useConversationSession,
  useSessionState,
} from "@workbench/agent-runtime-client";
import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";

import { DaySeparator } from "../elements/conversation-separator";
import { MessagePair } from "../elements/message-pair";
import { useI18n } from "../i18n";
import { THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME } from "../layout";
import { cn } from "../utils";

import {
  conversationPairKey,
  isLastConversationPair,
  shouldShowWorkingStatus,
} from "./workbench-message-rows";
import {
  WorkbenchAssistantMessage,
  WorkbenchEditComposer,
  WorkbenchSystemMessage,
  WorkbenchUserMessage,
} from "./workbench-message";

interface ConversationRow {
  readonly createdAt: number;
  readonly id: string;
  readonly index: number;
  readonly role: "user" | "assistant" | "system";
}

const messageComponents = {
  UserMessage: WorkbenchUserMessage,
  AssistantMessage: WorkbenchAssistantMessage,
  SystemMessage: WorkbenchSystemMessage,
  EditComposer: WorkbenchEditComposer,
};

function nodeRole(node: ConversationNode): ConversationRow["role"] {
  return node.kind === "user" || node.kind === "assistant" ? node.kind : "system";
}

function localDayKey(timestamp: number): string | undefined {
  // Legacy runtime entries can lack timestamps and use tiny positional fallbacks.
  // Do not turn those placeholders into a misleading January 1970 divider.
  if (timestamp < Date.UTC(2000, 0, 1)) return undefined;
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) return undefined;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Subscribe one stable Workbench Node key while the remaining assistant-ui presentation migrates.
 * The compatibility primitive is deliberately isolated here so sibling Nodes stay untouched.
 */
export const ConversationNodeSeat = memo(function ConversationNodeSeat({
  index,
  nodeKey,
}: Readonly<{ index: number; nodeKey: string }>) {
  const node = useConversationNode(nodeKey);
  if (!node) return null;

  return (
    <div data-conversation-node-key={node.key} data-conversation-node-kind={node.kind}>
      <ThreadPrimitive.MessageByIndex index={index} components={messageComponents} />
    </div>
  );
});

function ConversationMessages({
  isRunning,
  renderWorkingStatus,
}: Readonly<{ isRunning: boolean; renderWorkingStatus: () => ReactNode }>) {
  const { date } = useI18n();
  const session = useConversationSession();
  const nodeKeys = useSessionState((snapshot) => snapshot.nodeKeys);
  const rows = useMemo<readonly ConversationRow[]>(
    () =>
      nodeKeys.flatMap((nodeKey, index) => {
        const node = session.node(nodeKey).getSnapshot();
        return node
          ? [
              {
                id: nodeKey,
                index,
                role: nodeRole(node),
                createdAt: node.createdAt ?? index,
              },
            ]
          : [];
      }),
    [nodeKeys, session],
  );
  const items: ReactNode[] = [];
  let previousDay: string | undefined;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;

    const day = localDayKey(row.createdAt);
    if (day && day !== previousDay) {
      items.push(
        <DaySeparator
          key={`day:${day}:${row.id}`}
          dateTime={day}
          label={date(row.createdAt, {
            year: "numeric",
            month: "short",
            day: "numeric",
            weekday: "short",
          })}
          aria-label={date(row.createdAt, {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
          className="[overflow-anchor:none]"
        />,
      );
      previousDay = day;
    }

    if (row.role === "system") {
      items.push(
        <div key={row.id} className="[overflow-anchor:none]">
          <ConversationNodeSeat index={row.index} nodeKey={row.id} />
        </div>,
      );
      continue;
    }

    const nextRow = rows[index + 1];
    const assistantIndex =
      row.role === "user" && nextRow?.role === "assistant" && localDayKey(nextRow.createdAt) === day
        ? index + 1
        : undefined;
    const hasAssistantMessage = row.role === "assistant" || assistantIndex !== undefined;
    const pairMessageIndex = assistantIndex ?? index;
    const showWorkingStatus = shouldShowWorkingStatus({
      isLastPair: isLastConversationPair(rows, pairMessageIndex),
      threadIsRunning: isRunning,
    });
    const hasAssistantTurn = hasAssistantMessage || showWorkingStatus;

    items.push(
      <MessagePair
        key={conversationPairKey(row)}
        variant="flat"
        className="max-w-none gap-4 px-2 [overflow-anchor:none]"
        userMessage={
          row.role === "user" ? (
            <ConversationNodeSeat index={row.index} nodeKey={row.id} />
          ) : undefined
        }
        assistantMessage={
          hasAssistantTurn ? (
            <div
              data-slot="assistant-message-slot"
              className={cn(
                "w-full [overflow-anchor:none]",
                showWorkingStatus && "min-h-[var(--assistant-turn-min-height)]",
              )}
            >
              {hasAssistantMessage ? (
                <ConversationNodeSeat
                  index={rows[assistantIndex ?? index]?.index ?? row.index}
                  nodeKey={rows[assistantIndex ?? index]?.id ?? row.id}
                />
              ) : null}
              {showWorkingStatus ? renderWorkingStatus() : null}
            </div>
          ) : undefined
        }
      />,
    );

    if (assistantIndex !== undefined) index = assistantIndex;
  }

  if (items.length === 0) return null;

  return (
    <div
      data-slot="conversation-flow"
      className={cn(
        THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME,
        "mx-auto flex shrink-0 flex-col gap-4 pb-4 [overflow-anchor:none]",
      )}
    >
      {items}
    </div>
  );
}

export function ConversationList({
  renderWorkingStatus,
}: Readonly<{ renderWorkingStatus: () => ReactNode }>) {
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  return <ConversationMessages isRunning={isRunning} renderWorkingStatus={renderWorkingStatus} />;
}
