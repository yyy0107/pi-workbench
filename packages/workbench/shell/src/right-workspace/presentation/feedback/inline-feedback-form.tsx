"use client";

import { MessageSquarePlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "../../../ui/button";
import { Textarea } from "../../../ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "../../../ui/popover";
import { useI18n } from "../../../i18n";
import type { WorkspaceSurfaceInstance } from "@workbench/extension-sdk";
import type {
  WorkspaceDraftStore,
  WorkspaceFeedbackDraft,
  WorkspaceFeedbackKind,
} from "../../../right-workspace";
import {
  useWorkspaceContext,
  useWorkspaceDraftStore,
  useWorkspaceFeedbackStore,
} from "../../../right-workspace-react";

const FEEDBACK_DRAFT_STORAGE_PREFIX = "workbench:right-workspace-feedback-draft:v2";

function feedbackDraftStorageKey(
  prefix: string,
  surfaceId: string,
  kind: WorkspaceFeedbackKind,
  target: Record<string, unknown>,
): string {
  const stableTarget = JSON.stringify(
    Object.entries(target).sort(([left], [right]) => left.localeCompare(right)),
  );
  return `${prefix}:${surfaceId}:${kind}:${stableTarget}`;
}

function readFeedbackDraft(drafts: WorkspaceDraftStore, key: string): string {
  try {
    return drafts.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeFeedbackDraft(drafts: WorkspaceDraftStore, key: string, value: string): void {
  try {
    if (value) drafts.setItem(key, value);
    else drafts.removeItem(key);
  } catch {
    // Draft persistence is best effort; the in-memory form remains usable.
  }
}

export function InlineFeedbackForm({
  surface,
  kind,
  target,
  label,
  children,
  prepare,
  prepareError,
}: Readonly<{
  surface: WorkspaceSurfaceInstance;
  kind: WorkspaceFeedbackKind;
  target: Record<string, unknown>;
  label: string;
  children?: ReactNode;
  prepare?: () => Promise<Partial<Pick<WorkspaceFeedbackDraft, "target" | "images">>>;
  prepareError?: string;
}>) {
  const { t } = useI18n();
  const context = useWorkspaceContext();
  const drafts = useWorkspaceDraftStore();
  const feedback = useWorkspaceFeedbackStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const saving = useRef(false);
  const draftKey = useMemo(
    () => feedbackDraftStorageKey(FEEDBACK_DRAFT_STORAGE_PREFIX, surface.id, kind, target),
    [kind, surface.id, target],
  );

  useEffect(() => {
    generation.current += 1;
    saving.current = false;
    setPending(false);
    setFailed(false);
    const draft = readFeedbackDraft(drafts, draftKey);
    setText(draft);
    setOpen(Boolean(draft));
    return () => {
      generation.current += 1;
    };
  }, [draftKey, drafts]);

  const updateText = (value: string) => {
    setText(value);
    writeFeedbackDraft(drafts, draftKey, value);
  };
  const clearDraft = () => {
    writeFeedbackDraft(drafts, draftKey, "");
    setText("");
  };

  const submit = async () => {
    const normalized = text.trim();
    if (!normalized || saving.current) return;
    const submittedGeneration = generation.current;
    saving.current = true;
    setPending(true);
    setFailed(false);
    try {
      const prepared = await prepare?.();
      if (submittedGeneration !== generation.current) return;
      feedback.add({
        surfaceId: surface.id,
        kind,
        target,
        text: normalized,
        scope: surface.scope,
        ...(context.threadId ? { threadId: context.threadId } : {}),
        ...prepared,
      });
      clearDraft();
      setOpen(false);
    } catch {
      if (submittedGeneration === generation.current) setFailed(true);
    } finally {
      if (submittedGeneration === generation.current) {
        saving.current = false;
        setPending(false);
      }
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            className="text-muted-foreground shrink-0 hover:text-foreground"
          />
        }
      >
        <MessageSquarePlusIcon />
      </PopoverTrigger>
      <PopoverContent align="end" side="top" aria-label={label}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          aria-busy={pending}
        >
          <Textarea
            autoFocus
            rows={3}
            value={text}
            disabled={pending}
            aria-label={t("rightWorkspace.feedback.placeholder")}
            placeholder={t("rightWorkspace.feedback.placeholder")}
            className="min-h-20 resize-none text-xs"
            onChange={(event) => updateText(event.currentTarget.value)}
          />
          {children}
          {failed ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {prepareError ?? t("rightWorkspace.feedback.saveFailed")}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                clearDraft();
              }}
            >
              {t("rightWorkspace.feedback.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={pending || !text.trim()} className="text-xs">
              {t(pending ? "rightWorkspace.feedback.saving" : "rightWorkspace.feedback.save")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
