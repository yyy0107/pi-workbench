import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider, type Locale } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import { piTranslationBundle } from "../../i18n";
import type { ToolboxCapabilityItem } from "./toolbox-catalog";
import { ExtensionControls } from "./toolbox-capability-presentation";
import { builtinToolPreferenceKey } from "./toolbox-capability";
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

function render(query: string, locale: Locale = "en-US", resources = items, groupBySource = false) {
  return renderToStaticMarkup(
    <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => undefined }}>
      <I18nProvider initialLocale={locale} bundles={[piTranslationBundle]}>
        <ToolboxResourceList
          items={resources}
          query={query}
          groupBySource={groupBySource}
          onOpen={() => undefined}
        />
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

test("built-in entries have localized labels and share the searchable Pi extension list", () => {
  const resources: ToolboxCapabilityItem[] = [
    {
      id: "builtin-extension:workbench.rpiv-todo",
      kind: "extension",
      name: "workbench.rpiv-todo",
      searchText: "workbench.rpiv-todo todo session_start",
      params: {
        capabilityId: "builtin-extension:workbench.rpiv-todo",
        capabilityKind: "extension",
        name: "workbench.rpiv-todo",
        builtin: true,
      },
    },
  ];
  const combined = [
    ...resources,
    {
      ...items[0],
      kind: "extension" as const,
      params: { ...items[0].params, capabilityKind: "extension" as const },
    },
  ];
  const html = render("", "en-US", combined);
  assert.equal((html.match(/<li\b/g) ?? []).length, 2);
  assert.match(html, /workbench.rpiv-todo/);
  assert.match(html, /Review changes/);
  assert.match(render("TODO", "en-US", resources), />Built-in</);
  assert.match(render("session_start", "zh-CN", resources), />内置</);
  assert.doesNotMatch(render("", "en-US", resources), />Enabled<|>Available</);
});

test("only built-in tool providers are switchable and their disabled state stays visible", () => {
  const params = {
    capabilityId: "builtin-extension:todo",
    capabilityKind: "extension" as const,
    name: "workbench.rpiv-todo",
    builtin: true,
    toolNames: ["todo"],
    enabled: false,
  };
  assert.equal(builtinToolPreferenceKey(params), "todoEnabled");
  assert.equal(
    builtinToolPreferenceKey({ ...params, name: "workbench.ask-user", toolNames: ["ask_user"] }),
    "askUserEnabled",
  );
  assert.equal(builtinToolPreferenceKey({ ...params, builtin: false }), undefined);
  assert.equal(builtinToolPreferenceKey({ ...params, toolNames: [] }), undefined);
  assert.equal(builtinToolPreferenceKey({ ...params, name: "workbench.context-trace" }), undefined);
  const resources: ToolboxCapabilityItem[] = [
    { id: params.capabilityId, kind: "extension", name: params.name, searchText: "todo", params },
  ];
  assert.match(render("", "en-US", resources), />Disabled</);
  assert.match(render("", "en-US", resources), />Built-in</);
  assert.match(render("", "zh-CN", resources), />已停用</);
  const html = renderToStaticMarkup(
    <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => undefined }}>
      <I18nProvider initialLocale="zh-CN" bundles={[piTranslationBundle]}>
        <ExtensionControls
          builtin
          name="todo"
          enabled={false}
          canToggle
          canDelete={false}
          canOpenDirectory={false}
          mutationState="idle"
          openFailed={false}
          removed={false}
          onToggle={() => undefined}
          onDelete={() => undefined}
          onOpenDirectory={() => undefined}
        />
      </I18nProvider>
    </WorkbenchSettingsProvider>,
  );
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-label="启用 todo"/);
  assert.doesNotMatch(html, /role="switch"[^>]* disabled|打开.*目录|删除扩展/);
});

test("Pi extensions group by source after search while keeping disabled entries", () => {
  const extension = (
    name: string,
    params: Partial<ToolboxCapabilityItem["params"]>,
  ): ToolboxCapabilityItem => ({
    id: name,
    kind: "extension",
    name,
    searchText: name,
    params: { capabilityId: name, capabilityKind: "extension", name, ...params },
  });
  const resources = [
    extension("Builtin Todo", { builtin: true }),
    extension("Own review", { origin: "top-level", source: "auto", enabled: false }),
    extension("Package search", { origin: "package", source: "npm:pi-search", enabled: true }),
  ];
  const html = render("", "en-US", resources, true);
  const groups = [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>([\s\S]*?)(?=<h2\b|$)/g)];
  assert.deepEqual(
    groups.map((group) => group[1]),
    ["Pi Packages", "Custom extensions", "Built-in extensions"],
  );
  assert.match(groups[0][2], /Package search/);
  assert.match(groups[1][2], /Own review/);
  assert.match(groups[1][2], />Disabled</);
  assert.match(groups[2][2], /Builtin Todo/);
  assert.equal((html.match(/<li\b/g) ?? []).length, resources.length);
  const filtered = render("OWN", "zh-CN", resources, true);
  assert.match(filtered, />自建扩展<[\s\S]*Own review/);
  assert.doesNotMatch(filtered, /Pi Package|内置扩展|Builtin Todo|Package search/);
  const localized = render("", "zh-CN", resources, true);
  assert.match(localized, />Pi Package</);
  assert.match(localized, />内置扩展</);
  const empty = render("missing", "zh-CN", resources, true);
  assert.match(empty, /没有匹配的能力/);
  assert.doesNotMatch(empty, /<h2|<li/);
});
