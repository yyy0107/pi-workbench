import assert from "node:assert/strict";
import test from "node:test";
import { act, Children, isValidElement, memo, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import {
  RuntimeProvider,
  type CurrentSessionSnapshot,
  type ThreadListItem,
} from "@workbench/agent-runtime-client";
import {
  WorkspaceSelectionProvider,
  type WorkspaceCapabilities,
} from "@workbench/agent-runtime-client/workspaces";
import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { SidebarDragSessionProvider } from "../hooks/use-sidebar-pointer-reorder";
import { I18nProvider } from "../i18n";
import { WorkbenchSettingsProvider, type WorkbenchSettingsPort } from "../settings";
import { WorkbenchNavigationProvider, type WorkbenchNavigationPort } from "../navigation";
import { SidebarRow } from "../ui/sidebar-items";
import { WorkbenchThreadList } from "./thread-list";
import { WorkbenchThreadListItem } from "./thread-list-item";
import { NewThreadButton } from "./new-thread-button";
import { NewThreadWorkspaceItem } from "../extensions/builtin/workspace-directory-picker/new-thread-workspace-item";
import { useNewThreadLayout } from "../layout/new-thread-layout";
import {
  WorkspaceSidebarProvider,
  useWorkspaceSidebar,
  useWorkspaceSidebarItem,
  sidebarThreadKey,
} from "./workspace-sidebar-context";

test("workspace conversations isolate selection updates and paginate independently on collapse", async () => {
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
  let current: CurrentSessionSnapshot = { sessionId: undefined, isNewThread: false };
  const currentListeners = new Set<() => void>();
  const runtime: ComponentProps<typeof RuntimeProvider>["runtime"] = {
    threads: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    current: {
      getSnapshot: () => current,
      subscribe: (listener) => {
        currentListeners.add(listener);
        return () => {
          currentListeners.delete(listener);
        };
      },
    },
    threadActions: {},
    session: () => undefined,
    async createThread() {
      throw new Error("Unexpected createThread");
    },
    createDraft(options) {
      assert.equal(options?.workspaceId, "project");
      return "local-draft";
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
  let navigation: WorkbenchNavigationPort = {
    currentConversationId: undefined,
    isHome: true,
    openHome() {},
    openConversation() {},
    refresh() {},
  };
  let draftWorkspaceId: string | undefined;
  let collapsedWorkspaceIds: string[] = [];
  let searchQuery = "";
  const lists = new Map<string, ReturnType<typeof WorkbenchThreadList>>();

  const rowRenders = new Map<string, number>();
  const activeRows = new Map<string, boolean>();
  const routedRows = new Map<string, boolean>();
  let model: unknown;
  let fallbackWorkspaceId: string | undefined;
  let dockComposerWhenEmpty = false;
  let openProjectDraft: () => void;
  let openStandaloneDraft: () => void;
  function NewThreadProbe() {
    dockComposerWhenEmpty = useNewThreadLayout().dockComposerWhenEmpty;
    openProjectDraft = NewThreadButton({ workspaceId: "project" }).props.onActivate;
    openStandaloneDraft = NewThreadWorkspaceItem().props.onClick;
    return null;
  }
  // Exercise the shared subscriptions without mounting unrelated DOM controls.
  const RowProbe = memo(function RowProbe({ id }: { id: string }) {
    activeRows.set(
      id,
      useWorkspaceSidebar((state) => state.current.threadId === id),
    );
    routedRows.set(
      id,
      useWorkspaceSidebar((state) => state.navigation.currentConversationId === id),
    );
    useWorkspaceSidebarItem(sidebarThreadKey(id));
    rowRenders.set(id, (rowRenders.get(id) ?? 0) + 1);
    return null;
  });

  // Capture the rendered list and its button callbacks without mounting unrelated row controls.
  function Probe(props: ComponentProps<typeof WorkbenchThreadList>) {
    const sidebar = useWorkspaceSidebar();
    model = sidebar.model;
    const item = sidebar.model.items.get(sidebarThreadKey("pinned-0"));
    fallbackWorkspaceId = item?.kind === "thread" ? item.workspaceId : undefined;
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
                selection={{ workspaces, collapsedWorkspaceIds, draftWorkspaceId }}
              >
                <WorkbenchNavigationProvider navigation={navigation}>
                  <SidebarDragSessionProvider>
                    <WorkspaceSidebarProvider searchQuery={searchQuery}>
                      <NewThreadProbe />
                      <Probe workspaceId="project" />
                      <Probe workspaceId="pinned-project" />
                      <Probe pinnedOnly />
                      <RowProbe id="pinned-0" />
                      <RowProbe id="pinned-1" />
                      <RowProbe id="pinned-2" />
                    </WorkspaceSidebarProvider>
                  </SidebarDragSessionProvider>
                </WorkbenchNavigationProvider>
              </WorkspaceSelectionProvider>
            </I18nProvider>
          </WorkbenchSettingsProvider>
        </RuntimeProvider>,
      );
    });
  const children = (id = "project") => Children.toArray(lists.get(id)?.props.children);
  const rowCount = (id = "project") =>
    children(id).filter((child) => isValidElement(child) && child.type === WorkbenchThreadListItem)
      .length;
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

    const originalModel = model;
    const untouchedRowRenders = rowRenders.get("pinned-2");
    for (const id of ["pinned-0", "pinned-1"]) {
      navigation = { ...navigation, currentConversationId: id, isHome: false };
      await render();
      assert.equal(routedRows.get(id), true);
      await act(async () => {
        current = { sessionId: id, threadId: id, isNewThread: false };
        currentListeners.forEach((listener) => listener());
      });
      assert.equal(activeRows.get(id), true);
      assert.equal(model, originalModel, "selection must not rebuild the catalog or drag model");
      assert.equal(
        rowRenders.get("pinned-2"),
        untouchedRowRenders,
        "unrelated rows must skip both route and runtime updates",
      );
    }
    assert.equal(activeRows.get("pinned-0"), false);
    assert.equal(routedRows.get("pinned-0"), false);
    draftWorkspaceId = "project";
    await render();
    await act(async () => {
      current = { sessionId: "pinned-0", threadId: "pinned-0", isNewThread: false };
      currentListeners.forEach((listener) => listener());
    });
    assert.equal(
      fallbackWorkspaceId,
      "project",
      "draft workspace fallback still follows the current thread",
    );
    draftWorkspaceId = undefined;
    await render();
    assert.equal(fallbackWorkspaceId, undefined);

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

    draftWorkspaceId = "project";
    navigation = { ...navigation, currentConversationId: undefined, isHome: true };
    await act(async () => {
      current = { sessionId: "local-draft", isNewThread: true };
      currentListeners.forEach((listener) => listener());
    });
    await render();
    assert.equal(rowCount(), 5);
    assert.equal(
      children().filter(isValidElement).length,
      6,
      "a new conversation adds no placeholder row and consumes no pagination slot",
    );
    await showMore();
    assert.equal(rowCount(), 10);

    collapsedWorkspaceIds = ["project"];
    await render();
    collapsedWorkspaceIds = [];
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
    assert.equal(dockComposerWhenEmpty, false, "new conversations start centered by default");
    await act(async () => openProjectDraft());
    assert.equal(dockComposerWhenEmpty, true, "the project entry docks its draft composer");

    draftWorkspaceId = undefined;
    await act(async () => {
      current = { sessionId: "unscoped-draft", isNewThread: true };
      currentListeners.forEach((listener) => listener());
    });
    await render();
    assert.equal(
      dockComposerWhenEmpty,
      true,
      "clearing the project preserves the dock when the runtime switches to an unscoped draft",
    );

    draftWorkspaceId = "project";
    await act(async () => {
      current = { sessionId: "local-draft", isNewThread: true };
      currentListeners.forEach((listener) => listener());
    });
    await render();
    assert.equal(dockComposerWhenEmpty, true, "selecting a project again preserves the dock");
    await act(async () => openStandaloneDraft());
    assert.equal(
      dockComposerWhenEmpty,
      false,
      "the standalone entry stays centered even when the runtime reuses the same project draft",
    );
    await act(async () => openProjectDraft());
    assert.equal(dockComposerWhenEmpty, true, "returning through the project entry docks again");
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});
