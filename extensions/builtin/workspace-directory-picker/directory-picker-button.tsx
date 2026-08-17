"use client";

import { useRef } from "react";
import { FolderPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import {
  useWorkspaceDirectoryStore,
  type WorkspaceDirectoryHandle,
} from "./workspace-directory-store";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<WorkspaceDirectoryHandle>;
};

export function DirectoryPickerButton() {
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const addDirectory = useWorkspaceDirectoryStore((state) => state.addDirectory);

  const activateDirectory = (name: string, handle?: WorkspaceDirectoryHandle) => {
    addDirectory({
      id: crypto.randomUUID(),
      name,
      handle,
    });
    router.push("/");
  };

  const pickDirectory = async () => {
    const showDirectoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;

    if (!showDirectoryPicker) {
      fallbackInputRef.current?.click();
      return;
    }

    try {
      const directory = await showDirectoryPicker.call(window);
      activateDirectory(directory.name, directory);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Unable to open the directory picker.", error);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="添加本地工作区"
        title="添加本地工作区"
        onClick={() => void pickDirectory()}
        className="text-muted-foreground hover:text-foreground"
      >
        <FolderPlusIcon className="size-[18px]" />
      </Button>
      <input
        ref={fallbackInputRef}
        type="file"
        multiple
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const relativePath = event.currentTarget.files?.[0]?.webkitRelativePath;
          const directoryName = relativePath?.split("/")[0];
          if (directoryName) activateDirectory(directoryName);
          event.currentTarget.value = "";
        }}
        {...{ webkitdirectory: "" }}
      />
    </>
  );
}
