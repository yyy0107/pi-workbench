import assert from "node:assert/strict";
import test from "node:test";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OpenerRegistryImpl,
  WorkspaceSurfaceRegistryImpl,
} from "@workbench/extension-sdk/internal";
import { DefaultOpenerService } from "@workbench/extension-host/services";
import { RightWorkspaceProvider } from "../../right-workspace-react";
import { ToastProvider } from "../../ui/toast";
import { parseLocalFileHref } from "../../workspace-files/file-link";

import { CodexCodeHeader } from "./codex-code-header";

import { I18nProvider, isLocalizableText } from "../../i18n";
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
      children: createElement(I18nProvider, {
        initialLocale: "en-US",
        children: createElement(RightWorkspaceProvider, {
          registry: new WorkspaceSurfaceRegistryImpl(),
          createOpener: (surfaces) => new DefaultOpenerService(new OpenerRegistryImpl(), surfaces),
          initialContext: { applicationId: "test", rootPath: "/workspace", projectId: "test" },
          validateLocalizableText: isLocalizableText,
          children: createElement(ToastProvider, { children: node }),
        }),
      }),
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
          text: `\`\`\`${language}\n${code}\n${isRunning ? "" : "```"}`,
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

test("decorates assistant links by destination while retaining Streamdown link safety", () => {
  const links = [
    ["/workspace/notes.md:12", "file-text"],
    ["file:///tmp/notes.md", "file-text"],
    ["C:/Users/me/notes.md", "file-text"],
    ["notes.md:12", "file-text"],
    ["../src/main.ts#L12", "file-text"],
    ["https://example.com/guide", "earth"],
    ["//example.com/guide", "earth"],
    ["/images/screen.PNG", "image"],
    ["https://example.com/screen%2Ewebp?size=large#preview", "image"],
    ["/workspace/docs/", "folder"],
    ["#details", "hash"],
    ["mailto:hello@example.com", "mail"],
    ["https://example.com/%ZZ", "earth"],
  ];
  for (const isRunning of [false, true]) {
    for (const [href, icon] of links) {
      const markup = render(
        createElement(MarkdownTextContentWithCitations, {
          text: `Before [\`reference\`](${href}) after.`,
          sources: [],
          isRunning,
        }),
      );
      assert.match(
        markup,
        parseLocalFileHref(href)
          ? /<a[^>]+data-streamdown="link"/
          : /<button[^>]+data-streamdown="link"/,
        href,
      );
      if (parseLocalFileHref(href)) assert.match(markup, /data-slot="context-menu-trigger"/, href);
      else assert.doesNotMatch(markup, /data-slot="context-menu-trigger"/, href);
      assert.ok(markup.includes(`lucide-${icon}`), `${href}\n${markup}`);
      assert.match(markup, /<svg[^>]+aria-hidden="true"[^>]*>.*<\/svg><code/, href);
      assert.equal(markup.replace(/<[^>]+>/g, ""), "Before reference after.", href);
    }
  }

  for (const text of [
    "[![preview](https://example.com/image.png)](https://example.com)",
    "[unsafe](javascript:alert%281%29)",
    "An unfinished [reference](https://",
  ]) {
    const markup = render(
      createElement(MarkdownTextContentWithCitations, { text, sources: [], isRunning: true }),
    );
    assert.doesNotMatch(markup, /aui-markdown-link-icon/);
    assert.doesNotMatch(markup, /href="javascript:/);
  }
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
