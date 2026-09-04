import assert from "node:assert/strict";
import test from "node:test";
import { act, Children, isValidElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { RuntimeProvider, type ThreadListItem } from "@workbench/agent-runtime-client";
import {
  WorkspaceSelectionProvider,
  type WorkspaceCapabilities,
} from "@workbench/agent-runtime-client/workspaces";
import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { SidebarDragSessionProvider } from "../hooks/use-sidebar-pointer-reorder";
import { I18nProvider } from "../i18n";
import { WorkbenchSettingsProvider, type WorkbenchSettingsPort } from "../settings";
import { SidebarRow } from "../ui/sidebar-items";
import { DraftThreadListItem } from "./draft-thread-list-item";
import { WorkbenchThreadList } from "./thread-list";
import { WorkbenchThreadListItem } from "./thread-list-item";
import { WorkspaceSidebarProvider } from "./workspace-sidebar-context";

test("workspace conversations reveal five rows at a time and reset independently on collapse", async () => {
  const environment = installMinimalReactDomEnvironment();
  Object.assign(window, { addEventListener() {}, removeEventListener() {} });
  const root = createRoot(environment.container);
  const workspaces = [
    { id: "project", name: "Project", rootPath: "/project" },
    { id: "pinned-project", name: "Pinned project", rootPath: "/pinned", pinned: true },
  ];
  const threadDefaults = {
    isArchived: false,
    isPinned: false,
    isRunning: false,
    isWaitingForInput: false,
    hasUnreadCompletion: false,
  };
  const threads: ThreadListItem[] = [
    ...workspaces.flatMap((workspace) =>
      Array.from({ length: 12 }, (_, index) => ({
        ...threadDefaults,
        threadId: `${workspace.id}-${index}`,
        title: index < 7 ? `Match ${index}` : `Conversation ${index}`,
        workspace,
      })),
    ),
    ...Array.from({ length: 7 }, (_, index) => ({
      ...threadDefaults,
      threadId: `pinned-${index}`,
      isPinned: true,
    })),
  ];
  const snapshot = { threads, isLoading: false };
  const current = { sessionId: undefined, isNewThread: false };
  const runtime: ComponentProps<typeof RuntimeProvider>["runtime"] = {
    threads: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    current: { getSnapshot: () => current, subscribe: () => () => {} },
    threadActions: {},
    session: () => undefined,
    async createThread() {
      throw new Error("Unexpected createThread");
    },
    createDraft() {
      throw new Error("Unexpected createDraft");
    },
    switchToThread() {},
    switchToNewThread() {},
  };
  const settings: WorkbenchSettingsPort = {
    async load() {
      return {};
    },
    async update() {},
  };
  const capabilities: WorkspaceCapabilities = {
    activateWorkspace() {},
    deactivateWorkspace() {},
    revealWorkspace() {},
    setWorkspaceCollapsed() {},
    toggleWorkspaceCollapsed() {},
    beginNewThread() {},
    beginNewThreadWithCreatedWorkspace() {},
    destroyNewThread() {},
    async refreshWorkspaces() {},
    async openWorkspaceFolder() {},
    async removeWorkspace() {},
    async moveWorkspaceBefore() {},
    async setWorkspacePinned() {},
  };
  let collapsedWorkspaceIds: string[] = [];
  let searchQuery = "";
  let showNewThread = false;
  const lists = new Map<string, ReturnType<typeof WorkbenchThreadList>>();

  // Capture the rendered list and its button callbacks without mounting unrelated row controls.
  function Probe(props: ComponentProps<typeof WorkbenchThreadList>) {
    lists.set(props.workspaceId ?? "pinned", WorkbenchThreadList(props));
    return null;
  }
  const render = () =>
    act(async () => {
      root.render(
        <RuntimeProvider runtime={runtime}>
          <WorkbenchSettingsProvider service={settings}>
            <I18nProvider initialLocale="zh-CN">
              <WorkspaceSelectionProvider
                capabilities={capabilities}
                selection={{ workspaces, collapsedWorkspaceIds }}
              >
                <SidebarDragSessionProvider>
                  <WorkspaceSidebarProvider searchQuery={searchQuery}>
                    <Probe workspaceId="project" showNewThread={showNewThread} />
                    <Probe workspaceId="pinned-project" />
                    <Probe pinnedOnly />
                  </WorkspaceSidebarProvider>
                </SidebarDragSessionProvider>
              </WorkspaceSelectionProvider>
            </I18nProvider>
          </WorkbenchSettingsProvider>
        </RuntimeProvider>,
      );
    });
  const children = (id = "project") => Children.toArray(lists.get(id)?.props.children);
  const rowCount = (id = "project") =>
    children(id).filter(
      (child) =>
        isValidElement(child) &&
        (child.type === WorkbenchThreadListItem || child.type === DraftThreadListItem),
    ).length;
  const more = (id = "project") =>
    children(id)
      .filter(isValidElement<{ label: string; onActivate(): void }>)
      .find((child) => child.type === SidebarRow);
  const showMore = () =>
    act(async () => {
      const button = more();
      assert.ok(button);
      button.props.onActivate();
    });

  try {
    await render();
    assert.equal(rowCount(), 5);
    assert.equal(more()?.props.label, "展示更多");
    assert.equal(rowCount("pinned-project"), 5);
    assert.equal(rowCount("pinned"), 7);
    assert.equal(more("pinned"), undefined);

    await showMore();
    assert.equal(rowCount(), 10);
    assert.equal(rowCount("pinned-project"), 5);
    await showMore();
    assert.equal(rowCount(), 12);
    assert.equal(more(), undefined);

    collapsedWorkspaceIds = ["project"];
    await render();
    assert.equal(rowCount(), 12, "keep the closing rows until the panel finishes its animation");
    collapsedWorkspaceIds = [];
    await render();
    assert.equal(rowCount(), 5);
    assert.ok(more());

    showNewThread = true;
    await render();
    assert.equal(rowCount(), 5);
    assert.ok(
      children().some((child) => isValidElement(child) && child.type === DraftThreadListItem),
    );
    await showMore();
    assert.equal(rowCount(), 10);

    collapsedWorkspaceIds = ["project"];
    await render();
    collapsedWorkspaceIds = [];
    showNewThread = false;
    searchQuery = "Match";
    await render();
    assert.equal(rowCount(), 5);
    await showMore();
    assert.equal(rowCount(), 7);
    assert.equal(more(), undefined);

    searchQuery = "Match 0";
    await render();
    assert.equal(rowCount(), 1);
    assert.equal(more(), undefined);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});
