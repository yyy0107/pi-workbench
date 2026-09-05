import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createI18n, SUPPORTED_LOCALES } from "../i18n/public-runtime";
import { Toast, ToastProvider, useToastManager } from "./toast";

test("event toasts use semantic tones and localized, accessible close controls", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const { t } = createI18n(locale);
    for (const type of ["error", "success", "warning", "info", "unknown"]) {
      const tone = type === "unknown" ? "info" : type;
      const html = renderToStaticMarkup(
        <ToastProvider>
          <Toast
            toast={{
              id: type,
              type,
              title: "File could not be opened",
              description: "example.ts",
              priority: type === "error" ? "high" : "low",
            }}
            closeLabel={t("ui.toast.closeLabel")}
          />
        </ToastProvider>,
      );

      assert.ok(html.includes(`data-tone="${tone}"`));
      assert.ok(html.includes(`text-${tone === "error" ? "danger" : tone}-foreground`));
      assert.ok(html.includes(`aria-label="${t("ui.toast.closeLabel")}"`));
      assert.match(html, /role="(?:alert)?dialog"/u);
      assert.match(html, /aria-hidden="true"/u);
      assert.match(html, /File could not be opened/u);
      assert.match(html, /example\.ts/u);
      assert.match(html, /data-limited:hidden/u);
      assert.match(html, /motion-reduce:transition-none/u);
      assert.match(html, /data-behind:invisible/u);
      assert.match(html, /contain:inline-size/u);
      assert.match(html, /data-expanded:visible/u);
      assert.match(html, /--toast-offset-y/u);
      assert.match(html, /data-starting-style:-translate-y-\[calc\(100%\+1rem\)\]/u);
      assert.ok(html.includes("data-ending-style:translate-y-[calc(var(--toast-shift-y)-0.5rem)]"));
      assert.ok(html.includes("transition-[opacity,visibility]"));
      assert.match(html, /group-data-ending-style\/toast:opacity-0/u);
      assert.doesNotMatch(html, /data-ending-style:-translate-y-2/u);
      assert.doesNotMatch(html, /data-expanded:row-auto/u);
      assert.match(html, /--toast-frontmost-height/u);
    }
  }
});

test("notification managers remain isolated between Workbench installations", () => {
  const managers: ReturnType<typeof useToastManager>[] = [];
  function Probe() {
    managers.push(useToastManager());
    return null;
  }

  renderToStaticMarkup(
    <>
      <ToastProvider>
        <Probe />
      </ToastProvider>
      <ToastProvider>
        <Probe />
      </ToastProvider>
    </>,
  );

  assert.equal(managers.length, 2);
  assert.notEqual(managers[0].add, managers[1].add);
});
