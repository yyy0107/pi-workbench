export type ExplorerTreeNodeKind = "directory" | "file";

/** Minimal structural contract accepted from the shared workspace file service. */
export interface ExplorerTreeNode {
  path: string;
  relativePath?: string;
  name: string;
  kind: ExplorerTreeNodeKind;
  hidden?: boolean;
  symbolicLink?: boolean;
}

export type ExplorerDirectoryLoadStatus = "idle" | "loading" | "loaded" | "error";

export interface ExplorerDirectorySnapshot {
  status: ExplorerDirectoryLoadStatus;
  children: readonly ExplorerTreeNode[];
  error?: unknown;
}

export interface ExplorerEntryTreeItem {
  type: "entry";
  id: string;
  node: ExplorerTreeNode;
  children?: readonly ExplorerTreeItem[];
}

export interface ExplorerStatusTreeItem {
  type: "status";
  id: string;
  parent: ExplorerTreeNode;
  status: "loading" | "error" | "empty";
}

export type ExplorerTreeItem = ExplorerEntryTreeItem | ExplorerStatusTreeItem;

export interface BuildExplorerTreeItemsOptions {
  nodes: readonly ExplorerTreeNode[];
  directories?: ReadonlyMap<string, ExplorerDirectorySnapshot>;
  showHidden?: boolean;
}

const nodeNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareExplorerNodes(left: ExplorerTreeNode, right: ExplorerTreeNode): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  const nameResult = nodeNameCollator.compare(left.name, right.name);
  return nameResult || left.path.localeCompare(right.path);
}

export function sortExplorerNodes(nodes: readonly ExplorerTreeNode[]): readonly ExplorerTreeNode[] {
  return [...nodes].sort(compareExplorerNodes);
}

/** Compares directory snapshots without depending on object identity from a fresh RPC response. */
export function explorerNodeListsEqual(
  left: readonly ExplorerTreeNode[],
  right: readonly ExplorerTreeNode[],
): boolean {
  return (
    left.length === right.length &&
    left.every((node, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        node.path === candidate.path &&
        node.relativePath === candidate.relativePath &&
        node.name === candidate.name &&
        node.kind === candidate.kind &&
        node.hidden === candidate.hidden &&
        node.symbolicLink === candidate.symbolicLink
      );
    })
  );
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizedExplorerPath(value: string): string {
  const normalizedPath = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/");
  const withoutTrailingSeparator =
    normalizedPath.length > 1 ? normalizedPath.replace(/\/+$/, "") : normalizedPath;
  return /^[a-zA-Z]:\//.test(withoutTrailingSeparator)
    ? withoutTrailingSeparator.toLocaleLowerCase()
    : withoutTrailingSeparator;
}

export function explorerPathsEqual(left: string, right: string): boolean {
  return normalizedExplorerPath(left) === normalizedExplorerPath(right);
}

/** Returns true only when `path` is a descendant of `directoryPath`. */
export function explorerPathIsDescendant(directoryPath: string, path: string): boolean {
  const directory = normalizedExplorerPath(directoryPath);
  const candidate = normalizedExplorerPath(path);
  if (!directory || directory === candidate) return false;
  return directory === "/" ? candidate.startsWith("/") : candidate.startsWith(`${directory}/`);
}

export function explorerDirectoryOnPath(
  nodes: readonly ExplorerTreeNode[],
  path: string,
): ExplorerTreeNode | undefined {
  return nodes.find(
    (node) => node.kind === "directory" && explorerPathIsDescendant(node.path, path),
  );
}

export function explorerNodeMatchesFilter(node: ExplorerTreeNode, filter: string): boolean {
  const query = normalized(filter);
  if (!query) return true;
  if (normalized(node.name).includes(query)) return true;
  if (!/[\\/]/.test(query)) return false;
  return normalized(node.relativePath ?? node.path).includes(query);
}

function statusItem(
  parent: ExplorerTreeNode,
  status: ExplorerStatusTreeItem["status"],
): ExplorerStatusTreeItem {
  return {
    type: "status",
    id: `workspace-explorer-status:${status}:${parent.path}`,
    parent,
    status,
  };
}

/** Builds the controlled data consumed by react-arborist. Directories always own a children array. */
export function buildExplorerTreeItems({
  nodes,
  directories = new Map(),
  showHidden = true,
}: BuildExplorerTreeItemsOptions): readonly ExplorerTreeItem[] {
  const visibleNodes = showHidden ? nodes : nodes.filter((node) => !node.hidden);

  return sortExplorerNodes(visibleNodes).map((node): ExplorerTreeItem => {
    if (node.kind === "file") return { type: "entry", id: node.path, node };

    const snapshot = directories.get(node.path);
    const children = buildExplorerTreeItems({
      nodes: snapshot?.children ?? [],
      directories,
      showHidden,
    });

    if (!snapshot || snapshot.status === "idle") {
      return { type: "entry", id: node.path, node, children };
    }
    if (snapshot.status === "loading") {
      return {
        type: "entry",
        id: node.path,
        node,
        children: [...children, statusItem(node, "loading")],
      };
    }
    if (snapshot.status === "error") {
      return {
        type: "entry",
        id: node.path,
        node,
        children: [...children, statusItem(node, "error")],
      };
    }
    return {
      type: "entry",
      id: node.path,
      node,
      children: children.length ? children : [statusItem(node, "empty")],
    };
  });
}

export function explorerTreeItemsHaveMatch(
  items: readonly ExplorerTreeItem[],
  filter: string,
): boolean {
  if (!filter.trim()) return items.length > 0;
  return items.some(
    (item) =>
      item.type === "entry" &&
      (explorerNodeMatchesFilter(item.node, filter) ||
        Boolean(item.children && explorerTreeItemsHaveMatch(item.children, filter))),
  );
}
