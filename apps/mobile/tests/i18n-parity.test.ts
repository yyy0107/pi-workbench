import assert from "node:assert/strict";
import test from "node:test";

import { createI18n } from "@workbench/i18n/runtime";

import { messages as enUS } from "../src/i18n/en-US.ts";
import { mobileTranslationBundle } from "../src/i18n/index.ts";
import { messages as zhCN } from "../src/i18n/zh-CN.ts";
import { mobileRemoteErrorMessage, mobileRemoteErrorMessageKeys } from "../src/i18n/errors.ts";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return nested && typeof nested === "object" ? keys(nested, path) : [path];
  });
}

test("keeps every mobile en-US and zh-CN key in parity and resolvable", () => {
  const englishKeys = keys(enUS);
  assert.deepEqual(englishKeys, keys(zhCN));
  for (const required of [
    "mobile.home.privateTitle",
    "mobile.pairing.manualHost",
    "mobile.pairing.manualPort",
    "mobile.pairing.oneTimeCode",
    "mobile.pairing.safetyCode",
    "mobile.connectionSettings.identityDescription",
    "mobile.connectionSettings.endpoints",
    "mobile.connectionSettings.addEndpoint",
    "mobile.connectionSettings.editEndpoint",
    "mobile.connectionSettings.testEndpoint",
    "mobile.connectionSettings.saveEndpoint",
    "mobile.connectionSettings.confirmEndpointRemoval",
    "mobile.connectionSettings.removeConfirm",
    "mobile.errors.identityMismatch",
    "mobile.errors.listenerFailed",
    "mobile.errors.deviceRevoked",
  ]) {
    assert.ok(englishKeys.includes(required), required);
  }
  assert.equal(
    englishKeys.some((key) => /^mobile\.(?:auth|login|logout|notifications?)(?:\.|$)/u.test(key)),
    false,
  );
  for (const locale of ["en-US", "zh-CN"] as const) {
    const runtime = createI18n(locale, [mobileTranslationBundle]).forBundle(
      mobileTranslationBundle,
    );
    for (const key of englishKeys) {
      assert.notEqual(runtime.t(key as never), "");
    }
  }
});

test("maps every stable error in both locales with en-US as the final catalog", () => {
  const expectedCodes = [
    "authentication_failed",
    "authorization_revision_changed",
    "protocol_version_mismatch",
    "device_not_paired",
    "device_revoked",
    "endpoint_not_allowed",
    "identity_mismatch",
    "listener_disabled",
    "listener_failed",
    "pairing_denied",
    "pairing_expired",
    "pairing_locked",
    "scope_denied",
    "machine_offline",
    "machine_lease_changed",
    "operation_expired",
    "operation_id_conflict",
    "operation_not_found",
    "entity_revision_conflict",
    "interaction_not_pending",
    "interaction_expired",
    "cursor_expired",
    "cursor_gap",
    "epoch_changed",
    "snapshot_required",
    "payload_too_large",
    "rate_limited",
    "slow_consumer",
    "invalid_frame",
    "internal",
  ];
  assert.deepEqual(Object.keys(mobileRemoteErrorMessageKeys), expectedCodes);
  const en = createI18n("en-US", [mobileTranslationBundle]).forBundle(mobileTranslationBundle);
  const zh = createI18n("zh-CN", [mobileTranslationBundle]).forBundle(mobileTranslationBundle);
  for (const code of expectedCodes) {
    assert.notEqual(
      mobileRemoteErrorMessage(en.t, code as keyof typeof mobileRemoteErrorMessageKeys),
      "",
    );
    assert.notEqual(
      mobileRemoteErrorMessage(zh.t, code as keyof typeof mobileRemoteErrorMessageKeys),
      "",
    );
  }
  assert.equal(
    mobileTranslationBundle.messages["en-US"],
    mobileTranslationBundle.messages["en-US"],
  );
});

test("does not translate user content, stable IDs, or paths through the error mapper", () => {
  const opaque = ["用户输入", "session-01", "/private/worktree/file.ts"];
  const runtime = createI18n("zh-CN", [mobileTranslationBundle]).forBundle(mobileTranslationBundle);
  const error = mobileRemoteErrorMessage(runtime.t, "internal");
  assert.deepEqual(opaque, ["用户输入", "session-01", "/private/worktree/file.ts"]);
  assert.equal(
    opaque.some((value) => error.includes(value)),
    false,
  );
});
