import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";

import { AskUserPanel } from "./ask-user-panel";

test("Skip shows a blue countdown only during the final 20 seconds of the server deadline", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const expiresAt = Date.now() + 30_000;
  for (const locale of ["en-US", "zh-CN"] as const) {
    for (const elapsed of [0, 9_999, 10_000, 29_000, 30_000, 35_000]) {
      t.mock.timers.setTime(1_000_000 + elapsed);
      const markup = renderToStaticMarkup(
        <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
          <I18nProvider initialLocale={locale}>
            <AskUserPanel
              questions={[{ id: "answer", question: "Continue?" }]}
              expiresAt={expiresAt}
              onCancel={() => {}}
              onSubmit={() => {}}
            />
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      );
      const timer = markup.match(/<span\b[^>]*role="timer"[^>]*>[\s\S]*?<\/span>/u)?.[0];
      assert.equal(Boolean(timer), elapsed >= 10_000);
      if (timer) {
        const seconds = Math.max(0, Math.ceil((30_000 - elapsed) / 1_000));
        assert.ok(timer.includes(`>${seconds}${locale === "en-US" ? "s" : "秒"}</span>`));
        assert.ok(timer.includes("text-info-foreground"));
        assert.match(markup, /<button\b[^>]*>[^<]*(?:Skip|跳过)<span role="timer"/u);
      }
    }
  }
});

test("required answers gate Next while Skip remains available, in both base locales", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    for (const [required, busy] of [
      [true, false],
      [false, false],
      [false, true],
    ]) {
      const markup = renderToStaticMarkup(
        <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
          <I18nProvider initialLocale={locale}>
            <AskUserPanel
              questions={[
                {
                  id: "topic",
                  question: "Choose a topic",
                  options: [{ label: "Code" }, { label: "Plans" }],
                  allowCustom: true,
                  required,
                },
                { id: "note", question: "Additional context" },
              ]}
              disabled={busy}
              onCancel={() => {}}
              onSubmit={() => {}}
            />
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      );

      const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu) ?? [];
      const next = buttons.find((button) => button.includes('type="submit"'));
      const skip = buttons.find((button) =>
        button.endsWith(locale === "en-US" ? ">Skip</button>" : ">跳过</button>"),
      );
      assert.ok(next);
      assert.ok(skip);
      assert.equal(next.includes('disabled=""'), required || busy);
      assert.equal(skip.includes('disabled=""'), busy);
      assert.match(markup, /<textarea[^>]*aria-labelledby="[^"]+"/u);
      assert.ok(
        markup.includes(locale === "en-US" ? "Or write your own response" : "或输入你自己的回答"),
      );
    }
  }
});

test("free-text questions show one reply field and only navigate when more questions remain", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    for (const count of [1, 2]) {
      const markup = renderToStaticMarkup(
        <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
          <I18nProvider initialLocale={locale}>
            <AskUserPanel
              questions={Array.from({ length: count }, (_, index) => ({
                id: `answer-${index}`,
                question: "The one thing I want to finish is ____.",
                required: true,
              }))}
              onCancel={() => {}}
              onSubmit={() => {}}
            />
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      );

      assert.equal(markup.match(/<textarea\b/gu)?.length, 1);
      assert.doesNotMatch(markup, /<fieldset|lucide-pencil/u);
      assert.equal(markup.includes('aria-haspopup="dialog"'), count > 1);
      assert.ok(
        markup.includes(locale === "en-US" ? 'placeholder="Reply…"' : 'placeholder="回复…"'),
      );
      const submit = markup.match(/<button\b[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/u)?.[0];
      assert.ok(submit);
      assert.ok(submit.includes('disabled=""'));
      assert.ok(
        submit.includes(
          count === 1
            ? locale === "en-US"
              ? "Send"
              : "发送"
            : locale === "en-US"
              ? "Next"
              : "下一步",
        ),
      );
    }
  }
});

test("restores the active question and saved answers for each question request", () => {
  for (const currentIndex of [0, 1]) {
    const markup = renderToStaticMarkup(
      <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
        <I18nProvider initialLocale="zh-CN">
          <AskUserPanel
            questions={[
              { id: "first", question: "First question", required: true },
              { id: "second", question: "Second question", required: true },
            ]}
            progress={{
              currentIndex,
              answers: [{ id: "first", selected: [], custom: "Saved answer" }],
            }}
            onCancel={() => {}}
            onSubmit={() => {}}
          />
        </I18nProvider>
      </WorkbenchSettingsProvider>,
    );
    assert.match(markup, currentIndex === 0 ? /First question/u : /Second question/u);
    assert.equal(markup.includes("Saved answer"), currentIndex === 0);
    const submit = markup.match(/<button\b[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/u)?.[0];
    assert.ok(submit);
    assert.equal(submit.includes('disabled=""'), currentIndex === 1);
  }
});
