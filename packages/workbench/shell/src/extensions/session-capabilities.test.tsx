import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "@workbench/agent-runtime-client/context";
import type { WorkbenchAgentRuntimeCapabilities } from "@workbench/agent-runtime-client/capabilities";
import { ExtensionManager } from "@workbench/extension-sdk/internal";
import { I18nProvider } from "../i18n";
import { WorkbenchSettingsProvider } from "../settings";
import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { interactiveRequestsExtension } from "./builtin/interactive-requests";
import {
  InteractiveQuestionComposerOverlay,
  InteractiveRequestsOverlay,
} from "./builtin/interactive-requests/interactive-requests-overlay";
import { SideChatThreadMenuItem } from "./builtin/side-chat/side-chat-menu-item";
import { SideChatSurface } from "./builtin/side-chat/side-chat-surface";
import { automationExtension } from "./builtin/automation";
import { AutomationSidebar } from "./builtin/automation/automation-sidebar";
import { AutomationMainView } from "./builtin/automation/automation-main-view-content";
import { ModelSelector } from "./builtin/model-selector/model-selector";
import { attachmentUnderstandingExtension } from "./builtin/image-understanding";
import { AttachmentUnderstandingSettingsItem } from "./builtin/image-understanding/image-understanding-settings-item";
import { TokenUsage } from "./builtin/token-usage/token-usage";

test("session entry points stay hidden without capabilities and restored surfaces explain why", () => {
  const wrap = (children: React.ReactNode) => (
    <WorkbenchAgentRuntimeEnvironmentProvider id="fixture" commands={[]}>
      {children}
    </WorkbenchAgentRuntimeEnvironmentProvider>
  );
  assert.equal(
    renderToStaticMarkup(
      wrap(
        <>
          <InteractiveQuestionComposerOverlay
            isRunning={false}
            isEmpty
            submissionBlocked={false}
            setOverlayVisible={() => undefined}
          />
          <InteractiveRequestsOverlay
            isRunning={false}
            isEmpty
            submissionBlocked={false}
            setOverlayVisible={() => undefined}
          />
          <SideChatThreadMenuItem threadId="thread" closeMenu={() => undefined} />
          <AutomationSidebar mobile={false} searchQuery="" />
          <ModelSelector />
          <TokenUsage />
        </>,
      ),
    ),
    "",
  );
  const markup = renderToStaticMarkup(
    wrap(
      <WorkbenchSettingsProvider
        service={{ load: async () => ({}), update: async () => undefined }}
      >
        <I18nProvider initialLocale="en-US">
          <AttachmentUnderstandingSettingsItem sectionId="image-understanding" itemId="providers" />
          <AutomationMainView
            view={{
              kind: "automations",
              title: "Automations",
              revision: 0,
              params: { page: "automations" },
            }}
            close={() => undefined}
          />
          <SideChatSurface
            {...({ surface: { params: {} } } as Parameters<typeof SideChatSurface>[0])}
          />
        </I18nProvider>
      </WorkbenchSettingsProvider>,
    ),
  );
  assert.equal(markup.match(/This runtime does not support this feature\./g)?.length, 3);
});

test("runtime entries follow capability presence and dispose with their owning extension", async () => {
  const manager = new ExtensionManager();
  const activations = [
    interactiveRequestsExtension,
    attachmentUnderstandingExtension,
    automationExtension,
  ].map((extension) => manager.activate(extension));
  const entries = manager.slots.get("shell.overlay");
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const render = (capabilities: WorkbenchAgentRuntimeCapabilities) =>
    act(async () =>
      root.render(
        <StrictMode>
          <WorkbenchAgentRuntimeEnvironmentProvider
            id="fixture"
            commands={[]}
            capabilities={capabilities}
          >
            {entries.map(({ id, component }) =>
              createElement(Fragment, { key: id }, createElement(component)),
            )}
          </WorkbenchAgentRuntimeEnvironmentProvider>
        </StrictMode>,
      ),
    );
  try {
    await render({});
    assert.deepEqual(manager.settings.getSections(), []);
    assert.deepEqual(manager.sidebarSections.getAll(), []);
    assert.equal(manager.commands.get("automations.create"), undefined);
    await render({
      automation: {},
      attachmentUnderstanding: {},
    } as WorkbenchAgentRuntimeCapabilities);
    assert.deepEqual(manager.settings.getSections(), []);
    assert.deepEqual(manager.sidebarSections.getAll(), []);
    await render({
      interactions: {},
      attachmentUnderstanding: {},
      automation: {},
      models: {},
      host: {},
    } as WorkbenchAgentRuntimeCapabilities);
    assert.deepEqual(
      manager.settings.getSections().map(({ id }) => id),
      ["image-understanding"],
    );
    assert.equal(manager.sidebarSections.get("automations")?.id, "automations");
    assert.ok(manager.commands.get("automations.create"));
    await render({});
    assert.deepEqual(manager.settings.getSections(), []);
    assert.deepEqual(manager.sidebarSections.getAll(), []);
    assert.equal(manager.commands.get("automations.create"), undefined);
    assert.ok(
      manager.renderers.tools.get("ask_user"),
      "historical tool presentation survives capability removal",
    );
    for (const activation of activations) activation.dispose();
    assert.equal(manager.renderers.tools.get("ask_user"), undefined);
    assert.deepEqual(manager.slots.get("shell.overlay"), []);
  } finally {
    for (const activation of activations) activation.dispose();
    await act(async () => root.unmount());
    dom.restore();
  }
});
