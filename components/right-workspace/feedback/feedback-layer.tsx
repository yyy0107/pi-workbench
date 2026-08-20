"use client";

import { MessageSquareTextIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/i18n";

import {
  useRightWorkspaceState,
  useWorkspaceFeedbackState,
  useWorkspaceFeedbackStore,
} from "../workspace-context";

export function WorkspaceFeedbackLayer() {
  const { t } = useI18n();
  const activeSurfaceId = useRightWorkspaceState((state) => state.activeSurfaceId);
  const feedbackStore = useWorkspaceFeedbackStore();
  const feedback = useWorkspaceFeedbackState((snapshot) =>
    snapshot.feedback.filter((item) => item.surfaceId === activeSurfaceId),
  );
  const [expanded, setExpanded] = useState(false);

  if (feedback.length === 0) return null;

  return (
    <aside
      aria-label={t("rightWorkspace.feedback.title")}
      className="bg-background/95 absolute inset-x-2 bottom-2 z-30 overflow-hidden rounded-xl border shadow-lg backdrop-blur"
    >
      <button
        type="button"
        aria-expanded={expanded}
        className="hover:bg-muted/45 flex h-9 w-full items-center gap-2 px-3 text-left text-xs"
        onClick={() => setExpanded((value) => !value)}
      >
        <MessageSquareTextIcon className="size-3.5" />
        <span className="font-medium">
          {t("rightWorkspace.feedback.pending", { count: feedback.length })}
        </span>
        <span className="text-muted-foreground ms-auto truncate">
          {t("rightWorkspace.feedback.composerHint")}
        </span>
      </button>
      {expanded ? (
        <div className="max-h-48 space-y-1 overflow-y-auto border-t p-2">
          {feedback.map((item) => (
            <div
              key={item.id}
              className="bg-muted/35 flex items-start gap-2 rounded-lg p-2 text-xs"
            >
              <p className="min-w-0 flex-1 whitespace-pre-wrap">{item.text}</p>
              <button
                type="button"
                aria-label={t("rightWorkspace.feedback.remove")}
                title={t("rightWorkspace.feedback.remove")}
                className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
                onClick={() => feedbackStore.remove(item.id)}
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
