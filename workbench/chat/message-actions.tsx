"use client";

import { ActionBarPrimitive, AuiIf, useAuiState } from "@assistant-ui/react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SlotHost } from "@/platform/extensions";

import { shouldShowMessageActions } from "./message-action-visibility";

function CopyAction({ role }: Readonly<{ role: "user" | "assistant" }>) {
  const { t } = useI18n();
  const tooltip =
    role === "user"
      ? t("workbench.chat.actions.copyMessage")
      : t("workbench.chat.actions.copyResponse");

  return (
    <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="flex items-center gap-0.5">
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip={tooltip} />}>
        {role === "assistant" ? (
          <>
            <AuiIf condition={(state) => state.message.isCopied}>
              <CheckIcon className="size-3.5" />
            </AuiIf>
            <AuiIf condition={(state) => !state.message.isCopied}>
              <CopyIcon className="size-3.5" />
            </AuiIf>
          </>
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
}

export function WorkbenchMessageActions({ className }: Readonly<{ className?: string }>) {
  const messageId = useAuiState((state) => state.message.id);
  const role = useAuiState((state) => state.message.role);
  const isLast = useAuiState((state) => state.message.isLast);
  const capabilities = useAuiState((state) => state.thread.capabilities);
  const visible = useAuiState((state) =>
    shouldShowMessageActions(state.thread.messages, state.message.index),
  );
  const context = { messageId, role, isLast };

  if (!visible) return null;

  return (
    <div
      data-slot="message-actions"
      className={cn("text-muted-foreground flex min-h-7 flex-wrap items-center gap-1", className)}
    >
      {capabilities.unstable_copy && (role === "user" || role === "assistant") ? (
        <CopyAction role={role} />
      ) : null}
      <SlotHost name="message.actions" context={context} className="flex items-center gap-1" />
    </div>
  );
}
