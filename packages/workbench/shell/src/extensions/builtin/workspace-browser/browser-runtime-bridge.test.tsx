import assert from "node:assert/strict";
import test from "node:test";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { RuntimeProvider, SessionProvider } from "@workbench/agent-runtime-client";
import type {
  ConversationNode,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";
import { ExtensionProvider } from "@workbench/extension-host/installation";
import type { BrowserCommand } from "@workbench/browser-contracts";
import type { LocalizableText } from "@workbench/extension-sdk";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";

import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { createPanelStore } from "../../../panels";
import {
  RightWorkspaceProvider,
  WorkspaceSurfaceRuntimeHost,
  useRightWorkspaceState,
} from "../../../right-workspace-react";
import type { RightWorkspaceState } from "../../../right-workspace";
import { useRightWorkspaceInstallationResource } from "../../../right-workspace/right-workspace-context";
import {
  RuntimeConnectionProvider,
  createSameOriginRuntimeConnection,
} from "../../../runtime-connection";
import {
  BROWSER_SESSION_SERVICE_RESOURCE,
  MemoryBrowserSessionService,
  useBrowserSessionService,
  type BrowserSessionService,
} from "./browser-session-service";
import { browserSurfaceDefinition } from "./extension";

test("thread revisits preserve the browser page and history while new calls reuse its tab", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register(browserSurfaceDefinition);
  const listeners = new Set<() => void>();
  const errors: unknown[] = [];
  const agentNavigations: Array<{ command: BrowserCommand; source?: "agent" }> = [];
  class Browser extends MemoryBrowserSessionService {
    override async command<T>(command: BrowserCommand, source?: "agent"): Promise<T> {
      agentNavigations.push({ command, source });
      if (command.type === "navigate") await this.navigate(command.sessionId, command.url);
      else assert.equal(command.type, "close");
      return undefined as T;
    }
  }
  const tool = (callId: string, url: string): ToolCallBlock => ({
    key: callId,
    kind: "tool-call",
    callId,
    toolName: "browser_navigate",
    argumentsText: "{}",
    arguments: { sessionId: "browser-1", url },
    status: "complete",
    result: "done",
  });
  const firstCalls = [
    tool("call-1", "https://one.example/"),
    tool("call-2", "https://two.example/"),
  ];
  const node = (blocks: ToolCallBlock[]): ConversationNode => ({
    key: "assistant",
    kind: "assistant",
    status: "complete",
    blocks,
  });
  const nodes = new Map([
    ["first", node(firstCalls)],
    ["second", node([])],
  ]);
  const sessions = new Map(
    ["first", "second"].map((id) => {
      const snapshot = {
        sessionId: id,
        isRunning: false,
        isLoading: false,
        hasMore: false,
        nodeKeys: ["assistant"],
        composer: { text: "", attachments: [], mode: "send", phase: "idle" },
      };
      return [
        id,
        {
          id,
          actions: {},
          snapshot: { getSnapshot: () => snapshot, subscribe: () => () => {} },
          node: () => ({
            getSnapshot: () => nodes.get(id),
            subscribe(listener: () => void) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          }),
        },
      ];
    }),
  );
  const current = { sessionId: "first", isNewThread: false };
  const runtime = {
    current: { getSnapshot: () => current, subscribe: () => () => {} },
    session: (id: string) => sessions.get(id),
  } as unknown as ComponentProps<typeof RuntimeProvider>["runtime"];
  const panelStore = createPanelStore();
  const initialContext = { applicationId: "test" };
  const createOpener = () => ({
    open: async () => {},
    getHandlers: () => [],
    subscribe: () => () => {},
  });
  const validateLocalizableText = (value: unknown): value is LocalizableText =>
    typeof value === "string";
  let browser!: BrowserSessionService;
  let workspace!: RightWorkspaceState;
  function Probe() {
    useRightWorkspaceInstallationResource(BROWSER_SESSION_SERVICE_RESOURCE, () => new Browser());
    browser = useBrowserSessionService();
    workspace = useRightWorkspaceState((value) => value);
    return null;
  }
  const render = (sessionId: string) =>
    act(async () =>
      root.render(
        <RuntimeConnectionProvider
          connection={createSameOriginRuntimeConnection("http://localhost")}
        >
          <RuntimeProvider runtime={runtime}>
            <ExtensionProvider
              extensions={[]}
              panelStore={panelStore}
              onError={(error) => errors.push(error)}
            >
              <RightWorkspaceProvider
                initialContext={initialContext}
                registry={registry}
                validateLocalizableText={validateLocalizableText}
                createOpener={createOpener}
              >
                <Probe />
                <SessionProvider sessionId={sessionId}>
                  <WorkspaceSurfaceRuntimeHost
                    context={{ applicationId: "test", threadId: sessionId }}
                    reportError={(error) => errors.push(error)}
                  />
                </SessionProvider>
              </RightWorkspaceProvider>
            </ExtensionProvider>
          </RuntimeProvider>
        </RuntimeConnectionProvider>,
      ),
    );

  try {
    await render("first");
    assert.equal(browser.getSession("browser-1")?.url, "https://two.example/");
    assert.equal(workspace.surfaceOrder.length, 1);
    const surfaceId = workspace.surfaceOrder[0]!;
    await act(async () => browser.navigate("browser-1", "https://user.example/"));
    const liveSession = browser.getSession("browser-1");

    await render("second");
    await render("first");
    assert.deepEqual(browser.getSession("browser-1"), liveSession);
    assert.deepEqual(workspace.surfaceOrder, [surfaceId]);

    await act(async () => {
      nodes.set("first", node([...firstCalls, tool("call-3", "https://new.example/")]));
      for (const listener of listeners) listener();
    });
    assert.equal(browser.getSession("browser-1")?.url, "https://new.example/");
    assert.equal(browser.getSession("browser-1")?.revision, liveSession!.revision + 1);
    assert.equal(workspace.surfaces[surfaceId]?.params.url, "https://new.example/");
    assert.deepEqual(workspace.surfaceOrder, [surfaceId]);
    await act(async () => browser.goBack("browser-1"));
    assert.equal(browser.getSession("browser-1")?.url, "https://user.example/");
    assert.deepEqual(
      agentNavigations.map(({ source }) => source),
      ["agent", "agent"],
    );
    const ownRevision = browser.getSession("browser-1")!.revision;
    await act(async () => {
      nodes.set(
        "first",
        node([
          ...firstCalls,
          {
            ...tool("own-call", "https://user.example/"),
            toolName: "workbench_browser",
            arguments: { action: "attach" },
            result: {
              text: "done",
              details: {
                browserSessionId: "browser-1",
                projectId: "test",
                url: "https://user.example/",
              },
            },
          },
        ]),
      );
      for (const listener of listeners) listener();
    });
    assert.equal(
      browser.getSession("browser-1")?.revision,
      ownRevision,
      "completed host browser commands must not execute navigation twice",
    );
    assert.equal(agentNavigations.length, 2);
    assert.deepEqual(workspace.surfaceOrder, [surfaceId]);
    await act(async () => {
      nodes.set(
        "first",
        node([
          {
            ...tool("close-call", "https://user.example/"),
            toolName: "workbench_browser",
            arguments: { action: "close", sessionId: "browser-1" },
            result: { text: "done", details: { browserSessionId: "browser-1" } },
          },
        ]),
      );
      for (const listener of listeners) listener();
    });
    assert.deepEqual(
      workspace.surfaceOrder,
      [],
      "closing an agent browser also closes its workspace surface",
    );
    const listCall: ToolCallBlock = {
      ...tool("list-call", "https://ignored.example/"),
      toolName: "workbench_browser",
      arguments: { action: "tabs.list" },
      result: {
        content: [{ type: "text", text: "[]" }],
        details: {},
      },
    };
    await act(async () => {
      nodes.set("first", node([listCall]));
      for (const listener of listeners) listener();
    });
    assert.deepEqual(workspace.surfaceOrder, [], "tab discovery must not reveal a synthetic tab");
    const commandsBeforeSnapshot = agentNavigations.length;
    await act(async () => {
      nodes.set(
        "first",
        node([
          listCall,
          {
            ...tool("snapshot-call", "https://observed.example/"),
            toolName: "workbench_browser",
            arguments: { action: "snapshot", sessionId: "observed-tab" },
            result: {
              content: [{ type: "text", text: '{"snapshotId":"snapshot-1","nodes":[]}' }],
              details: {
                browserSessionId: "observed-tab",
                projectId: "test",
                url: "https://observed.example/",
              },
            },
          },
        ]),
      );
      for (const listener of listeners) listener();
    });
    assert.equal(workspace.surfaceOrder.length, 1);
    const observedSurface = workspace.surfaces[workspace.surfaceOrder[0]!]!;
    assert.equal(observedSurface.params.browserSessionId, "observed-tab");
    assert.equal(observedSurface.params.url, "https://observed.example/");
    assert.equal(browser.getSession("observed-tab")?.url, "https://observed.example/");
    assert.equal(
      agentNavigations.length,
      commandsBeforeSnapshot,
      "snapshot projection reveals its observed session without replaying navigation",
    );
    assert.deepEqual(errors, []);
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});
