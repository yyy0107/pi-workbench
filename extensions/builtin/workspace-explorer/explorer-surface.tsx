"use client";

import { FileCode2Icon, FolderOpenIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceProps } from "@/platform/extensions";

import { useRightWorkspace } from "@/components/right-workspace";
import {
  fileWorkspaceService as files,
  type FileNode,
} from "../workspace-file/file-workspace-service";

export interface ExplorerSurfaceParams extends Record<string, unknown> {
  rootPath: string;
}

export function ExplorerSurface({
  surface,
  context,
}: WorkspaceSurfaceProps<ExplorerSurfaceParams>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const [nodes, setNodes] = useState<readonly FileNode[]>([]);

  const refresh = () => {
    void files
      .listDirectory(surface.params.rootPath)
      .then(setNodes)
      .catch(() => controller.update(surface.id, { status: "error" }));
  };

  useEffect(refresh, [controller, files, surface.id, surface.params.rootPath]);

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={t("extensions.workspaceExplorer.files")}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void Promise.all(
            selected.map((file) => files.importFile(file, surface.params.rootPath)),
          ).then((snapshots) => {
            for (const snapshot of snapshots) {
              controller.reveal({
                kind: "file",
                title: snapshot.name,
                params: { absolutePath: snapshot.path },
                context,
                scope: surface.scope,
                status: "ready",
              });
            }
            refresh();
          });
        }}
      />
      <div className="flex h-10 shrink-0 items-center border-b px-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {surface.params.rootPath}
        </span>
        <button
          type="button"
          className="hover:bg-muted text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs"
          onClick={() => inputRef.current?.click()}
        >
          <FolderOpenIcon className="size-3.5" />
          {t("extensions.workspaceExplorer.openFiles")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {nodes.length ? (
          <div className="space-y-0.5">
            {nodes.map((node) => (
              <button
                key={node.path}
                type="button"
                className="hover:bg-muted/60 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs"
                onClick={() =>
                  controller.reveal({
                    kind: "file",
                    title: node.name,
                    params: { absolutePath: node.path },
                    context,
                    scope: surface.scope,
                    status: "ready",
                  })
                }
              >
                <FileCode2Icon className="text-muted-foreground size-3.5" />
                <span className="min-w-0 flex-1 truncate">{node.path}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-xs">
            <FolderOpenIcon className="size-7 opacity-45" />
            <p>{t("extensions.workspaceExplorer.empty")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
