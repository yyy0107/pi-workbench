"use client";

import { useAui } from "@assistant-ui/react";
import { FolderPlusIcon, LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePiSessionManager } from "@/runtime/pi/client/runtime/context";
import { PiApiError, pickPiWorkspace } from "@/runtime/pi/client/transport/api";
import type { PiWorkspaceSummary } from "@/runtime/pi/contracts";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

import {
  RemoteDirectoryPickerDialog,
  shouldUseNativeDirectoryPicker,
} from "./remote-directory-picker-dialog";

export function DirectoryPickerButton() {
  const { t } = useI18n();
  const aui = useAui();
  const manager = usePiSessionManager();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [error, setError] = useState(false);
  const addDirectory = useWorkspaceDirectoryStore((state) => state.addDirectory);

  const activateDirectory = async (workspace: PiWorkspaceSummary) => {
    addDirectory(workspace);
    await aui.threads.switchToNewThread();
    router.push("/");
  };

  const pickDirectory = async () => {
    if (picking) return;
    if (!shouldUseNativeDirectoryPicker()) {
      setError(false);
      setRemotePickerOpen(true);
      return;
    }
    setPicking(true);
    setError(false);
    try {
      const workspace = await pickPiWorkspace();
      if (workspace) {
        await activateDirectory(workspace);
        await manager.refreshWorkspaceMetadata().catch(() => undefined);
      }
    } catch (cause) {
      if (cause instanceof PiApiError && cause.code === "directory-picker-unavailable") {
        setRemotePickerOpen(true);
      } else {
        setError(true);
      }
    } finally {
      setPicking(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={picking}
        aria-label={t(
          picking ? "extensions.workspaceDirectory.selecting" : "extensions.workspaceDirectory.add",
        )}
        title={t(
          error ? "extensions.workspaceDirectory.selectError" : "extensions.workspaceDirectory.add",
        )}
        onClick={() => void pickDirectory()}
        className={cn(
          "text-muted-foreground hover:text-foreground",
          error && "text-destructive hover:text-destructive",
        )}
      >
        {picking ? (
          <LoaderCircleIcon className="size-4 animate-spin" />
        ) : (
          <FolderPlusIcon className="size-4" />
        )}
      </Button>
      <RemoteDirectoryPickerDialog
        open={remotePickerOpen}
        onOpenChange={setRemotePickerOpen}
        onSelect={async (workspace) => {
          try {
            await activateDirectory(workspace);
            await manager.refreshWorkspaceMetadata().catch(() => undefined);
          } catch (cause) {
            setError(true);
            throw cause;
          }
        }}
      />
    </>
  );
}
