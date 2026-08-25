"use client";

import { AlertCircleIcon, FolderTreeIcon, LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExplorerTree, explorerNodeListsEqual } from "@/components/workspace-file-tree";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceProps } from "@/platform/extensions";
import {
  fileWorkspaceContext,
  fileWorkspaceService as files,
  type FileNode,
} from "@/services/workspace-file-service";
import { listPiSkillFiles } from "@/runtime/pi/client/transport/api";
import type { SkillFileEntry } from "@/runtime/pi/rpc-contracts";

import {
  useActiveWorkspaceSurface,
  useOpenerService,
  useRightWorkspaceState,
} from "@/components/right-workspace";

const DIRECTORY_REFRESH_INTERVAL_MS = 2_000;

export interface WorkspaceExplorerSurfaceParams extends Record<string, unknown> {
  source?: "workspace";
  rootPath: string;
}

export interface SkillExplorerSurfaceParams extends Record<string, unknown> {
  source: "skill";
  rootPath: string;
  sessionId: string;
  skillName: string;
}

export type ExplorerSurfaceParams = WorkspaceExplorerSurfaceParams | SkillExplorerSurfaceParams;

type RootLoadState =
  | { status: "loading"; rootPath: string; nodes: readonly FileNode[] }
  | { status: "ready"; rootPath: string; nodes: readonly FileNode[] }
  | { status: "error"; rootPath: string; nodes: readonly FileNode[] };

function skillEntryPath(rootPath: string, relativePath: string): string {
  const normalizedRoot = rootPath.replaceAll("\\", "/").replace(/\/+$/, "");
  return relativePath ? `${normalizedRoot}/${relativePath}` : normalizedRoot;
}

function skillFileNode(rootPath: string, entry: SkillFileEntry): FileNode {
  return {
    path: skillEntryPath(rootPath, entry.relativePath),
    relativePath: entry.relativePath,
    name: entry.name,
    kind: entry.kind,
    hidden: entry.hidden,
    ...(entry.symbolicLink ? { symbolicLink: true } : {}),
  };
}

function updateTruncatedPath(
  current: ReadonlySet<string>,
  path: string,
  truncated: boolean,
): ReadonlySet<string> {
  if (current.has(path) === truncated) return current;
  const next = new Set(current);
  if (truncated) next.add(path);
  else next.delete(path);
  return next;
}

export function ExplorerSurface({
  surface,
  context,
}: WorkspaceSurfaceProps<ExplorerSurfaceParams>) {
  const { t } = useI18n();
  const openers = useOpenerService();
  const activeSurface = useActiveWorkspaceSurface();
  const isExplorerVisible = useRightWorkspaceState(
    (state) => state.open && state.auxiliaryOpen && state.activeAuxiliarySurfaceId === surface.id,
  );
  const rootRequest = useRef(0);
  const [filter, setFilter] = useState("");
  const [openError, setOpenError] = useState<string>();
  const [selectedSkillPath, setSelectedSkillPath] = useState<string>();
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [truncatedPaths, setTruncatedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [rootState, setRootState] = useState<RootLoadState>({
    status: "loading",
    rootPath: surface.params.rootPath,
    nodes: [],
  });
  const skillParams = surface.params.source === "skill" ? surface.params : undefined;
  const fileContext = useMemo(
    () => fileWorkspaceContext(surface.scope, context),
    [context.projectId, context.rootPath, context.worktreeId, surface.scope],
  );
  const activeFilePath =
    activeSurface?.kind === "file" && typeof activeSurface.params.absolutePath === "string"
      ? activeSurface.params.absolutePath
      : undefined;
  const loadRoot = useCallback(
    async (mode: "foreground" | "background" = "foreground") => {
      const request = ++rootRequest.current;
      if (mode === "foreground") {
        setRootState((current) => ({ ...current, status: "loading" }));
      }
      try {
        let rootPath: string;
        let relativePath: string;
        let nodes: readonly FileNode[];
        let truncated: boolean;
        if (skillParams) {
          const listing = await listPiSkillFiles({
            sessionId: skillParams.sessionId,
            name: skillParams.skillName,
          });
          rootPath = listing.rootPath;
          relativePath = listing.relativePath;
          nodes = listing.entries.map((entry) => skillFileNode(listing.rootPath, entry));
          truncated = listing.truncated;
        } else {
          const listing = await files.listDirectory(fileContext, "");
          rootPath = surface.params.rootPath;
          relativePath = listing.relativePath;
          nodes = listing.nodes;
          truncated = listing.truncated;
        }
        if (request !== rootRequest.current) return;
        setRootState((current) =>
          current.status === "ready" &&
          current.rootPath === rootPath &&
          explorerNodeListsEqual(current.nodes, nodes)
            ? current
            : { status: "ready", rootPath, nodes },
        );
        setTruncatedPaths((current) => updateTruncatedPath(current, relativePath, truncated));
        setTreeRefreshToken((current) => current + 1);
      } catch {
        if (request !== rootRequest.current) return;
        if (mode === "background") return;
        setRootState((current) => ({ ...current, status: "error" }));
      }
    },
    [fileContext, skillParams, surface.params.rootPath],
  );

  useEffect(() => {
    setFilter("");
    setOpenError(undefined);
    setSelectedSkillPath(undefined);
    setTruncatedPaths(new Set());
    void loadRoot("foreground");
    return () => {
      rootRequest.current += 1;
    };
  }, [loadRoot, surface.params.rootPath]);

  useEffect(() => {
    if (!isExplorerVisible) return;

    let cancelled = false;
    let paused = document.visibilityState !== "visible";
    let refreshing = false;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      if (cancelled || paused || refreshing || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        refreshing = true;
        void loadRoot("background").finally(() => {
          refreshing = false;
          schedule(DIRECTORY_REFRESH_INTERVAL_MS);
        });
      }, delay);
    };
    const handleVisibilityChange = () => {
      paused = document.visibilityState !== "visible";
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (!paused) schedule(0);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!paused) schedule(DIRECTORY_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [isExplorerVisible, loadRoot]);

  const loadDirectory = useCallback(
    async (node: FileNode, signal: AbortSignal) => {
      if (skillParams) {
        const listing = await listPiSkillFiles({
          sessionId: skillParams.sessionId,
          name: skillParams.skillName,
          relativePath: node.relativePath ?? "",
        });
        signal.throwIfAborted();
        setTruncatedPaths((current) =>
          updateTruncatedPath(current, listing.relativePath, listing.truncated),
        );
        return listing.entries.map((entry) => skillFileNode(listing.rootPath, entry));
      }

      const listing = await files.listDirectory(fileContext, node.relativePath ?? node.path);
      signal.throwIfAborted();
      setTruncatedPaths((current) =>
        updateTruncatedPath(current, listing.relativePath, listing.truncated),
      );
      return listing.nodes;
    },
    [fileContext, skillParams],
  );

  const openFile = useCallback(
    async (node: FileNode) => {
      if (skillParams) {
        setSelectedSkillPath(node.path);
        await openers.open({
          resource: {
            scheme: "skill-file",
            path: node.path,
            label: node.name,
            metadata: {
              sessionId: skillParams.sessionId,
              skillName: skillParams.skillName,
              relativePath: node.relativePath,
            },
          },
          context,
          policy: "reveal",
        });
        return;
      }
      setOpenError(undefined);
      await openers.open({
        resource: {
          scheme: "workspace-file",
          path: node.relativePath || node.path,
          label: node.name,
        },
        context,
        policy: "reveal",
      });
    },
    [context, openers, skillParams],
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={t("extensions.workspaceExplorer.files")}
    >
      <div className="relative shrink-0 px-2.5 pt-2 pb-1">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
          />
          <Input
            value={filter}
            type="search"
            autoComplete="off"
            spellCheck={false}
            aria-label={t("extensions.workspaceExplorer.filterLabel")}
            placeholder={t("extensions.workspaceExplorer.filterPlaceholder")}
            className="border-border/80 h-8 rounded-xl bg-background pr-9 pl-10 text-[15px] shadow-none placeholder:text-muted-foreground/75 md:text-[15px] [&::-webkit-search-cancel-button]:hidden"
            onChange={(event) => setFilter(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !filter) return;
              event.preventDefault();
              setFilter("");
            }}
          />
          {filter ? (
            <button
              type="button"
              aria-label={t("extensions.workspaceExplorer.clearFilter")}
              title={t("extensions.workspaceExplorer.clearFilter")}
              className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
              onClick={() => setFilter("")}
            >
              <XIcon aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {openError ? (
        <div role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {openError}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden px-2.5 pb-1 [overflow-anchor:none]">
        {rootState.status === "loading" && rootState.nodes.length === 0 ? (
          <div
            role="status"
            className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-xs"
          >
            <LoaderCircleIcon aria-hidden="true" className="size-5 animate-spin" />
            {t("extensions.shared.fileTree.loading")}
          </div>
        ) : rootState.status === "error" && rootState.nodes.length === 0 ? (
          <div
            role="alert"
            className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-xs"
          >
            <AlertCircleIcon aria-hidden="true" className="text-destructive size-6" />
            <p>{t("extensions.shared.fileTree.loadError")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadRoot()}>
              {t("extensions.shared.fileTree.retry")}
            </Button>
          </div>
        ) : (
          <ExplorerTree
            key={rootState.rootPath}
            rootPath={rootState.rootPath}
            nodes={rootState.nodes}
            refreshToken={treeRefreshToken}
            filter={filter}
            selectedPath={skillParams ? selectedSkillPath : activeFilePath}
            labels={{
              tree: t("extensions.shared.fileTree.tree"),
              empty: t("extensions.shared.fileTree.empty"),
              noMatches: t("extensions.shared.fileTree.noMatches"),
              loadingDirectory: ({ name }) =>
                t("extensions.shared.fileTree.loadingDirectory", { name }),
              loadDirectoryError: ({ name }) =>
                t("extensions.shared.fileTree.loadDirectoryError", { name }),
              retryDirectory: ({ name }) =>
                t("extensions.shared.fileTree.retryDirectory", { name }),
              emptyDirectory: ({ name }) =>
                t("extensions.shared.fileTree.emptyDirectory", { name }),
            }}
            loadDirectory={loadDirectory}
            openFile={openFile}
            onSelectedPathChange={skillParams ? setSelectedSkillPath : undefined}
            onOpenFileError={(_error, node) =>
              setOpenError(t("extensions.shared.fileTree.openError", { name: node.name }))
            }
          />
        )}
      </div>

      {truncatedPaths.size > 0 ? (
        <div
          role="status"
          className="text-muted-foreground flex shrink-0 items-center gap-2 border-t px-3 py-2 text-xs"
        >
          <FolderTreeIcon aria-hidden="true" className="size-3.5" />
          {t("extensions.shared.fileTree.truncated")}
        </div>
      ) : null}
    </section>
  );
}
