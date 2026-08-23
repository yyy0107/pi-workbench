import assert from "node:assert/strict";
import test from "node:test";

import type { RightWorkspaceState, WorkspaceSurfaceInstance } from "./surface-types";
import {
  selectActiveAuxiliarySurface,
  selectActiveSurface,
  selectContextSurfacesByPlacement,
} from "./workspace-selectors";
import { DEFAULT_AUXILIARY_SURFACE_WIDTH, DEFAULT_RIGHT_WORKSPACE_WIDTH } from "./workspace-store";

function surface(
  id: string,
  placement: WorkspaceSurfaceInstance["placement"],
  scopeKey: string,
): WorkspaceSurfaceInstance {
  return {
    id,
    kind: id.split(":")[0] ?? "fixture",
    placement,
    title: id,
    resourceKey: id,
    scope: { type: "thread", key: scopeKey },
    params: {},
    status: "ready",
    createdAt: 1,
    lastActiveAt: 1,
  };
}

test("workspace selectors resolve primary and auxiliary surfaces independently", () => {
  const primary = surface("file:one", "primary", "thread-1");
  const auxiliary = surface("explorer:one", "auxiliary", "thread-1");
  const other = surface("file:other", "primary", "thread-2");
  const state: RightWorkspaceState = {
    open: true,
    width: DEFAULT_RIGHT_WORKSPACE_WIDTH,
    maximized: false,
    activeSurfaceId: other.id,
    activeAuxiliarySurfaceId: auxiliary.id,
    auxiliaryOpen: true,
    auxiliaryWidth: DEFAULT_AUXILIARY_SURFACE_WIDTH,
    surfaceOrder: [primary.id, auxiliary.id, other.id],
    surfaces: {
      [primary.id]: primary,
      [auxiliary.id]: auxiliary,
      [other.id]: other,
    },
    navigationHistory: [primary.id, auxiliary.id, other.id],
    hydrated: true,
  };
  const context = { applicationId: "app", threadId: "thread-1" };

  assert.deepEqual(selectContextSurfacesByPlacement(state, context, "primary"), [primary]);
  assert.deepEqual(selectContextSurfacesByPlacement(state, context, "auxiliary"), [auxiliary]);
  assert.equal(selectActiveSurface(state, context)?.id, primary.id);
  assert.equal(selectActiveAuxiliarySurface(state, context)?.id, auxiliary.id);
});

test("workspace selectors retain each conversation's own active surface", () => {
  const first = surface("file:first", "primary", "thread-1");
  const later = surface("file:later", "primary", "thread-1");
  const other = surface("file:other", "primary", "thread-2");
  const state: RightWorkspaceState = {
    open: true,
    width: DEFAULT_RIGHT_WORKSPACE_WIDTH,
    maximized: false,
    activeSurfaceId: other.id,
    activeAuxiliarySurfaceId: null,
    auxiliaryOpen: true,
    auxiliaryWidth: DEFAULT_AUXILIARY_SURFACE_WIDTH,
    surfaceOrder: [first.id, later.id, other.id],
    surfaces: {
      [first.id]: first,
      [later.id]: later,
      [other.id]: other,
    },
    navigationHistory: [later.id, first.id, other.id],
    hydrated: true,
  };

  assert.equal(
    selectActiveSurface(state, { applicationId: "app", threadId: "thread-1" })?.id,
    first.id,
  );
  assert.equal(
    selectActiveSurface(state, { applicationId: "app", threadId: "thread-2" })?.id,
    other.id,
  );
});
