import assert from "node:assert/strict";
import test from "node:test";
import type { LocalizableText as ExtensionLocalizableText } from "@workbench/extension-sdk";
import { defineTranslationBundle } from "./bundle";
import {
  createI18n,
  createTranslationBundleMessageFactory,
  defineMessage,
  isLocalizableText,
  resolveText,
  type MessageDescriptor,
} from "./runtime";
import type { TranslationBundle } from "./types";

const fixtureBundle = defineTranslationBundle({
  id: "test.fixture",
  messages: {
    "en-US": {
      fixture: {
        title: "Fixture",
        count: ({ count }: { count: number }) => `${count} fixtures`,
      },
    },
    "zh-CN": {
      fixture: {
        title: "测试目录",
        count: ({ count }: { count: number }) => `${count} 个测试目录`,
      },
    },
  },
});

function typecheckMessageDescriptorContract(): void {
  // Raw object literals cannot impersonate the opaque SDK descriptor.
  // @ts-expect-error The app catalog constructor supplies the private descriptor brand.
  const rawDescriptor: ExtensionLocalizableText = {
    key: "extensions.archivedChats.title",
  };
  void rawDescriptor;

  // The combined semantic key includes its namespace and is checked against the app catalog.
  // @ts-expect-error Unnamespaced keys are not part of the application catalog.
  defineMessage("title");
  // @ts-expect-error Unknown catalog key.
  defineMessage("extensions.archivedChats.typo");
  // @ts-expect-error Static messages reject values.
  defineMessage("extensions.archivedChats.title", { count: 1 });
  // @ts-expect-error Parameterized messages require their values.
  defineMessage("extensions.archivedChats.totalCount");
  // @ts-expect-error Parameter names remain associated with the selected key.
  defineMessage("extensions.archivedChats.totalCount", { sequence: 1 });
}
void typecheckMessageDescriptorContract;

function typecheckTranslationBundleContract(): void {
  const defineFixtureMessage = createTranslationBundleMessageFactory(fixtureBundle);
  fixtureBundle satisfies TranslationBundle;
  defineFixtureMessage("fixture.title");
  defineFixtureMessage("fixture.count", { count: 2 });
  // @ts-expect-error Bundle translators reject base-catalog keys.
  defineFixtureMessage("extensions.archivedChats.title");
  // @ts-expect-error Parameterized bundle messages require their values.
  defineFixtureMessage("fixture.count");
  // @ts-expect-error Parameter names remain associated with the bundle key.
  defineFixtureMessage("fixture.count", { sequence: 2 });
}
void typecheckTranslationBundleContract;

const typedDescriptor = defineMessage("extensions.archivedChats.totalCount", { count: 2 });
const descriptorContract: MessageDescriptor = typedDescriptor;
void descriptorContract;

test("selects locale-aware plural categories", () => {
  const english = createI18n("en-US");
  const chinese = createI18n("zh-CN");

  assert.equal(english.plural(1), "one");
  assert.equal(english.plural(2), "other");
  assert.equal(english.plural(2, { type: "ordinal" }), "two");
  assert.equal(chinese.plural(1), "other");
  assert.equal(chinese.plural(2), "other");
});

test("opaque descriptors survive plain JSON persistence and resolve after catalog validation", () => {
  const descriptor = defineMessage("extensions.archivedChats.totalCount", { count: 2 });

  assert.deepEqual(descriptor, {
    key: "extensions.archivedChats.totalCount",
    values: { count: 2 },
  });
  assert.equal(Object.isFrozen(descriptor), true);

  const restored: unknown = JSON.parse(JSON.stringify(descriptor));
  assert.equal(isLocalizableText(restored), true);
  if (!isLocalizableText(restored)) assert.fail("descriptor should validate after JSON restore");

  assert.equal(resolveText(createI18n("en-US").t, restored), "2 archived chats");
  assert.equal(resolveText(createI18n("zh-CN").t, restored), "共 2 个已归档聊天");
  assert.equal(isLocalizableText({ key: "extensions.archivedChats.typo" }), false);
  assert.equal(isLocalizableText({ key: "extensions.archivedChats.totalCount" }), false);
  assert.equal(
    isLocalizableText({ key: "extensions.archivedChats.title", values: { count: 2 } }),
    false,
  );
});

test("composes explicit translation bundles without mutating the Shell catalog", () => {
  const english = createI18n("en-US", [fixtureBundle]);
  const chinese = createI18n("zh-CN", [fixtureBundle]);
  const englishFixture = english.forBundle(fixtureBundle);
  const chineseFixture = chinese.forBundle(fixtureBundle);

  assert.equal(englishFixture.t("fixture.title"), "Fixture");
  assert.equal(englishFixture.t("fixture.count", { count: 2 }), "2 fixtures");
  assert.equal(chineseFixture.t("fixture.title"), "测试目录");
  assert.equal(chineseFixture.t("fixture.count", { count: 2 }), "2 个测试目录");
  assert.equal(english.forBundle(fixtureBundle), englishFixture);
  assert.notEqual(chineseFixture, englishFixture);

  const defineFixtureMessage = createTranslationBundleMessageFactory(fixtureBundle);
  const descriptor = defineFixtureMessage("fixture.count", { count: 3 });
  const restored: unknown = JSON.parse(JSON.stringify(descriptor));
  assert.equal(english.isLocalizableText(restored), true);
  if (!english.isLocalizableText(restored)) assert.fail("bundle descriptor should validate");
  assert.equal(english.text(restored), "3 fixtures");
  assert.equal(isLocalizableText(restored), false);
});

test("rejects duplicate bundle ids, message collisions, and uninstalled bundle bindings", () => {
  const duplicateId = defineTranslationBundle({
    id: fixtureBundle.id,
    messages: {
      "en-US": { anotherFixture: { title: "Another fixture" } },
      "zh-CN": { anotherFixture: { title: "另一个测试目录" } },
    },
  });
  assert.throws(() => createI18n("en-US", [fixtureBundle, duplicateId]), /Duplicate.+id/);

  const collision = defineTranslationBundle({
    id: "test.collision",
    messages: {
      "en-US": { extensions: { archivedChats: { title: "Collision" } } },
      "zh-CN": { extensions: { archivedChats: { title: "冲突" } } },
    },
  });
  assert.throws(() => createI18n("en-US", [collision]), /collides.+archivedChats\.title/);
  assert.throws(() => createI18n("en-US").forBundle(fixtureBundle), /not installed/);
});
