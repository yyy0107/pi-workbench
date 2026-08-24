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
  saving,
  onCancel,
  onDecision,
}: {
  error?: ProjectTrustDialogError;
  open: boolean;
  path: string;
  saving: boolean;
  onCancel(): void;
  onDecision(trusted: boolean): void | Promise<void>;
}) {
  const { t } = useI18n();

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
        className={cn(paper, "max-w-sm gap-3 rounded-[20px] p-4")}
      >
        <DialogHeader className="gap-2 pe-7">
          <DialogTitle className="text-sm font-medium">
            {t("extensions.workspaceDirectory.trustQuestion")}
          </DialogTitle>
          <DialogDescription className="text-foreground/55 text-[13px] leading-relaxed">
            {t("extensions.workspaceDirectory.trustDescription")}
          </DialogDescription>
        </DialogHeader>

        <code
          className="bg-foreground/[0.06] text-foreground/70 block max-h-16 overflow-auto rounded-md px-2 py-1.5 font-mono text-[11px] leading-4 break-all"
          title={path}
        >
          {path}
        </code>

        {error ? (
          <p role="alert" className="text-destructive text-xs leading-4">
            {t(
              error === "save"
                ? "extensions.workspaceDirectory.trustSaveError"
                : "extensions.workspaceDirectory.selectError",
            )}
          </p>
        ) : null}

        <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
          <span className="text-foreground/45 me-auto inline-flex items-center gap-1.5 text-[11px]">
            <ShieldCheckIcon aria-hidden="true" className="size-3.5 text-emerald-500" />
            {t("extensions.workspaceDirectory.trustSecurityDecision")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            className="rounded-full px-3.5 transition-colors active:translate-y-0!"
            onClick={() => void onDecision(false)}
          >
            {t("extensions.workspaceDirectory.trustDecline")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            className="rounded-full px-3.5 transition-colors active:translate-y-0!"
            onClick={() => void onDecision(true)}
          >
            {saving ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : null}
            {t(
              saving
                ? "extensions.workspaceDirectory.trustSaving"
                : "extensions.workspaceDirectory.trustAccept",
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
