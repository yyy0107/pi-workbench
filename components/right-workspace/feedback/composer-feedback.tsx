"use client";

import { MessageSquareTextIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

import {
  useWorkspaceContext,
  useWorkspaceFeedbackState,
  useWorkspaceFeedbackStore,
} from "../workspace-context";

export function ComposerWorkspaceFeedback() {
  const { t } = useI18n();
  const context = useWorkspaceContext();
  const store = useWorkspaceFeedbackStore();
  const feedback = useWorkspaceFeedbackState(() => store.forContext(context));

  if (feedback.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-1.5 px-3 pt-1"
      aria-label={t("rightWorkspace.feedback.title")}
    >
      {feedback.map((item) => (
        <span
          key={item.id}
          className="bg-muted text-muted-foreground inline-flex min-h-[var(--button-height-default)] max-w-full items-center gap-1.5 rounded-lg px-2 text-[11px]"
        >
          <MessageSquareTextIcon className="size-3 shrink-0" />
          <span className="max-w-56 truncate">{item.text}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("rightWorkspace.feedback.remove")}
            title={t("rightWorkspace.feedback.remove")}
            className="-me-1 hover:text-foreground"
            onClick={() => store.remove(item.id)}
          >
            <XIcon />
          </Button>
        </span>
      ))}
    </div>
  );
}
