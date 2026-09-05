import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PanelsTopLeftIcon } from "lucide-react";
import { ExtensionProvider } from "@workbench/extension-host/installation";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import type { WorkspaceContext, WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import { createPanelStore } from "../../src/panels";
import { WorkbenchDomIdsProvider } from "../../src/dom";
import { I18nProvider } from "../../src/i18n";
import { WorkbenchSettingsProvider } from "../../src/settings";
import {
  RightWorkspaceProvider,
  useRightWorkspace,
  useSetWorkspaceContext,
  useWorkspaceContext,
} from "../../src/right-workspace-react";
import { SurfaceHost } from "../../src/right-workspace/presentation/surface-host";
import { installMinimalReactDomEnvironment } from "../react-dom-environment";

test("Shell chrome hides RightWorkspace without conditionally removing its mount", async () => {
  const shell = await readFile(
    new URL("../../src/shell/workbench-shell.tsx", import.meta.url),
    "utf8",
  );
  const workspace = await readFile(
    new URL("../../src/right-workspace/presentation/right-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shell, /<\/div>\s*<RightWorkspace isVisible=\{rightWorkspaceVisible\} \/>/);
  assert.match(workspace, /const open = isVisible && workspaceOpen/);
  assert.match(workspace, /<SurfaceHost isVisible=\{open\} \/>/);
});

test("keep-alive surfaces retain their mounts and owner across navigation, panes, promotion and removal", async (t) => {
  const dom = installMinimalReactDomEnvironment();
  t.after(() => dom.restore());
  const elements: Array<Record<string, any>> = [];
  Object.assign(dom.container.ownerDocument, {
    createElement: (tag: string) => {
      const element = {
        ...dom.container,
        nodeName: tag.toUpperCase(),
        tagName: tag.toUpperCase(),
        attributes: {} as Record<string, string>,
        style: { setProperty() {}, removeProperty() {} },
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;
        },
        removeAttribute(name: string) {
          delete this.attributes[name];
        },
        closest: () => null,
        getBoundingClientRect: () => ({ width: 0 }),
      };
      elements.push(element);
      return element;
    },
  });
  Object.assign(window, {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
  });
  const resizeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  t.after(() => {
    if (resizeDescriptor) Object.defineProperty(globalThis, "ResizeObserver", resizeDescriptor);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  });
  const root = createRoot(dom.container);
  const registry = new WorkspaceSurfaceRegistryImpl();
  const mounts = new Map<string, number>();
  const unmounts = new Map<string, number>();
  const rendered = new Map<
    string,
    { context: WorkspaceContext; provider: WorkspaceContext; visible: boolean }
  >();
  function Retained({ surface, context, isVisible }: WorkspaceSurfaceProps) {
    const provider = useWorkspaceContext();
    rendered.set(surface.id, { context, provider, visible: isVisible });
    useEffect(() => {
      mounts.set(surface.id, (mounts.get(surface.id) ?? 0) + 1);
      return () => {
        unmounts.set(surface.id, (unmounts.get(surface.id) ?? 0) + 1);
      };
    }, [surface.id]);
    return null;
  }
  const registration = registry.register({
    kind: "retained",
    icon: PanelsTopLeftIcon,
    cachePolicy: "keep-alive",
    getResourceKey: (params) => String(params.name),
    render: Retained,
  });
  let controller!: ReturnType<typeof useRightWorkspace>;
  let setContext!: ReturnType<typeof useSetWorkspaceContext>;
  let setHostVisible!: (visible: boolean) => void;
  function Probe() {
    controller = useRightWorkspace();
    setContext = useSetWorkspaceContext();
    const [hostVisible, updateHostVisible] = useState(true);
    setHostVisible = updateHostVisible;
    return <SurfaceHost isVisible={hostVisible} />;
  }
  const a = { applicationId: "lifecycle", threadId: "draft-a", rootPath: "/a" };
  const b = { applicationId: "lifecycle", threadId: "b", rootPath: "/b" };
  const errors: unknown[] = [];
  await act(async () =>
    root.render(
      <WorkbenchSettingsProvider
        service={{ load: async () => ({ locale: "en-US" }), update: async () => {} }}
      >
        <I18nProvider initialLocale="en-US">
          <WorkbenchDomIdsProvider>
            <ExtensionProvider
              extensions={[]}
              panelStore={createPanelStore()}
              onError={(error) => errors.push(error)}
            >
              <RightWorkspaceProvider
                initialContext={a}
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
            </ExtensionProvider>
          </WorkbenchDomIdsProvider>
        </I18nProvider>
      </WorkbenchSettingsProvider>,
    ),
  );
  let primary = "",
    auxiliary = "",
    second = "";
  const open = (
    name: string,
    context: WorkspaceContext,
    placement: "primary" | "auxiliary" = "primary",
  ) =>
    controller.open({
      kind: "retained",
      title: name,
      params: { name },
      context,
      scope: { type: "thread", key: context.threadId! },
      placement,
    });
  const expectOwner = (id: string, owner: WorkspaceContext, visible: boolean) => {
    assert.deepEqual(rendered.get(id), { context: owner, provider: owner, visible });
    assert.equal(mounts.get(id), 1);
    assert.equal(unmounts.get(id), undefined);
  };
  try {
    await act(async () => {
      primary = open("Terminal", a);
      auxiliary = open("Side Chat", a, "auxiliary");
    });
    expectOwner(primary, a, true);
    expectOwner(auxiliary, a, true);
    await act(async () => setHostVisible(false)); // Settings/main-view chrome hides the host.
    expectOwner(primary, a, false);
    expectOwner(auxiliary, a, false);
    await act(async () => setHostVisible(true));
    expectOwner(primary, a, true);
    await act(async () => setContext(b)); // No surfaces at all in B.
    expectOwner(primary, a, false);
    expectOwner(auxiliary, a, false);
    const primaryElement = elements.find(
      (element) => element.attributes["data-surface-id"] === primary,
    );
    assert.ok(primaryElement);
    assert.ok("hidden" in primaryElement.attributes);
    assert.ok("inert" in primaryElement.attributes);
    await act(async () => {
      second = open("Explorer", b);
    });
    expectOwner(second, b, true);
    await act(async () => setContext(a));
    expectOwner(primary, a, true);
    expectOwner(second, b, false);
    await act(async () => controller.setWorkspaceOpen(false));
    expectOwner(primary, a, false);
    await act(async () => {
      controller.setWorkspaceOpen(true);
      controller.setAuxiliaryOpen(false);
    });
    expectOwner(auxiliary, a, false);
    await act(async () => controller.setAuxiliaryOpen(true));
    expectOwner(auxiliary, a, true);
    const promoted = { ...a, threadId: "durable-a" };
    await act(async () => {
      setContext(promoted);
      controller.promoteThreadScope("draft-a", promoted);
    });
    expectOwner(primary, promoted, true);
    expectOwner(auxiliary, promoted, true);
    await act(async () => controller.close(primary, promoted));
    assert.equal(unmounts.get(primary), 1);
    await act(async () => registration.dispose());
    assert.equal(unmounts.get(auxiliary), 1);
    assert.equal(unmounts.get(second), 1);
    assert.deepEqual(errors, []);
  } finally {
    await act(async () => root.unmount());
  }
});
