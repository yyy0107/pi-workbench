import assert from "node:assert/strict";
import test from "node:test";
import { act, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { DataRendererProps } from "@workbench/extension-sdk";
import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { I18nProvider } from "../../../i18n";
import { WorkbenchSettingsProvider } from "../../../settings";
import type { ToolCallProps } from "../../../elements/tool-call";
import { AttachmentRecognitionRenderer } from "./image-recognition-renderer";

function props(completedPages?: number, status = "running"): DataRendererProps {
  return {
    node: { key: "recognition", kind: "system", blocks: [] },
    fallback: null,
    block: {
      key: "recognition",
      kind: "data",
      name: "workbench.attachment-recognition",
      data: {
        version: 1,
        operationId: "recognition",
        submissionId: "submission",
        revision: 2,
        status: "running",
        stage: "polling",
        method: "ocr",
        attachmentCount: 2,
        completedCount: 0,
        progress: 0,
        jobs: [
          {
            attachmentId: "pdf-1",
            status,
            pollCount: 3,
            ...(completedPages === undefined ? {} : { completedPages, totalPages: 10 }),
          },
          { attachmentId: "image-1", status: "queued", pollCount: 0 },
        ],
      },
    },
  };
}

test("running OCR discloses localized page progress without presenting attachment ratios as job progress", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    const render = (completedPages?: number, status?: string) =>
      renderToStaticMarkup(
        <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
          <I18nProvider initialLocale={locale}>
            <AttachmentRecognitionRenderer {...props(completedPages, status)} />
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      );
    const html = render(7);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /aria-valuenow="70"/);
    assert.match(html, /70%/);
    assert.match(html, locale === "zh-CN" ? /已识别 7 \/ 10 页/ : /7 \/ 10 pages recognized/);
    assert.match(html, locale === "zh-CN" ? /已查询状态 3 次/ : /Status checks: 3/);
    const unknown = render();
    assert.doesNotMatch(unknown, / · 0%|aria-valuenow=/);
    assert.doesNotMatch(unknown, /role="progressbar"/);
    const queued = render(undefined, "pending");
    assert.doesNotMatch(queued, /role="progressbar"/);
    assert.match(queued, locale === "zh-CN" ? /尚未开始识别/ : /recognition has not started/);
  }
});

test("poll updates preserve the user's disclosure choice", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let view!: ReactElement<{ children: [ReactNode, ReactElement<ToolCallProps>] }>;
  function Probe({ completedPages }: { completedPages: number }) {
    view = (AttachmentRecognitionRenderer as FunctionComponent<DataRendererProps>)(
      props(completedPages),
    ) as typeof view;
    return null;
  }
  const render = (completedPages: number) =>
    act(async () =>
      root.render(
        <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
          <I18nProvider initialLocale="en-US">
            <Probe completedPages={completedPages} />
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      ),
    );
  try {
    await render(2);
    assert.equal(view.props.children[1].props.open, true);
    await act(async () => view.props.children[1].props.onOpenChange(false));
    await render(7);
    assert.equal(view.props.children[1].props.open, false);
    assert.match(view.props.children[1].props.query, /70%/);
    await act(async () => view.props.children[1].props.onOpenChange(true));
    assert.match(renderToStaticMarkup(view), /aria-valuenow="70"/);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});
