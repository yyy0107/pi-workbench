"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpIcon, FolderIcon } from "lucide-react";

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
import { browsePiWorkspaces, validatePiWorkspace } from "@/runtime/pi/client/api";
import type { PiWorkspaceDirectoryEntry, PiWorkspaceSummary } from "@/runtime/pi/contracts";

export function DirectoryPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelect(workspace: PiWorkspaceSummary): void | Promise<void>;
}) {
  const { t } = useI18n();
  const requestId = useRef(0);
  const [currentPath, setCurrentPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<PiWorkspaceDirectoryEntry[]>([]);
  const [drives, setDrives] = useState<PiWorkspaceDirectoryEntry[] | undefined>();
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigateTo = useCallback(
    async (path?: string) => {
      const nextRequestId = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const result = await browsePiWorkspaces(path);
        if (requestId.current !== nextRequestId) return;
        setCurrentPath(result.path);
        setPathInput(result.path);
        setParentPath(result.parentPath);
        setDirectories(result.directories);
        setDrives(result.drives);
      } catch {
        if (requestId.current === nextRequestId) {
          setError(t("extensions.workspaceDirectory.browseError"));
        }
      } finally {
        if (requestId.current === nextRequestId) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!open) return;
    void navigateTo();
    return () => {
      requestId.current++;
    };
  }, [navigateTo, open]);

  const selectCurrentDirectory = async () => {
    if (!currentPath || pathInput.trim() !== currentPath || selecting) return;
    setSelecting(true);
    setError(null);
    try {
      const workspace = await validatePiWorkspace(currentPath);
      await onSelect(workspace);
      onOpenChange(false);
    } catch {
      setError(t("extensions.workspaceDirectory.selectError"));
    } finally {
      setSelecting(false);
    }
  };

  const entries = drives ?? directories;
  const canSelect = Boolean(currentPath) && pathInput.trim() === currentPath && !loading;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!selecting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        closeLabel={t("extensions.workspaceDirectory.close")}
        className="flex h-[min(38rem,calc(100dvh-2rem))] max-w-2xl grid-rows-none flex-col gap-0 overflow-hidden p-0"
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
            size="icon"
            aria-label={t("extensions.workspaceDirectory.parent")}
            disabled={loading || !parentPath}
            onClick={() => void navigateTo(parentPath ?? undefined)}
          >
            <ArrowUpIcon className="size-4" />
          </Button>
          <Input
            value={pathInput}
            aria-label={t("extensions.workspaceDirectory.path")}
            placeholder={t("extensions.workspaceDirectory.pathPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setPathInput(event.target.value);
              setError(null);
            }}
          />
          <Button type="submit" variant="outline" disabled={loading || !pathInput.trim()}>
            {t("extensions.workspaceDirectory.open")}
          </Button>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="text-muted-foreground px-3 py-4 text-sm">
              {t("extensions.workspaceDirectory.loading")}
            </p>
          ) : entries.length ? (
            <div className="flex flex-col gap-1">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="hover:bg-accent focus-visible:bg-accent flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-start text-sm outline-none"
                  onClick={() => void navigateTo(entry.path)}
                >
                  <FolderIcon className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground px-3 py-4 text-sm">
              {t("extensions.workspaceDirectory.empty")}
            </p>
          )}
          {error ? <p className="text-destructive px-3 py-3 text-sm">{error}</p> : null}
        </div>

        <DialogFooter closeLabel={t("extensions.workspaceDirectory.cancel")} className="m-0">
          <Button
            type="button"
            onClick={() => void selectCurrentDirectory()}
            disabled={!canSelect || selecting}
          >
            {selecting
              ? t("extensions.workspaceDirectory.selecting")
              : t("extensions.workspaceDirectory.selectCurrent")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={selecting}
            onClick={() => onOpenChange(false)}
          >
            {t("extensions.workspaceDirectory.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
