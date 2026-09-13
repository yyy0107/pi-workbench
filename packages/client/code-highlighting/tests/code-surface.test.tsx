import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, createI18n, type Locale } from "@workbench/i18n";
import { WorkbenchSettingsProvider, type WorkbenchSettingsPort } from "@workbench/settings-runtime";
import { WorkbenchCodeBlock } from "../src/workbench-code-block";
import { codeHighlightingTranslationBundle } from "../src/i18n";

const service: WorkbenchSettingsPort = {
  async load() {
    return {};
  },
  async update() {},
};
const bundles = [codeHighlightingTranslationBundle];
function render(node: ReactNode, locale: Locale = "en-US") {
  return renderToStaticMarkup(
    createElement(WorkbenchSettingsProvider, {
      service,
      children: createElement(I18nProvider, {
        locale,
        onLocaleChange() {},
        bundles,
        children: node,
      }),
    }),
  );
}
function sourceText(markup: string) {
  const encoded = markup.match(/<pre\b[^>]*><code>([\s\S]*?)<\/code><\/pre>/)?.[1];
  assert.notEqual(encoded, undefined);
  return encoded!.replace(
    /&(?:amp|lt|gt|quot|#x27);/g,
    (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" })[entity]!,
  );
}

test("literal surfaces preserve fences, HTML, math-like text and exact empty/trailing lines", () => {
  for (const code of [
    "",
    "\n",
    "\n\n",
    "text",
    "text\n",
    "text\n\n",
    "```markdown\n**source**\n````",
    "<script>alert(\"x\")</script> & 'quoted'",
    String.raw`Cost $5 and $10; \(x\), \[y\], $x^2$`,
    "中文\n".repeat(6_000),
  ]) {
    const markup = render(createElement(WorkbenchCodeBlock, { code, language: "markdown" }));
    assert.equal(sourceText(markup), code);
    assert.doesNotMatch(markup, /<script\b|class="katex"|<strong\b/);
    assert.match(markup, /data-expanded="false"/);
  }
});

test("Mermaid source uses the code surface and localized header without a diagram runtime", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    const code = "graph TD\n  A[Start] --> B[Done]\n";
    const markup = render(createElement(WorkbenchCodeBlock, { code, language: "mermaid" }), locale);
    assert.equal(sourceText(markup), code);
    assert.doesNotMatch(markup, /data-markdown="mermaid-block"|aria-busy="true"/);
    assert.match(markup, locale === "zh-CN" ? />复制</ : />Copy</);
  }
});

test("the owning bundle retains plural and locale-aware diff summaries", () => {
  const en = createI18n("en-US", bundles).forBundle(codeHighlightingTranslationBundle);
  const zh = createI18n("zh-CN", bundles).forBundle(codeHighlightingTranslationBundle);
  assert.equal(en.t("codeHighlighting.unmodifiedLines", { count: 1 }), "1 unmodified line");
  assert.equal(
    en.t("codeHighlighting.unmodifiedLines", { count: 2_000 }),
    "2,000 unmodified lines",
  );
  assert.equal(zh.t("codeHighlighting.unmodifiedLines", { count: 2_000 }), "未修改 2,000 行");
});
