"use client";

import { ArrowUpIcon, FolderIcon, LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@workbench/shell/ui";
import { useI18n } from "@workbench/shell/i18n";
import { cn } from "@workbench/shell/utils";
import type { WorkbenchRuntimeHostCapability } from "@workbench/agent-runtime-client";
import type { WorkbenchHostDirectoryListing } from "@workbench/host-contracts/runtime-capabilities";
import styles from "./directory-picker.module.css";

type PickerError = "browse" | "select";

export function RemoteDirectoryPickerDialog({
  hostClient,
  open,
  onOpenChange,
  onSelectPath,
}: {
  hostClient: WorkbenchRuntimeHostCapability;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelectPath(path: string): void | Promise<void>;
}) {
  const { t } = useI18n();
  const requestId = useRef(0);
  const [listing, setListing] = useState<WorkbenchHostDirectoryListing | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<PickerError | null>(null);

  const navigateTo = useCallback(
    async (path?: string) => {
      const nextRequestId = ++requestId.current;
      setLoading(true);
      setError(null);

      try {
        const nextListing = await hostClient.listDirectory(path);
        if (requestId.current !== nextRequestId) return;
        setListing(nextListing);
        setPathInput(nextListing.path);
      } catch {
        if (requestId.current === nextRequestId) setError("browse");
      } finally {
        if (requestId.current === nextRequestId) setLoading(false);
      }
    },
    [hostClient],
  );

  useEffect(() => {
    if (!open) return;
    setListing(null);
    setPathInput("");
    setError(null);
    void navigateTo();

    return () => {
      requestId.current++;
    };
  }, [navigateTo, open]);

  const selectCurrentDirectory = async () => {
    if (!listing || pathInput.trim() !== listing.path || loading || selecting) return;

    setSelecting(true);
    setError(null);
    try {
      await onSelectPath(listing.path);
      onOpenChange(false);
    } catch {
      setError("select");
    } finally {
      setSelecting(false);
    }
  };

  const parentCrumb = listing?.crumbs.at(-2);
  const canSelect = Boolean(listing) && pathInput.trim() === listing?.path && !loading;
  const errorMessage =
    error === "browse"
      ? t("extensions.workspaceDirectory.browseError")
      : error === "select"
        ? t("extensions.workspaceDirectory.selectError")
        : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!selecting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        closeLabel={t("extensions.workspaceDirectory.close")}
        showCloseButton={false}
        data-workspace-directory-picker=""
        className={cn(styles.dialog, styles.remote, "flex flex-col gap-3 overflow-hidden")}
      >
        <DialogHeader>
          <DialogTitle>{t("extensions.workspaceDirectory.sourceFolder")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("extensions.workspaceDirectory.selectDescription")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const candidate = pathInput.trim();
            if (candidate && !loading && !selecting) void navigateTo(candidate);
          }}
        >
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t("extensions.workspaceDirectory.parent")}
            disabled={loading || selecting || !parentCrumb}
            onClick={() => void navigateTo(parentCrumb?.path)}
          >
            <ArrowUpIcon aria-hidden="true" />
          </Button>
          <Input
            value={pathInput}
            aria-label={t("extensions.workspaceDirectory.path")}
            placeholder={t("extensions.workspaceDirectory.pathPlaceholder")}
            autoComplete="off"
            enterKeyHint="go"
            spellCheck={false}
            disabled={selecting}
            onChange={(event) => {
              setPathInput(event.target.value);
              setError(null);
            }}
          />
        </form>

        <div
          aria-busy={loading}
          className="min-h-0 flex-1 overflow-y-auto rounded-[var(--input-control-radius)] border border-border bg-background p-1"
        >
          {loading ? (
            <div
              role="status"
              className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"
            >
              <LoaderCircleIcon
                aria-hidden="true"
                className="size-[var(--icon-size-md)] animate-spin"
              />
              {t("extensions.workspaceDirectory.loading")}
            </div>
          ) : listing?.entries.length ? (
            <div className="flex flex-col">
              {listing.entries.map((entry) => (
                <Button
                  key={entry.path}
                  type="button"
                  variant="ghost"
                  disabled={selecting}
                  className="w-full justify-start gap-3 px-3 text-start font-normal"
                  onClick={() => void navigateTo(entry.path)}
                >
                  <FolderIcon aria-hidden="true" className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </Button>
              ))}
            </div>
          ) : listing ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {t("extensions.workspaceDirectory.empty")}
            </p>
          ) : null}
          {listing?.truncated ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {t("extensions.workspaceDirectory.truncated")}
            </p>
          ) : null}
          {errorMessage ? (
            <p role="alert" className="px-3 py-3 text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <DialogFooter
          closeLabel={t("extensions.workspaceDirectory.cancel")}
          className="m-0 flex-row justify-end gap-4 border-0 bg-transparent p-0 pt-6"
        >
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground"
            disabled={selecting}
            onClick={() => onOpenChange(false)}
          >
            {t("extensions.workspaceDirectory.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void selectCurrentDirectory()}
            disabled={!canSelect || selecting}
          >
            {selecting
              ? t("extensions.workspaceDirectory.selecting")
              : t("extensions.workspaceDirectory.selectCurrent")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
