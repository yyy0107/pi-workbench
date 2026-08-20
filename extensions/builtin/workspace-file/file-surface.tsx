"use client";

import { SaveIcon } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceProps } from "@/platform/extensions";

import { useRightWorkspace } from "@/components/right-workspace";
import { fileWorkspaceService as files } from "./file-workspace-service";

export interface FileSurfaceParams extends Record<string, unknown> {
  absolutePath: string;
  bufferId?: string;
}

export function FileSurface({ surface }: WorkspaceSurfaceProps<FileSurfaceParams>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const path = surface.params.absolutePath;
  const subscribe = useCallback(
    (listener: () => void) => files.watchPath(path, listener),
    [files, path],
  );
  const getSnapshot = useCallback(() => files.getSnapshot(path), [files, path]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (!snapshot) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
        {t("extensions.workspaceFile.unavailable")}
      </div>
    );
  }

  const dirty = snapshot.content !== snapshot.savedContent;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="min-w-0 flex-1 truncate font-mono">{snapshot.path}</span>
        <span className="text-muted-foreground">
          {dirty ? t("extensions.workspaceFile.dirty") : t("extensions.workspaceFile.saved")}
        </span>
        <button
          type="button"
          disabled={!dirty}
          className="hover:bg-muted inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 disabled:opacity-50"
          onClick={() => {
            void files
              .writeFile(path, snapshot.content, snapshot.version)
              .then(() => controller.update(surface.id, { dirty: false, status: "ready" }))
              .catch((error: unknown) =>
                controller.update(surface.id, {
                  status: "error",
                  statusMessage: error instanceof Error ? error.message : String(error),
                }),
              );
          }}
        >
          <SaveIcon className="size-3.5" />
          {t("extensions.workspaceFile.save")}
        </button>
      </div>
      <textarea
        value={snapshot.content}
        spellCheck={false}
        aria-label={t("extensions.workspaceFile.source", { name: snapshot.name })}
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-6 outline-none"
        onChange={(event) => {
          files.updateBuffer(path, event.currentTarget.value);
          controller.update(surface.id, { dirty: true, status: "ready" });
        }}
      />
    </section>
  );
}
