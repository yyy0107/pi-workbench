import assert from "node:assert/strict";
import test from "node:test";
import type { useI18n } from "../src/provider";
import {
  createI18n,
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
  resolveText,
} from "../src/public-runtime";

const bundle = defineTranslationBundle({
  id: "fixture",
  messages: {
    "en-US": {
      fixture: { title: "Example", count: ({ count }: { count: number }) => `${count} entries` },
    },
    "zh-CN": { fixture: { title: "示例", count: ({ count }: { count: number }) => `${count} 项` } },
  },
});
const message = createTranslationBundleMessageFactory(bundle);

function typedMessages() {
  message("fixture.count", { count: 2 });
  // @ts-expect-error Parameters are required by the bundle's message contract.
  message("fixture.count");
  // @ts-expect-error Catalog ownership keeps unrelated message keys out.
  message("extensions.settings.title");
}
void typedMessages;

test("empty runtimes have no implicit product catalog and explicit catalogs stay isolated", () => {
  const empty = createI18n("en-US");
  assert.throws(() => empty.t("extensions.settings.title"), /Missing i18n message/);
  assert.throws(() => empty.forBundle(bundle), /not installed/);
  const first = createI18n("en-US", [bundle]);
  const second = createI18n("zh-CN", [bundle]);
  const descriptor = JSON.parse(JSON.stringify(message("fixture.count", { count: 2 })));
  assert.equal(empty.isLocalizableText(descriptor), false);
  assert.equal(first.isLocalizableText(descriptor), true);
  assert.equal(resolveText(first.t, descriptor), "2 entries");
  assert.equal(resolveText(second.t, descriptor), "2 项");
  assert.equal(first.forBundle(bundle), first.forBundle(bundle));
  assert.notEqual(first.forBundle(bundle), second.forBundle(bundle));
});

test("duplicate identities, conflicting keys and locale mismatch fail before installation", () => {
  assert.throws(() => createI18n("en-US", [bundle, bundle]), /Duplicate/);
  const collision = defineTranslationBundle({
    id: "collision",
    messages: {
      "en-US": { fixture: { title: "A" } },
      "zh-CN": { fixture: { title: "甲" } },
    },
  });
  assert.throws(() => createI18n("en-US", [bundle, collision]), /collides/);
  assert.throws(
    () =>
      defineTranslationBundle({
        id: "invalid",
        messages: {
          "en-US": { title: "Title" },
          // @ts-expect-error Runtime validation must reject untyped persisted input as well.
          "zh-CN": { other: "不同" },
        },
      }),
    /different message keys/,
  );
});

// Compile-only API checks: this function is never invoked and mounts no UI.
function typedBundleHookContract(readI18n: typeof useI18n) {
  const local = readI18n(bundle);
  local.t("fixture.title");
  local.t("fixture.count", { count: 2 });
  local.text(message("fixture.title"));
  local.isLocalizableText(message("fixture.title"));
  local.setLocale("zh-CN");
  readI18n().setLocale("en-US");
  // @ts-expect-error Local translations reject keys outside this bundle.
  local.t("another.title");
  // @ts-expect-error Named interpolation parameters remain required.
  local.t("fixture.count");
  // @ts-expect-error Parameter names cannot be widened by the global runtime.
  local.t("fixture.count", { total: 2 });
}
void typedBundleHookContract;
