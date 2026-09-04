import assert from "node:assert/strict";
import test from "node:test";
import {
  canStartSidebarDrag,
  commitSidebarMove,
  resolveSidebarMove,
  sidebarDropPosition,
  type SidebarItem,
  type SidebarMoveModel,
} from "./sidebar-move";

const items: SidebarItem[] = [
  { key: "group:pinned", kind: "group", id: "pinned" },
  { key: "group:projects", kind: "group", id: "projects" },
  { key: "wa", kind: "workspace", id: "a", pinned: false, canPin: true },
  { key: "wb", kind: "workspace", id: "b", pinned: true, canPin: true },
  { key: "wc", kind: "workspace", id: "c", pinned: false, canPin: true },
  { key: "ta", kind: "thread", id: "a", workspaceId: "a", pinned: false, canPin: true },
  { key: "tb", kind: "thread", id: "b", workspaceId: "a", pinned: false, canPin: true },
  { key: "tp", kind: "thread", id: "p", workspaceId: "a", pinned: true, canPin: true },
  { key: "tu", kind: "thread", id: "u", pinned: true, canPin: true },
];
const model: SidebarMoveModel = {
  items: new Map(items.map((item) => [item.key, item])),
  orders: new Map([
    ["workspaces:projects", ["wa", "wc"]],
    ["workspaces:pinned", ["wb"]],
    ["threads:workspace:a", ["ta", "tb"]],
    ["threads:pinned", ["tp", "tu"]],
  ]),
};

test("pinning and unpinning folders preserves typed ordering", () => {
  const pin = resolveSidebarMove(model, "wa", "wb", "after")!;
  assert.equal(pin.pinned, true);
  assert.deepEqual(pin.order, ["wb", "wa"]);
  const unpin = resolveSidebarMove(model, "wb", "wc", "before")!;
  assert.equal(unpin.pinned, false);
  assert.deepEqual(unpin.order, ["wa", "wb", "wc"]);
  assert.equal(unpin.beforeId, "c");
});

test("threads keep their owner when pinned, restored, appended or inserted", () => {
  const pin = resolveSidebarMove(model, "ta", "group:pinned", "inside")!;
  assert.equal(pin.source.kind === "thread" && pin.source.workspaceId, "a");
  assert.deepEqual(pin.order, ["tp", "tu", "ta"]);
  const restore = resolveSidebarMove(model, "tp", "group:projects", "inside")!;
  assert.equal(restore.pinned, false);
  assert.equal(restore.order, undefined);
  assert.equal(restore.scope, "threads:workspace:a");
  assert.deepEqual(resolveSidebarMove(model, "tp", "wa", "inside")!.order, ["ta", "tb", "tp"]);
  assert.deepEqual(resolveSidebarMove(model, "tp", "tb", "before")!.order, ["ta", "tp", "tb"]);
  assert.equal(
    resolveSidebarMove(model, "tu", "group:projects", "inside")!.scope,
    "threads:ungrouped",
  );
});

test("rejects changing projects, mixing types, stale targets and no-op drops", () => {
  for (const [source, target, position] of [
    ["tp", "wb", "inside"],
    ["wa", "tp", "before"],
    ["ta", "tb", "before"],
    ["ta", "missing", "after"],
    ["wa", "wa", "after"],
    ["group:pinned", "wa", "before"],
  ] as const) {
    assert.equal(resolveSidebarMove(model, source, target, position), undefined);
  }
  assert.equal(sidebarDropPosition(model, "tp", "wa", "before"), "inside");
  assert.equal(sidebarDropPosition(model, "tp", "wb", "before"), undefined);
});

test("single items can cross groups; searching and pending writes disable every drag", () => {
  assert.equal(canStartSidebarDrag(model, "wb", "", false), true);
  assert.equal(canStartSidebarDrag(model, "ta", "  ", false), true);
  for (const key of ["wa", "wb", "ta", "tp"]) {
    assert.equal(canStartSidebarDrag(model, key, "search", false), false);
    assert.equal(canStartSidebarDrag(model, key, "", true), false);
  }
  assert.equal(canStartSidebarDrag(model, "group:pinned", "", false), false);
  const emptyPinned = { ...model, orders: new Map(model.orders).set("threads:pinned", []) };
  assert.deepEqual(resolveSidebarMove(emptyPinned, "ta", "group:pinned", "inside")!.order, ["ta"]);
});

test("pin capability is required only for membership changes", () => {
  const noPin: SidebarMoveModel = {
    ...model,
    items: new Map(model.items).set("ta", {
      ...model.items.get("ta")!,
      kind: "thread",
      pinned: false,
      canPin: false,
    }),
  };
  assert.equal(resolveSidebarMove(noPin, "ta", "group:pinned", "inside"), undefined);
  assert.deepEqual(resolveSidebarMove(noPin, "ta", "tb", "after")!.order, ["tb", "ta"]);
});

test("a pinned parent does not pin its children or prevent restoring their ownership", () => {
  const pinnedParent = {
    ...model,
    items: new Map(model.items).set("wa", {
      key: "wa",
      kind: "workspace" as const,
      id: "a",
      pinned: true,
      canPin: true,
    }),
  };
  const move = resolveSidebarMove(pinnedParent, "tp", "wa", "inside")!;
  assert.equal(move.pinned, false);
  assert.equal(move.scope, "threads:workspace:a");
});

test("pin failure stops ordering; order failure retains the successful pin", async () => {
  const move = resolveSidebarMove(model, "ta", "group:pinned", "inside")!;
  for (const fail of ["pin", "order", undefined] as const) {
    const calls: string[] = [];
    const result = await commitSidebarMove(move, {
      async setPinned() {
        calls.push("pin");
        if (fail === "pin") throw new Error("pin failed");
      },
      async saveOrder() {
        calls.push("order");
        if (fail === "order") throw new Error("order failed");
      },
    });
    assert.deepEqual(calls, fail === "pin" ? ["pin"] : ["pin", "order"]);
    assert.equal(result.ok, fail === undefined);
    if (!result.ok) assert.equal(result.phase, fail);
  }
});
