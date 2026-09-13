import { modelSelectionTranslationBundle } from "../src/i18n";
import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORTED_LOCALES, type Locale } from "@workbench/i18n/runtime";

import { reasoningEffortLabel } from "../lib/reasoning-effort-label";
import { createI18n as createRuntime } from "@workbench/i18n/runtime";

const EXPECTED_LABELS = {
  off: { "en-US": "Off", "zh-CN": "关闭" },
  minimal: { "en-US": "Minimal", "zh-CN": "最低" },
  low: { "en-US": "Low", "zh-CN": "低" },
  medium: { "en-US": "Medium", "zh-CN": "中" },
  high: { "en-US": "High", "zh-CN": "高" },
  xhigh: { "en-US": "Extra high", "zh-CN": "超高" },
  max: { "en-US": "Maximum", "zh-CN": "最高" },
} as const satisfies Record<string, Record<Locale, string>>;

test("localizes every standard reasoning effort instead of trusting its server name", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const { t } = createRuntime(locale, [modelSelectionTranslationBundle]).forBundle(
      modelSelectionTranslationBundle,
    );
    for (const id of Object.keys(EXPECTED_LABELS) as (keyof typeof EXPECTED_LABELS)[]) {
      assert.equal(
        reasoningEffortLabel({ id, name: `server:${id}` }, t),
        EXPECTED_LABELS[id][locale],
      );
    }
  }
});

test("uses the server name for an unknown provider-specific effort in every locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const { t } = createRuntime(locale, [modelSelectionTranslationBundle]).forBundle(
      modelSelectionTranslationBundle,
    );
    assert.equal(
      reasoningEffortLabel({ id: "turbo", name: "Provider Turbo" }, t),
      "Provider Turbo",
    );
  }
});
