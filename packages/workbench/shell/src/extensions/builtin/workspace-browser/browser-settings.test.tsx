import assert from "node:assert/strict";
import test from "node:test";
import { act, Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Globe2Icon } from "lucide-react";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import { BROWSER_PAGES, type BrowserCommand } from "@workbench/browser-contracts";

import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { I18nProvider } from "../../../i18n";
import { RightWorkspaceProvider, useRightWorkspaceState } from "../../../right-workspace-react";
import { useRightWorkspaceInstallationResource } from "../../../right-workspace/right-workspace-context";
import {
  RuntimeConnectionProvider,
  createSameOriginRuntimeConnection,
} from "../../../runtime-connection";
import { WorkbenchSettingsProvider } from "../../../settings";
import { Button, Input, Switch } from "../../../ui";
import {
  BROWSER_SESSION_SERVICE_RESOURCE,
  MemoryBrowserSessionService,
} from "./browser-session-service";
import { BrowserSettingsItem } from "./browser-settings";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child)
      ? [child, ...elements(child.props.children)]
      : [],
  );
}

test("browser settings persist choices and website overrides, reuse management tabs, import files, and report save failures", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const commands: BrowserCommand[] = [];
  class Browser extends MemoryBrowserSessionService {
    override async command<T>(command: BrowserCommand): Promise<T> {
      commands.push(command);
      if (command.type === "open-page") {
        const session = this.getSession(command.sessionId)!;
        this.updateSession({ ...session, url: BROWSER_PAGES[command.page], title: command.page });
      }
      return { count: 2 } as T;
    }
  }
  const browser = new Browser();
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
  let tree!: ReturnType<typeof BrowserSettingsItem>;
  let surfaceCount = 0;
  function Probe() {
    useRightWorkspaceInstallationResource(BROWSER_SESSION_SERVICE_RESOURCE, () => browser);
    surfaceCount = useRightWorkspaceState((state) => state.surfaceOrder.length);
    tree = BrowserSettingsItem();
    return null;
  }
  const find = (predicate: (element: ReactElement<Record<string, unknown>>) => boolean) => {
    const element = elements(tree).find(predicate);
    assert.ok(element);
    return element;
  };
  const click = async (element: ReactElement<Record<string, unknown>>) =>
    act(async () => {
      (element.props.onClick as () => void)();
    });
  const button = (label: string) =>
    find(
      (element) =>
        element.type === Button &&
        Children.toArray(element.props.children as ReactNode).includes(label),
    );
  const choice = (label: string, value: string) =>
    find(
      (element) =>
        element.props.label === label &&
        element.props.value === value &&
        typeof element.props.onChange === "function",
    );
  const submitSite = () => {
    const form = find(
      (element) =>
        element.type === "form" &&
        elements(element.props.children as ReactNode).some(
          (child) => child.type === Input && child.props.type === "url",
        ),
    );
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  };
  const setOrigin = (value: string) => {
    const input = find((element) => element.type === Input && element.props.type === "url");
    (input.props.onChange as (event: unknown) => void)({ currentTarget: { value } });
  };
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
            </I18nProvider>
          </WorkbenchSettingsProvider>
        </RuntimeConnectionProvider>,
      ),
    );
    await act(async () => {
      const toggle = find(
        (element) =>
          element.type === Switch && element.props["aria-label"] === "Fit pages to workspace width",
      );
      (toggle.props.onCheckedChange as (checked: boolean) => void)(false);
    });
    assert.equal(browser.getSettings().fitToWidth, false);
    await act(async () =>
      (choice("Approvals", "ask").props.onChange as (value: string) => void)("deny"),
    );
    assert.deepEqual(browser.getSettings().permissions, {
      navigate: "deny",
      history: "ask",
      download: "ask",
      upload: "ask",
    });

    await click(button("Add website"));
    await act(async () => setOrigin("https://name:secret@example.test"));
    await act(async () => submitSite());
    assert.equal(browser.getSettings().sites.length, 0);
    assert.equal(
      find((element) => element.type === Input && element.props.type === "url").props[
        "aria-invalid"
      ],
      true,
    );
    await act(async () => setOrigin("https://example.test/docs"));
    await act(async () =>
      (choice("History access", "inherit").props.onChange as (value: string) => void)("deny"),
    );
    await act(async () => submitSite());
    assert.deepEqual(browser.getSettings().sites, [
      { origin: "https://example.test", permissions: { history: "deny" } },
    ]);

    const historyButton = () =>
      find((element) => element.props.label === "Browsing history").props.children as ReactElement<
        Record<string, unknown>
      >;
    await click(historyButton());
    await click(historyButton());
    assert.equal(surfaceCount, 1);
    assert.equal(
      commands.filter((command) => command.type === "open-page" && command.page === "history")
        .length,
      2,
    );

    await click(button("Import…"));
    await act(async () => {
      const input = find(
        (element) => element.type === Input && element.props.accept === ".csv,text/csv",
      );
      (input.props.onChange as (event: unknown) => void)({
        currentTarget: {
          value: "passwords.csv",
          files: [
            {
              size: 10,
              text: async () => "url,username,password\nhttps://example.test,name,password",
            },
          ],
        },
      });
    });
    assert.equal(commands.at(-1)?.type, "passwords.import");
    assert.ok(elements(tree).some((element) => element.props.children === "Imported 2 items."));

    browser.updateSettings = async () => {
      throw new Error("save failed");
    };
    await act(async () => {
      const toggle = find(
        (element) => element.type === Switch && element.props["aria-label"] === "Show full URL",
      );
      (toggle.props.onCheckedChange as (checked: boolean) => void)(true);
    });
    assert.equal(browser.getSettings().showFullUrl, false);
    assert.ok(
      elements(tree).some(
        (element) =>
          element.props.role === "alert" &&
          element.props.children === "The browser action could not be completed. Please try again.",
      ),
    );
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});
