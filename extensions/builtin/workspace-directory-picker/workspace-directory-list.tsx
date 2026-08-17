"use client";

import { useEffect } from "react";
import { FolderIcon, FolderOpenIcon } from "lucide-react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { useWorkspaceDirectoryStore } from "./workspace-directory-store";

export function WorkspaceDirectoryList() {
  const pathname = usePathname();
  const directories = useWorkspaceDirectoryStore((state) => state.directories);
  const activeDirectoryId = useWorkspaceDirectoryStore((state) => state.activeDirectoryId);
  const draftDirectoryId = useWorkspaceDirectoryStore((state) => state.draftDirectoryId);
  const activateDirectory = useWorkspaceDirectoryStore((state) => state.activateDirectory);
  const destroyNewThread = useWorkspaceDirectoryStore((state) => state.destroyNewThread);

  useEffect(() => {
    if (pathname !== "/") destroyNewThread();
  }, [destroyNewThread, pathname]);

  if (directories.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      {directories.map((directory) => {
        const isActive = directory.id === activeDirectoryId;
        const hasNewThread = directory.id === draftDirectoryId && pathname === "/";
        const Icon = isActive ? FolderOpenIcon : FolderIcon;

        return (
          <div key={directory.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-start text-sm font-medium outline-none focus-visible:ring-2"
              onClick={() => activateDirectory(directory.id)}
            >
              <Icon className={cn("size-4 shrink-0", isActive && "text-blue-500")} />
              <span className="min-w-0 flex-1 truncate">{directory.name}</span>
            </button>

            {hasNewThread ? (
              <div
                aria-current="page"
                className="bg-sidebar-accent flex h-10 items-center rounded-lg ps-9 pe-2.5 text-sm font-medium"
              >
                新会话
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
