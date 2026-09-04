import assert from "node:assert/strict";
import test from "node:test";

const { ExtensionManager } =
  (await import("@workbench/extension-sdk/internal")) as typeof import("@workbench/extension-sdk/internal");
const { workspaceFileExtension } = (await import(
  new URL("./extension.ts", import.meta.url).href
)) as typeof import("./extension");
const { createWorkspaceFileOpenersBinding, registerWorkspaceFileOpeners } = (await import(
  new URL("../../services/pi-file-workspace-openers-bridge.tsx", import.meta.url).href
)) as typeof import("../../services/pi-file-workspace-openers-bridge");

const openerIds = [
  "workspace.file",
  "workspace.file.skill",
  "workspace.directory.skill",
  "workspace.file.extension",
  "workspace.directory.extension",
];

test("Workspace File owns its surface and opener bridge for one extension lifecycle", () => {
  const manager = new ExtensionManager();
  const activation = manager.activate(workspaceFileExtension);

  assert.equal(manager.workspace.get("file") !== undefined, true);
  assert.equal(
    manager.workspace.get("file")?.runtime,
    undefined,
    "Agent file tools must not navigate the user-owned workspace",
  );
  assert.deepEqual(
    manager.slots.get("shell.overlay").map(({ id }) => id),
    ["workbench.workspace-file.openers"],
  );
  assert.deepEqual(
    manager.openers.getAll().map(({ id }) => id),
    openerIds,
  );

  activation.dispose();

  assert.equal(manager.workspace.get("file"), undefined);
  assert.deepEqual(manager.slots.get("shell.overlay"), []);
  assert.deepEqual(manager.openers.getAll(), []);
});

test("Workspace File opener binding defers runtime behavior without deferring registration", () => {
  const manager = new ExtensionManager();
  const binding = createWorkspaceFileOpenersBinding();
  const registration = registerWorkspaceFileOpeners(manager.openers, binding);
  const runtime = {
    files: {} as never,
    resources: {} as never,
    diffs: {} as never,
  };
  const request = {
    resource: { scheme: "workspace-file", path: "src/index.ts" },
    context: { applicationId: "test" },
  };

  assert.deepEqual(
    manager.openers.getAll().map(({ id }) => id),
    openerIds,
  );
  assert.equal(manager.openers.getAll()[0]?.canOpen(request), 0);

  const connection = binding.connect(runtime);
  assert.equal(manager.openers.getAll()[0]?.canOpen(request), 100);

  connection.dispose();
  assert.equal(manager.openers.getAll()[0]?.canOpen(request), 0);

  registration.dispose();

  assert.deepEqual(manager.openers.getAll(), []);
});

test("Workspace File opener registration rolls back earlier schemes after a collision", () => {
  const manager = new ExtensionManager();
  const collision = manager.openers.register({
    id: "workspace.file.skill",
    canOpen: () => 0,
    open: () => undefined,
  });

  assert.throws(
    () => registerWorkspaceFileOpeners(manager.openers, createWorkspaceFileOpenersBinding()),
    /already registered/u,
  );
  assert.deepEqual(
    manager.openers.getAll().map(({ id }) => id),
    ["workspace.file.skill"],
  );

  collision.dispose();
});
