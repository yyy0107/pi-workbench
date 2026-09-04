"use client";

import { FileWarningIcon, FolderOpenIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useRightWorkspace, useWorkspaceDraftStore } from "@workbench/shell/right-workspace/react";
import { shouldHighlightWorkbenchCode } from "@workbench/shell/code-highlighting";
import { languageForFilename } from "@workbench/shell/code-highlighting";
import { usePiI18n } from "../../i18n";
import { MarkdownPreview } from "../../markdown-preview";
import { useExtensionErrorReporter } from "@workbench/extension-host";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import { WORKSPACE_FILE_BUFFERED_PREVIEW_SIZE_LIMIT } from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  fileWorkspaceContext,
  resolveFileWorkspaceSession,
  type FileDescriptor,
  type FileWorkspaceSession,
} from "../../services/workspace-file-service";
import { useRuntimeConnection } from "@workbench/shell/runtime-connection";
import { useWorkspaceFileRuntime } from "@workbench/shell/workspace-files";

import { FileCodeEditor, FileCodeView } from "./file-code-editor";
import { saveFileBuffer } from "./file-buffer-actions";
import { readFileBufferDraft, writeFileBufferDraft } from "./file-buffer-draft";
import { FileDiffViewer } from "./file-diff-viewer";
import { FileDocumentPreview } from "./file-document-preview";
import { FILE_SURFACE_LOAD_FAILED, FILE_SURFACE_SAVE_FAILED } from "./file-surface-messages";
import {
  isFileViewerPreviewFile,
  isMarkdownFile,
  resolveFileViewMode,
  type FileViewMode,
} from "./file-view-mode";
import { isLargeTextFile } from "./progressive-text-document";
import { useProgressiveTextDocument } from "./use-progressive-text-document";
import { useWorkspaceFileObjectUrl } from "./use-workspace-file-object-url";
import { VirtualizedTextViewer } from "./virtualized-text-viewer";

interface FileDocumentParams {
  absolutePath?: string;
  relativePath?: string;
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

export type FileSurfaceParams = FileWorkspaceSession & FileDocumentParams & Record<string, unknown>;

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
    ...(params.source === "workspace" ? { workspaceId: params.workspaceId } : {}),
    source: params.source === "workspace" ? "workspace" : "resource",
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

export function FileSurface({
  surface,
  isVisible,
  retryToken = 0,
}: WorkspaceSurfaceProps<FileSurfaceParams>) {
  const { t } = usePiI18n();
  const controller = useRightWorkspace();
  const reportError = useExtensionErrorReporter();
  const runtimeConnection = useRuntimeConnection();
  const draftStore = useWorkspaceDraftStore();
  const { files, diffs } = useWorkspaceFileRuntime();
  const path = surface.params.absolutePath;
  const fileSession = useMemo(() => resolveFileWorkspaceSession(surface.params), [surface.params]);
  const initialDescriptor = useMemo(() => descriptorFromParams(surface.params), [surface.params]);
  const [descriptor, setDescriptor] = useState<FileDescriptor | undefined>(initialDescriptor);
  const fileContext = useMemo(
    () =>
      fileSession ? fileWorkspaceContext(surface.scope, fileSession) : { scope: surface.scope },
    [fileSession, surface.scope],
  );
  const subscribe = useCallback(
    (listener: () => void) => (path ? files.watchPath(fileContext, path, listener) : () => {}),
    [fileContext, files, path],
  );
  const getSnapshot = useCallback(
    () => (path ? files.getSnapshot(fileContext, path) : undefined),
    [fileContext, files, path],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const viewMode = resolveFileViewMode(path, surface.params.viewMode);
  const requiresAuthenticatedPreview = runtimeConnection.kind === "desktop-sidecar";
  const objectUrl = useWorkspaceFileObjectUrl(
    descriptor?.workspaceId && descriptor.relativePath
      ? {
          workspaceId: descriptor.workspaceId,
          relativePath: descriptor.relativePath,
          version: descriptor.version,
          retryToken,
          enabled:
            requiresAuthenticatedPreview &&
            viewMode === "preview" &&
            isFileViewerPreviewFile(path) &&
            descriptor.size <= WORKSPACE_FILE_BUFFERED_PREVIEW_SIZE_LIMIT,
        }
      : undefined,
  );
  const previewUrl =
    requiresAuthenticatedPreview && objectUrl.status === "ready"
      ? objectUrl.url
      : descriptor?.contentUrl;
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
    (requiresAuthenticatedPreview || descriptor.contentUrl),
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
  const progressiveText = useProgressiveTextDocument(progressiveTextSource, isVisible);
  const needsTextSnapshot = needsTextContent && !canStreamLargeText;

  useEffect(() => {
    if (objectUrl.status !== "error") return;
    reportError(objectUrl.error, { source: "workspace", contributionId: surface.id });
    controller.update(surface.id, {
      status: "error",
      statusMessage: FILE_SURFACE_LOAD_FAILED,
    });
  }, [controller, objectUrl, reportError, surface.id]);

  useEffect(() => {
    if (!fileSession || !path) {
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
        reportError(error, { source: "workspace", contributionId: surface.id });
        controller.update(surface.id, {
          status: "error",
          statusMessage: FILE_SURFACE_LOAD_FAILED,
        });
      });
    return () => {
      current = false;
    };
  }, [
    controller,
    files,
    fileContext,
    fileSession,
    initialDescriptor,
    path,
    reportError,
    retryToken,
    surface.id,
    surface.params.relativePath,
  ]);

  useEffect(() => {
    if (!fileSession || !path || !needsTextSnapshot) return;
    if (snapshot) {
      controller.update(surface.id, { status: "ready", statusMessage: undefined });
      return;
    }
    if (!fileContext.workspaceId && !fileContext.session) return;

    let current = true;
    controller.update(surface.id, { status: "loading", statusMessage: undefined });
    void files
      .readFile(fileContext, surface.params.relativePath ?? path)
      .then(() => {
        if (current) controller.update(surface.id, { status: "ready", statusMessage: undefined });
      })
      .catch((error: unknown) => {
        if (!current) return;
        reportError(error, { source: "workspace", contributionId: surface.id });
        controller.update(surface.id, {
          status: "error",
          statusMessage: FILE_SURFACE_LOAD_FAILED,
        });
      });
    return () => {
      current = false;
    };
  }, [
    controller,
    files,
    fileContext,
    fileSession,
    needsTextSnapshot,
    path,
    reportError,
    retryToken,
    snapshot,
    surface.id,
    surface.params.extensionFilePath,
    surface.params.extensionName,
    surface.params.extensionOrigin,
    surface.params.extensionScope,
    surface.params.extensionSource,
    surface.params.relativePath,
    surface.params.sessionId,
    surface.params.skillName,
    surface.params.source,
  ]);

  useEffect(() => {
    if (!path || !snapshot) return;
    const draft = readFileBufferDraft(draftStore, surface.id);
    const compatibleDraft =
      draft && (draft.version === snapshot.version || draft.savedContent === snapshot.savedContent);

    if (compatibleDraft && draft.content !== snapshot.content) {
      files.updateBuffer(fileContext, path, draft.content);
      controller.update(surface.id, { dirty: draft.content !== snapshot.savedContent });
      return;
    }

    const dirty = Boolean(compatibleDraft && draft.content !== snapshot.savedContent);
    if (surface.dirty !== dirty) controller.update(surface.id, { dirty });
  }, [controller, draftStore, fileContext, files, path, snapshot, surface.dirty, surface.id]);

  useEffect(() => {
    if (!surface.dirty) return;
    const preventAccidentalUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalUnload);
    return () => window.removeEventListener("beforeunload", preventAccidentalUnload);
  }, [surface.dirty]);

  const save = useCallback(async () => {
    if (!path) return;
    try {
      const available = await saveFileBuffer({
        files,
        context: fileContext,
        path,
        storage: draftStore,
        surfaceId: surface.id,
      });
      if (!available) return;
      controller.update(surface.id, { dirty: false, status: "ready", statusMessage: undefined });
    } catch (error) {
      reportError(error, { source: "workspace", contributionId: surface.id });
      controller.update(surface.id, {
        status: "error",
        statusMessage: FILE_SURFACE_SAVE_FAILED,
      });
    }
  }, [controller, draftStore, fileContext, files, path, reportError, surface.id]);
  const handledRetryToken = useRef(0);

  useEffect(() => {
    if (retryToken === 0 || retryToken === handledRetryToken.current || !surface.dirty) {
      return;
    }
    handledRetryToken.current = retryToken;
    void save();
  }, [retryToken, save, surface.dirty]);

  if (!fileSession) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
        {t("extensions.workspaceFile.unavailable")}
      </div>
    );
  }

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
    const diff = surface.params.diffId ? diffs.get(surface.params.diffId) : undefined;
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
    (previewUrl || (descriptor.encoding === "utf-8" && snapshot))
  ) {
    return (
      <FileDocumentPreview
        key={descriptor.version}
        {...(descriptor.encoding === "utf-8" && snapshot
          ? { content: snapshot.content }
          : { url: previewUrl })}
        name={descriptor.name}
        mediaType={descriptor.mediaType}
        size={descriptor.size}
        ariaLabel={t("extensions.workspaceFile.documentPreview", { name: descriptor.name })}
      />
    );
  }

  if (
    requiresAuthenticatedPreview &&
    viewMode === "preview" &&
    isFileViewerPreviewFile(path) &&
    objectUrl.status === "loading"
  ) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
        {t("extensions.workspaceFile.loading")}
      </div>
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
      <MarkdownPreview
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

  if (fileSession.source !== "workspace") {
    return (
      <section className="flex h-full min-h-0 flex-col">
        <FileCodeView
          value={snapshot.content}
          name={snapshot.name}
          ariaLabel={t("extensions.workspaceFile.source", { name: snapshot.name })}
        />
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <FileCodeEditor
        value={snapshot.content}
        name={snapshot.name}
        ariaLabel={t("extensions.workspaceFile.source", { name: snapshot.name })}
        exitLabel={t("extensions.workspaceFile.exitEditor")}
        saveLabel={t("extensions.workspaceFile.saveShortcut")}
        onSave={save}
        onChange={(content) => {
          files.updateBuffer(fileContext, path, content);
          writeFileBufferDraft(draftStore, surface.id, {
            version: snapshot.version,
            savedContent: snapshot.savedContent,
            content,
          });
          controller.update(surface.id, {
            dirty: content !== snapshot.savedContent,
            status: "ready",
          });
        }}
      />
    </section>
  );
}
