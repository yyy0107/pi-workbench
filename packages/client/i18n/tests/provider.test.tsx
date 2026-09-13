import assert from "node:assert/strict";
import test from "node:test";
import { act, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { installMinimalReactDomEnvironment, flushReactMicrotasks } from "@workbench/ui-testkit";
import {
  I18nProvider,
  defineTranslationBundle,
  useI18n,
  useTranslationBundle,
  type Locale,
} from "../src/index";

const bundle = defineTranslationBundle({
  id: "controlled",
  messages: {
    "en-US": { fixture: { title: "Example" } },
    "zh-CN": { fixture: { title: "示例" } },
  },
});

test("locale changes are controlled by each owner and sibling provider installations stay isolated", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const changes: Locale[] = [];
  const observed = new Map<string, { text: string; setLocale(locale: Locale): void }>();
  function Probe({ id }: { id: string }) {
    const runtime = useI18n();
    const { t } = useTranslationBundle(bundle);
    observed.set(id, { text: t("fixture.title"), setLocale: runtime.setLocale });
    return null;
  }
  const change = (locale: Locale) => {
    changes.push(locale);
  };
  const render = (locale: Locale) => (
    <Fragment>
      <I18nProvider locale={locale} onLocaleChange={change} bundles={[bundle]}>
        <Probe id="first" />
      </I18nProvider>
      <I18nProvider
        locale="en-US"
        onLocaleChange={() => assert.fail("Unrelated installation changed")}
        bundles={[bundle]}
      >
        <Probe id="second" />
      </I18nProvider>
    </Fragment>
  );
  try {
    await act(async () => {
      root.render(render("en-US"));
    });
    await act(async () => {
      observed.get("first")!.setLocale("zh-CN");
      await flushReactMicrotasks();
    });
    assert.deepEqual(changes, ["zh-CN"]);
    assert.equal(observed.get("first")!.text, "Example");
    await act(async () => {
      root.render(render("zh-CN"));
    });
    assert.equal(observed.get("first")!.text, "示例");
    assert.equal(observed.get("second")!.text, "Example");
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.restore();
  }
});
