import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider, type Locale } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import { piTranslationBundle } from "../../i18n";
import type { ToolboxCapabilityItem } from "./toolbox-catalog";
import { CapabilityMetadataFields, ExtensionControls } from "./toolbox-capability-presentation";
import { builtinExtensionSurfaceParams, builtinToolPreferenceKey } from "./toolbox-capability";
import { ToolboxResourceList } from "./toolbox-installed-view";
import { ToolboxResourceGroup } from "./toolbox-resource-group";

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

test("built-in tools and lifecycle extensions are switchable and disabled entries stay visible", () => {
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
  assert.equal(
    builtinToolPreferenceKey({ ...params, name: "workbench.context-trace" }),
    "contextTraceExtensionEnabled",
  );
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

test("resource groups preview six entries with localized remaining names and unrestricted search", () => {
  const resources: ToolboxCapabilityItem[] = Array.from({ length: 9 }, (_, index) => ({
    ...items[0],
    id: `skill:${index}`,
    name: `Skill ${index + 1}`,
    searchText: `Skill ${index + 1}`,
  }));
  for (const kind of ["skill", "extension", "package"] as const) {
    const entries = resources.map((item) => ({
      ...item,
      kind,
      params: { ...item.params, capabilityKind: kind },
    }));
    const html = render("", "en-US", entries);
    assert.equal((html.match(/<li\b/g) ?? []).length, 6);
    assert.match(html, /View Skill 7, Skill 8, and 1 more/);
    assert.match(html, /aria-expanded="false"/);
    const listId = html.match(/<ul id="([^"]+)"/)?.[1];
    assert.ok(listId);
    assert.ok(html.includes(`aria-controls="${listId}"`));
  }
  assert.match(render("", "zh-CN", resources), /查看 Skill 7、Skill 8，另有 1 项/);
  assert.match(render("", "en-US", resources.slice(0, 7)), /View Skill 7<\/button>/);
  assert.match(render("", "en-US", resources.slice(0, 8)), /View Skill 7, Skill 8<\/button>/);
  assert.doesNotMatch(render("", "en-US", resources.slice(0, 6)), /aria-expanded=/);

  const grouped = [
    ...resources.map((item) => ({
      ...item,
      params: { ...item.params, origin: "package" as const },
    })),
    ...resources.map((item) => ({
      ...item,
      id: `builtin:${item.id}`,
      params: { ...item.params, builtin: true },
    })),
  ];
  assert.equal((render("", "en-US", grouped, true).match(/<li\b/g) ?? []).length, 12);
  const searched = render("skill", "en-US", grouped, true);
  assert.equal((searched.match(/<li\b/g) ?? []).length, 18);
  assert.doesNotMatch(searched, /aria-expanded=/);
});

test("shared resource groups limit custom prompt rows and preserve their actions", () => {
  const prompts: ToolboxCapabilityItem[] = Array.from({ length: 9 }, (_, index) => ({
    ...items[0],
    id: `prompt:${index}`,
    kind: "prompt",
    name: `Template ${index + 1}`,
    params: { ...items[0].params, capabilityKind: "prompt" },
  }));
  const renderPrompts = (query: string) =>
    renderToStaticMarkup(
      <WorkbenchSettingsProvider
        service={{ load: async () => ({}), update: async () => undefined }}
      >
        <I18nProvider initialLocale="en-US" bundles={[piTranslationBundle]}>
          <ToolboxResourceGroup
            items={prompts}
            query={query}
            renderItem={(item) => (
              <li key={item.id}>
                <button>{item.name}</button>
                <button>Use {item.name}</button>
              </li>
            )}
          />
        </I18nProvider>
      </WorkbenchSettingsProvider>,
    );
  const collapsed = renderPrompts("");
  assert.equal((collapsed.match(/<li\b/g) ?? []).length, 6);
  assert.match(collapsed, /View Template 7, Template 8, and 1 more/);
  assert.doesNotMatch(collapsed, /Use Template 7/);
  const searched = renderPrompts("Template");
  assert.equal((searched.match(/<li\b/g) ?? []).length, 9);
  assert.match(searched, /Use Template 9/);
  assert.doesNotMatch(searched, /aria-expanded=/);
});

test("all native tool entries expose their actual names and independent switches", () => {
  for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
    const params = builtinExtensionSurfaceParams({
      name: `workbench.tool.${name}`,
      toolNames: [name],
      eventNames: [],
      commandNames: [],
      eventDetails: [],
      toolDetails: [],
      commandDetails: [],
    });
    assert.equal(params.name, name);
    assert.equal(builtinToolPreferenceKey(params), `${name}ToolEnabled`);
  }
});

test("tool metadata distinguishes providers and overrides in both locales", () => {
  const cases = [
    ["pi-builtin", "Pi 原生工具", "Pi built-in tool"],
    ["workbench", "Workbench 提供", "Workbench implementation"],
    ["custom", "自定义实现", "Custom implementation"],
    ["package", "Package 提供", "Package implementation"],
  ] as const;
  for (const [kind, chinese, english] of cases) {
    for (const locale of ["zh-CN", "en-US"] as const) {
      const params = builtinExtensionSurfaceParams({
        name: "workbench.tool.read",
        toolNames: ["read"],
        eventNames: [],
        commandNames: [],
        toolDetails: [],
        eventDetails: [],
        commandDetails: [],
        provenance: { kind, source: "example-source", overridesPiBuiltin: kind !== "pi-builtin" },
      });
      const html = renderToStaticMarkup(
        <WorkbenchSettingsProvider
          service={{ load: async () => ({}), update: async () => undefined }}
        >
          <I18nProvider initialLocale={locale} bundles={[piTranslationBundle]}>
            <CapabilityMetadataFields params={params} />
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      );
      assert.ok(html.includes(locale === "zh-CN" ? chinese : english));
      assert.match(html, /example-source/);
      assert.equal(
        html.includes(locale === "zh-CN" ? "覆盖关系" : "Overrides"),
        kind !== "pi-builtin",
      );
      assert.doesNotMatch(html, /Workbench 内置扩展|Built-in Workbench extension/);
    }
  }
});
