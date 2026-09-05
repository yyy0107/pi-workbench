import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider, type Locale } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import { piTranslationBundle } from "../../i18n";
import type { ToolboxCapabilityItem } from "./toolbox-catalog";
import { ToolboxResourceList } from "./toolbox-installed-view";

const items: ToolboxCapabilityItem[] = [
  {
    id: "skill:review",
    kind: "skill",
    name: "Review changes",
    description: "Inspect a patch",
    searchText: "Review changes Inspect a patch",
    params: {
      capabilityId: "skill:review",
      capabilityKind: "skill",
      name: "Review changes",
      enabled: true,
    },
  },
  {
    id: "skill:design",
    kind: "skill",
    name: "Design interface",
    description: "Create a layout",
    searchText: "Design interface Create a layout",
    params: {
      capabilityId: "skill:design",
      capabilityKind: "skill",
      name: "Design interface",
      enabled: false,
    },
  },
];

function render(query: string, locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => undefined }}>
      <I18nProvider initialLocale={locale} bundles={[piTranslationBundle]}>
        <ToolboxResourceList items={items} query={query} onOpen={() => undefined} />
      </I18nProvider>
    </WorkbenchSettingsProvider>,
  );
}

test("resource search matches names and descriptions, preserves disabled entries, and localizes status", () => {
  const all = render("");
  assert.equal((all.match(/<li\b/g) ?? []).length, 2);
  assert.match(all, />Enabled</);
  assert.match(all, />Disabled</);
  assert.doesNotMatch(all, /<button\b[^>]*\sdisabled=/);

  const filtered = render("  PATCH  ");
  assert.match(filtered, /Review changes/);
  assert.doesNotMatch(filtered, /Design interface/);
  assert.match(render("design"), /Design interface/);

  const empty = render("missing", "zh-CN");
  assert.match(empty, /role="status"/);
  assert.match(empty, /没有匹配的能力/);
  assert.doesNotMatch(empty, /<button\b/);
  assert.match(render("", "zh-CN"), /已启用/);
  assert.match(render("", "zh-CN"), /已停用/);
});
