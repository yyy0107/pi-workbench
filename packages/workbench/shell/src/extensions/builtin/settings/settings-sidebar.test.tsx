import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionProvider } from "@workbench/extension-host/installation";
import { I18nProvider } from "../../../i18n";
import { createPanelStore } from "../../../panels/panel-store";
import { WorkbenchSettingsProvider } from "../../../settings";
import { SidebarProvider } from "../../../ui/sidebar";
import { SettingsMainViewContent } from "./settings-main-view-content";
import { SettingsSidebarRail } from "./settings-sidebar-rail";
import { SettingsSidebar } from "./settings-sidebar";
import { createSettingsMainViewRequest } from "./settings-main-view";

test("settings icon rail stays mounted and follows the sidebar state for synchronized transitions", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    const props = { view: { ...createSettingsMainViewRequest(), revision: 1 }, close() {} };
    const render = (open: boolean) =>
      renderToStaticMarkup(
        <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
          <I18nProvider initialLocale={locale}>
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
