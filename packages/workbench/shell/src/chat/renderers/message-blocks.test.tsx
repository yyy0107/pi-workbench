import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { WorkbenchMessageFileBlock, WorkbenchMessageSourceBlock } from "./message-blocks";
import { I18nProvider } from "../../i18n";
import { WorkbenchSettingsProvider } from "../../settings";
import type { FileBlock } from "@workbench/agent-runtime-contracts/conversation";

test("renders a Workbench SourceBlock without provider-specific Part state", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchMessageSourceBlock
      block={{
        key: "source-1",
        kind: "source",
        title: "Workbench guide",
        url: "https://example.com/guide",
      }}
      fallbackLabel="Source"
      variant="chip"
    />,
  );

  assert.match(markup, /Workbench guide/);
  assert.match(markup, /href="https:\/\/example\.com\/guide"/);
  assert.match(markup, /rel="noopener noreferrer"/);
});

test("assistant images reserve a square through generation, loading, completion and failure", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    const render = (status: FileBlock["status"], source = "", assistant = true) =>
      renderToStaticMarkup(
        <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
          <I18nProvider initialLocale={locale}>
            <WorkbenchMessageFileBlock
              assistant={assistant}
              block={{
                key: "image",
                kind: "file",
                name: "generated.png",
                mediaType: "image/png",
                source,
                ...(status ? { status } : {}),
              }}
            />
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      );
    const running = render("running");
    assert.match(running, /data-slot="image-generation"/);
    assert.match(running, /aspect-square w-full/);
    assert.match(running, /data-slot="image-generating-dots"/);
    assert.match(running, /role="status"/);
    assert.match(running, locale === "zh-CN" ? /正在生成图片/ : /Generating image/);
    assert.doesNotMatch(running, /<img|<button/);

    const complete = render("complete", "data:image/png;base64,aW1hZ2U=");
    assert.match(complete, /data-slot="image-generation"/);
    assert.match(complete, /<img[^>]+src="data:image\/png;base64,aW1hZ2U="/);
    assert.match(complete, /data-slot="image-generating-dots"/); // Remains until the browser loads the image.
    assert.match(complete, /<img[^>]+class="[^"]*object-contain[^"]*h-full/);
    assert.match(complete, /cursor-zoom-in/);

    for (const status of ["incomplete", "error", "complete"] as const) {
      const stopped = render(status);
      assert.match(stopped, /data-slot="image-generation"/);
      assert.doesNotMatch(stopped, /image-generating-dots|<img/);
      assert.match(
        stopped,
        status === "incomplete"
          ? locale === "zh-CN"
            ? /图片生成已停止/
            : /Image generation stopped/
          : locale === "zh-CN"
            ? /图片生成失败/
            : /Image could not be generated/,
      );
    }
    const attachment = render(undefined, "data:image/png;base64,aW1hZ2U=", false);
    assert.match(attachment, /data-slot="image-root"/);
    assert.doesNotMatch(attachment, /data-slot="image-generation"|image-generating-dots/);
  }
});
