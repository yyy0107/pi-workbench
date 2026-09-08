import assert from "node:assert/strict";
import test from "node:test";
import {
  act,
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type ComponentProps,
} from "react";
import { createRoot } from "react-dom/client";
import type { BrowserCommand } from "@workbench/browser-contracts";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import type { WorkspaceSurfaceInstance } from "@workbench/extension-sdk";
import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { I18nProvider } from "../../../i18n";
import { WorkbenchSettingsProvider } from "../../../settings";
import { RightWorkspaceProvider, useWorkspaceFeedbackStore } from "../../../right-workspace-react";
import { useRightWorkspaceInstallationResource } from "../../../right-workspace/right-workspace-context";
import type { WorkspaceFeedbackStore } from "../../../right-workspace";
import { InlineFeedbackForm } from "../../../right-workspace/presentation";
import {
  RuntimeConnectionProvider,
  createSameOriginRuntimeConnection,
} from "../../../runtime-connection";
import { Switch, Textarea } from "../../../ui";
import {
  BROWSER_SESSION_SERVICE_RESOURCE,
  MemoryBrowserSessionService,
} from "./browser-session-service";
import { BrowserAnnotationLayer } from "./browser-annotation-layer";
import type { BrowserSurfaceParams } from "./browser-surface";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child)
      ? [child, ...elements(child.props.children)]
      : [],
  );
}

test("browser annotations honor screenshot choices and keep the draft when capture fails", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  let captures = 0;
  let failCapture = false;
  class Browser extends MemoryBrowserSessionService {
    override async command<T>(command: BrowserCommand): Promise<T> {
      assert.equal(command.type, "screenshot");
      captures += 1;
      if (failCapture) throw new Error("capture unavailable");
      return { name: "page.png", mimeType: "image/png", data: "c2NyZWVuc2hvdA==" } as T;
    }
  }
  const browser = new Browser();
  const session = await browser.create({ projectId: "project", url: "https://example.test/" });
  const surface = {
    id: "browser-surface",
    kind: "browser",
    scope: { type: "thread", key: "thread" },
    params: { browserSessionId: session.id, url: session.url },
  } as WorkspaceSurfaceInstance<BrowserSurfaceParams>;
  let form!: ReturnType<typeof InlineFeedbackForm>;
  let feedback!: WorkspaceFeedbackStore;
  function Probe() {
    useRightWorkspaceInstallationResource(BROWSER_SESSION_SERVICE_RESOURCE, () => browser);
    feedback = useWorkspaceFeedbackStore();
    const layer = BrowserAnnotationLayer({ surface, label: "Annotate" });
    const inline = layer.props.children as ReactElement<ComponentProps<typeof InlineFeedbackForm>>;
    form = InlineFeedbackForm(inline.props);
    return null;
  }
  const find = (predicate: (element: ReactElement<Record<string, unknown>>) => boolean) => {
    const element = elements(form).find(predicate);
    assert.ok(element);
    return element;
  };
  const input = () => find((element) => element.type === Textarea);
  const save = async (text: string) => {
    await act(async () =>
      (input().props.onChange as (event: unknown) => void)({ currentTarget: { value: text } }),
    );
    await act(async () =>
      (find((element) => element.type === "form").props.onSubmit as (event: unknown) => void)({
        preventDefault() {},
      }),
    );
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
                initialContext={{ applicationId: "test", threadId: "thread" }}
                registry={new WorkspaceSurfaceRegistryImpl()}
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
    await act(async () => browser.updateSettings({ annotationScreenshots: "never" }));
    await save("Text only.");
    assert.equal(captures, 0);
    assert.equal(feedback.getSnapshot().feedback.at(-1)?.images, undefined);

    await act(async () => browser.updateSettings({ annotationScreenshots: "ask" }));
    await save("No screenshot selected.");
    assert.equal(captures, 0);
    await act(async () =>
      (
        find((element) => element.type === Switch).props.onCheckedChange as (value: boolean) => void
      )(true),
    );
    await save("Use this screenshot.");
    assert.equal(captures, 1);
    const captured = feedback.getSnapshot().feedback.at(-1)!;
    assert.equal(captured.images?.[0]?.data, "c2NyZWVuc2hvdA==");
    assert.equal((captured.target.screenshot as { name: string }).name, captured.images?.[0]?.name);
    assert.equal(find((element) => element.type === Switch).props.checked, false);

    await act(async () => browser.updateSettings({ annotationScreenshots: "always" }));
    assert.equal(
      elements(form).some((element) => element.type === Switch),
      false,
    );
    await save("Always capture.");
    assert.equal(captures, 2);
    const count = feedback.getSnapshot().feedback.length;
    failCapture = true;
    await save("Keep this draft.");
    assert.equal(feedback.getSnapshot().feedback.length, count);
    assert.equal(input().props.value, "Keep this draft.");
    assert.equal(
      find((element) => element.props.role === "alert").props.children,
      "The screenshot could not be captured. Try again before saving.",
    );
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});
