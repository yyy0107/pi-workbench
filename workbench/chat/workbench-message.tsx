"use client";

import {
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  useAuiState,
} from "@assistant-ui/react";

import { ComposerAttachments, UserMessageAttachments } from "@/components/assistant-ui/attachment";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions";

import { WorkbenchMessageActions } from "./message-actions";
import { WorkbenchMessageParts } from "./message-parts";

function MessageSlot({ name }: { name: "message.before" | "message.after" }) {
  const messageId = useAuiState((state) => state.message.id);
  const role = useAuiState((state) => state.message.role);
  const isLast = useAuiState((state) => state.message.isLast);

  return (
    <SlotHost
      name={name}
      context={{ messageId, role, isLast }}
      className="col-span-full [overflow-anchor:none]"
    />
  );
}

function WorkbenchMessageError() {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="border-destructive/30 bg-destructive/10 text-destructive mt-3 rounded-lg border p-3 text-sm">
        <ErrorPrimitive.Message className="line-clamp-3" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
}

export function WorkbenchUserMessage() {
  return (
    <MessagePrimitive.Root
      data-role="user"
      className="group/message flex w-full min-w-0 flex-col items-end gap-1.5"
    >
      <MessageSlot name="message.before" />
      <div className="flex max-w-full min-w-0 flex-col items-end gap-2">
        <UserMessageAttachments />
        <div
          data-slot="user-message-bubble"
          className="min-w-0 max-w-full rounded-[22px] bg-[rgb(237,243,254)] px-3.5 py-2 break-words text-start dark:bg-[rgb(44,44,46)]"
        >
          <WorkbenchMessageParts />
        </div>
      </div>
      <WorkbenchMessageActions className="justify-end" />
      <MessageSlot name="message.after" />
    </MessagePrimitive.Root>
  );
}

export function WorkbenchAssistantMessage() {
  return (
    <MessagePrimitive.Root data-role="assistant" className="w-full min-w-0">
      <MessageSlot name="message.before" />
      <div className="min-w-0 break-words leading-relaxed [overflow-anchor:none]">
        <WorkbenchMessageParts />
        <WorkbenchMessageError />
        <WorkbenchMessageActions className="mt-1" />
      </div>
      <MessageSlot name="message.after" />
      <span
        data-slot="assistant-scroll-anchor"
        aria-hidden="true"
        className="block size-px [overflow-anchor:auto]"
      />
    </MessagePrimitive.Root>
  );
}

export function WorkbenchSystemMessage() {
  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-[var(--thread-max-width)] px-2 py-2">
      <MessageSlot name="message.before" />
      <div className="bg-muted/50 text-muted-foreground rounded-lg border px-3 py-2 text-xs">
        <WorkbenchMessageParts />
      </div>
      <MessageSlot name="message.after" />
    </MessagePrimitive.Root>
  );
}

export function WorkbenchEditComposer() {
  const { t } = useI18n();

  return (
    <MessagePrimitive.Root className="w-full min-w-0">
      <ComposerPrimitive.Root className="flex w-full flex-col gap-2">
        <ComposerAttachments />
        <ComposerPrimitive.Input
          autoFocus
          className="min-h-20 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none"
          aria-label={t("workbench.chat.edit.label")}
        />
        <div className="flex items-center justify-end gap-2">
          <ComposerPrimitive.Cancel render={<Button type="button" variant="ghost" size="sm" />}>
            {t("workbench.chat.edit.cancel")}
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button type="submit" size="sm" />}>
            {t("workbench.chat.edit.update")}
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
