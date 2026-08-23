"use client";

import { FileWarningIcon, FolderOpenIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useRightWorkspace } from "@/components/right-workspace";
import { languageForFilename, shouldHighlightWorkbenchCode } from "@/components/code-highlighting";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceProps } from "@/platform/extensions";
import {
  fileWorkspaceContext,
  fileWorkspaceService as files,
  type FileDescriptor,
} from "@/services/workspace-file-service";

import { FileCodeEditor } from "./file-code-editor";
import { fileDiffService } from "./file-diff-service";
import { FileDiffViewer } from "./file-diff-viewer";
import { FileDocumentPreview } from "./file-document-preview";
import { FileMarkdownPreview } from "./file-markdown-preview";
import {
  isFileViewerPreviewFile,
  isMarkdownFile,
  resolveFileViewMode,
  type FileViewMode,
} from "./file-view-mode";
import { isLargeTextFile } from "./progressive-text-document";
import { useProgressiveTextDocument } from "./use-progressive-text-document";
import { VirtualizedTextViewer } from "./virtualized-text-viewer";

export interface FileSurfaceParams extends Record<string, unknown> {
  absolutePath?: string;
  relativePath?: string;
  workspaceId?: string;
  bufferId?: string;
  launcher?: boolean;
  viewMode?: FileViewMode;
  diffId?: string;
  diffCycle?: number;
  name?: string;
  mediaType?: string;
  encoding?: "utf-8" | null;
  version?: string;
  size?: number;
  modifiedAt?: number;
  contentUrl?: string;
}

function descriptorFromParams(params: FileSurfaceParams): FileDescriptor | undefined {
  if (
    !params.absolutePath ||
    !params.name ||
    !params.mediaType ||
    (params.encoding !== "utf-8" && params.encoding !== null) ||
    !params.version ||
    typeof params.size !== "number" ||
    typeof params.modifiedAt !== "number"
  ) {
    return undefined;
  }
  return {
    path: params.absolutePath,
    ...(params.relativePath ? { relativePath: params.relativePath } : {}),
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    source: params.workspaceId ? "workspace" : "memory",
    name: params.name,
    mediaType: params.mediaType,
    encoding: params.encoding,
    version: params.version,
    size: params.size,
    modifiedAt: params.modifiedAt,
    ...(params.contentUrl ? { contentUrl: params.contentUrl } : {}),
  };
}

function UnavailableFile({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="flex max-w-sm flex-col items-center">
        <FileWarningIcon
          aria-hidden="true"
          className="text-muted-foreground mb-4 size-10 stroke-[1.6]"
        />
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-muted-foreground mt-2 text-sm">{description}</p>
      </div>
    </div>
  );
}

export function FileSurface({ surface, context }: WorkspaceSurfaceProps<FileSurfaceParams>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const path = surface.params.absolutePath;
  const initialDescriptor = useMemo(() => descriptorFromParams(surface.params), [surface.params]);
  const [descriptor, setDescriptor] = useState<FileDescriptor | undefined>(initialDescriptor);
  const fileContext = useMemo(
    () => fileWorkspaceContext(surface.scope, context),
    [context.projectId, context.rootPath, context.worktreeId, surface.scope],
  );
  const subscribe = useCallback(
    (listener: () => void) => (path ? files.watchPath(fileContext, path, listener) : () => {}),
    [fileContext, path],
  );
  const getSnapshot = useCallback(
    () => (path ? files.getSnapshot(fileContext, path) : undefined),
    [fileContext, path],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const viewMode = resolveFileViewMode(path, surface.params.viewMode);
  const markdownPreview = viewMode === "preview" && isMarkdownFile(path);
  const needsTextContent =
    descriptor?.encoding === "utf-8" && (viewMode === "source" || markdownPreview);
  const snapshotNeedsVirtualization = Boolean(
    viewMode === "source" && snapshot && !shouldHighlightWorkbenchCode(snapshot.content),
  );
  const largeTextMode = Boolean(
    needsTextContent &&
    descriptor &&
    (isLargeTextFile(descriptor.size) || snapshotNeedsVirtualization),
  );
  const canStreamLargeText = Boolean(
    largeTextMode &&
    descriptor &&
    isLargeTextFile(descriptor.size) &&
    !snapshot &&
    descriptor?.workspaceId &&
    descriptor.relativePath &&
    descriptor.contentUrl,
  );
  const progressiveTextSource = useMemo(() => {
    if (!largeTextMode || !descriptor) return undefined;
    if (snapshot) {
      return {
        text: snapshot.content,
        totalBytes: snapshot.size,
        version: `${snapshot.version}:${snapshot.modifiedAt}:${snapshot.content.length}`,
      };
    }
    if (!canStreamLargeText || !descriptor.workspaceId || !descriptor.relativePath)
      return undefined;
    return {
      stream: {
        workspaceId: descriptor.workspaceId,
        relativePath: descriptor.relativePath,
      },
      totalBytes: descriptor.size,
      version: descriptor.version,
    };
  }, [canStreamLargeText, descriptor, largeTextMode, snapshot]);
  const progressiveText = useProgressiveTextDocument(progressiveTextSource);
  const needsTextSnapshot = needsTextContent && !canStreamLargeText;

  useEffect(() => {
    if (!path) {
      setDescriptor(undefined);
      return;
    }
    if (initialDescriptor) {
      setDescriptor(initialDescriptor);
      controller.update(surface.id, { status: "ready", statusMessage: undefined });
      return;
    }

    let current = true;
    setDescriptor(undefined);
    controller.update(surface.id, { status: "loading", statusMessage: undefined });
    void files
      .describeFile(fileContext, surface.params.relativePath ?? path)
      .then((nextDescriptor) => {
        if (!current) return;
        setDescriptor(nextDescriptor);
        controller.update(surface.id, { status: "ready", statusMessage: undefined });
      })
      .catch((error: unknown) => {
        if (!current) return;
        controller.update(surface.id, {
          status: "error",
          statusMessage: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      current = false;
    };
  }, [controller, fileContext, initialDescriptor, path, surface.id, surface.params.relativePath]);

  useEffect(() => {
    if (!path || !needsTextSnapshot) return;
    if (snapshot) {
      controller.update(surface.id, { status: "ready", statusMessage: undefined });
      return;
    }
    if (!fileContext.workspaceId) return;

    let current = true;
    controller.update(surface.id, { status: "loading", statusMessage: undefined });
    void files
      .readFile(fileContext, surface.params.relativePath ?? path)
      .then(() => {
        if (current) controller.update(surface.id, { status: "ready", statusMessage: undefined });
      })
      .catch((error: unknown) => {
        if (!current) return;
        controller.update(surface.id, {
          status: "error",
          statusMessage: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      current = false;
    };
  }, [
    controller,
    fileContext,
    needsTextSnapshot,
    path,
    snapshot,
    surface.id,
    surface.params.relativePath,
  ]);

  const save = useCallback(async () => {
    if (!path || !snapshot || snapshot.content === snapshot.savedContent) return;
    try {
      await files.writeFile(fileContext, path, snapshot.content, snapshot.version);
      controller.update(surface.id, { dirty: false, status: "ready", statusMessage: undefined });
    } catch (error) {
      controller.update(surface.id, {
        status: "error",
        statusMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }, [controller, fileContext, path, snapshot, surface.id]);

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="flex max-w-sm flex-col items-center">
          <FolderOpenIcon
            aria-hidden="true"
            className="text-muted-foreground mb-4 size-10 stroke-[1.6]"
          />
          <h2 className="text-xl font-medium">{t("extensions.workspaceFile.openFileTitle")}</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {t("extensions.workspaceFile.openFileDescription")}
          </p>
        </div>
      </div>
    );
  }

  if (!descriptor) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
        {surface.status === "loading"
          ? t("extensions.workspaceFile.loading")
          : t("extensions.workspaceFile.unavailable")}
      </div>
    );
  }

  if (viewMode === "diff") {
    const diff = surface.params.diffId ? fileDiffService.get(surface.params.diffId) : undefined;
    if (!diff) {
      return (
        <UnavailableFile
          title={t("extensions.workspaceFile.diffUnavailableTitle")}
          description={t("extensions.workspaceFile.diffUnavailableDescription")}
        />
      );
    }

    return (
      <section className="flex h-full min-h-0 flex-col">
        <FileDiffViewer
          key={surface.params.diffCycle ?? diff.cycle}
          ariaLabel={t("extensions.workspaceFile.source", { name: descriptor.name })}
          name={descriptor.name}
          lines={diff.lines}
        />
      </section>
    );
  }

  if (
    viewMode === "preview" &&
    isFileViewerPreviewFile(path) &&
    (descriptor.contentUrl || (descriptor.encoding === "utf-8" && snapshot))
  ) {
    return (
      <FileDocumentPreview
        key={descriptor.version}
        {...(descriptor.encoding === "utf-8" && snapshot
          ? { content: snapshot.content }
          : { url: descriptor.contentUrl })}
        name={descriptor.name}
        mediaType={descriptor.mediaType}
        size={descriptor.size}
        ariaLabel={t("extensions.workspaceFile.documentPreview", { name: descriptor.name })}
      />
    );
  }

  if (largeTextMode && progressiveTextSource) {
    return (
      <section className="flex h-full min-h-0 flex-col">
        <VirtualizedTextViewer
          ariaLabel={t("extensions.workspaceFile.source", { name: descriptor.name })}
          document={progressiveText.document}
          language={languageForFilename(descriptor.name)}
          snapshot={progressiveText.snapshot}
          stage={progressiveText.stage}
          onRetry={progressiveText.retry}
        />
      </section>
    );
  }

  if (markdownPreview && snapshot) {
    return (
      <FileMarkdownPreview
        content={snapshot.content}
        ariaLabel={t("extensions.workspaceFile.markdownPreview", { name: snapshot.name })}
      />
    );
  }

  if (descriptor.encoding === null) {
    return (
      <UnavailableFile
        title={t("extensions.workspaceFile.previewUnsupportedTitle")}
        description={t("extensions.workspaceFile.previewUnsupportedDescription", {
          name: descriptor.name,
        })}
      />
    );
  }

  if (!snapshot) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
        {surface.status === "loading"
          ? t("extensions.workspaceFile.loading")
          : t("extensions.workspaceFile.unavailable")}
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <FileCodeEditor
        value={snapshot.content}
        name={snapshot.name}
        ariaLabel={t("extensions.workspaceFile.source", { name: snapshot.name })}
        saveLabel={t("extensions.workspaceFile.saveShortcut")}
        onSave={save}
        onChange={(content) => {
          files.updateBuffer(fileContext, path, content);
          controller.update(surface.id, {
            dirty: content !== snapshot.savedContent,
            status: "ready",
          });
        }}
      />
    </section>
  );
}
