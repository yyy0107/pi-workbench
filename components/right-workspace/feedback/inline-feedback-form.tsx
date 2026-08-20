"use client";

import { MessageSquarePlusIcon } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/i18n";

import type { WorkspaceSurfaceInstance } from "../core/surface-types";
import { useWorkspaceContext, useWorkspaceFeedbackStore } from "../workspace-context";
import type { WorkspaceFeedbackKind } from "./feedback-types";

export function InlineFeedbackForm({
  surface,
  kind,
  target,
  label,
}: Readonly<{
  surface: WorkspaceSurfaceInstance;
  kind: WorkspaceFeedbackKind;
  target: Record<string, unknown>;
  label: string;
}>) {
  const { t } = useI18n();
  const context = useWorkspaceContext();
  const feedback = useWorkspaceFeedbackStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlusIcon className="size-3.5" />
      </button>
    );
  }

  return (
    <form
      className="bg-background absolute inset-x-2 z-20 mt-1 rounded-xl border p-2 shadow-lg"
      onSubmit={(event) => {
        event.preventDefault();
        const normalized = text.trim();
        if (!normalized) return;
        feedback.add({
          surfaceId: surface.id,
          kind,
          target,
          text: normalized,
          scope: surface.scope,
          ...(context.threadId ? { threadId: context.threadId } : {}),
        });
        setText("");
        setOpen(false);
      }}
    >
      <textarea
        autoFocus
        rows={3}
        value={text}
        aria-label={t("rightWorkspace.feedback.placeholder")}
        placeholder={t("rightWorkspace.feedback.placeholder")}
        className="bg-muted/35 min-h-20 w-full resize-none rounded-lg border px-2.5 py-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="hover:bg-muted h-7 rounded-lg px-2.5 text-xs"
          onClick={() => {
            setOpen(false);
            setText("");
          }}
        >
          {t("rightWorkspace.feedback.cancel")}
        </button>
        <button
          type="submit"
          disabled={!text.trim()}
          className="bg-primary text-primary-foreground h-7 rounded-lg px-2.5 text-xs disabled:opacity-50"
        >
          {t("rightWorkspace.feedback.save")}
        </button>
      </div>
    </form>
  );
}
