"use client";

import {
  ArrowUpIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  HomeIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import {
  createPiHostDirectory,
  listPiHostDirectory,
} from "@/workbench/runtime-contributions/pi/client/host";
import type { HostDirectoryListing } from "@/workbench/runtime-contributions/pi/protocol/rpc";

type PickerError = "browse" | "create" | "select";

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1") return true;

  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

export function shouldUseNativeDirectoryPicker(): boolean {
  return typeof window === "undefined" || isLoopbackHostname(window.location.hostname);
}

export function RemoteDirectoryPickerDialog({
  open,
  onOpenChange,
  onSelectPath,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelectPath(path: string): void | Promise<void>;
}) {
  const { t } = useI18n();
  const requestId = useRef(0);
  const [listing, setListing] = useState<HostDirectoryListing | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [newDirectoryName, setNewDirectoryName] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<PickerError | null>(null);

  const navigateTo = useCallback(async (path?: string) => {
    const nextRequestId = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const nextListing = await listPiHostDirectory(path);
      if (requestId.current !== nextRequestId) return;
      setListing(nextListing);
      setPathInput(nextListing.path);
    } catch {
      if (requestId.current === nextRequestId) setError("browse");
    } finally {
      if (requestId.current === nextRequestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setListing(null);
    setPathInput("");
    setNewDirectoryName("");
    setError(null);
    void navigateTo();

    return () => {
      requestId.current++;
    };
  }, [navigateTo, open]);

  const createDirectory = async () => {
    const name = newDirectoryName.trim();
    if (!listing || !name || creating) return;

    setCreating(true);
    setError(null);
    try {
      const created = await createPiHostDirectory(listing.path, name);
      setNewDirectoryName("");
      await navigateTo(created.path);
    } catch {
      setError("create");
    } finally {
      setCreating(false);
    }
  };

  const selectCurrentDirectory = async () => {
    if (!listing || pathInput.trim() !== listing.path || selecting) return;

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
  const interactionLocked = creating || selecting;
  const canSelect = Boolean(listing) && pathInput.trim() === listing?.path && !loading;
  const errorMessage =
    error === "browse"
      ? t("extensions.workspaceDirectory.browseError")
      : error === "create"
        ? t("extensions.workspaceDirectory.createError")
        : error === "select"
          ? t("extensions.workspaceDirectory.selectError")
          : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!selecting && !creating) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        closeLabel={t("extensions.workspaceDirectory.close")}
        className="flex h-[min(42rem,calc(100dvh-2rem))] max-w-2xl grid-rows-none flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b px-5 py-4 pe-12">
          <DialogTitle>{t("extensions.workspaceDirectory.selectTitle")}</DialogTitle>
          <DialogDescription>
            {t("extensions.workspaceDirectory.selectDescription")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex items-center gap-2 border-b p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const candidate = pathInput.trim();
            if (candidate) void navigateTo(candidate);
          }}
        >
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("extensions.workspaceDirectory.home")}
            disabled={loading || interactionLocked || !listing}
            onClick={() => void navigateTo(listing?.home)}
          >
            <HomeIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("extensions.workspaceDirectory.parent")}
            disabled={loading || interactionLocked || !parentCrumb}
            onClick={() => void navigateTo(parentCrumb?.path)}
          >
            <ArrowUpIcon />
          </Button>
          <Input
            value={pathInput}
            aria-label={t("extensions.workspaceDirectory.path")}
            placeholder={t("extensions.workspaceDirectory.pathPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            disabled={interactionLocked}
            onChange={(event) => {
              setPathInput(event.target.value);
              setError(null);
            }}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={loading || interactionLocked || !pathInput.trim()}
          >
            {t("extensions.workspaceDirectory.open")}
          </Button>
        </form>

        <nav
          aria-label={t("extensions.workspaceDirectory.breadcrumbs")}
          className="flex min-h-10 items-center gap-0.5 overflow-x-auto border-b px-3"
        >
          {listing?.crumbs.map((crumb, index) => (
            <span key={crumb.path} className="inline-flex shrink-0 items-center">
              {index > 0 ? (
                <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={loading || interactionLocked || crumb.path === listing.path}
                onClick={() => void navigateTo(crumb.path)}
              >
                {crumb.name}
              </Button>
            </span>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              {t("extensions.workspaceDirectory.loading")}
            </div>
          ) : listing?.entries.length ? (
            <div className="flex flex-col gap-1">
              {listing.entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  disabled={interactionLocked}
                  className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-start text-sm leading-[var(--control-text-line-height)]! outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => void navigateTo(entry.path)}
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
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

        <form
          className="flex items-center gap-2 border-t px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void createDirectory();
          }}
        >
          <FolderPlusIcon className="size-4 shrink-0 text-muted-foreground" />
          <Input
            value={newDirectoryName}
            aria-label={t("extensions.workspaceDirectory.newFolderName")}
            placeholder={t("extensions.workspaceDirectory.newFolderPlaceholder")}
            autoComplete="off"
            disabled={!listing || loading || creating || selecting}
            onChange={(event) => {
              setNewDirectoryName(event.target.value);
              setError(null);
            }}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={!listing || loading || creating || selecting || !newDirectoryName.trim()}
          >
            {creating
              ? t("extensions.workspaceDirectory.creating")
              : t("extensions.workspaceDirectory.createFolder")}
          </Button>
        </form>

        <DialogFooter closeLabel={t("extensions.workspaceDirectory.cancel")} className="m-0">
          <Button
            type="button"
            onClick={() => void selectCurrentDirectory()}
            disabled={!canSelect || creating || selecting}
          >
            {selecting
              ? t("extensions.workspaceDirectory.selecting")
              : t("extensions.workspaceDirectory.selectCurrent")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={creating || selecting}
            onClick={() => onOpenChange(false)}
          >
            {t("extensions.workspaceDirectory.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
