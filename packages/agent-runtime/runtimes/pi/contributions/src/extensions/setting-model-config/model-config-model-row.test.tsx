import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider, type Locale } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import { supportedModelThinkingLevels } from "@workbench/agent-runtime-pi-shared/models";
import { piTranslationBundle } from "../../i18n";
import { emptyModel, toModelDraft, type ModelDraft } from "./model-config-draft";
import {
  ModelCatalogRow,
  setReasoningLevelSupported,
  type ModelCatalogRowTestResult,
} from "./model-config-model-row";

function render(
  model: ModelDraft,
  locale: Locale = "en-US",
  feedback: { testing?: boolean; testResult?: ModelCatalogRowTestResult; creating?: boolean } = {},
) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => undefined }}>
      <I18nProvider initialLocale={locale} bundles={[piTranslationBundle]}>
        <ModelCatalogRow
          model={model}
          index={0}
          configuredModels={[model]}
          availableModels={[]}
          busy={false}
          modelPickerLoading={false}
          providerReadyForTest
          testingDisabled={false}
          testing={feedback.testing ?? false}
          testResult={feedback.testResult}
          onUpdateModel={noop}
          onSelectAvailableModel={noop}
          onRefreshAvailableModels={noop}
          onTestModelImageInput={noop}
          onRemoveModel={noop}
          onComplete={feedback.creating ? noop : undefined}
        />
      </I18nProvider>
    </WorkbenchSettingsProvider>,
  );
}

test("model rows expose only the ID, capacity, and test/edit/remove actions", () => {
  const model = toModelDraft({
    id: "acme-reason",
    name: "Acme Reasoner",
    contextWindow: 128000,
    reasoning: true,
  });
  for (const locale of ["en-US", "zh-CN"] as const) {
    const markup = render(model, locale);
    assert.doesNotMatch(markup, /Acme Reasoner/);
    assert.match(markup, /acme-reason/);
    assert.match(markup, /aria-haspopup="dialog"/);
    assert.match(markup, /aria-expanded="false"/);
    assert.match(markup, /value="acme-reason"/);
    assert.equal((markup.match(/<input/g) ?? []).length, 1);
    assert.equal((markup.match(/<button/g) ?? []).length, 3);
    assert.match(markup, locale === "en-US" ? /Context/ : /上下文/);
  }
});

test("new model rows retain an ID input and a dialog action", () => {
  const markup = render(emptyModel());
  assert.match(markup, /aria-haspopup="dialog"/);
  assert.equal((markup.match(/<input/g) ?? []).length, 1);
  assert.match(markup, /New model/);
});

test("choosing an effort while off starts with that level, then preserves further selections", () => {
  const high = setReasoningLevelSupported({ reasoning: false }, "high", true);
  assert.equal(high?.high, undefined);
  assert.equal(high?.low, null);
  assert.equal(high?.max, null);
  const highAndLow = setReasoningLevelSupported(
    { reasoning: true, thinkingLevelMap: high },
    "low",
    true,
  );
  assert.equal(highAndLow?.low, undefined);
  assert.equal(highAndLow?.high, undefined);
  const onlyLow = setReasoningLevelSupported(
    { reasoning: true, thinkingLevelMap: highAndLow },
    "high",
    false,
  );
  assert.equal(onlyLow?.high, null);
  assert.equal(onlyLow?.low, undefined);
  assert.equal(high?.low, null);
});

test("extended selections write explicit Pi mappings and preserve existing provider mappings", () => {
  for (const level of ["xhigh", "max"] as const) {
    const thinkingLevelMap = setReasoningLevelSupported({ reasoning: false }, level, true);
    assert.equal(thinkingLevelMap?.[level], level);
    assert.deepEqual(supportedModelThinkingLevels({ reasoning: true, thinkingLevelMap }), [
      "off",
      level,
    ]);
    const disabled = setReasoningLevelSupported(
      { reasoning: true, thinkingLevelMap },
      level,
      false,
    );
    assert.equal(disabled?.[level], null);
  }
  const thinkingLevelMap = { off: null, minimal: "low", max: "maximum" };
  for (const reasoning of [true, false]) {
    for (const level of ["minimal", "max"] as const) {
      const updated = setReasoningLevelSupported({ reasoning, thinkingLevelMap }, level, true);
      assert.equal(updated?.[level], thinkingLevelMap[level]);
      assert.equal(updated?.off, null);
    }
  }
  assert.deepEqual(thinkingLevelMap, { off: null, minimal: "low", max: "maximum" });
});

test("model test feedback is visible below the row without opening the editor", () => {
  const model = toModelDraft({ id: "test-model" });
  for (const locale of ["en-US", "zh-CN"] as const) {
    const pending = render(model, locale, { testing: true });
    assert.match(pending, /role="status"/);
    assert.match(pending, /data-tone="info"/);
    for (const kind of ["success", "warning", "error"] as const) {
      const markup = render(model, locale, { testResult: { kind, message: "Test feedback" } });
      assert.match(markup, /aria-expanded="false"/);
      assert.match(markup, /Test feedback/);
      assert.ok(markup.includes(`data-tone="${kind === "error" ? "danger" : kind}"`));
      assert.ok(markup.includes(`role="${kind === "error" ? "alert" : "status"}"`));
    }
  }
});

test("external model feedback summarizes connection and confirmed image support", () => {
  const model = toModelDraft({ id: "test-model" });
  for (const locale of ["en-US", "zh-CN"] as const) {
    for (const connection of ["connected", "image-supported"] as const) {
      const markup = render(model, locale, {
        testResult: { connection, kind: "warning", message: "Detailed image test result" },
      });
      assert.match(markup, /data-tone="success"/);
      assert.doesNotMatch(markup, /Detailed image test result/);
      assert.ok(markup.includes(locale === "zh-CN" ? "连接成功" : "Connection successful"));
      assert.equal(
        markup.includes(locale === "zh-CN" ? "(支持图片)" : "(supports images)"),
        connection === "image-supported",
      );
    }
  }
});

test("connected models display quota and rate-limit warnings alongside success", () => {
  const model = toModelDraft({ id: "test-model" });
  for (const locale of ["en-US", "zh-CN"] as const) {
    for (const message of ["Insufficient quota", "Rate limited"]) {
      const feedback = {
        connection: "connected" as const,
        kind: "warning" as const,
        message,
        showConnectionWarning: true,
      };
      const markup = render(model, locale, { testResult: feedback });
      assert.match(markup, /data-tone="success"/);
      assert.match(markup, /data-tone="warning"/);
      assert.ok(markup.includes(message));
      assert.ok(markup.includes(locale === "zh-CN" ? "连接成功" : "Connection successful"));
      assert.doesNotMatch(markup, /支持图片|supports images/);
      assert.doesNotMatch(
        render(model, locale, { testing: true, testResult: feedback }),
        /Insufficient quota|Rate limited/,
      );
    }
  }
});

test("unconfirmed new models have no extra catalog row, even after entering an ID", () => {
  for (const model of [emptyModel(), toModelDraft({ id: "pending-model" })]) {
    const pending = render(model, "zh-CN", { creating: true });
    assert.match(pending, /class="contents"/);
    assert.doesNotMatch(pending, /<input|<button|pending-model/);
    const completed = render({ ...model, id: "saved-model", expanded: false });
    assert.match(completed, /value="saved-model"/);
  }
});
