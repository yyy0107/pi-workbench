"use client";

import { memo, useMemo, type ReactNode } from "react";

import {
  useConversationNode,
  useConversationNodes,
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
  steeredTurnEnd,
} from "./workbench-message-rows";
import { SteeredTurn, SteeredTurnWork } from "./steered-turn";
import {
  WorkbenchAssistantMessage,
  WorkbenchSystemMessage,
  WorkbenchUserMessage,
} from "./workbench-message";
import {
  ConversationMessageProvider,
  ConversationStructureProvider,
} from "./conversation-message-context";
import { WorkbenchConversationError } from "./renderers/message-blocks";

interface ConversationRow {
  readonly createdAt: number;
  readonly id: string;
  readonly index: number;
  readonly role: "user" | "assistant" | "system";
  readonly steering: boolean;
  readonly steerInterrupted: boolean;
  readonly kind: ConversationNode["kind"];
}

function selectRow(node: ConversationNode) {
  return {
    id: node.key,
    kind: node.kind,
    role: nodeRole(node),
    createdAt: node.createdAt,
    steering: node.presentation?.custom?.workbenchSteering === true,
    steerInterrupted: node.presentation?.custom?.workbenchSteerInterrupted === true,
  };
}

function sameRow(left: ReturnType<typeof selectRow>, right: ReturnType<typeof selectRow>) {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.role === right.role &&
    left.createdAt === right.createdAt &&
    left.steering === right.steering &&
    left.steerInterrupted === right.steerInterrupted
  );
}

const messageComponents = {
  UserMessage: WorkbenchUserMessage,
  AssistantMessage: WorkbenchAssistantMessage,
  SystemMessage: WorkbenchSystemMessage,
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

export const ConversationNodeSeat = memo(function ConversationNodeSeat({
  index,
  nodeKey,
}: Readonly<{ index: number; nodeKey: string }>) {
  const node = useConversationNode(nodeKey);
  const isLast = useSessionState((snapshot) => snapshot.nodeKeys.at(-1) === nodeKey);
  if (!node) return null;
  if (node.kind === "error") {
    return <WorkbenchConversationError error={node.error} nodeKey={node.key} />;
  }
  const Message =
    messageComponents[
      nodeRole(node) === "user"
        ? "UserMessage"
        : nodeRole(node) === "assistant"
          ? "AssistantMessage"
          : "SystemMessage"
    ];

  return (
    <ConversationMessageProvider
      value={{ messageId: node.key, role: nodeRole(node), isLast, index }}
    >
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

function ConversationMessages({
  isRunning,
  renderWorkingStatus,
}: Readonly<{ isRunning: boolean; renderWorkingStatus: () => ReactNode }>) {
  const { date } = useI18n();
  const nodes = useConversationNodes({ select: selectRow, isEqual: sameRow });
  const rows = useMemo<readonly ConversationRow[]>(
    () =>
      nodes.map((node, index) => ({
        ...node,
        index,
        createdAt: node.createdAt ?? index,
      })),
    [nodes],
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
    const turnStart = assistantIndex ?? index;
    const turnEnd = steeredTurnEnd(rows, turnStart);
    const grouped = turnEnd > turnStart;
    const pairMessageIndex = turnEnd;
    const showWorkingStatus = shouldShowWorkingStatus({
      isLastPair: isLastConversationPair(rows, pairMessageIndex),
      threadIsRunning: isRunning,
    });
    const hasAssistantTurn = hasAssistantMessage || showWorkingStatus;

    items.push(
      <MessagePair
        key={conversationPairKey(row)}
        data-conversation-history-row={showWorkingStatus ? undefined : ""}
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
              {grouped ? (
                <SteeredTurn
                  nodeKeys={rows.slice(turnStart, turnEnd + 1).map((entry) => entry.id)}
                  running={showWorkingStatus}
                >
                  {({ finalMessageId }) =>
                    rows.slice(turnStart, turnEnd + 1).map((entry) => {
                      const seat = <ConversationNodeSeat index={entry.index} nodeKey={entry.id} />;
                      return entry.role !== "user" &&
                        entry.id !== finalMessageId &&
                        entry.kind !== "error" ? (
                        <SteeredTurnWork key={entry.id}>
                          <div className="pb-4">{seat}</div>
                        </SteeredTurnWork>
                      ) : (
                        <div key={entry.id} className="pb-4 last:pb-0">
                          {seat}
                        </div>
                      );
                    })
                  }
                </SteeredTurn>
              ) : hasAssistantMessage ? (
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

    if (grouped || assistantIndex !== undefined) index = turnEnd;
  }

  if (items.length === 0) return null;

  return (
    <ConversationStructureProvider value={rows}>
      <div
        data-slot="conversation-flow"
        className={cn(
          THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME,
          "flex shrink-0 flex-col gap-4 pb-4 [overflow-anchor:none]",
        )}
      >
        {items}
      </div>
    </ConversationStructureProvider>
  );
}

export function ConversationList({
  renderWorkingStatus,
}: Readonly<{ renderWorkingStatus: () => ReactNode }>) {
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  return <ConversationMessages isRunning={isRunning} renderWorkingStatus={renderWorkingStatus} />;
}
