"use client";

import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import { ArrowUpIcon, MicIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { ComposerAddAttachment, ComposerAttachments } from "@/components/assistant-ui/attachment";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SlotHost, useExtensionManager } from "@/platform/extensions";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

function ComposerDrawerStats({
  children,
  contextCount,
}: Readonly<{ children: React.ReactNode; contextCount: number }>) {
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
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="bg-muted/55 text-muted-foreground inline-flex h-8 items-center rounded-xl px-2.5 text-xs whitespace-nowrap">
        {t("workbench.chat.composer.contextCount", { count: contextCount })}
      </span>
      {children}
      <span className="bg-muted/55 text-muted-foreground inline-flex h-8 items-center rounded-xl px-2.5 text-xs whitespace-nowrap">
        {t("workbench.chat.composer.extensionsCount", { count: extensionCount })}
      </span>
    </div>
  );
}

export function WorkbenchComposer() {
  const { t } = useI18n();
  const drawerId = useId();
  const composerRef = useRef<HTMLFormElement>(null);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isEmpty = useAuiState((state) => state.thread.composer.isEmpty);
  const canSend = useAuiState((state) => state.thread.composer.canSend);
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
  const showDisabledAppearance = !canCompose && isComposerSelected;
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
  }, [isNewThread, mainThreadId]);

  useEffect(() => {
    if (!isNewThread || !isComposerSelected) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && composerRef.current?.contains(target)) return;
      setIsComposerSelected(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isComposerSelected, isNewThread]);

  return (
    <div className="flex w-full flex-col gap-2">
      <SlotHost name="composer.before" context={context} className="flex flex-col gap-2" />

      <ComposerPrimitive.Root
        ref={composerRef}
        className="group/composer relative flex w-full flex-col"
        data-selected={isNewThread && isComposerSelected ? "true" : undefined}
        onPointerDownCapture={() => {
          if (isNewThread) setIsComposerSelected(true);
        }}
        onSubmit={(event) => {
          if (!canCompose) {
            event.preventDefault();
            return;
          }
          if (!canSend) return;
          setIsDrawerOpen(false);
          setIsComposerSelected(false);
        }}
      >
        <ComposerPrimitive.AttachmentDropzone
          className={cn(
            "bg-background data-[dragging=true]:bg-accent/50 flex w-full flex-col overflow-hidden rounded-[30px] border shadow-[0_1px_3px_rgba(0,0,0,0.08)] outline-none transition-[border-color,box-shadow,background-color] data-[dragging=true]:border-dashed",
            isNewThread &&
              isComposerSelected &&
              "border-dashed border-muted-foreground/40 dark:border-muted-foreground/50",
          )}
        >
          <fieldset
            disabled={!canCompose}
            className={cn(
              "flex min-h-36 flex-col px-5 pb-3 pt-4 transition-opacity",
              showDisabledAppearance ? "opacity-60" : !canCompose && "[&_:disabled]:opacity-100",
            )}
          >
            <ComposerAttachments />
            <ComposerPrimitive.Input asChild>
              <textarea
                rows={1}
                aria-label={t("workbench.chat.composer.messageInput")}
                placeholder={t("workbench.chat.composer.placeholder")}
                className="max-h-40 min-h-16 w-full resize-none overflow-y-auto bg-transparent px-1 py-0 text-base leading-7 outline-none [field-sizing:content] placeholder:text-muted-foreground/85 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:placeholder:text-muted-foreground/65"
              />
            </ComposerPrimitive.Input>

            <div className="mt-auto flex min-h-9 items-center justify-between gap-3">
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
                  className="text-muted-foreground hover:text-foreground size-9 rounded-full"
                  onClick={() => setIsDrawerOpen((open) => !open)}
                >
                  {isDrawerOpen ? <XIcon className="size-5" /> : <PlusIcon className="size-5" />}
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
                        disabled={!canCompose}
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
          </fieldset>

          {isDrawerOpen ? (
            <div
              id={drawerId}
              role="region"
              aria-label={t("workbench.chat.composer.drawer")}
              className="animate-in fade-in slide-in-from-top-1 flex min-h-14 items-center justify-between gap-3 overflow-x-auto border-t px-5 py-2 duration-150"
            >
              <SlotHost
                name="composer.drawer.left"
                context={drawerContext}
                className="flex min-w-0 flex-1 items-center gap-2"
              />
              <fieldset
                disabled={!canCompose}
                className={cn(
                  "ms-auto flex shrink-0 items-center gap-1.5 transition-opacity",
                  showDisabledAppearance
                    ? "opacity-60"
                    : !canCompose && "[&_:disabled]:opacity-100",
                )}
              >
                <ComposerDrawerStats contextCount={contextCount}>
                  <SlotHost
                    name="composer.drawer.right"
                    context={drawerContext}
                    className="flex shrink-0 items-center gap-1.5"
                  />
                </ComposerDrawerStats>
              </fieldset>
            </div>
          ) : null}
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>

      <SlotHost name="composer.after" context={context} className="flex flex-col gap-2" />
    </div>
  );
}
