import assert from "node:assert/strict";
import test from "node:test";
import { act, Children, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Globe2Icon } from "lucide-react";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import {
  DEFAULT_BROWSER_SETTINGS,
  type BrowserCommand,
  type BrowserDownload,
  type BrowserEvent,
} from "@workbench/browser-contracts";

import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { I18nProvider } from "../../../i18n";
import { RightWorkspaceProvider, useRightWorkspaceState } from "../../../right-workspace-react";
import { useRightWorkspaceInstallationResource } from "../../../right-workspace/right-workspace-context";
import {
  RuntimeConnectionProvider,
  createSameOriginRuntimeConnection,
} from "../../../runtime-connection";
import { WorkbenchSettingsProvider } from "../../../settings";
import { Button, Dialog, Input, ToastProvider } from "../../../ui";
import {
  BROWSER_SESSION_SERVICE_RESOURCE,
  MemoryBrowserSessionService,
} from "./browser-session-service";
import { BrowserEventsOverlay, resolveEmbeddedBrowserUrl } from "./browser-events-overlay";
import { BrowserDownloadsDialog } from "./browser-downloads-dialog";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child)
      ? [child, ...elements(child.props.children)]
      : [],
  );
}

test("link preferences recognize loopback hosts and never embed credentials or non-web schemes", () => {
  for (const address of [
    "http://localhost:3000/",
    "http://app.localhost/",
    "http://127.1/",
    "http://[::1]:8080/",
  ])
    assert.ok(resolveEmbeddedBrowserUrl(address, DEFAULT_BROWSER_SETTINGS));
  for (const address of [
    "https://example.com/",
    "http://localhost.evil.example/",
    "https://name:secret@localhost/",
    "javascript:alert(1)",
    "file:///tmp/file",
    "not a URL",
  ])
    assert.equal(resolveEmbeddedBrowserUrl(address, DEFAULT_BROWSER_SETTINGS), undefined);
  const settings = {
    ...DEFAULT_BROWSER_SETTINGS,
    webLinks: "embedded",
    localLinks: "external",
  } as const;
  assert.equal(resolveEmbeddedBrowserUrl("https://example.com/path", settings)?.pathname, "/path");
  assert.equal(resolveEmbeddedBrowserUrl("http://localhost/", settings), undefined);
});

test("browser overlay waits for explicit responses, routes confirmed links, and manages downloads", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const commands: BrowserCommand[] = [];
  const handlers = new Map<string, (event: unknown) => void>();
  const shell = {
    closest: () => shell,
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      handlers.set(name, listener),
    removeEventListener: (name: string) => handlers.delete(name),
  };
  let download: BrowserDownload = {
    id: "download",
    name: "report.txt",
    url: "https://example.test/report",
    state: "inProgress",
    receivedBytes: 3,
    totalBytes: 6,
  };
  class Browser extends MemoryBrowserSessionService {
    readonly events = new Set<(event: BrowserEvent) => void>();
    emit(event: BrowserEvent) {
      for (const listener of this.events) listener(event);
    }
    override subscribeEvents(listener: (event: BrowserEvent) => void) {
      this.events.add(listener);
      return () => this.events.delete(listener);
    }
    override async command<T>(command: BrowserCommand): Promise<T> {
      commands.push(command);
      if (command.type === "permission.respond" && command.requestId === "expired") {
        throw Object.assign(new Error("expired"), { code: "browser-invalid" });
      }
      if (command.type === "downloads.list") return [download] as T;
      if (command.type === "download.cancel") {
        download = { ...download, state: "canceled" };
        this.emit({ type: "download", download });
      }
      if (command.type === "download.read") throw new Error("disconnected");
      return undefined as T;
    }
  }
  const browser = new Browser();
  await browser.updateSettings({ askDownloadLocation: true });
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register({
    kind: "browser",
    icon: Globe2Icon,
    persistence: "session",
    cachePolicy: "keep-alive",
    allowDuplicateResources: false,
    getResourceKey: (params) => String(params.browserSessionId),
    getDefaultScope: () => ({ type: "application", key: "test" }),
    render: () => null,
  });
  let promptTree: ReactNode;
  let downloadsTree: ReactNode;
  let setDownloadsOpen!: (open: boolean) => void;
  let surfaceCount = 0;
  function PromptProbe({ element }: { element: ReactElement<Record<string, unknown>> }) {
    const Component = element.type as (props: Record<string, unknown>) => ReactNode;
    promptTree = Component(element.props);
    return null;
  }
  function Probe() {
    useRightWorkspaceInstallationResource(BROWSER_SESSION_SERVICE_RESOURCE, () => browser);
    surfaceCount = useRightWorkspaceState((state) => state.surfaceOrder.length);
    const [downloadsOpen, setOpen] = useState(false);
    setDownloadsOpen = setOpen;
    const overlay = BrowserEventsOverlay();
    const anchor = elements(overlay).find((element) => element.type === "span")!;
    (anchor.props.ref as { current: unknown }).current = { closest: () => shell };
    downloadsTree = BrowserDownloadsDialog({ open: downloadsOpen, onOpenChange: setOpen });
    const prompt = elements(overlay).find((element) => element.props.event);
    if (!prompt) promptTree = undefined;
    return prompt ? <PromptProbe key={prompt.key} element={prompt} /> : null;
  }
  const find = (
    tree: ReactNode,
    predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
  ) => {
    const found = elements(tree).find(predicate);
    assert.ok(found);
    return found;
  };
  const click = async (tree: ReactNode, label: string) =>
    act(async () => {
      const button = find(
        tree,
        (element) => element.type === Button && element.props.children === label,
      );
      (button.props.onClick as () => void)();
    });
  const submit = async () =>
    act(async () =>
      (
        find(promptTree, (element) => element.type === "form").props.onSubmit as (
          event: unknown,
        ) => void
      )({ preventDefault() {} }),
    );
  try {
    await act(async () =>
      root.render(
        <RuntimeConnectionProvider
          connection={createSameOriginRuntimeConnection("http://localhost")}
        >
          <WorkbenchSettingsProvider
            service={{ load: async () => ({ locale: "en-US" }), update: async () => {} }}
          >
            <I18nProvider initialLocale="en-US">
              <ToastProvider>
                <RightWorkspaceProvider
                  initialContext={{ applicationId: "test" }}
                  registry={registry}
                  validateLocalizableText={(value): value is string => typeof value === "string"}
                  createOpener={() => ({
                    open: async () => {},
                    getHandlers: () => [],
                    subscribe: () => () => {},
                  })}
                >
                  <Probe />
                </RightWorkspaceProvider>
              </ToastProvider>
            </I18nProvider>
          </WorkbenchSettingsProvider>
        </RuntimeConnectionProvider>,
      ),
    );
    const event = {
      target: shell,
      cancelable: true,
      defaultPrevented: false,
      detail: { url: "http://localhost:3001/page" },
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    await act(async () => handlers.get("workbench:open-browser-link")!(event));
    assert.equal(event.defaultPrevented, true);
    assert.equal(surfaceCount, 1);
    await act(async () =>
      handlers.get("workbench:open-browser-link")!({ ...event, defaultPrevented: false }),
    );
    assert.equal(surfaceCount, 1);
    const anchor = {
      href: "http://localhost:3002/",
      hasAttribute: () => false,
      closest: (selector: string) =>
        selector.startsWith("a[") ? anchor : selector === "[data-workbench-shell]" ? shell : null,
    };
    const modifiedClick = {
      target: anchor,
      button: 0,
      ctrlKey: true,
      preventDefault() {
        assert.fail("modified clicks must retain native behavior");
      },
    };
    await act(async () => handlers.get("click")!(modifiedClick));
    assert.equal(surfaceCount, 1);

    const permission = {
      type: "permission",
      requestId: "permission",
      sessionId: "session",
      origin: "https://example.test",
      action: "download",
    } as const;
    await act(async () => {
      browser.emit(permission);
      browser.emit(permission);
      browser.emit({
        type: "dialog",
        sessionId: "session",
        kind: "prompt",
        message: "Website question",
        defaultPrompt: "old",
        url: "https://iframe.example.test/",
      });
      browser.emit({
        type: "file-chooser",
        sessionId: "session",
        requestId: "upload",
        multiple: false,
      });
    });
    (
      find(promptTree, (element) => element.type === Dialog).props.onOpenChange as (
        open: boolean,
      ) => void
    )(false);
    assert.equal(commands.length, 0);
    await click(promptTree, "Deny");
    assert.deepEqual(commands.at(-1), {
      type: "permission.respond",
      requestId: "permission",
      allow: false,
    });
    assert.ok(
      elements(promptTree).some(
        (element) =>
          element.type === "code" && element.props.children === "https://iframe.example.test/",
      ),
    );
    await act(async () =>
      (
        find(promptTree, (element) => element.type === Input).props.onChange as (
          event: unknown,
        ) => void
      )({ currentTarget: { value: "answer" } }),
    );
    await submit();
    assert.deepEqual(commands.at(-1), {
      type: "dialog.respond",
      sessionId: "session",
      accept: true,
      text: "answer",
    });
    await act(async () =>
      (
        find(promptTree, (element) => element.type === Input).props.onChange as (
          event: unknown,
        ) => void
      )({ currentTarget: { files: [new File(["abc"], "input.txt", { type: "text/plain" })] } }),
    );
    await submit();
    assert.deepEqual(commands.at(-1), {
      type: "upload",
      sessionId: "session",
      requestId: "upload",
      files: [{ name: "input.txt", mimeType: "text/plain", data: "YWJj" }],
    });

    await act(async () => browser.emit({ ...permission, requestId: "once" }));
    await submit();
    assert.deepEqual(commands.at(-1), {
      type: "permission.respond",
      requestId: "once",
      allow: true,
    });

    await act(async () =>
      browser.emit({ ...permission, requestId: "internal", action: "history", origin: "null" }),
    );
    await click(promptTree, "Deny");

    await act(async () => browser.emit({ ...permission, requestId: "expired" }));
    await submit();
    assert.equal(promptTree, undefined, "an expired permission must not trap the user in a modal");

    await act(async () => setDownloadsOpen(true));
    assert.ok(commands.some((command) => command.type === "downloads.list"));
    await click(downloadsTree, "Cancel download");
    assert.deepEqual(commands.at(-1), { type: "download.cancel", downloadId: "download" });
    await act(async () => {
      download = { ...download, state: "completed" };
      browser.emit({ type: "download", download });
    });
    assert.equal(
      commands.filter((command) => command.type === "download.read").length,
      0,
      "ask-location downloads wait for their file event and a user gesture",
    );
    await click(downloadsTree, "Save to this device");
    assert.deepEqual(commands.at(-1), { type: "download.read", downloadId: "download" });
    assert.ok(elements(downloadsTree).some((element) => element.props.role === "alert"));
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});
