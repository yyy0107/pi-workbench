"use client";

import { useAui } from "@assistant-ui/react";
import { FolderPlusIcon, LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { pickPiWorkspace } from "@/runtime/pi/client/api";
import type { PiWorkspaceSummary } from "@/runtime/pi/contracts";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

export function DirectoryPickerButton() {
  const { t } = useI18n();
  const aui = useAui();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState(false);
  const addDirectory = useWorkspaceDirectoryStore((state) => state.addDirectory);

  const activateDirectory = async (workspace: PiWorkspaceSummary) => {
    addDirectory(workspace);
    await aui.threads.switchToNewThread();
    router.push("/");
  };

  const pickDirectory = async () => {
    if (picking) return;
    setPicking(true);
    setError(false);
    try {
      const workspace = await pickPiWorkspace();
      if (workspace) await activateDirectory(workspace);
    } catch {
      setError(true);
    } finally {
      setPicking(false);
    }
  };

  return (
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
        <LoaderCircleIcon className="size-[18px] animate-spin" />
      ) : (
        <FolderPlusIcon className="size-[18px]" />
      )}
    </Button>
  );
}
