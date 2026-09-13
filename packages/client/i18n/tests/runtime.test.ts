import assert from "node:assert/strict";
import test from "node:test";
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
