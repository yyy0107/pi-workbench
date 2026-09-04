import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORTED_LOCALES, type Locale } from "@workbench/shell/i18n";

import { reasoningEffortLabel } from "../../../model-selector/reasoning-effort-label";
import { createI18n } from "@workbench/shell/i18n";

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
    const { t } = createI18n(locale);
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
    const { t } = createI18n(locale);
    assert.equal(
      reasoningEffortLabel({ id: "turbo", name: "Provider Turbo" }, t),
      "Provider Turbo",
    );
  }
});
