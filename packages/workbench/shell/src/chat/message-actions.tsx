"use client";

import { CheckIcon, CircleXIcon, CopyIcon } from "lucide-react";
import { useMemo } from "react";

import {
  useConversationNode,
  useConversationSession,
  useSessionState,
} from "@workbench/agent-runtime-client";
import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";

import { TooltipIconButton } from "../ui/tooltip-icon-button";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";

import {
  shouldHideMessageActionBar,
  shouldShowMessageActions,
  shouldShowMessageNavigation,
  type MessageActionVisibilityMessage,
} from "./message-action-visibility";
import { useConversationMessageContext } from "./conversation-message-context";

const messageActionStyles = [
  "[&_button.aui-button-icon]:size-[var(--icon-frame-size-default)]!",
  "[&_button.aui-button-icon]:p-0!",
  "[&_button.aui-button-icon]:active:scale-100",
  "[&_button_svg.lucide]:size-[var(--icon-size-md)]!",
].join(" ");

function CopyAction({ role, text }: Readonly<{ role: "user" | "assistant"; text: string }>) {
  const { t } = useI18n();
  const { copy, isCopied, status } = useClipboardCopy();
  const tooltip = t(
    status === "copied"
      ? "assistant.actions.copied"
      : status === "failed"
        ? "assistant.actions.copyFailed"
        : role === "user"
          ? "workbench.chat.actions.copyMessage"
          : "workbench.chat.actions.copyResponse",
  );

  return (
    <div className="flex items-center gap-0.5">
      <TooltipIconButton type="button" tooltip={tooltip} onClick={() => void copy(text)}>
        {isCopied ? (
          <CheckIcon className="size-3.5" />
        ) : status === "failed" ? (
          <CircleXIcon className="text-destructive size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </TooltipIconButton>
    </div>
  );
}

function visibilityMessage(
  node: ConversationNode,
  isLast: boolean,
): MessageActionVisibilityMessage {
  const role = node.kind === "user" || node.kind === "assistant" ? node.kind : "system";
  return {
    id: node.key,
    role,
    content:
      "blocks" in node
        ? node.blocks.map((block) => ({
            type: block.kind,
            ...(block.kind === "text" ? { text: block.text } : {}),
          }))
        : [],
    branchCount: node.presentation?.branch?.count,
    isLast,
    ...(node.kind === "assistant" ? { status: { type: node.status } } : {}),
  };
}

export function WorkbenchMessageActions({ className }: Readonly<{ className?: string }>) {
  const { date } = useI18n();
  const { messageId, role, isLast, index } = useConversationMessageContext();
  const session = useConversationSession();
  const node = useConversationNode(messageId);
  const nodeKeys = useSessionState((snapshot) => snapshot.nodeKeys);
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  const messages = useMemo(
    () =>
      nodeKeys.flatMap((key, nodeIndex) => {
        const item = session.node(key).getSnapshot();
        return item ? [visibilityMessage(item, nodeIndex === nodeKeys.length - 1)] : [];
      }),
    [nodeKeys, session],
  );
  if (!node) return null;
  const message = visibilityMessage(node, isLast);
  const hideActionBar = shouldHideMessageActionBar(message, isRunning);
  const actionsVisible = shouldShowMessageActions(messages, index);
  const navigationVisible = shouldShowMessageNavigation(
    messages,
    index,
    session.actions.selectBranch !== undefined,
  );
  const context = { messageId, role, isLast };
  const copyText =
    "blocks" in node
      ? node.blocks
          .filter((block) => block.kind === "text")
          .map((block) => block.text)
          .join("\n\n")
      : "";

  if (!actionsVisible && !navigationVisible && !hideActionBar) return null;

  return (
    <div
      data-slot="message-actions"
      aria-hidden={hideActionBar || undefined}
      className={cn(
        messageActionStyles,
        "text-muted-foreground flex min-h-8 flex-wrap items-center gap-0.5 transition-opacity duration-150 ease-out motion-reduce:transition-none",
        hideActionBar && "invisible pointer-events-none opacity-0",
        role === "user" &&
          "opacity-100 md:opacity-0 md:group-focus-within/message:opacity-100 md:group-hover/message:opacity-100",
        className,
      )}
    >
      {actionsVisible && role === "user" && node.createdAt !== undefined ? (
        <time dateTime={new Date(node.createdAt).toISOString()} className="text-xs tabular-nums">
          {date(node.createdAt, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </time>
      ) : null}
      {actionsVisible && copyText && (role === "user" || role === "assistant") ? (
        <CopyAction role={role} text={copyText} />
      ) : null}
      <SlotHost name="message.actions" context={context} className="flex items-center gap-0.5" />
    </div>
  );
}
