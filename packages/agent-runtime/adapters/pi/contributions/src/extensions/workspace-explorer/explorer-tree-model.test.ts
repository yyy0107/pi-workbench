import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExplorerTreeItems,
  explorerDirectoryOnPath,
  explorerNodeListsEqual,
  explorerNodeMatchesFilter,
  explorerPathIsDescendant,
  explorerPathsEqual,
  explorerTreeItemsHaveMatch,
  sortExplorerNodes,
  type ExplorerDirectorySnapshot,
  type ExplorerTreeNode,
} from "@workbench/shell/workspace-file-tree";

function directory(path: string, name = path.split("/").at(-1) ?? path): ExplorerTreeNode {
  return { path, relativePath: path.replace(/^\/workspace\/?/, ""), name, kind: "directory" };
}

function file(path: string, name = path.split("/").at(-1) ?? path): ExplorerTreeNode {
  return { path, relativePath: path.replace(/^\/workspace\/?/, ""), name, kind: "file" };
}

function loaded(children: readonly ExplorerTreeNode[]): ExplorerDirectorySnapshot {
  return { status: "loaded", children };
}

test("sorts directories before files using natural name order", () => {
  assert.deepEqual(
    sortExplorerNodes([
      file("/workspace/file10.ts"),
      directory("/workspace/zeta"),
      file("/workspace/file2.ts"),
      directory("/workspace/alpha"),
    ]).map((node) => node.name),
    ["alpha", "zeta", "file2.ts", "file10.ts"],
  );
});

test("compares fresh directory listings by file metadata instead of object identity", () => {
  const nodes = [directory("/workspace/src"), file("/workspace/app.ts")];

  assert.equal(
    explorerNodeListsEqual(
      nodes,
      nodes.map((node) => ({ ...node })),
    ),
    true,
  );
  assert.equal(
    explorerNodeListsEqual(nodes, [directory("/workspace/src"), file("/workspace/new.ts")]),
    false,
  );
  assert.equal(explorerNodeListsEqual(nodes, [...nodes].reverse()), false);
  assert.equal(
    explorerNodeListsEqual(nodes, [{ ...nodes[0]!, symbolicLink: true }, nodes[1]!]),
    false,
  );
});

test("builds nested controlled arborist data and preserves unloaded directories as internal nodes", () => {
  const extensions = directory("/workspace/extensions");
  const builtin = directory("/workspace/extensions/builtin");
  const index = file("/workspace/extensions/index.ts");
  const items = buildExplorerTreeItems({
    nodes: [file("/workspace/README.md"), extensions],
    directories: new Map([[extensions.path, loaded([index, builtin])]]),
  });

  assert.deepEqual(
    items.map((item) => [item.type, item.type === "entry" ? item.node.name : item.status]),
    [
      ["entry", "extensions"],
      ["entry", "README.md"],
    ],
  );
  const extensionItem = items[0];
  assert.equal(extensionItem?.type, "entry");
  if (extensionItem?.type !== "entry") return;
  assert.deepEqual(
    extensionItem.children?.map((item) => [
      item.type,
      item.type === "entry" ? item.node.name : item.status,
      item.type === "entry" ? Array.isArray(item.children) : false,
    ]),
    [
      ["entry", "builtin", true],
      ["entry", "index.ts", false],
    ],
  );
});

test("adds virtual status children for loading, error, and empty directories", () => {
  const loading = directory("/workspace/loading");
  const failed = directory("/workspace/failed");
  const empty = directory("/workspace/empty");
  const items = buildExplorerTreeItems({
    nodes: [loading, failed, empty],
    directories: new Map([
      [loading.path, { status: "loading", children: [] }],
      [failed.path, { status: "error", children: [] }],
      [empty.path, { status: "loaded", children: [] }],
    ]),
  });

  assert.deepEqual(
    items.map((item) =>
      item.type === "entry" && item.children?.[0]?.type === "status"
        ? item.children[0].status
        : undefined,
    ),
    ["empty", "error", "loading"],
  );
});

test("filters hidden entries without removing visible descendants from loaded parents", () => {
  const src = directory("/workspace/src");
  const visible = file("/workspace/src/index.ts");
  const hidden = { ...file("/workspace/src/.secret"), hidden: true };
  const items = buildExplorerTreeItems({
    nodes: [src],
    directories: new Map([[src.path, loaded([hidden, visible])]]),
    showHidden: false,
  });

  const srcItem = items[0];
  assert.equal(srcItem?.type, "entry");
  if (srcItem?.type !== "entry") return;
  assert.deepEqual(
    srcItem.children?.map((item) => (item.type === "entry" ? item.node.name : item.status)),
    ["index.ts"],
  );
});

test("matches names and path queries across nested arborist items", () => {
  const extensions = directory("/workspace/extensions");
  const explorer = directory("/workspace/extensions/workspace-explorer");
  const treeFile = file("/workspace/extensions/workspace-explorer/explorer-tree.tsx");
  const items = buildExplorerTreeItems({
    nodes: [extensions],
    directories: new Map([
      [extensions.path, loaded([explorer])],
      [explorer.path, loaded([treeFile])],
    ]),
  });

  assert.equal(explorerNodeMatchesFilter(treeFile, "explorer-tree"), true);
  assert.equal(explorerNodeMatchesFilter(treeFile, "workspace-explorer/explorer"), true);
  assert.equal(explorerTreeItemsHaveMatch(items, "explorer-tree"), true);
  assert.equal(explorerTreeItemsHaveMatch(items, "missing"), false);
});

test("matches workspace paths across separators without confusing sibling prefixes", () => {
  assert.equal(explorerPathsEqual("C:\\workspace\\src", "c:/workspace/src/"), true);
  assert.equal(explorerPathIsDescendant("/workspace/src", "/workspace/src/lib/index.ts"), true);
  assert.equal(explorerPathIsDescendant("/workspace/src", "/workspace/src-other/index.ts"), false);
  assert.equal(explorerPathIsDescendant("/workspace/src", "/workspace/src"), false);
});

test("finds only the directory branch containing the active file", () => {
  const src = directory("/workspace/src");
  const sourceMaps = directory("/workspace/src-maps");

  assert.equal(
    explorerDirectoryOnPath([sourceMaps, src], "/workspace/src/features/index.ts")?.path,
    src.path,
  );
  assert.equal(explorerDirectoryOnPath([sourceMaps, src], "/workspace/README.md"), undefined);
});
