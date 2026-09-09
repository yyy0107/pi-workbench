import assert from "node:assert/strict";
import test from "node:test";
import { act, Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Globe2Icon } from "lucide-react";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import {
  WorkbenchAgentCapabilityError,
  type WorkbenchRuntimeHostCapability,
} from "@workbench/agent-runtime-client";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "@workbench/agent-runtime-client/context";
import {
  BROWSER_PAGES,
  type BrowserCommand,
  type BrowserSettings,
} from "@workbench/browser-contracts";

import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { I18nProvider } from "../../../i18n";
import { RemoteDirectoryPickerDialog } from "../../../directory-picker";
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
  let selectedDirectory: string | undefined;
  let directoryFailure: Error | undefined;
  let nativeCalls = 0;
  const hostClient = {
    pickDirectory: async () => {
      nativeCalls++;
      if (directoryFailure) throw directoryFailure;
      return selectedDirectory;
    },
  } as WorkbenchRuntimeHostCapability;
  class Browser extends MemoryBrowserSessionService {
    override async command<T>(command: BrowserCommand): Promise<T> {
      commands.push(command);
      if (command.type === "profiles.list")
        return [
          {
            id: "/chrome#Profile 1",
            name: "Work",
            browser: "Chrome",
            userDataDirectory: "/chrome",
            profileDirectory: "Profile 1",
          },
        ] as T;
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
  const toggle = (label: string) =>
    find((element) => element.type === Switch && element.props["aria-label"] === label);
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
                <WorkbenchAgentRuntimeEnvironmentProvider
                  id="test"
                  commands={[]}
                  capabilities={{ host: hostClient }}
                >
                  <Probe />
                </WorkbenchAgentRuntimeEnvironmentProvider>
              </RightWorkspaceProvider>
            </I18nProvider>
          </WorkbenchSettingsProvider>
        </RuntimeConnectionProvider>,
      ),
    );
    await act(async () =>
      (choice("Browser to control", "embedded").props.onChange as (value: string) => void)(
        "chrome",
      ),
    );
    await act(async () =>
      (choice("User profile", "").props.onChange as (value: string) => void)("/chrome#Profile 1"),
    );
    await act(async () => {
      const form = find(
        (element) =>
          element.type === "form" &&
          elements(element.props.children as ReactNode).some(
            (child) => child.props.children === "Apply and connect",
          ),
      );
      (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    });
    assert.equal(browser.getSettings().connection, "chrome");
    assert.equal(browser.getSettings().chromeProfile, "/chrome#Profile 1");
    assert.equal(commands.at(-1)?.type, "connection.test");
    const updateSettings = browser.updateSettings.bind(browser);
    const patches: Partial<BrowserSettings>[] = [];
    let finishSave!: () => void;
    const saving = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    browser.updateSettings = async (patch) => {
      patches.push(patch);
      await saving;
      await updateSettings(patch);
    };
    await act(async () => {
      (
        toggle("Ask where to save each download").props.onCheckedChange as (
          checked: boolean,
        ) => void
      )(true);
    });
    assert.equal(tree.props["aria-busy"], true);
    assert.equal(
      toggle("Ask where to save each download").props.checked,
      true,
      "show the change before the server responds",
    );
    for (const control of elements(tree).filter(
      (element) =>
        element.type === Switch ||
        element.type === Input ||
        typeof element.props.onChange === "function",
    )) {
      assert.equal(control.props.disabled, false, "saving must not dim or disable other controls");
    }
    await act(async () => {
      (toggle("Show full URL").props.onCheckedChange as (checked: boolean) => void)(true);
      (toggle("Show full URL").props.onCheckedChange as (checked: boolean) => void)(false);
      (choice("Downloads", "ask").props.onChange as (value: string) => void)("deny");
      (choice("History access", "ask").props.onChange as (value: string) => void)("allow");
    });
    assert.equal(
      toggle("Show full URL").props.checked,
      false,
      "keep the latest queued choice visible",
    );
    choice("Downloads", "deny");
    choice("History access", "allow");
    assert.equal(patches.length, 1, "save requests must wait for the preceding request");
    await act(async () => finishSave());
    assert.equal(patches.length, 5, "continuous changes must all be saved");
    assert.equal(tree.props["aria-busy"], false);
    assert.equal(browser.getSettings().askDownloadLocation, true);
    assert.equal(browser.getSettings().showFullUrl, false);
    assert.deepEqual(browser.getSettings().permissions, {
      history: "allow",
      download: "deny",
      upload: "ask",
    });
    browser.updateSettings = async () => {
      throw new Error("Save failed");
    };
    await act(async () => {
      (toggle("Show full URL").props.onCheckedChange as (checked: boolean) => void)(true);
    });
    assert.equal(
      toggle("Show full URL").props.checked,
      false,
      "failed saves restore the confirmed setting",
    );
    assert.ok(elements(tree).some((element) => element.props.role === "alert"));
    browser.updateSettings = updateSettings;

    selectedDirectory = "/chosen/downloads";
    await click(button("Change"));
    assert.equal(nativeCalls, 1, "Local downloads use the project's native picker capability");
    assert.equal(browser.getSettings().downloadDirectory, selectedDirectory);
    selectedDirectory = undefined;
    await click(button("Change"));
    assert.equal(
      browser.getSettings().downloadDirectory,
      "/chosen/downloads",
      "Cancel keeps the configured location",
    );
    directoryFailure = new WorkbenchAgentCapabilityError("unavailable");
    await click(button("Change"));
    const directoryPicker = find((element) => element.type === RemoteDirectoryPickerDialog);
    assert.equal(directoryPicker.props.initialPath, "/chosen/downloads");
    assert.equal((directoryPicker.props.copy as { select: string }).select, "Save");
    await act(async () => {
      await (directoryPicker.props.onSelectPath as (path: string) => Promise<void>)(
        "/remote/downloads",
      );
      (directoryPicker.props.onOpenChange as (open: boolean) => void)(false);
    });
    assert.equal(browser.getSettings().downloadDirectory, "/remote/downloads");
    directoryFailure = undefined;

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
      (toggle("Show full URL").props.onCheckedChange as (checked: boolean) => void)(true);
    });
    assert.equal(browser.getSettings().showFullUrl, false);
    assert.ok(
      elements(tree).some(
        (element) =>
          element.props.role === "alert" &&
          element.props.children === "The browser action could not be completed. Please try again.",
      ),
    );
    browser.updateSettings = updateSettings;
    await act(async () => {
      (toggle("Show full URL").props.onCheckedChange as (checked: boolean) => void)(true);
    });
    assert.equal(
      browser.getSettings().showFullUrl,
      true,
      "failed saves must not block later changes",
    );
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});
