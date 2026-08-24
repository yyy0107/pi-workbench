"use client";

import { useAui } from "@assistant-ui/react";
import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { PiApiError, pickPiHostDirectory } from "@/runtime/pi/client/transport/api";
import type { PiWorkspaceSummary } from "@/runtime/pi/contracts";
import { useWorkspaceCapabilities } from "@/services/workspace-selection-service";

import {
  RemoteDirectoryPickerDialog,
  shouldUseNativeDirectoryPicker,
} from "./remote-directory-picker-dialog";
import { ProjectTrustDialog } from "./project-trust-dialog";
import { useWorkspaceDirectoryAdmission } from "./use-workspace-directory-admission";
import { activateCreatedWorkspace } from "./workspace-activation";

export function DirectoryPickerButton() {
  const { t } = useI18n();
  const aui = useAui();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [error, setError] = useState(false);
  const { beginNewThreadWithCreatedWorkspace } = useWorkspaceCapabilities();

  const activateDirectory = useCallback(
    async (workspace: PiWorkspaceSummary) => {
      await activateCreatedWorkspace(workspace, {
        beginNewThreadWithCreatedWorkspace,
        switchToNewThread: () => aui.threads.switchToNewThread(),
        navigateHome: () => router.push("/"),
      });
    },
    [aui.threads, beginNewThreadWithCreatedWorkspace, router],
  );
  const admission = useWorkspaceDirectoryAdmission(activateDirectory);

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
      const path = await pickPiHostDirectory();
      if (path) await admission.selectPath(path);
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
          "text-muted-foreground hover:text-foreground focus-visible:border-transparent focus-visible:ring-0",
          error && "text-destructive hover:text-destructive",
        )}
      >
        {picking ? (
          <LoaderCircleIcon className="size-4 animate-spin" />
        ) : (
          <PlusIcon className="size-4" />
        )}
      </Button>
      <RemoteDirectoryPickerDialog
        open={remotePickerOpen}
        onOpenChange={setRemotePickerOpen}
        onSelectPath={async (path) => {
          try {
            await admission.selectPath(path);
          } catch (cause) {
            setError(true);
            throw cause;
          }
        }}
      />
      <ProjectTrustDialog
        open={admission.pendingPath !== undefined}
        path={admission.pendingPath ?? ""}
        saving={admission.savingDecision}
        error={admission.dialogError}
        onCancel={admission.cancelTrust}
        onDecision={admission.decideTrust}
      />
    </>
  );
}
