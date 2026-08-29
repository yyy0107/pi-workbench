"use client";

import { LoaderCircleIcon, ShieldCheckIcon } from "lucide-react";

import { paper } from "@/components/elements/surfaces";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type ProjectTrustDialogError = "save" | "select";

export function ProjectTrustDialog({
  error,
  open,
  path,
  savingDecision,
  variant = "project",
  onCancel,
  onConfirm,
  onDecline,
}: {
  error?: ProjectTrustDialogError;
  open: boolean;
  path: string;
  savingDecision?: "trust" | "decline";
  variant?: "project" | "workflow";
  onCancel(): void;
  onConfirm(): void | Promise<void>;
  onDecline(): void | Promise<void>;
}) {
  const { t } = useI18n();
  const saving = savingDecision !== undefined;
  const copy =
    variant === "workflow"
      ? {
          question: t("extensions.workflows.trust.question"),
          description: t("extensions.workflows.trust.description"),
          securityDecision: t("extensions.workflows.trust.securityDecision"),
          accept: t("extensions.workflows.trust.accept"),
          decline: t("extensions.workflows.trust.decline"),
          saving: t("extensions.workflows.trust.saving"),
          cancel: t("extensions.workflows.trust.cancel"),
          saveError: t("extensions.workflows.trust.saveError"),
        }
      : {
          question: t("extensions.workspaceDirectory.trustQuestion"),
          description: t("extensions.workspaceDirectory.trustDescription"),
          securityDecision: t("extensions.workspaceDirectory.trustSecurityDecision"),
          accept: t("extensions.workspaceDirectory.trustAccept"),
          decline: t("extensions.workspaceDirectory.trustDecline"),
          saving: t("extensions.workspaceDirectory.trustSaving"),
          cancel: t("extensions.workspaceDirectory.trustCancel"),
          saveError: t("extensions.workspaceDirectory.trustSaveError"),
        };

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
            {error === "save" ? copy.saveError : t("extensions.workspaceDirectory.selectError")}
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
