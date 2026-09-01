import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  defineTranslationBundle,
  I18nProvider,
  type CatalogTranslate,
  type I18nRuntime,
  useI18n,
  useTranslationBundle,
} from "@workbench/shell/i18n";
import {
  WorkbenchSettingsProvider,
  type WorkbenchSettingsPort,
  type WorkbenchSettingsPreferences,
} from "@workbench/shell/settings";

import { flushReactMicrotasks, installMinimalReactDomEnvironment } from "./react-dom-environment";

const fixtureBundle = defineTranslationBundle({
  id: "test.provider-fixture",
  messages: {
    "en-US": { fixture: { title: "Fixture" } },
    "zh-CN": { fixture: { title: "测试目录" } },
  },
});
type FixtureCatalog = (typeof fixtureBundle.messages)["en-US"];
type FixtureBinding = I18nRuntime<CatalogTranslate<FixtureCatalog>>;

async function settleReactWork(): Promise<void> {
  await flushReactMicrotasks();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await flushReactMicrotasks();
}

test("bundle bindings stay stable across rerenders and change with locale", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const updates: unknown[] = [];
  const settings: WorkbenchSettingsPort = {
    async load() {
      return { locale: "en-US" };
    },
    async update(patch) {
      updates.push(patch);
    },
  };
  const captures: Array<{
    binding: FixtureBinding;
    setLocale: ReturnType<typeof useI18n>["setLocale"];
  }> = [];

  function Probe() {
    const i18n = useI18n();
    const binding = useTranslationBundle(fixtureBundle);
    captures.push({ binding, setLocale: i18n.setLocale });
    return null;
  }

  const tree = () =>
    createElement(WorkbenchSettingsProvider, {
      service: settings,
      children: createElement(I18nProvider, {
        bundles: [fixtureBundle],
        initialLocale: "en-US",
        children: createElement(Probe),
      }),
    });

  try {
    await act(async () => {
      root.render(tree());
      await settleReactWork();
    });
    const initial = captures.at(-1);
    assert.ok(initial);

    await act(async () => {
      root.render(tree());
      await settleReactWork();
    });
    const rerendered = captures.at(-1);
    assert.ok(rerendered);
    assert.equal(rerendered.binding, initial.binding);

    await act(async () => {
      rerendered.setLocale("zh-CN");
      await settleReactWork();
    });
    const localized = captures.at(-1);
    assert.ok(localized);
    assert.notEqual(localized.binding, initial.binding);
    assert.equal(localized.binding.locale, "zh-CN");
    assert.equal(localized.binding.t("fixture.title"), "测试目录");
    assert.deepEqual(updates, [{ locale: "zh-CN" }]);
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});

test("Strict replay shares one hydration and performs one normalized write", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  let resolveLoad!: (preferences: WorkbenchSettingsPreferences) => void;
  let loads = 0;
  const updates: unknown[] = [];
  const settings: WorkbenchSettingsPort = {
    load() {
      loads += 1;
      return new Promise((resolve) => {
        resolveLoad = resolve;
      });
    },
    async update(patch) {
      updates.push(patch);
    },
  };

  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(WorkbenchSettingsProvider, {
            service: settings,
            children: createElement(I18nProvider, {
              initialLocale: "en-US",
              children: null,
            }),
          }),
        ),
      );
      await flushReactMicrotasks();
    });
    assert.equal(loads, 1);

    await act(async () => {
      resolveLoad({});
      await settleReactWork();
    });
    assert.deepEqual(updates, [{ locale: "en-US" }]);
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});

test("true unmount cancels a late locale hydration", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  let resolveLoad!: (preferences: WorkbenchSettingsPreferences) => void;
  const updates: unknown[] = [];
  const settings: WorkbenchSettingsPort = {
    load: () => new Promise((resolve) => (resolveLoad = resolve)),
    async update(patch) {
      updates.push(patch);
    },
  };

  try {
    await act(async () => {
      root.render(
        createElement(WorkbenchSettingsProvider, {
          service: settings,
          children: createElement(I18nProvider, {
            initialLocale: "en-US",
            children: null,
          }),
        }),
      );
      await flushReactMicrotasks();
    });

    await act(async () => {
      root.unmount();
      resolveLoad({ locale: "zh-CN" });
      await settleReactWork();
    });
    assert.deepEqual(updates, []);
    assert.notEqual(
      (document.documentElement as HTMLElement).lang,
      "zh-CN",
      "a late hydration must not mutate the document after unmount",
    );
  } finally {
    dom.restore();
  }
});
