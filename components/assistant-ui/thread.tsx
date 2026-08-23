"use client";

import {
  BotIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  LoaderIcon,
  PencilIcon,
  RefreshCwIcon,
} from "lucide-react";
import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useComposerInput,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  Composer,
  ComposerActions,
  ComposerAttachButton,
  ComposerBar,
  ComposerInput,
  ComposerSend,
  ComposerToolbar,
} from "@/components/elements/composer";
import { ComposerAttachments, UserMessageAttachments } from "@/components/assistant-ui/attachment";
import { ModelSelector, type ModelOption } from "@/components/assistant-ui/model-selector";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const MODELS: readonly ModelOption[] = [
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    keywords: ["openai"],
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    keywords: ["openai"],
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    keywords: ["openai"],
    efforts: true,
  },
];
export function Thread() {
  return (
    <ThreadPrimitive.Root
      className="flex h-full flex-col bg-background text-base"
      style={
        {
          "--thread-max-width": "48rem",
          "--accent-color": "#10a37f",
          "--accent-foreground": "#ffffff",
        } as React.CSSProperties
      }
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            EditComposer,
            AssistantMessage,
          }}
        />

        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-4 overflow-visible rounded-t-3xl bg-background pb-4">
          <ThreadComposer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
function ThreadWelcome() {
  const { t } = useI18n();

  return (
    <div className="mx-auto my-auto flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col">
      <div className="flex w-full flex-grow flex-col items-center justify-center">
        <div className="flex size-full flex-col justify-center px-8">
          <div className="text-2xl font-semibold">{t("assistant.thread.greeting")}</div>
          <div className="text-2xl text-muted-foreground/65">{t("assistant.thread.help")}</div>
        </div>
      </div>
    </div>
  );
}

function ThreadComposer() {
  const { t } = useI18n();
  const aui = useAui();
  const { value, setText, send } = unstable_useComposerInput();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composer = aui.thread.composer();
  const models = MODELS.map((model) => ({
    ...model,
    description:
      model.id === "gpt-5.6-luna"
        ? t("assistant.model.fast")
        : model.id === "gpt-5.6-terra"
          ? t("assistant.model.balanced")
          : t("assistant.model.capable"),
  }));

  return (
    <Composer className="w-full max-w-[var(--thread-max-width)]">
      <ComposerBar>
        <ComposerAttachments />
        <ComposerInput
          value={value}
          placeholder={t("assistant.composer.placeholder")}
          onChange={(event) => setText(event.target.value)}
          onSubmit={() => send()}
        />
        <ComposerToolbar>
          <ComposerActions>
            <ComposerAttachButton
              label={t("assistant.composer.addAttachment")}
              onClick={() => fileInputRef.current?.click()}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const files = event.target.files;
                if (files) {
                  for (const file of Array.from(files)) {
                    void composer.addAttachment(file);
                  }
                }
                event.target.value = "";
              }}
            />
          </ComposerActions>
          <ComposerActions>
            <ModelSelector
              models={models}
              defaultValue={models[0]!.id}
              defaultEffort="medium"
              variant="muted"
              size="sm"
            />
            <ComposerSend
              streaming={isRunning}
              idle={!value}
              sendLabel={t("assistant.composer.sendMessage")}
              stopLabel={t("assistant.composer.stopGenerating")}
              onClick={() => {
                if (isRunning) {
                  composer.cancel();
                } else {
                  send();
                }
              }}
            />
          </ComposerActions>
        </ComposerToolbar>
      </ComposerBar>
    </Composer>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root
      className="mx-auto grid w-full max-w-[var(--thread-max-width)] auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-4 fade-in slide-in-from-bottom-1 animate-in duration-150"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="relative col-start-2 min-w-0">
        <div className="rounded-3xl bg-muted px-4 py-2.5 break-words text-foreground">
          <MessagePrimitive.Parts />
        </div>
        <div className="absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker className="col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
}

function UserActionBar() {
  const { t } = useI18n();

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit
        render={<TooltipIconButton tooltip={t("assistant.actions.edit")} className="p-4" />}
      >
        <PencilIcon />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
}

function EditComposer() {
  const { t } = useI18n();

  return (
    <MessagePrimitive.Root className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col px-2 py-3">
      <ComposerPrimitive.Root className="ml-auto flex w-full max-w-[85%] flex-col gap-2 rounded-3xl bg-muted p-2.5">
        <ComposerAttachments />
        <ComposerPrimitive.Input
          className="min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel render={<Button variant="ghost" size="sm" />}>
            {t("assistant.common.cancel")}
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button size="sm" />}>
            {t("assistant.common.update")}
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const { t } = useI18n();

  return (
    <MessagePrimitive.Root
      className="relative mx-auto w-full max-w-[var(--thread-max-width)] py-4 fade-in slide-in-from-bottom-1 animate-in duration-150"
      data-role="assistant"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <BotIcon className="size-4" />
      </div>
      <div className="break-words px-2 leading-relaxed text-foreground">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            tools: { Fallback: ToolFallback },
          }}
        />
        <MessageError />
        <AuiIf condition={(s) => s.thread.isRunning && s.message.content.length === 0}>
          <div className="flex items-center gap-2 text-muted-foreground">
            <LoaderIcon className="size-4 animate-spin" />
            <span className="text-sm">{t("assistant.thread.thinking")}</span>
          </div>
        </AuiIf>
      </div>

      <div className="mt-1 ml-2 flex min-h-6 items-center">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
}

function MessageError() {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
}

function AssistantActionBar() {
  const { t } = useI18n();

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="-ml-1 flex gap-1 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip={t("assistant.actions.copy")} />}>
        <AuiIf condition={(s) => s.message.isCopied}>
          <CheckIcon />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon />
        </AuiIf>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload
        render={<TooltipIconButton tooltip={t("assistant.actions.refresh")} />}
      >
        <RefreshCwIcon />
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
}

function BranchPicker({ className, ...rest }: { className?: string }) {
  const { t } = useI18n();

  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn("mr-2 -ml-2 inline-flex items-center text-xs text-muted-foreground", className)}
      {...rest}
    >
      <BranchPickerPrimitive.Previous
        render={<TooltipIconButton tooltip={t("assistant.branch.previous")} />}
      >
        <ChevronLeftIcon />
      </BranchPickerPrimitive.Previous>
      <span className="font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next
        render={<TooltipIconButton tooltip={t("assistant.branch.next")} />}
      >
        <ChevronRightIcon />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
}
