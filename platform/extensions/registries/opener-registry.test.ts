import assert from "node:assert/strict";
import test from "node:test";

import { DefaultOpenerService } from "@/services/opener-service";

import { ExtensionManager } from "../extension-manager";
import type { OpenResourceRequest, WorkspaceSurfaceOpenOperations } from "../api/opener";
import { OpenerRegistryImpl } from "./opener-registry";

const request: OpenResourceRequest = {
  resource: { scheme: "file", path: "/workspace/app.ts", label: "app.ts" },
  context: { applicationId: "workbench", threadId: "thread-1" },
};

const unusedSurfaces: WorkspaceSurfaceOpenOperations = {
  open: () => "unused",
  reveal: () => "unused",
};

test("open handlers are unique, frozen, and disposable", () => {
  const registry = new OpenerRegistryImpl();
  const handler = {
    id: "workspace.file",
    canOpen: () => 100,
    open: () => "file-surface",
  };
  const disposable = registry.register(handler);

  assert.equal(registry.getAll().length, 1);
  assert.equal(Object.isFrozen(registry.getAll()[0]), true);
  assert.throws(() => registry.register(handler), /already registered/);

  disposable.dispose();
  assert.equal(registry.getAll().length, 0);
});

test("opener service executes the highest-scoring positive handler", async () => {
  const registry = new OpenerRegistryImpl();
  const calls: string[] = [];
  registry.register({
    id: "fallback",
    canOpen: () => 10,
    open: () => {
      calls.push("fallback");
    },
  });
  registry.register({
    id: "file",
    canOpen: (candidate) => (candidate.resource.scheme === "file" ? 100 : 0),
    open: (candidate, context) => {
      calls.push(candidate.resource.path);
      assert.equal(context.surfaces, unusedSurfaces);
      return "file-surface";
    },
  });

  const service = new DefaultOpenerService(registry, unusedSurfaces);
  assert.equal(await service.open(request), "file-surface");
  assert.deepEqual(calls, ["/workspace/app.ts"]);
});

test("opener service rejects resources without a positive handler", async () => {
  const registry = new OpenerRegistryImpl();
  registry.register({
    id: "unsupported",
    canOpen: () => Number.NaN,
    open: () => undefined,
  });

  await assert.rejects(
    () => new DefaultOpenerService(registry, unusedSurfaces).open(request),
    /No opener is registered/,
  );
});

test("extension deactivation removes its open handlers", () => {
  const manager = new ExtensionManager();
  manager.activate({
    id: "workbench.file-opener-fixture",
    name: "File Opener Fixture",
    version: "1.0.0",
    setup(context) {
      return context.openers.register({
        id: "fixture.file",
        canOpen: () => 100,
        open: () => undefined,
      });
    },
  });

  assert.equal(manager.openers.getAll().length, 1);
  manager.deactivate("workbench.file-opener-fixture");
  assert.equal(manager.openers.getAll().length, 0);
});
