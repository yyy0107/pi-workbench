"use client";

import { LoaderCircleIcon, ShieldCheckIcon } from "lucide-react";

import { paper } from "../elements/surfaces";
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
        className={cn(
          paper,
          "gap-5 rounded-3xl p-6 sm:max-w-lg [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4",
        )}
      >
        <DialogHeader className="gap-3 pe-10">
          <DialogTitle className="text-xl leading-7 font-semibold tracking-tight">
            {copy.question}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-[15px] leading-7">
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        <code
          className="bg-foreground/[0.05] text-foreground/80 block max-h-24 overflow-auto rounded-xl border border-foreground/8 px-3 py-2.5 font-mono text-sm leading-5 [overflow-wrap:anywhere]"
          title={path}
        >
          {path}
        </code>

        {error ? (
          <p role="alert" className="text-destructive text-sm leading-5">
            {error === "save" ? copy.saveError : copy.selectError}
          </p>
        ) : null}

        <div className="flex flex-col gap-4 border-t border-foreground/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground inline-flex items-center gap-2 text-xs font-medium">
            <ShieldCheckIcon aria-hidden="true" className="size-4 text-emerald-500" />
            {copy.securityDecision}
          </span>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={saving}
              aria-busy={savingDecision === "decline"}
              className="rounded-xl px-4 transition-colors active:translate-y-0!"
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
              className="rounded-xl px-5 transition-colors active:translate-y-0!"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
