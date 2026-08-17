"use client";

import { ActionBarPrimitive, AuiIf, BranchPickerPrimitive, useAuiState } from "@assistant-ui/react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions";

function BranchPicker() {
  const { t } = useI18n();

  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className="text-muted-foreground me-1 inline-flex items-center text-xs"
    >
      <BranchPickerPrimitive.Previous
        render={<TooltipIconButton tooltip={t("workbench.chat.actions.previousResponse")} />}
      >
        <ChevronLeftIcon className="size-3.5" />
      </BranchPickerPrimitive.Previous>
      <span className="px-1 font-medium tabular-nums">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next
        render={<TooltipIconButton tooltip={t("workbench.chat.actions.nextResponse")} />}
      >
        <ChevronRightIcon className="size-3.5" />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
}

function UserActions() {
  const { t } = useI18n();

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center gap-0.5"
    >
      <ActionBarPrimitive.Edit
        render={<TooltipIconButton tooltip={t("workbench.chat.actions.editMessage")} />}
      >
        <PencilIcon className="size-3.5" />
      </ActionBarPrimitive.Edit>
      <ActionBarPrimitive.Copy
        render={<TooltipIconButton tooltip={t("workbench.chat.actions.copyMessage")} />}
      >
        <CopyIcon className="size-3.5" />
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
}

function AssistantActions() {
  const { t } = useI18n();

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center gap-0.5"
    >
      <ActionBarPrimitive.Copy
        render={<TooltipIconButton tooltip={t("workbench.chat.actions.copyResponse")} />}
      >
        <AuiIf condition={(state) => state.message.isCopied}>
          <CheckIcon className="size-3.5" />
        </AuiIf>
        <AuiIf condition={(state) => !state.message.isCopied}>
          <CopyIcon className="size-3.5" />
        </AuiIf>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.ExportMarkdown
        render={<TooltipIconButton tooltip={t("workbench.chat.actions.exportMarkdown")} />}
      >
        <DownloadIcon className="size-3.5" />
      </ActionBarPrimitive.ExportMarkdown>
      <ActionBarPrimitive.Reload
        render={<TooltipIconButton tooltip={t("workbench.chat.actions.regenerateResponse")} />}
      >
        <RefreshCwIcon className="size-3.5" />
      </ActionBarPrimitive.Reload>
      <ActionBarPrimitive.FeedbackPositive
        render={<TooltipIconButton tooltip={t("workbench.chat.actions.goodResponse")} />}
      >
        <ThumbsUpIcon className="size-3.5" />
      </ActionBarPrimitive.FeedbackPositive>
      <ActionBarPrimitive.FeedbackNegative
        render={<TooltipIconButton tooltip={t("workbench.chat.actions.poorResponse")} />}
      >
        <ThumbsDownIcon className="size-3.5" />
      </ActionBarPrimitive.FeedbackNegative>
    </ActionBarPrimitive.Root>
  );
}

export function WorkbenchMessageActions() {
  const messageId = useAuiState((state) => state.message.id);
  const role = useAuiState((state) => state.message.role);
  const isLast = useAuiState((state) => state.message.isLast);
  const context = { messageId, role, isLast };

  return (
    <div className="text-muted-foreground flex min-h-7 flex-wrap items-center gap-1">
      <BranchPicker />
      {role === "user" ? <UserActions /> : null}
      {role === "assistant" ? <AssistantActions /> : null}
      <SlotHost name="message.actions" context={context} className="flex items-center gap-1" />
    </div>
  );
}
