"use client";

import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { AlertCircleIcon, ArrowUpIcon, MicIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { ComposerAddAttachment, ComposerAttachments } from "@/components/assistant-ui/attachment";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SlotHost, useExtensionManager } from "@/platform/extensions";
import type { PiComposerSendError } from "@/runtime/pi/client/runtime/send-error";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

interface PiComposerActions {
  error?: PiComposerSendError;
  clearError(): void;
}

function piComposerActions(extras: unknown): PiComposerActions | undefined {
  if (
    !extras ||
    typeof extras !== "object" ||
    !("piComposer" in extras) ||
    !extras.piComposer ||
    typeof extras.piComposer !== "object" ||
    !("clearError" in extras.piComposer) ||
    typeof extras.piComposer.clearError !== "function"
  ) {
    return undefined;
  }
  return extras.piComposer as PiComposerActions;
}

function composerErrorMessage(error: PiComposerSendError, t: ReturnType<typeof useI18n>["t"]) {
  switch (error) {
    case "model-image-unsupported":
      return t("workbench.chat.errors.modelDoesNotSupportImages");
    case "image-too-large":
      return t("workbench.chat.errors.imageTooLarge");
    case "too-many-images":
      return t("workbench.chat.errors.tooManyImages");
    case "image-invalid":
      return t("workbench.chat.errors.invalidImage");
  }
}

function ComposerDrawerStats({ contextCount }: Readonly<{ contextCount: number }>) {
  const { t } = useI18n();
  const extensionManager = useExtensionManager();
  const getExtensionCount = useCallback(
    () => extensionManager.getExtensions().length,
    [extensionManager],
  );
  const extensionCount = useSyncExternalStore(
    extensionManager.subscribe,
    getExtensionCount,
    () => 0,
  );

  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="bg-muted/55 text-muted-foreground inline-flex h-6 items-center rounded-lg px-2 text-[11px] whitespace-nowrap">
        {t("workbench.chat.composer.contextCount", { count: contextCount })}
      </span>
      <span className="bg-muted/55 text-muted-foreground inline-flex h-6 items-center rounded-lg px-2 text-[11px] whitespace-nowrap">
        {t("workbench.chat.composer.extensionsCount", { count: extensionCount })}
      </span>
    </div>
  );
}

export function WorkbenchComposer() {
  const { t } = useI18n();
  const aui = useAui();
  const extras = useAuiState((state) => state.thread.extras);
  const composerActions = piComposerActions(extras);
  const drawerId = useId();
  const composerRef = useRef<HTMLFormElement>(null);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isEmpty = useAuiState((state) => state.thread.composer.isEmpty);
  const canSend = useAuiState((state) => state.thread.composer.canSend);
  const canQueue = useAuiState((state) => state.thread.capabilities.queue);
  const isDictating = useAuiState((state) => state.thread.composer.dictation != null);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const isNewThread = mainThreadId === newThreadId;
  const [isDrawerOpen, setIsDrawerOpen] = useState(isNewThread);
  const [isComposerSelected, setIsComposerSelected] = useState(false);
  const hasDraftWorkspace = useWorkspaceDirectoryStore((state) =>
    state.directories.some((directory) => directory.id === state.draftDirectoryId),
  );
  const canCompose = !isNewThread || hasDraftWorkspace;
  const showWorkspacePrompt = !canCompose && isComposerSelected;
  const contextCount = useAuiState(
    (state) => state.thread.messages.length + state.thread.composer.attachments.length,
  );
  const context = { isRunning, isEmpty };
  const drawerContext = {
    ...context,
    closeDrawer: () => setIsDrawerOpen(false),
  };

  useEffect(() => {
    setIsDrawerOpen(isNewThread);
    setIsComposerSelected(false);
  }, [hasDraftWorkspace, isNewThread, mainThreadId]);

  useEffect(() => {
    if (!showWorkspacePrompt) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && composerRef.current?.contains(target)) return;
      setIsComposerSelected(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showWorkspacePrompt]);

  return (
    <div className="flex w-full flex-col gap-2">
      <SlotHost name="composer.before" context={context} className="flex flex-col gap-2" />

      <ComposerPrimitive.Root
        ref={composerRef}
        className="group/composer relative flex w-full flex-col"
        data-selected={showWorkspacePrompt ? "true" : undefined}
        onPointerDownCapture={() => {
          if (!canCompose) setIsComposerSelected(true);
        }}
        onSubmit={(event) => {
          if (!canCompose) {
            event.preventDefault();
            return;
          }
          if (!canSend) return;
          setIsDrawerOpen(false);
          setIsComposerSelected(false);
          if (isRunning && canQueue) {
            event.preventDefault();
            aui.thread.composer().send({ steer: false });
          }
        }}
      >
        <ComposerPrimitive.AttachmentDropzone
          data-slot="workbench-composer-card"
          className={cn(
            "bg-background data-[dragging=true]:bg-accent/50 flex w-full flex-col overflow-hidden rounded-[22px] border shadow-[0_1px_3px_rgba(0,0,0,0.08)] outline-none transition-[border-color,box-shadow,background-color] data-[dragging=true]:border-dashed",
            showWorkspacePrompt &&
              "border-dashed border-muted-foreground/40 dark:border-muted-foreground/50",
          )}
        >
          <fieldset
            disabled={!canCompose}
            className={cn(
              "flex flex-col gap-3 pt-2.5 transition-opacity [&>.aui-composer-attachments]:px-3",
              showWorkspacePrompt ? "opacity-60" : !canCompose && "[&_:disabled]:opacity-100",
            )}
          >
            <ComposerAttachments />
            <ComposerPrimitive.Input asChild>
              <textarea
                rows={1}
                aria-label={t("workbench.chat.composer.messageInput")}
                placeholder={t("workbench.chat.composer.placeholder")}
                className={cn(
                  "max-h-[336px] w-full resize-none overflow-y-auto bg-transparent px-4 pt-1 pb-0 text-base leading-6 outline-none [field-sizing:content] placeholder:text-muted-foreground/85 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:placeholder:text-muted-foreground/65",
                  isNewThread ? "min-h-[52px]" : "min-h-7",
                )}
              />
            </ComposerPrimitive.Input>

            <div className="flex min-h-[42px] items-center justify-between gap-3 px-2 pt-0.5 pb-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <TooltipIconButton
                  type="button"
                  tooltip={
                    isDrawerOpen
                      ? t("workbench.chat.composer.closeDrawer")
                      : t("workbench.chat.composer.openDrawer")
                  }
                  aria-label={
                    isDrawerOpen
                      ? t("workbench.chat.composer.closeDrawer")
                      : t("workbench.chat.composer.openDrawer")
                  }
                  aria-expanded={isDrawerOpen}
                  aria-controls={drawerId}
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground size-7 rounded-full"
                  onClick={() => setIsDrawerOpen((open) => !open)}
                >
                  {isDrawerOpen ? (
                    <XIcon className="size-[18px]" />
                  ) : (
                    <PlusIcon className="size-[18px]" />
                  )}
                </TooltipIconButton>
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
                        className="text-muted-foreground hover:text-foreground size-7 rounded-full"
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
                        className="text-muted-foreground hover:text-foreground size-7 rounded-full"
                      />
                    }
                  >
                    <MicIcon className="size-[18px]" />
                  </ComposerPrimitive.Dictate>
                )}
                {isRunning ? (
                  <>
                    <ComposerPrimitive.Cancel
                      render={
                        <TooltipIconButton
                          tooltip={t("workbench.chat.composer.stopGenerating")}
                          type="button"
                          variant="default"
                          className="size-[34px] -translate-y-0.5 rounded-full"
                        />
                      }
                    >
                      <SquareIcon className="size-3 fill-current" />
                    </ComposerPrimitive.Cancel>
                    {canQueue ? (
                      <TooltipIconButton
                        tooltip={t("workbench.chat.composer.queueFollowUp")}
                        aria-label={t("workbench.chat.composer.queueFollowUp")}
                        type="button"
                        disabled={!canCompose || !canSend}
                        variant="default"
                        className="size-[34px] -translate-y-0.5 rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
                        onClick={() => {
                          aui.thread.composer().send({ steer: false });
                          setIsDrawerOpen(false);
                          setIsComposerSelected(false);
                        }}
                      >
                        <ArrowUpIcon className="size-5" />
                      </TooltipIconButton>
                    ) : null}
                  </>
                ) : (
                  <ComposerPrimitive.Send
                    render={
                      <TooltipIconButton
                        tooltip={t("workbench.chat.composer.sendMessage")}
                        type="submit"
                        disabled={!canCompose}
                        variant="default"
                        className="size-[34px] -translate-y-0.5 rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
                      />
                    }
                  >
                    <ArrowUpIcon className="size-5" />
                  </ComposerPrimitive.Send>
                )}
              </div>
            </div>
          </fieldset>

          {isDrawerOpen ? (
            <div
              id={drawerId}
              role="region"
              aria-label={t("workbench.chat.composer.drawer")}
              data-slot="workbench-composer-drawer"
              className="animate-in fade-in slide-in-from-top-1 flex min-h-7 items-center justify-between gap-2 overflow-x-auto px-4 py-0.5 duration-150"
            >
              <SlotHost
                name="composer.drawer.left"
                context={drawerContext}
                className="flex min-w-0 flex-1 items-center gap-1.5 empty:hidden"
              />
              <div className="ms-auto flex shrink-0 items-center gap-1.5">
                <ComposerDrawerStats contextCount={contextCount} />
                <fieldset
                  disabled={!canCompose}
                  className={cn(
                    "flex shrink-0 items-center transition-opacity",
                    showWorkspacePrompt ? "opacity-60" : !canCompose && "[&_:disabled]:opacity-100",
                  )}
                >
                  <SlotHost
                    name="composer.drawer.right"
                    context={drawerContext}
                    className="flex shrink-0 items-center gap-1.5 empty:hidden"
                  />
                </fieldset>
              </div>
            </div>
          ) : null}
        </ComposerPrimitive.AttachmentDropzone>

        {composerActions?.error ? (
          <div
            role="alert"
            aria-live="polite"
            className="border-destructive/25 bg-destructive/8 text-destructive mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm"
          >
            <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">{composerErrorMessage(composerActions.error, t)}</span>
            <button
              type="button"
              aria-label={t("workbench.chat.composer.dismissError")}
              className="hover:bg-destructive/10 -m-1 rounded-md p-1"
              onClick={composerActions.clearError}
            >
              <XIcon aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        ) : null}
      </ComposerPrimitive.Root>

      <SlotHost name="composer.after" context={context} className="flex flex-col gap-2" />
    </div>
  );
}
