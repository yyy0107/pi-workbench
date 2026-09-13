"use client";
import { useI18n } from "@workbench/i18n";

import { useMemo, type ReactNode } from "react";

import { useConversationNodes, useSessionState } from "@workbench/agent-runtime-client";

import { DaySeparator } from "@workbench/ui-message-blocks/conversation-separator";
import { MessagePair } from "./message-pair";

import { THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME } from "@workbench/shell-context/layout";
import { cn } from "@workbench/ui/utils";
import {
  ConversationNodeSeat,
  ConversationStructureProvider,
  SteeredTurn,
  SteeredTurnWork,
} from "@workbench/ui-conversation-nodes";

import {
  conversationPairKey,
  isLastConversationPair,
  shouldShowWorkingStatus,
  steeredTurnEnd,
} from "../lib/workbench-message-rows";

import {
  localConversationDayKey as localDayKey,
  sameConversationRow as sameRow,
  selectConversationRow as selectRow,
  type ConversationRow,
} from "../lib/conversation-row";

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

    // ponytail: keep history rows painted; revisit content-visibility after Chromium's
    // HitTestResult::GetPosition display-lock crash is fixed upstream.
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
