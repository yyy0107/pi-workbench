import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RuntimeProvider } from "@workbench/agent-runtime-client";
import {
  resolveWorkspaceSelection,
  WorkspaceSelectionProvider,
  type WorkspaceCapabilities,
} from "@workbench/agent-runtime-client/workspaces";
import { PiDraftWorkspaceTracker } from "../../src/integration/trackers";
import { PiSessionManager } from "../../src/runtime/manager";

const { installMinimalReactDomEnvironment } = await import(
  new URL("../../../../../core/testkit/test/client/react-dom-environment.ts", import.meta.url).href
);

test("restores project drafts across navigation and keeps them out of the catalog until promotion", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const requests: string[] = [];
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const manager = new PiSessionManager({
    transport: {
      http: async (_path, init) => {
        const request = JSON.parse(String(init?.body));
        requests.push(request.method);
        assert.equal(request.method, "session.create");
        assert.equal(request.payload.workspaceId, "a");
        await createGate;
        return Response.json({
          type: "server-response",
          rpcId: request.rpcId,
          result: { ok: true, value: { sessionId: "promoted-a" } },
        });
      },
    },
  });
  manager.start = async () => {};
  const workspaces = ["a", "b"].map((id) => ({ id, name: id, rootPath: `/workspace/${id}` }));
  for (const workspace of workspaces) {
    manager.acceptCreatedWorkspace({ ...workspace, cwd: workspace.rootPath });
  }
  const render = (workspaceId: string | undefined, navigate: () => void) =>
    act(async () => {
      navigate();
      root.render(
        <RuntimeProvider runtime={manager}>
          <WorkspaceSelectionProvider
            capabilities={{} as WorkspaceCapabilities}
            selection={resolveWorkspaceSelection(workspaces, {
              activeWorkspaceId: workspaceId,
              draftWorkspaceId: workspaceId,
              collapsedWorkspaceIds: [],
            })}
          >
            <PiDraftWorkspaceTracker manager={manager} />
          </WorkspaceSelectionProvider>
        </RuntimeProvider>,
      );
    });
  const openDraft = (workspaceId?: string) =>
    render(workspaceId, () => {
      manager.createDraft({ workspaceId });
    });
  const activeSession = () => manager.session(manager.current.getSnapshot().sessionId!)!;

  try {
    await openDraft("a");
    const a = activeSession();
    a.actions.setComposerText!("项目 A 的草稿\n保留换行和空格  ");
    a.actions.addComposerAttachment!({
      key: "image-a",
      kind: "inline",
      name: "a.png",
      mediaType: "image/png",
      source: "data:image/png;base64,AA==",
    });
    const composerA = a.snapshot.getSnapshot().composer;

    await openDraft("b");
    const b = activeSession();
    assert.notEqual(b, a);
    assert.equal(b.snapshot.getSnapshot().composer.text, "");
    b.actions.setComposerText!("项目 B 的草稿");
    const composerB = b.snapshot.getSnapshot().composer;

    manager.getSession("existing", "existing");
    await render(undefined, () => manager.switchToThread("existing"));
    assert.equal(manager.session(a.id), a);
    assert.equal(manager.getThreadStateSnapshot(a.id).metadata.workspace?.id, "a");
    assert.equal(manager.getThreadStateSnapshot(b.id).metadata.workspace?.id, "b");
    for (const workspaceId of ["a", "a", "b", "a"]) {
      await openDraft(workspaceId);
      assert.equal(activeSession(), workspaceId === "a" ? a : b);
      assert.equal(
        activeSession().snapshot.getSnapshot().composer,
        workspaceId === "a" ? composerA : composerB,
      );
      assert.equal(manager.current.getSnapshot().isNewThread, true);
      assert.deepEqual(manager.threads.getSnapshot().threads, []);
    }
    assert.deepEqual(requests, [], "opening and restoring drafts must not create remote sessions");

    await openDraft();
    const unassigned = activeSession();
    unassigned.actions.setComposerText!("还未选择项目的草稿");
    await render(undefined, () => manager.switchToThread("existing"));
    await render(undefined, () => manager.switchToNewThread());
    assert.equal(activeSession(), unassigned);
    assert.equal(activeSession().snapshot.getSnapshot().composer.text, "还未选择项目的草稿");

    await openDraft("a");
    const promotion = manager.ensureRemote(a);
    await openDraft("b");
    await act(async () => {
      releaseCreate();
      await promotion;
    });
    assert.equal(activeSession(), b, "background promotion must not steal the selected draft");
    assert.deepEqual(requests, ["session.create"]);
    assert.deepEqual(
      manager.threads.getSnapshot().threads.map((thread) => thread.threadId),
      ["promoted-a"],
    );
    assert.equal(manager.session("promoted-a"), a);
    await openDraft("a");
    assert.notEqual(activeSession(), a);
    assert.equal(activeSession().snapshot.getSnapshot().composer.text, "");
    assert.deepEqual(activeSession().snapshot.getSnapshot().composer.attachments, []);
    await openDraft("b");
    assert.equal(activeSession().snapshot.getSnapshot().composer, composerB);
  } finally {
    releaseCreate();
    await act(async () => root.unmount());
    manager.dispose();
    environment.restore();
  }
});
