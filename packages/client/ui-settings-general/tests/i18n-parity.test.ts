import assert from "node:assert/strict";
import test from "node:test";

import { createI18n } from "@workbench/i18n/runtime";

import { messages as enUS } from "../src/i18n/en-US.ts";
import { settingsGeneralTranslationBundle } from "../src/i18n/index.ts";
import { messages as zhCN } from "../src/i18n/zh-CN.ts";

function leaves(value: object, prefix = ""): Array<{ key: string; kind: string; arity: number }> {
  return Object.entries(value).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof nested === "string") return [{ key: path, kind: "string", arity: 0 }];
    if (typeof nested === "function") {
      return [{ key: path, kind: "function", arity: nested.length }];
    }
    return nested && typeof nested === "object" ? leaves(nested, path) : [];
  });
}

test("keeps settings en-US/zh-CN keys and interpolation signatures in parity", () => {
  const englishLeaves = leaves(enUS);
  assert.deepEqual(englishLeaves, leaves(zhCN));
  const englishKeys = englishLeaves.map(({ key }) => key);
  for (const required of [
    "extensions.settings.remoteDevices.enabled",
    "extensions.settings.remoteDevices.port",
    "extensions.settings.remoteDevices.interfaces",
    "extensions.settings.remoteDevices.pairingQrLabel",
    "extensions.settings.remoteDevices.manualPairingHint",
    "extensions.settings.remoteDevices.safetyCode",
    "extensions.settings.remoteDevices.revokeLabel",
    "extensions.settings.remoteDevices.resetIdentityConfirm",
    "extensions.settings.remoteDevices.saveError",
  ]) {
    assert.ok(englishKeys.includes(required), required);
  }
  assert.equal(
    englishKeys.some((key) => /(?:account|login|logout|notification)/iu.test(key)),
    false,
  );
  for (const locale of ["en-US", "zh-CN"] as const) {
    const runtime = createI18n(locale, [settingsGeneralTranslationBundle]).forBundle(
      settingsGeneralTranslationBundle,
    );
    for (const { key } of englishLeaves) assert.notEqual(runtime.t(key as never), "");
  }
  assert.ok(settingsGeneralTranslationBundle.messages["en-US"]);
});
