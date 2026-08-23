"use client";

import { useAui } from "@assistant-ui/react";
import { FolderPlusIcon, LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { PiApiError, pickPiWorkspace } from "@/runtime/pi/client/transport/api";
import type { PiWorkspaceSummary } from "@/runtime/pi/contracts";
import { useWorkspaceCapabilities } from "@/services/workspace-selection-service";

import {
  RemoteDirectoryPickerDialog,
  shouldUseNativeDirectoryPicker,
} from "./remote-directory-picker-dialog";
import { activateCreatedWorkspace } from "./workspace-activation";

export function DirectoryPickerButton() {
  const { t } = useI18n();
  const aui = useAui();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [error, setError] = useState(false);
  const { beginNewThreadWithCreatedWorkspace } = useWorkspaceCapabilities();

  const activateDirectory = async (workspace: PiWorkspaceSummary) => {
    await activateCreatedWorkspace(workspace, {
      beginNewThreadWithCreatedWorkspace,
      switchToNewThread: () => aui.threads.switchToNewThread(),
      navigateHome: () => router.push("/"),
    });
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
          } catch (cause) {
            setError(true);
            throw cause;
          }
        }}
      />
    </>
  );
}
