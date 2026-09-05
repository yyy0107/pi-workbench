import assert from "node:assert/strict";
import test from "node:test";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CodexCodeHeader } from "./codex-code-header";

import { I18nProvider } from "../../i18n";
import { WorkbenchSettingsProvider, type WorkbenchSettingsPort } from "../../settings";
import {
  MarkdownCodeBlockContent,
  MarkdownTextContent,
  MarkdownTextContentWithCitations,
} from "./markdown-text";

const settings = {
  async load() {
    return {};
  },
  async update() {},
} satisfies WorkbenchSettingsPort;

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(WorkbenchSettingsProvider, {
      service: settings,
      children: createElement(I18nProvider, { initialLocale: "en-US", children: node }),
    }),
  );
}

test("routes fenced code and code previews through Streamdown's code block", () => {
  const code = "const answer = 42;\nconsole.log(answer);";
  for (const node of [
    createElement(MarkdownTextContent, {
      text: `Inline \`answer\`.\n\n\`\`\`typescript\n${code}\n\`\`\``,
    }),
    createElement(MarkdownCodeBlockContent, { code, language: "typescript" }),
  ]) {
    const markup = render(node);
    assert.match(markup, /data-expanded="false"/);
    assert.doesNotMatch(markup, /Expand code block/);
    assert.match(markup, />Copy</);
    assert.match(markup, /data-streamdown="code-block"/);
    assert.match(markup, /data-streamdown="code-block-body"/);
    assert.match(markup, /data-language="typescript"/);
    assert.match(markup, /aui-codex-code-language">TypeScript</);
    assert.match(markup, /<pre[\s>]/);
    assert.match(markup, /const answer = 42;/);
    assert.match(markup, /console.log\(answer\);/);
    assert.doesNotMatch(markup, /aui-streamdown-inline-code[^>]*>const/);
  }

  assert.match(
    render(createElement(MarkdownTextContent, { text: "Inline `answer`." })),
    /<code class="aui-streamdown-inline-code">answer<\/code>/,
  );
});

test("keeps Markdown editor source literal through Streamdown highlighting", () => {
  const code = [
    "# System prompt",
    "Cost: $5 or $10.",
    String.raw`Keep \(x\) and \[y\] literal.`,
    "```markdown",
    "**nested source**",
    "```",
  ].join("\n");
  const markup = render(createElement(MarkdownCodeBlockContent, { code, language: "markdown" }));

  assert.match(markup, /data-language="markdown"/);
  assert.ok(markup.includes("Cost: $5 or $10."));
  assert.ok(markup.includes(String.raw`Keep \(x\) and \[y\] literal.`));
  assert.ok(markup.includes("```markdown"));
  assert.ok(markup.includes("**nested source**"));
});

test("routes Mermaid fences to diagrams while keeping source previews literal", () => {
  const code = "graph TD\n  A[Start] --> B[Done]";
  for (const language of ["mermaid", "Mermaid"]) {
    for (const isRunning of [false, true]) {
      const markup = render(
        createElement(MarkdownTextContent, {
          text: `\`\`\`${language}\n${code}\n${isRunning ? "" : "\`\`\`"}`,
          isRunning,
        }),
      );
      assert.match(markup, /data-streamdown="mermaid-block"/);
      assert.match(markup, /aria-busy="true"/);
      assert.match(markup, /Rendering diagram/);
      assert.match(markup, />Copy</);
      assert.doesNotMatch(markup, /data-streamdown="code-block"/);
    }
  }

  const source = render(createElement(MarkdownCodeBlockContent, { code, language: "mermaid" }));
  assert.match(source, /data-streamdown="code-block"/);
  assert.match(source, /A\[Start\]/);
  assert.doesNotMatch(source, /data-streamdown="mermaid-block"/);
});

test("renders supported math delimiters without treating currency as math", () => {
  const markup = render(
    createElement(MarkdownTextContent, {
      text: "Price: $5. Math: $E = mc^2$ and \\(a^2 + b^2 = c^2\\).",
    }),
  );

  assert.equal(markup.match(/class="katex"/g)?.length, 2);
  assert.match(markup, /\$5/);
});

test("renders structured citations with stable accessible labels", () => {
  const markup = render(
    createElement(MarkdownTextContentWithCitations, {
      text: "Evidence-backed answer.",
      sources: [
        {
          domain: "example.com",
          title: "Example guide",
          snippet: "https://example.com/guide",
          url: "https://example.com/guide",
        },
      ],
    }),
  );

  assert.match(markup, /data-slot="inline-citation"/);
  assert.match(markup, /aria-label="Example guide"/);
});

test("code header exposes expand and collapse controls before copy", () => {
  const fittedMarkup = render(
    createElement(CodexCodeHeader, { code: "const answer = 42;", expanded: false }),
  );
  assert.doesNotMatch(fittedMarkup, /Expand code block|Collapse code block/);
  assert.match(fittedMarkup, />Copy</);

  for (const expanded of [false, true]) {
    const markup = render(
      createElement(CodexCodeHeader, {
        code: "const answer = 42;",
        expanded,
        onToggleExpanded() {},
      }),
    );
    const label = expanded ? "Collapse code block" : "Expand code block";
    assert.ok(markup.includes(`aria-expanded="${expanded}"`));
    assert.ok(markup.includes(label));
    assert.ok(markup.indexOf(label) < markup.indexOf(">Copy<"));
  }
});
