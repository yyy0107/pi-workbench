"use client";

import { ActionBarPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { CheckIcon, CircleXIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "../assistant-ui/tooltip-icon-button";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";

import {
  shouldHideMessageActionBar,
  shouldShowMessageActions,
  shouldShowMessageNavigation,
} from "./message-action-visibility";

const messageActionStyles = [
  "[&_button.aui-button-icon]:size-[var(--icon-frame-size-default)]!",
  "[&_button.aui-button-icon]:p-0!",
  "[&_button.aui-button-icon]:active:scale-100",
  "[&_button_svg.lucide]:size-[var(--icon-size-md)]!",
].join(" ");

function CopyAction({ role }: Readonly<{ role: "user" | "assistant" }>) {
  const aui = useAui();
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
    <ActionBarPrimitive.Root autohide="never" className="flex items-center gap-0.5">
      <TooltipIconButton
        type="button"
        tooltip={tooltip}
        onClick={() => void copy(aui.message.getCopyText())}
      >
        {isCopied ? (
          <CheckIcon className="size-3.5" />
        ) : status === "failed" ? (
          <CircleXIcon className="text-destructive size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </TooltipIconButton>
    </ActionBarPrimitive.Root>
  );
}

export function WorkbenchMessageActions({ className }: Readonly<{ className?: string }>) {
  const { date } = useI18n();
  const messageId = useAuiState((state) => state.message.id);
  const role = useAuiState((state) => state.message.role);
  const createdAt = useAuiState((state) => state.message.createdAt);
  const isLast = useAuiState((state) => state.message.isLast);
  const capabilities = useAuiState((state) => state.thread.capabilities);
  const hideActionBar = useAuiState((state) =>
    shouldHideMessageActionBar(state.message, state.thread.isRunning),
  );
  const actionsVisible = useAuiState((state) =>
    shouldShowMessageActions(state.thread.messages, state.message.index),
  );
  const navigationVisible = useAuiState((state) =>
    shouldShowMessageNavigation(
      state.thread.messages,
      state.message.index,
      state.thread.capabilities.switchToBranch,
    ),
  );
  const context = { messageId, role, isLast };

  if (hideActionBar) return null;
  if (!actionsVisible && !navigationVisible) return null;

  return (
    <div
      data-slot="message-actions"
      className={cn(
        messageActionStyles,
        "text-muted-foreground flex min-h-8 flex-wrap items-center gap-0.5",
        role === "user" &&
          "opacity-100 transition-opacity md:opacity-0 md:group-focus-within/message:opacity-100 md:group-hover/message:opacity-100 motion-reduce:transition-none",
        className,
      )}
    >
      {actionsVisible && role === "user" ? (
        <time dateTime={createdAt.toISOString()} className="text-xs tabular-nums">
          {date(createdAt, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </time>
      ) : null}
      {actionsVisible && capabilities.unstable_copy && (role === "user" || role === "assistant") ? (
        <CopyAction role={role} />
      ) : null}
      <SlotHost name="message.actions" context={context} className="flex items-center gap-0.5" />
    </div>
  );
}
