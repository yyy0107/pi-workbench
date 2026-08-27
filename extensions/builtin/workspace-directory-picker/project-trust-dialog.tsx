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
  onCancel,
  onConfirm,
  onDecline,
}: {
  error?: ProjectTrustDialogError;
  open: boolean;
  path: string;
  savingDecision?: "trust" | "decline";
  onCancel(): void;
  onConfirm(): void | Promise<void>;
  onDecline(): void | Promise<void>;
}) {
  const { t } = useI18n();
  const saving = savingDecision !== undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onCancel();
      }}
    >
      <DialogContent
        closeLabel={t("extensions.workspaceDirectory.trustCancel")}
        showCloseButton={!saving}
        className={cn(
          paper,
          "gap-5 rounded-3xl p-6 sm:max-w-lg [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4",
        )}
      >
        <DialogHeader className="gap-3 pe-10">
          <DialogTitle className="text-xl leading-7 font-semibold tracking-tight">
            {t("extensions.workspaceDirectory.trustQuestion")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-[15px] leading-7">
            {t("extensions.workspaceDirectory.trustDescription")}
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
            {t(
              error === "save"
                ? "extensions.workspaceDirectory.trustSaveError"
                : "extensions.workspaceDirectory.selectError",
            )}
          </p>
        ) : null}

        <div className="flex flex-col gap-4 border-t border-foreground/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground inline-flex items-center gap-2 text-xs font-medium">
            <ShieldCheckIcon aria-hidden="true" className="size-4 text-emerald-500" />
            {t("extensions.workspaceDirectory.trustSecurityDecision")}
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
              {t(
                savingDecision === "decline"
                  ? "extensions.workspaceDirectory.trustSaving"
                  : "extensions.workspaceDirectory.trustDecline",
              )}
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
              {t(
                savingDecision === "trust"
                  ? "extensions.workspaceDirectory.trustSaving"
                  : "extensions.workspaceDirectory.trustAccept",
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
