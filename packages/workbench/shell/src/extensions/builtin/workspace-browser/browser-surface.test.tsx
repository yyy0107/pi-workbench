import assert from "node:assert/strict";
import test from "node:test";
import { Children, act, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ExtensionProvider } from "@workbench/extension-host/installation";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import type { LocalizableText, WorkspaceSurfaceInstance } from "@workbench/extension-sdk";

import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { I18nProvider } from "../../../i18n";
import { createPanelStore } from "../../../panels";
import {
  RightWorkspaceProvider,
  useRightWorkspace,
  useRightWorkspaceState,
} from "../../../right-workspace-react";
import type { RightWorkspaceState } from "../../../right-workspace";
import { WorkbenchSettingsProvider } from "../../../settings";
import {
  RuntimeConnectionProvider,
  createSameOriginRuntimeConnection,
} from "../../../runtime-connection";
import { useRightWorkspaceInstallationResource } from "../../../right-workspace/right-workspace-context";
import {
  BROWSER_SESSION_SERVICE_RESOURCE,
  MemoryBrowserSessionService,
} from "./browser-session-service";
import type { BrowserCommand } from "@workbench/browser-contracts";
import { BrowserViewport, browserPointerPosition } from "./browser-viewport";
import { DropdownMenuItem } from "../../../ui";
import { InputGroupInput } from "../../../ui/input-group";
import { BrowserMenuItem } from "./browser-menu-item";
import {
  BrowserSurface,
  browserDisplayAddress,
  type BrowserSurfaceParams,
} from "./browser-surface";
import { browserSurfaceDefinition } from "./extension";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child)
      ? [child, ...elements(child.props.children)]
      : [],
  );
}

test("browser tabs preserve address drafts and route toolbar actions to the live browser", async () => {
  const dom = installMinimalReactDomEnvironment();
  const commands: BrowserCommand[] = [];
  class Browser extends MemoryBrowserSessionService {
    override async command<T>(command: BrowserCommand): Promise<T> {
      commands.push(command);
      if (command.type === "attach")
        return this.attach({
          id: command.sessionId,
          projectId: command.projectId,
          url: command.url ?? "about:blank",
          title: "Restored",
          status: "ready",
          canGoBack: false,
          canGoForward: false,
        }) as T;
      return { found: true } as T;
    }
  }
  const browser = new Browser();
  const root = createRoot(dom.container);
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register(browserSurfaceDefinition);
  const context = { applicationId: "browser-test", projectId: "project", threadId: "thread" };
  const errors: unknown[] = [];
  let closed = 0;
  let controller!: ReturnType<typeof useRightWorkspace>;
  let state!: RightWorkspaceState;
  let menu!: ReturnType<typeof BrowserMenuItem>;
  let tree!: ReturnType<typeof BrowserSurface>;

  function MenuProbe() {
    menu = BrowserMenuItem({ closeMenu: () => closed++ });
    return null;
  }
  function SurfaceProbe({ surface }: { surface: WorkspaceSurfaceInstance<BrowserSurfaceParams> }) {
    tree = BrowserSurface({ surface, context, isVisible: true });
    return null;
  }
  function Probe() {
    useRightWorkspaceInstallationResource(BROWSER_SESSION_SERVICE_RESOURCE, () => browser);
    controller = useRightWorkspace();
    state = useRightWorkspaceState((value) => value);
    const surface = state.surfaces[state.surfaceOrder[0] ?? ""];
    return (
      <>
        <MenuProbe />
        {surface ? (
          <SurfaceProbe surface={surface as WorkspaceSurfaceInstance<BrowserSurfaceParams>} />
        ) : null}
      </>
    );
  }
  const input = () => {
    const element = elements(tree).find((candidate) => candidate.type === InputGroupInput);
    assert.ok(element);
    return element as ReactElement<React.ComponentProps<typeof InputGroupInput>>;
  };
  const submit = () => {
    const form = elements(tree).find((candidate) => candidate.type === "form");
    assert.ok(form);
    (form as ReactElement<React.ComponentProps<"form">>).props.onSubmit?.({
      preventDefault() {},
    } as never);
  };

  try {
    await act(async () => {
      root.render(
        <RuntimeConnectionProvider
          connection={createSameOriginRuntimeConnection("http://localhost")}
        >
          <WorkbenchSettingsProvider
            service={{ load: async () => ({ locale: "en-US" }), update: async () => {} }}
          >
            <I18nProvider initialLocale="en-US">
              <ExtensionProvider
                extensions={[]}
                panelStore={createPanelStore()}
                onError={(error) => errors.push(error)}
              >
                <RightWorkspaceProvider
                  initialContext={context}
                  registry={registry}
                  validateLocalizableText={(value): value is LocalizableText =>
                    typeof value === "string" ||
                    Boolean(value && typeof value === "object" && "key" in value)
                  }
                  createOpener={() => ({
                    open: async () => {},
                    getHandlers: () => [],
                    subscribe: () => () => {},
                  })}
                >
                  <Probe />
                </RightWorkspaceProvider>
              </ExtensionProvider>
            </I18nProvider>
          </WorkbenchSettingsProvider>
        </RuntimeConnectionProvider>,
      );
    });
    await act(async () => menu.props.onClick({} as never));
    assert.equal(closed, 1);
    assert.equal(state.surfaceOrder.length, 1);
    const id = state.surfaceOrder[0]!;
    assert.equal(state.activeSurfaceId, id);
    assert.equal(state.surfaces[id]?.kind, "browser");
    assert.ok(elements(tree).some((element) => element.type === BrowserViewport));

    await act(async () => {
      input().props.onChange?.({ currentTarget: { value: "javascript:alert(1)" } } as never);
    });
    await act(async () => submit());
    assert.equal(errors.length, 1);
    assert.equal(input().props["aria-invalid"], true);
    assert.ok(elements(tree).some((element) => element.props.role === "alert"));
    assert.equal(state.surfaces[id]?.status, "ready");
    assert.ok(elements(tree).some((element) => element.type === BrowserViewport));

    await act(async () => {
      input().props.onChange?.({ currentTarget: { value: "example.com" } } as never);
    });
    await act(async () => submit());
    assert.equal(input().props.value, "example.com");
    assert.equal(input().props["aria-invalid"], undefined);
    assert.equal(
      elements(tree).some((element) => element.props.role === "alert"),
      false,
    );
    assert.equal(state.surfaces[id]?.params.url, "https://example.com/");
    assert.ok(!elements(tree).some((element) => element.type === "iframe"));
    const viewport = elements(tree).find((element) => element.type === BrowserViewport)!;
    assert.equal(viewport.props.sessionId, state.surfaces[id]?.params.browserSessionId);
    assert.equal(viewport.props.isVisible, true);
    assert.equal(viewport.props.fitToWidth, true);

    await act(async () => {
      const surface = state.surfaces[id]!;
      controller.reveal({ kind: "browser", title: surface.title, params: surface.params, context });
    });
    assert.deepEqual(state.surfaceOrder, [id]);

    await act(async () => {
      const reload = elements(tree).find((element) => element.props["aria-label"] === "Reload");
      assert.ok(reload);
      (reload.props.onClick as () => void)();
    });
    await act(async () => {
      const history = elements(tree).find(
        (element) =>
          element.type === DropdownMenuItem &&
          Children.toArray(element.props.children as ReactNode).includes("Browsing history"),
      );
      assert.ok(history);
      (history.props.onClick as () => void)();
    });
    assert.equal(commands.at(-1)?.type, "open-page");

    assert.deepEqual(state.surfaceOrder, [id]);
    assert.equal(errors.length, 1);

    let duplicateId!: string;
    let backgroundId!: string;
    const sessionId = state.surfaces[id]!.params.browserSessionId;
    await act(async () => {
      duplicateId = controller.open({
        kind: "browser",
        title: "Shared",
        params: state.surfaces[id]!.params,
        context: { ...context, threadId: "second-thread" },
        policy: "background",
      });
      backgroundId = controller.open({
        kind: "browser",
        title: "Background",
        params: { browserSessionId: "unmounted" },
        context,
        policy: "background",
      });
    });
    await act(async () => controller.close(backgroundId));
    assert.deepEqual(commands.at(-1), { type: "close", sessionId: "unmounted" });
    await act(async () => controller.close(duplicateId));
    assert.equal(
      commands.filter((command) => command.type === "close" && command.sessionId === sessionId)
        .length,
      0,
    );
    await act(async () => controller.close(id));
    assert.equal(
      commands.filter((command) => command.type === "close" && command.sessionId === sessionId)
        .length,
      1,
    );

    await act(async () => {
      controller.open({
        kind: "browser",
        title: "Restore",
        params: { browserSessionId: "restored", url: "https://restored.example/" },
        context,
      });
    });
    assert.equal(browser.getSession("restored")?.url, "https://restored.example/");
    assert.ok(
      commands.some(
        (command) =>
          command.type === "attach" &&
          command.sessionId === "restored" &&
          command.projectId === "project",
      ),
    );
    assert.ok(elements(tree).some((element) => element.type === BrowserViewport));
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});

test("remote browser coordinates account for letterboxing and URLs reveal full paths only when requested", () => {
  assert.deepEqual(
    browserPointerPosition(
      { left: 10, top: 20, width: 400, height: 400 },
      { width: 800, height: 400 },
      210,
      220,
    ),
    { x: 400, y: 200 },
  );
  assert.deepEqual(
    browserPointerPosition(
      { left: 10, top: 20, width: 400, height: 400 },
      { width: 800, height: 400 },
      0,
      0,
    ),
    { x: 0, y: 0 },
  );
  assert.equal(
    browserDisplayAddress("https://example.com:8443/path?query=yes#fragment", false),
    "example.com:8443",
  );
  assert.equal(browserDisplayAddress("https://example.com/path", true), "https://example.com/path");
  assert.equal(browserDisplayAddress("chrome://history/", false), "chrome://history/");
});
