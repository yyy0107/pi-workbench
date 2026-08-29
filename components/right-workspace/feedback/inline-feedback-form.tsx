"use client";

import { MessageSquarePlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        title={label}
        className="text-muted-foreground shrink-0 hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlusIcon />
      </Button>
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
      <Textarea
        autoFocus
        rows={3}
        value={text}
        aria-label={t("rightWorkspace.feedback.placeholder")}
        placeholder={t("rightWorkspace.feedback.placeholder")}
        className="min-h-20 resize-none text-xs"
        onChange={(event) => updateText(event.currentTarget.value)}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => {
            setOpen(false);
            clearDraft();
          }}
        >
          {t("rightWorkspace.feedback.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={!text.trim()} className="text-xs">
          {t("rightWorkspace.feedback.save")}
        </Button>
      </div>
    </form>
  );
}
