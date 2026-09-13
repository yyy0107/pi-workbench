import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionProvider } from "@workbench/extension-host/installation";
import { I18nProvider } from "@workbench/i18n";
import { settingsUiTranslationBundle } from "../src/i18n";
import { uiTranslationBundle } from "@workbench/ui/i18n";
import { createPanelStore } from "@workbench/shell-context/panel-store";
import { WorkbenchSettingsProvider } from "@workbench/settings-runtime";
import { SidebarProvider } from "@workbench/ui";
import { SettingsMainViewContent } from "../src/settings-main-view-content";
import { SettingsSidebarRail } from "../src/settings-sidebar-rail";
import { SettingsSidebar } from "../src/settings-sidebar";
import { createSettingsMainViewRequest } from "@workbench/ui-settings/request";

test("settings icon rail stays mounted and follows the sidebar state for synchronized transitions", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    const props = { view: { ...createSettingsMainViewRequest(), revision: 1 }, close() {} };
    const render = (open: boolean) =>
      renderToStaticMarkup(
        <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
          <I18nProvider
            locale={locale}
            onLocaleChange={() => {}}
            bundles={[settingsUiTranslationBundle, uiTranslationBundle]}
          >
            <ExtensionProvider extensions={[]} panelStore={createPanelStore()}>
              <SidebarProvider open={open}>
                {open && <SettingsSidebar {...props} mobile={false} />}
                <SettingsSidebarRail {...props} mobile={false} />
                <SettingsMainViewContent {...props} />
              </SidebarProvider>
            </ExtensionProvider>
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      );
    const collapsed = render(false);
    assert.match(collapsed, /data-compact="true"/);
    assert.doesNotMatch(collapsed, /type="search"|aria-expanded=/);
    const expanded = render(true);
    assert.match(expanded, /data-compact="true"/);
    assert.match(
      expanded,
      /data-settings-icon-menu="" data-state="closed" aria-hidden="true" inert=""/,
    );
    assert.match(collapsed, /data-settings-icon-menu="" data-state="open"/);
    assert.doesNotMatch(collapsed, /aria-hidden="true" inert=""/);
    assert.match(expanded, /type="search"/);
    assert.doesNotMatch(expanded, /aria-expanded=/);
  }
});
