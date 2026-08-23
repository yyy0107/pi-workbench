"use client";

import { AlertCircleIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import {
  Tree,
  type NodeApi,
  type NodeRendererProps,
  type RowRendererProps,
  type TreeApi,
} from "react-arborist";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import {
  buildExplorerTreeItems,
  explorerDirectoryOnPath,
  explorerNodeMatchesFilter,
  explorerPathIsDescendant,
  explorerTreeItemsHaveMatch,
  type ExplorerDirectorySnapshot,
  type ExplorerEntryTreeItem,
  type ExplorerStatusTreeItem,
  type ExplorerTreeItem,
  type ExplorerTreeNode,
} from "./explorer-tree-model";
import { FileTypeIcon, FolderTypeIcon } from "./file-type-icon";

export interface ExplorerTreeLabels {
  tree: string;
  empty: string;
  noMatches: string;
  loadingDirectory(input: { name: string }): string;
  loadDirectoryError(input: { name: string }): string;
  retryDirectory(input: { name: string }): string;
  emptyDirectory(input: { name: string }): string;
}

export interface ExplorerTreeProps {
  rootPath: string;
  rootNode?: ExplorerTreeNode;
  nodes: readonly ExplorerTreeNode[];
  filter?: string;
  showHidden?: boolean;
  selectedPath?: string | null;
  labels: ExplorerTreeLabels;
  className?: string;
  loadDirectory(node: ExplorerTreeNode, signal: AbortSignal): Promise<readonly ExplorerTreeNode[]>;
  openFile(node: ExplorerTreeNode): void | Promise<void>;
  onSelectedPathChange?(path: string, node: ExplorerTreeNode): void;
  onOpenFileError(error: unknown, node: ExplorerTreeNode): void;
}

const TOP_LEVEL_INSET = 4;
const TREE_LEVEL_INDENT = 18;
const ICON_GAP = 7;
const DIRECTORY_DISCLOSURE_WIDTH = 20;
const MATERIAL_ICON_WIDTH = 18;
const TREE_ROW_HEIGHT = 30;
const TREE_PADDING = 4;

interface ExplorerTreeRenderContextValue {
  labels: ExplorerTreeLabels;
  retryDirectory(node: ExplorerTreeNode): void;
}

interface StickyExplorerAncestor {
  id: string;
  item: ExplorerEntryTreeItem;
  level: number;
}

const ExplorerTreeRenderContext = createContext<ExplorerTreeRenderContextValue | null>(null);

function useExplorerTreeRenderContext(): ExplorerTreeRenderContextValue {
  const context = useContext(ExplorerTreeRenderContext);
  if (!context) throw new Error("Explorer tree rows must render inside ExplorerTree.");
  return context;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function sameStickyAncestors(
  left: readonly StickyExplorerAncestor[],
  right: readonly StickyExplorerAncestor[],
): boolean {
  return (
    left.length === right.length &&
    left.every((ancestor, index) => ancestor.id === right[index]?.id)
  );
}

function stickyAncestorsAtOffset(
  tree: TreeApi<ExplorerTreeItem>,
  scrollOffset: number,
): readonly StickyExplorerAncestor[] {
  const offsetInsideRows = Math.max(0, scrollOffset - TREE_PADDING);
  const firstVisibleIndex = Math.min(
    Math.floor(offsetInsideRows / TREE_ROW_HEIGHT),
    Math.max(0, tree.visibleNodes.length - 1),
  );
  const firstVisibleNode = tree.at(firstVisibleIndex);
  if (!firstVisibleNode) return [];

  const ancestors: StickyExplorerAncestor[] = [];
  let ancestor = firstVisibleNode.parent;
  while (ancestor && !ancestor.isRoot) {
    if (ancestor.data.type === "entry" && ancestor.data.node.kind === "directory") {
      ancestors.unshift({ id: ancestor.id, item: ancestor.data, level: ancestor.level });
    }
    ancestor = ancestor.parent;
  }

  const rowTop = TREE_PADDING + firstVisibleIndex * TREE_ROW_HEIGHT;
  if (
    scrollOffset > rowTop &&
    firstVisibleNode.data.type === "entry" &&
    firstVisibleNode.data.node.kind === "directory" &&
    firstVisibleNode.isOpen
  ) {
    ancestors.push({
      id: firstVisibleNode.id,
      item: firstVisibleNode.data,
      level: firstVisibleNode.level,
    });
  }

  return ancestors;
}

function ExplorerEntryContent({
  item,
  level,
  expanded,
  selected = false,
  focused = false,
}: {
  item: ExplorerEntryTreeItem;
  level: number;
  expanded: boolean;
  selected?: boolean;
  focused?: boolean;
}) {
  const rowInset = TOP_LEVEL_INSET + level * TREE_LEVEL_INDENT;
  const node = item.node;

  return (
    <div
      className={cn(
        "hover:bg-muted/60 text-foreground relative flex h-[30px] w-full min-w-0 items-center overflow-hidden rounded-md pe-2 text-start text-[15px] font-normal outline-none",
        selected && "bg-muted/80",
        focused && "ring-ring ring-1 ring-inset",
      )}
      style={{ paddingInlineStart: `${rowInset}px`, gap: `${ICON_GAP}px` }}
    >
      {Array.from({ length: Math.max(0, level) }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="bg-border/65 pointer-events-none absolute inset-y-0 w-px"
          style={{
            insetInlineStart: `${TOP_LEVEL_INSET + DIRECTORY_DISCLOSURE_WIDTH / 2 + index * TREE_LEVEL_INDENT}px`,
          }}
        />
      ))}
      {node.kind === "directory" ? (
        <>
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "text-muted-foreground/85 size-5 shrink-0 stroke-[1.8] transition-transform motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
          {expanded ? (
            <span
              aria-hidden="true"
              className="bg-border/65 pointer-events-none absolute bottom-0 h-1/2 w-px"
              style={{ insetInlineStart: `${rowInset + 10}px` }}
            />
          ) : null}
          <FolderTypeIcon name={node.name} expanded={expanded} symbolicLink={node.symbolicLink} />
        </>
      ) : (
        <>
          <span aria-hidden="true" className="size-5 shrink-0" />
          <FileTypeIcon
            path={node.relativePath ?? node.path ?? node.name}
            symbolicLink={node.symbolicLink}
          />
        </>
      )}
      <span className="min-w-0 flex-1 cursor-default truncate">{node.name}</span>
    </div>
  );
}

function ExplorerStatusContent({ item, level }: { item: ExplorerStatusTreeItem; level: number }) {
  const { labels, retryDirectory } = useExplorerTreeRenderContext();
  const paddingInlineStart =
    TOP_LEVEL_INSET +
    Math.max(0, level - 1) * TREE_LEVEL_INDENT +
    DIRECTORY_DISCLOSURE_WIDTH +
    ICON_GAP +
    MATERIAL_ICON_WIDTH +
    ICON_GAP;

  if (item.status === "loading") {
    return (
      <div
        role="status"
        className="text-muted-foreground flex h-[30px] w-full min-w-0 items-center gap-2 pe-2 text-xs"
        style={{ paddingInlineStart }}
      >
        <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
        <span className="truncate">{labels.loadingDirectory({ name: item.parent.name })}</span>
      </div>
    );
  }

  if (item.status === "error") {
    return (
      <div
        role="alert"
        className="text-destructive flex h-[30px] w-full min-w-0 items-center gap-2 pe-2 text-xs"
        style={{ paddingInlineStart }}
      >
        <AlertCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {labels.loadDirectoryError({ name: item.parent.name })}
        </span>
        <button
          type="button"
          className="hover:bg-destructive/10 h-6 shrink-0 rounded-md px-2 font-medium outline-none focus-visible:ring-2"
          onClick={(event) => {
            event.stopPropagation();
            retryDirectory(item.parent);
          }}
        >
          {labels.retryDirectory({ name: item.parent.name })}
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="text-muted-foreground flex h-[30px] w-full min-w-0 items-center pe-2 text-xs"
      style={{ paddingInlineStart }}
    >
      {labels.emptyDirectory({ name: item.parent.name })}
    </div>
  );
}

function ExplorerNodeRenderer({ node }: NodeRendererProps<ExplorerTreeItem>) {
  if (node.data.type === "status") {
    return <ExplorerStatusContent item={node.data} level={node.level} />;
  }

  return (
    <ExplorerEntryContent
      item={node.data}
      level={node.level}
      expanded={node.isOpen}
      selected={node.isSelected}
      focused={node.isFocused && node.tree.hasFocus}
    />
  );
}

function ExplorerRowRenderer({
  node,
  attrs,
  innerRef,
  children,
}: RowRendererProps<ExplorerTreeItem>) {
  const item = node.data;
  const selectable = item.type === "entry";
  return (
    <div
      {...attrs}
      ref={innerRef}
      aria-disabled={selectable ? undefined : true}
      aria-expanded={node.isInternal ? node.isOpen : undefined}
      title={item.type === "entry" ? (item.node.relativePath ?? item.node.path) : undefined}
      onFocus={(event) => event.stopPropagation()}
      onClick={selectable ? node.handleClick : undefined}
    >
      {children}
    </div>
  );
}

function StickyScroll({ ancestors }: { ancestors: readonly StickyExplorerAncestor[] }) {
  if (!ancestors.length) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20">
      {ancestors.map((ancestor) => (
        <div key={ancestor.id} className="bg-background h-[30px]">
          <ExplorerEntryContent item={ancestor.item} level={ancestor.level} expanded />
        </div>
      ))}
    </div>
  );
}

function useElementHeight(element: HTMLElement | null): number {
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (!element) return;
    const update = () => setHeight(Math.max(0, Math.floor(element.getBoundingClientRect().height)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return height;
}

function arboristSearchMatch(node: NodeApi<ExplorerTreeItem>, filter: string): boolean {
  return node.data.type === "entry" && explorerNodeMatchesFilter(node.data.node, filter);
}

export function ExplorerTree({
  rootPath,
  rootNode,
  nodes,
  filter = "",
  showHidden = true,
  selectedPath,
  labels,
  className,
  loadDirectory,
  openFile,
  onSelectedPathChange,
  onOpenFileError,
}: ExplorerTreeProps) {
  const [directories, setDirectories] = useState<ReadonlyMap<string, ExplorerDirectorySnapshot>>(
    () =>
      rootNode
        ? new Map([[rootNode.path, { status: "loaded" as const, children: nodes }]])
        : new Map(),
  );
  const [internalSelectedPath, setInternalSelectedPath] = useState<string>();
  const [stickyAncestors, setStickyAncestors] = useState<readonly StickyExplorerAncestor[]>([]);
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
  const viewportHeight = useElementHeight(viewportElement);
  const directoriesRef = useRef(directories);
  const requests = useRef(new Map<string, AbortController>());
  const rootGeneration = useRef(0);
  const treeRef = useRef<TreeApi<ExplorerTreeItem>>(null);
  const activeSelectedPath = selectedPath === undefined ? internalSelectedPath : selectedPath;
  const topLevelNodes = useMemo(() => (rootNode ? [rootNode] : nodes), [nodes, rootNode]);
  const treeItems = useMemo(
    () => buildExplorerTreeItems({ nodes: topLevelNodes, directories, showHidden }),
    [directories, showHidden, topLevelNodes],
  );
  const hasVisibleItems = useMemo(
    () => explorerTreeItemsHaveMatch(treeItems, filter),
    [filter, treeItems],
  );
  const initialOpenState = useMemo(
    () => (rootNode ? { [rootNode.path]: true } : undefined),
    [rootNode],
  );

  useEffect(() => {
    rootGeneration.current += 1;
    for (const request of requests.current.values()) request.abort();
    requests.current.clear();
    const nextDirectories = rootNode
      ? new Map([[rootNode.path, { status: "loaded" as const, children: nodes }]])
      : new Map<string, ExplorerDirectorySnapshot>();
    directoriesRef.current = nextDirectories;
    setDirectories(nextDirectories);
    setInternalSelectedPath(undefined);
    setStickyAncestors([]);
  }, [nodes, rootNode, rootPath]);

  useEffect(
    () => () => {
      for (const request of requests.current.values()) request.abort();
      requests.current.clear();
    },
    [],
  );

  useEffect(() => {
    setStickyAncestors([]);
  }, [filter]);

  const loadChildren = useCallback(
    async (node: ExplorerTreeNode): Promise<readonly ExplorerTreeNode[] | undefined> => {
      requests.current.get(node.path)?.abort();
      const request = new AbortController();
      const generation = rootGeneration.current;
      requests.current.set(node.path, request);
      setDirectories((current) => {
        const next = new Map(current);
        next.set(node.path, {
          status: "loading",
          children: current.get(node.path)?.children ?? [],
        });
        directoriesRef.current = next;
        return next;
      });

      try {
        const children = await loadDirectory(node, request.signal);
        if (request.signal.aborted || generation !== rootGeneration.current) return;
        setDirectories((current) => {
          const next = new Map(current);
          next.set(node.path, { status: "loaded", children });
          directoriesRef.current = next;
          return next;
        });
        return children;
      } catch (error) {
        if (
          request.signal.aborted ||
          generation !== rootGeneration.current ||
          isAbortError(error)
        ) {
          return;
        }
        setDirectories((current) => {
          const next = new Map(current);
          next.set(node.path, {
            status: "error",
            children: current.get(node.path)?.children ?? [],
            error,
          });
          directoriesRef.current = next;
          return next;
        });
      } finally {
        if (requests.current.get(node.path) === request) requests.current.delete(node.path);
      }
    },
    [loadDirectory],
  );

  useEffect(() => {
    let cancelled = false;
    let frame: number | undefined;
    const selected = activeSelectedPath;
    if (!selected || !explorerPathIsDescendant(rootPath, selected)) return;

    void (async () => {
      let candidates = topLevelNodes;
      while (!cancelled) {
        const directory = explorerDirectoryOnPath(candidates, selected);
        if (!directory) break;
        const snapshot = directoriesRef.current.get(directory.path);
        if (snapshot?.status === "loaded") {
          candidates = snapshot.children;
          continue;
        }
        const children = await loadChildren(directory);
        if (cancelled || !children) return;
        candidates = children;
      }

      frame = requestAnimationFrame(() => {
        const tree = treeRef.current;
        tree?.openParents(selected);
        tree?.select(selected, { focus: false });
      });
    })();

    return () => {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [activeSelectedPath, loadChildren, rootPath, topLevelNodes]);

  const handleActivate = useCallback(
    (node: NodeApi<ExplorerTreeItem>) => {
      if (node.data.type !== "entry") return;
      const explorerNode = node.data.node;
      if (explorerNode.kind === "directory") {
        node.toggle();
        return;
      }

      try {
        void Promise.resolve(openFile(explorerNode)).catch((error: unknown) => {
          onOpenFileError(error, explorerNode);
        });
      } catch (error) {
        onOpenFileError(error, explorerNode);
      }
    },
    [onOpenFileError, openFile],
  );

  const handleSelect = useCallback(
    (selectedNodes: readonly NodeApi<ExplorerTreeItem>[]) => {
      const item = selectedNodes.at(-1)?.data;
      if (!item || item.type !== "entry") return;
      if (selectedPath === undefined) setInternalSelectedPath(item.node.path);
      onSelectedPathChange?.(item.node.path, item.node);
    },
    [onSelectedPathChange, selectedPath],
  );

  const handleToggle = useCallback(
    (id: string) => {
      const item = treeRef.current?.get(id)?.data;
      if (!item || item.type !== "entry" || item.node.kind !== "directory") return;
      const snapshot = directoriesRef.current.get(item.node.path);
      if (!snapshot || snapshot.status === "idle" || snapshot.status === "error") {
        void loadChildren(item.node);
      }
    },
    [loadChildren],
  );

  const handleScroll = useCallback(
    ({ scrollOffset }: { scrollOffset: number }) => {
      const tree = treeRef.current;
      const next = !tree || filter.trim() ? [] : stickyAncestorsAtOffset(tree, scrollOffset);
      setStickyAncestors((current) => (sameStickyAncestors(current, next) ? current : next));
    },
    [filter],
  );

  const renderContext = useMemo<ExplorerTreeRenderContextValue>(
    () => ({ labels, retryDirectory: (node) => void loadChildren(node) }),
    [labels, loadChildren],
  );

  return (
    <ExplorerTreeRenderContext.Provider value={renderContext}>
      <div ref={setViewportElement} className={cn("relative h-full min-h-0 min-w-0", className)}>
        {viewportHeight > 0 ? (
          <Tree<ExplorerTreeItem>
            ref={treeRef}
            data={treeItems}
            height={viewportHeight}
            width="100%"
            rowHeight={TREE_ROW_HEIGHT}
            indent={TREE_LEVEL_INDENT}
            paddingTop={TREE_PADDING}
            paddingBottom={TREE_PADDING}
            overscanCount={8}
            openByDefault={false}
            initialOpenState={initialOpenState}
            selection={activeSelectedPath ?? undefined}
            searchTerm={filter}
            searchMatch={arboristSearchMatch}
            aria-label={labels.tree}
            className="outline-none [overflow-anchor:none]"
            rowClassName="outline-none"
            disableMultiSelection
            disableDeselectOnClick
            disableSelect={(item) => item.type === "status"}
            disableDrag
            disableDrop
            disableEdit
            renderRow={ExplorerRowRenderer}
            onActivate={handleActivate}
            onSelect={handleSelect}
            onToggle={handleToggle}
            onScroll={handleScroll}
          >
            {ExplorerNodeRenderer}
          </Tree>
        ) : null}

        <StickyScroll ancestors={stickyAncestors} />

        {!hasVisibleItems ? (
          <div
            role="status"
            className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center px-3 py-8 text-center text-xs"
          >
            {filter.trim() ? labels.noMatches : labels.empty}
          </div>
        ) : null}
      </div>
    </ExplorerTreeRenderContext.Provider>
  );
}
