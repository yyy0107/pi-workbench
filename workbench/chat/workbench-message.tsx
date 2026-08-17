"use client";

import {
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { BotIcon } from "lucide-react";

import { ComposerAttachments, UserMessageAttachments } from "@/components/assistant-ui/attachment";
import { Button } from "@/components/ui/button";
import { SlotHost } from "@/platform/extensions";

import { WorkbenchMessageActions } from "./message-actions";
import { WorkbenchMessageParts } from "./message-parts";

function MessageSlot({ name }: { name: "message.before" | "message.after" }) {
  const messageId = useAuiState((state) => state.message.id);
  const role = useAuiState((state) => state.message.role);
  const isLast = useAuiState((state) => state.message.isLast);

  return <SlotHost name={name} context={{ messageId, role, isLast }} className="col-span-full" />;
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
      className="mx-auto w-full max-w-[var(--thread-max-width)] px-2 py-4"
    >
      <MessageSlot name="message.before" />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-2">
        <UserMessageAttachments />
        <div className="col-start-2 max-w-[min(85vw,42rem)] min-w-0">
          <div className="bg-muted rounded-3xl px-4 py-2.5 break-words">
            <WorkbenchMessageParts />
          </div>
          <div className="mt-1 flex justify-end">
            <WorkbenchMessageActions />
          </div>
        </div>
      </div>
      <MessageSlot name="message.after" />
    </MessagePrimitive.Root>
  );
}

export function WorkbenchAssistantMessage() {
  return (
    <MessagePrimitive.Root
      data-role="assistant"
      className="mx-auto grid w-full max-w-[var(--thread-max-width)] grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-2 py-4"
    >
      <MessageSlot name="message.before" />
      <div className="bg-primary/10 flex size-8 items-center justify-center rounded-full">
        <BotIcon className="size-4" />
      </div>
      <div className="min-w-0 break-words leading-relaxed">
        <WorkbenchMessageParts />
        <WorkbenchMessageError />
        <div className="mt-1">
          <WorkbenchMessageActions />
        </div>
      </div>
      <MessageSlot name="message.after" />
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
  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-[var(--thread-max-width)] px-2 py-3">
      <ComposerPrimitive.Root className="bg-muted ms-auto flex w-full max-w-[85%] flex-col gap-2 rounded-3xl p-3">
        <ComposerAttachments />
        <ComposerPrimitive.Input
          autoFocus
          className="min-h-20 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none"
          aria-label="Edit message"
        />
        <div className="flex items-center justify-end gap-2">
          <ComposerPrimitive.Cancel render={<Button type="button" variant="ghost" size="sm" />}>
            Cancel
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button type="submit" size="sm" />}>
            Update
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
