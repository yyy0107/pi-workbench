"use client";

import { MessageSquarePlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/i18n";

import type { WorkspaceSurfaceInstance } from "../core/surface-types";
import { useWorkspaceContext, useWorkspaceFeedbackStore } from "../workspace-context";
import type { WorkspaceFeedbackKind } from "./feedback-types";

const FEEDBACK_DRAFT_STORAGE_PREFIX = "pi-workbench:right-workspace-feedback-draft:v1";

function feedbackDraftStorageKey(
  surfaceId: string,
  kind: WorkspaceFeedbackKind,
  target: Record<string, unknown>,
): string {
  const stableTarget = JSON.stringify(
    Object.entries(target).sort(([left], [right]) => left.localeCompare(right)),
  );
  return `${FEEDBACK_DRAFT_STORAGE_PREFIX}:${surfaceId}:${kind}:${stableTarget}`;
}

function readFeedbackDraft(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeFeedbackDraft(key: string, value: string): void {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Draft persistence is best effort; the in-memory form remains usable.
  }
}

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
  const draftKey = useMemo(
    () => feedbackDraftStorageKey(surface.id, kind, target),
    [kind, surface.id, target],
  );

  useEffect(() => {
    const draft = readFeedbackDraft(draftKey);
    setText(draft);
    setOpen(Boolean(draft));
  }, [draftKey]);

  const updateText = (value: string) => {
    setText(value);
    writeFeedbackDraft(draftKey, value);
  };
  const clearDraft = () => {
    writeFeedbackDraft(draftKey, "");
    setText("");
  };

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
        clearDraft();
        setOpen(false);
      }}
    >
      <textarea
        autoFocus
        rows={3}
        value={text}
        aria-label={t("rightWorkspace.feedback.placeholder")}
        placeholder={t("rightWorkspace.feedback.placeholder")}
        className="bg-muted/35 min-h-20 w-full resize-none rounded-lg border px-2.5 py-2 text-xs outline-none"
        onChange={(event) => updateText(event.currentTarget.value)}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="hover:bg-muted h-7 rounded-lg px-2.5 text-xs"
          onClick={() => {
            setOpen(false);
            clearDraft();
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
