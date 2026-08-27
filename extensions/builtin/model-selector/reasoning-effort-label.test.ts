import assert from "node:assert/strict";
import test from "node:test";

import { createI18n } from "@/i18n";
import { PI_THINKING_LEVELS, type PiThinkingLevel } from "@/runtime/pi/contracts/pi";

import { reasoningEffortLabel } from "./reasoning-effort-label";

const EXPECTED_LABELS = {
  off: { "en-US": "Off", "zh-CN": "关闭" },
  minimal: { "en-US": "Minimal", "zh-CN": "最低" },
  low: { "en-US": "Low", "zh-CN": "低" },
  medium: { "en-US": "Medium", "zh-CN": "中" },
  high: { "en-US": "High", "zh-CN": "高" },
  xhigh: { "en-US": "Extra high", "zh-CN": "超高" },
  max: { "en-US": "Maximum", "zh-CN": "最高" },
} as const satisfies Record<PiThinkingLevel, Record<"en-US" | "zh-CN", string>>;

test("localizes every standard PI reasoning effort instead of trusting its server name", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    const { t } = createI18n(locale);
    for (const id of PI_THINKING_LEVELS) {
      assert.equal(
        reasoningEffortLabel({ id, name: `server:${id}` }, t),
        EXPECTED_LABELS[id][locale],
      );
    }
  }
});

test("uses the server name for an unknown provider-specific effort in every locale", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    const { t } = createI18n(locale);
    assert.equal(
      reasoningEffortLabel({ id: "turbo", name: "Provider Turbo" }, t),
      "Provider Turbo",
    );
  }
});
