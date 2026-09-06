"use client";

import { FolderIcon, LoaderCircleIcon, ShieldIcon } from "lucide-react";

import { paper } from "./surface";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";
import { cn } from "../utils";

export type ProjectTrustDialogError = "save" | "select";

export interface ProjectTrustDialogCopy {
  readonly accept: string;
  readonly cancel: string;
  readonly decline: string;
  readonly description: string;
  readonly question: string;
  readonly saveError: string;
  readonly saving: string;
  readonly securityDecision: string;
  readonly selectError: string;
}

export function ProjectTrustDialog({
  copy,
  error,
  open,
  path,
  savingDecision,
  onCancel,
  onConfirm,
  onDecline,
}: {
  copy: ProjectTrustDialogCopy;
  error?: ProjectTrustDialogError;
  open: boolean;
  path: string;
  savingDecision?: "trust" | "decline";
  onCancel(): void;
  onConfirm(): void | Promise<void>;
  onDecline(): void | Promise<void>;
}) {
  const saving = savingDecision !== undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onCancel();
      }}
    >
      <DialogContent
        closeLabel={copy.cancel}
        showCloseButton={!saving}
        className={cn(paper, "gap-5 rounded-xl p-6 text-foreground sm:max-w-md")}
      >
        <DialogHeader className="gap-2 pe-6">
          <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ShieldIcon aria-hidden="true" className="size-[var(--icon-size-md)]" />
            {copy.securityDecision}
          </span>
          <DialogTitle className="text-lg leading-snug font-semibold">{copy.question}</DialogTitle>
        </DialogHeader>

        <div className="flex min-w-0 items-start gap-3 rounded-lg border border-border bg-muted/50 p-3">
          <FolderIcon
            aria-hidden="true"
            className="mt-0.5 size-[var(--icon-size-md)] shrink-0 text-muted-foreground"
          />
          <code className="min-w-0 max-h-24 overflow-auto font-mono text-sm leading-5 [overflow-wrap:anywhere]">
            {path}
          </code>
        </div>

        <DialogDescription className="leading-relaxed">{copy.description}</DialogDescription>

        {error ? (
          <p role="alert" className="text-destructive text-sm leading-5">
            {error === "save" ? copy.saveError : copy.selectError}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={saving}
            aria-busy={savingDecision === "decline"}
            className="px-4"
            onClick={() => void onDecline()}
          >
            {savingDecision === "decline" ? (
              <LoaderCircleIcon
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {savingDecision === "decline" ? copy.saving : copy.decline}
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={saving}
            aria-busy={savingDecision === "trust"}
            className="px-4"
            onClick={() => void onConfirm()}
          >
            {savingDecision === "trust" ? (
              <LoaderCircleIcon
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {savingDecision === "trust" ? copy.saving : copy.accept}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
