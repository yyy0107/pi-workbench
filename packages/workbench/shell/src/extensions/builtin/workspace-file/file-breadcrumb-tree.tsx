"use client";

import { AlertCircleIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOpenerService } from "@workbench/shell/right-workspace/react";
import { Button } from "@workbench/shell/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@workbench/shell/ui";
import { ExplorerTree } from "@workbench/shell/workspace-file-tree";
import { useI18n } from "@workbench/shell/i18n";
import { cn } from "@workbench/shell/utils";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import {
  fileWorkspaceContext,
  fileWorkspaceOpenableResource,
  resolveFileWorkspaceSession,
  workspaceRelativePath,
  type FileNode,
} from "@workbench/shell/workspace-files";
import { useWorkspaceFileRuntime } from "@workbench/shell/workspace-files";

import { fileBreadcrumbSegments, fileBreadcrumbTreeRootPath } from "./file-breadcrumb-model";
import type { FileSurfaceParams } from "./file-surface";

type RootLoadState =
  | { status: "idle"; nodes: readonly FileNode[] }
  | { status: "loading"; nodes: readonly FileNode[] }
  | { status: "ready"; nodes: readonly FileNode[] }
  | { status: "error"; nodes: readonly FileNode[] };

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function FileBreadcrumbTree({ surface, context }: WorkspaceSurfaceProps<FileSurfaceParams>) {
  const { t } = useI18n();
  const { files } = useWorkspaceFileRuntime();
  const openers = useOpenerService();
  const request = useRef(0);
  const [openSegment, setOpenSegment] = useState<number>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [treeRootPath, setTreeRootPath] = useState<string>();
  const [openError, setOpenError] = useState<string>();
  const [truncated, setTruncated] = useState(false);
  const [rootState, setRootState] = useState<RootLoadState>({ status: "idle", nodes: [] });
  const path = surface.params.absolutePath;
  const fileSession = useMemo(() => resolveFileWorkspaceSession(surface.params), [surface.params]);
  const rootPath = fileSession?.rootPath;
  const relativePath = surface.params.relativePath;
  const hasWorkspace = Boolean(fileSession);
  const segments = useMemo(
    () => fileBreadcrumbSegments(rootPath, relativePath, path),
    [path, relativePath, rootPath],
  );
  const fileContext = useMemo(
    () => (fileSession ? fileWorkspaceContext(surface.scope, fileSession) : undefined),
    [fileSession, surface.scope],
  );
  const rootNode = useMemo<FileNode | undefined>(
    () =>
      treeRootPath
        ? {
            path: treeRootPath,
            relativePath: rootPath ? workspaceRelativePath(rootPath, treeRootPath) : treeRootPath,
            name: fileName(treeRootPath),
            kind: "directory",
            hidden: false,
          }
        : undefined,
    [rootPath, treeRootPath],
  );

  const loadRoot = useCallback(async () => {
    if (!fileContext) throw new Error("The file workspace session is unavailable");
    const currentRequest = ++request.current;
    setRootState((current) => ({ status: "loading", nodes: current.nodes }));
    try {
      const listing = await files.listDirectory(fileContext, treeRootPath ?? "");
      if (currentRequest !== request.current) return;
      setRootState({ status: "ready", nodes: listing.nodes });
      setTruncated(listing.truncated);
    } catch {
      if (currentRequest !== request.current) return;
      setRootState((current) => ({ status: "error", nodes: current.nodes }));
    }
  }, [fileContext, treeRootPath]);

  useEffect(() => {
    request.current += 1;
    setRootState({ status: "idle", nodes: [] });
    setTruncated(false);
    setOpenError(undefined);
  }, [surface.scope, treeRootPath]);

  useEffect(() => {
    if (openSegment === undefined || rootState.status !== "idle") return;
    void loadRoot();
  }, [loadRoot, openSegment, rootState.status]);

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  const loadDirectory = useCallback(
    async (node: FileNode, signal: AbortSignal) => {
      if (!fileContext) throw new Error("The file workspace session is unavailable");
      const listing = await files.listDirectory(fileContext, node.relativePath ?? node.path);
      signal.throwIfAborted();
      if (listing.truncated) setTruncated(true);
      return listing.nodes;
    },
    [fileContext],
  );

  const openFile = useCallback(
    async (node: FileNode) => {
      if (!fileSession) throw new Error("The file workspace session is unavailable");
      setOpenError(undefined);
      await openers.open({
        resource: fileWorkspaceOpenableResource(fileSession, node),
        context,
        policy: "reveal",
      });
      setOpenSegment(undefined);
    },
    [context, fileSession, openers],
  );

  const treeLabels = {
    tree: t("extensions.shared.fileTree.tree"),
    empty: t("extensions.shared.fileTree.empty"),
    noMatches: t("extensions.shared.fileTree.noMatches"),
    loadingDirectory: ({ name }: { name: string }) =>
      t("extensions.shared.fileTree.loadingDirectory", { name }),
    loadDirectoryError: ({ name }: { name: string }) =>
      t("extensions.shared.fileTree.loadDirectoryError", { name }),
    retryDirectory: ({ name }: { name: string }) =>
      t("extensions.shared.fileTree.retryDirectory", { name }),
    emptyDirectory: ({ name }: { name: string }) =>
      t("extensions.shared.fileTree.emptyDirectory", { name }),
  };

  return (
    <nav
      aria-label={t("extensions.workspaceFile.filePath")}
      className="flex min-w-0 flex-1 items-center overflow-hidden text-sm"
    >
      {segments.map((segment, index) => (
        <Fragment key={segment.path}>
          {index > 0 ? (
            <ChevronRightIcon
              aria-hidden="true"
              className="text-muted-foreground/60 mx-0.5 size-4 shrink-0"
            />
          ) : null}
          {hasWorkspace ? (
            <Popover
              open={openSegment === index}
              onOpenChange={(open) => {
                setOpenSegment(open ? index : undefined);
                if (open) {
                  setSelectedPath(segment.path);
                  setTreeRootPath(fileBreadcrumbTreeRootPath(segments, index));
                  setOpenError(undefined);
                }
              }}
            >
              <PopoverTrigger
                type="button"
                aria-current={segment.current ? "page" : undefined}
                aria-label={t("extensions.workspaceFile.browsePath", { name: segment.label })}
                title={t("extensions.workspaceFile.browsePath", { name: segment.label })}
                className={cn(
                  "hover:bg-muted hover:text-foreground min-w-0 truncate rounded-md px-1 py-0.5 text-start outline-none transition-colors focus-visible:ring-2",
                  segment.current ? "text-foreground font-medium" : "text-muted-foreground",
                  openSegment === index && "bg-muted text-foreground",
                )}
              >
                {segment.label}
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="bottom"
                sideOffset={4}
                className="h-[min(26rem,calc(100vh-4rem))] w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-xl p-0"
              >
                {openError ? (
                  <div role="alert" className="border-b px-3 py-2 text-xs text-destructive">
                    {openError}
                  </div>
                ) : null}
                <div className="min-h-0 flex-1 p-1.5">
                  {rootState.status === "idle" ||
                  (rootState.status === "loading" && rootState.nodes.length === 0) ? (
                    <div
                      role="status"
                      className="text-muted-foreground flex size-full items-center justify-center gap-2 text-xs"
                    >
                      <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                      {t("extensions.shared.fileTree.loading")}
                    </div>
                  ) : rootState.status === "error" && rootState.nodes.length === 0 ? (
                    <div
                      role="alert"
                      className="text-muted-foreground flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-xs"
                    >
                      <AlertCircleIcon aria-hidden="true" className="text-destructive size-5" />
                      <p>{t("extensions.shared.fileTree.loadError")}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void loadRoot()}
                      >
                        {t("extensions.shared.fileTree.retry")}
                      </Button>
                    </div>
                  ) : treeRootPath && rootNode ? (
                    <ExplorerTree
                      rootPath={treeRootPath}
                      rootNode={rootNode}
                      nodes={rootState.nodes}
                      selectedPath={selectedPath}
                      labels={treeLabels}
                      loadDirectory={loadDirectory}
                      openFile={openFile}
                      onSelectedPathChange={setSelectedPath}
                      onOpenFileError={(_error, node) =>
                        setOpenError(t("extensions.shared.fileTree.openError", { name: node.name }))
                      }
                    />
                  ) : null}
                </div>
                {truncated ? (
                  <div
                    role="status"
                    className="text-muted-foreground shrink-0 border-t px-3 py-2 text-xs"
                  >
                    {t("extensions.shared.fileTree.truncated")}
                  </div>
                ) : null}
              </PopoverContent>
            </Popover>
          ) : (
            <span
              className={cn(
                "truncate",
                segment.current ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {segment.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
