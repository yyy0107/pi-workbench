"use client";

import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import { ArrowUpIcon, MicIcon, SquareIcon } from "lucide-react";

import { ComposerAddAttachment, ComposerAttachments } from "@/components/assistant-ui/attachment";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions";

export function WorkbenchComposer() {
  const { t } = useI18n();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isEmpty = useAuiState((state) => state.thread.composer.isEmpty);
  const isDictating = useAuiState((state) => state.thread.composer.dictation != null);
  const context = { isRunning, isEmpty };

  return (
    <div className="flex w-full flex-col gap-2">
      <SlotHost name="composer.before" context={context} className="flex flex-col gap-2" />

      <ComposerPrimitive.Root className="relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone className="bg-background data-[dragging=true]:bg-accent/50 has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-ring/15 flex min-h-36 w-full flex-col rounded-[30px] border px-5 pb-3 pt-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] outline-none transition-[border-color,box-shadow,background-color] has-[textarea:focus-visible]:ring-2 data-[dragging=true]:border-dashed">
          <ComposerAttachments />
          <ComposerPrimitive.Input
            autoFocus
            rows={1}
            aria-label={t("workbench.chat.composer.messageInput")}
            placeholder={t("workbench.chat.composer.placeholder")}
            className="max-h-40 min-h-16 w-full resize-none bg-transparent px-1 py-0 text-base leading-7 outline-none placeholder:text-muted-foreground/85"
          />

          <div className="mt-auto flex min-h-9 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <SlotHost
                name="composer.actions.left"
                context={context}
                className="flex min-w-0 items-center gap-2"
              />
              <ComposerAddAttachment />
            </div>

            <div className="flex min-w-0 items-center justify-end gap-2">
              <SlotHost
                name="composer.actions.right"
                context={context}
                className="flex min-w-0 items-center justify-end gap-2"
              />
              {isDictating ? (
                <ComposerPrimitive.StopDictation
                  render={
                    <TooltipIconButton
                      tooltip={t("workbench.chat.composer.stopVoiceInput")}
                      type="button"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground size-9 rounded-full"
                    />
                  }
                >
                  <SquareIcon className="size-3 fill-current" />
                </ComposerPrimitive.StopDictation>
              ) : (
                <ComposerPrimitive.Dictate
                  render={
                    <TooltipIconButton
                      tooltip={t("workbench.chat.composer.voiceInput")}
                      type="button"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground size-9 rounded-full"
                    />
                  }
                >
                  <MicIcon className="size-[18px]" />
                </ComposerPrimitive.Dictate>
              )}
              {isRunning ? (
                <ComposerPrimitive.Cancel
                  render={
                    <TooltipIconButton
                      tooltip={t("workbench.chat.composer.stopGenerating")}
                      type="button"
                      variant="default"
                      className="size-10 rounded-full"
                    />
                  }
                >
                  <SquareIcon className="size-3 fill-current" />
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send
                  render={
                    <TooltipIconButton
                      tooltip={t("workbench.chat.composer.sendMessage")}
                      type="submit"
                      variant="default"
                      className="size-10 rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
                    />
                  }
                >
                  <ArrowUpIcon className="size-5" />
                </ComposerPrimitive.Send>
              )}
            </div>
          </div>
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>

      <SlotHost name="composer.after" context={context} className="flex flex-col gap-2" />
    </div>
  );
}
