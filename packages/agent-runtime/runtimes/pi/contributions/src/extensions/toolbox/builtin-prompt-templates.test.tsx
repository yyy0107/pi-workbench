import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider, type Locale } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import { createPiI18n, piTranslationBundle } from "../../i18n";
import {
  BuiltinPromptTemplates,
  expandBuiltinPromptTemplate,
  getBuiltinPromptTemplates,
} from "./builtin-prompt-templates";

function render(locale: Locale, query = "") {
  return renderToStaticMarkup(
    <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => undefined }}>
      <I18nProvider initialLocale={locale} bundles={[piTranslationBundle]}>
        <BuiltinPromptTemplates query={query} onOpen={() => undefined} onUse={() => undefined} />
      </I18nProvider>
    </WorkbenchSettingsProvider>,
  );
}

test("built-in prompts are localized and searchable without a Runtime or local prompt files", () => {
  const names = [
    "pi-extension",
    "pi-hook",
    "pi-tool",
    "pi-skill",
    "code-review",
    "debug-issue",
    "implement-feature",
    "safe-refactor",
    "write-tests",
  ];
  for (const locale of ["en-US", "zh-CN"] as const) {
    const templates = getBuiltinPromptTemplates(createPiI18n(locale).t);
    assert.deepEqual(
      templates.map((template) => template.name),
      names,
    );
    for (const template of templates) {
      assert(template.title && template.description);
      assert.match(template.content, /^---\ndescription: .+\nargument-hint: .+\n---\n/);
      assert.match(template.content, /\$\{ARGUMENTS:-[^}]+\}/);
      assert.doesNotMatch(template.content, /\/home\/wy\//);
    }
    assert.equal((render(locale).match(/<li\b/g) ?? []).length, 9);
    assert.equal((render(locale, "  PI  ").match(/<li\b/g) ?? []).length, 4);
    assert.doesNotMatch(render(locale), /<button\b[^>]*\sdisabled=/);
    assert.equal((render(locale).match(/<button\b/g) ?? []).length, 18);
    assert.doesNotMatch(render(locale), /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
    assert.equal(render(locale, "no-such-template"), "");
  }
  assert.match(render("zh-CN", "钩子"), /创建 Pi 钩子/);
  assert.match(render("en-US", "lifecycle"), /Create a Pi hook/);
  assert.match(render("en-US", "code-review"), /Review code/);
  assert.match(render("zh-CN", "pi-hook"), /立即使用/);
  assert.match(render("en-US", "pi-hook"), /Use now/);
  assert.match(render("en-US", "pi-hook"), /aria-label="Open details for Create a Pi hook"/);
  assert.match(render("zh-CN", "/prompts-pi-hook"), /\/prompts-pi-hook/);
});

test("built-in prompts expand locally without metadata or a saved prompt ID", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    for (const template of getBuiltinPromptTemplates(createPiI18n(locale).t)) {
      const expanded = expandBuiltinPromptTemplate(template, '"src/a b.ts" "focus on tools"');
      assert.match(expanded, /src\/a b\.ts focus on tools/);
      const defaults = expandBuiltinPromptTemplate(template, "");
      for (const content of [expanded, defaults]) {
        assert.match(content, /AGENTS\.md/);
        assert.doesNotMatch(content, /^---|argument-hint:|\$\{ARGUMENTS/);
      }
    }
  }
});
