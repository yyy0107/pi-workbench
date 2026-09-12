import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  SessionContextTraceCaptureMetadata,
  SessionContextTraceEvent,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { I18nProvider } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";

import { piTranslationBundle } from "../../i18n";
import { ContextTraceDetail } from "./context-trace-detail";

const capture: SessionContextTraceCaptureMetadata = {
  originalBytes: 1,
  capturedBytes: 1,
  truncated: false,
  redactedPaths: [],
};

const promptEvent = {
  schemaVersion: 1,
  traceId: "activation:prompt",
  sessionId: "session",
  activationId: "activation",
  seq: 1,
  time: 1,
  kind: "prompt-composition",
  detailBytes: 1,
  truncated: false,
  redacted: false,
  detail: {
    type: "prompt-composition",
    prompt: { ...capture, text: "Compare these", originalCharacters: 13 },
    systemPrompt: { ...capture, text: "System", originalCharacters: 6 },
    systemPromptOptions: { cwd: "/workspace", contextFiles: [], skills: [] },
    images: {
      value: [
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
          name: "diagram.png",
        },
      ],
      capture,
    },
    tools: [],
  },
} satisfies SessionContextTraceEvent;

function renderPreview(event: SessionContextTraceEvent) {
  return renderToStaticMarkup(
    <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => undefined }}>
      <I18nProvider initialLocale="en-US" bundles={[piTranslationBundle]}>
        <ContextTraceDetail
          detail={{ status: "ready", event }}
          focus={{ type: "prompt-section", section: "user-prompt" }}
          summary={event}
          view="preview"
        />
      </I18nProvider>
    </WorkbenchSettingsProvider>,
  );
}

test("renders inline attachments inside the user-message preview", () => {
  const html = renderPreview(promptEvent);
  assert.match(html, /Compare these/u);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,iVBORw0KGgo="/u);
  assert.match(html, /alt="Preview of diagram\.png"/u);
});

test("does not render captured SVG data as an image source", () => {
  const event = {
    ...promptEvent,
    detail: {
      ...promptEvent.detail,
      images: {
        value: [
          {
            type: "image",
            data: "data:image/svg+xml;base64,PHN2Zz4=",
            mimeType: "image/svg+xml",
          },
        ],
        capture,
      },
    },
  } satisfies SessionContextTraceEvent;
  const html = renderPreview(event);
  assert.doesNotMatch(html, /<img\b/u);
  assert.match(html, /Image preview unavailable/u);
});
