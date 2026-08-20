"use client";

import { MessageSquareTextIcon, XIcon } from "lucide-react";

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
          className="bg-muted text-muted-foreground inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg px-2 text-[11px]"
        >
          <MessageSquareTextIcon className="size-3 shrink-0" />
          <span className="max-w-56 truncate">{item.text}</span>
          <button
            type="button"
            aria-label={t("rightWorkspace.feedback.remove")}
            title={t("rightWorkspace.feedback.remove")}
            className="hover:text-foreground -me-0.5 rounded p-0.5"
            onClick={() => store.remove(item.id)}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
