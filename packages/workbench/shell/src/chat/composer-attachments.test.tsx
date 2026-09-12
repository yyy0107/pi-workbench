import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { ManagedFileComposerAttachment } from "@workbench/agent-runtime-contracts/conversation";

import { I18nProvider } from "../i18n";
import { WorkbenchPresentationProvider } from "../presentation";
import { WorkbenchSettingsProvider } from "../settings";
import { ComposerAttachments } from "./composer-attachments";

const SETTINGS = {
  load: async () => ({}),
  update: async () => undefined,
};

function renderAttachment(attachment: ManagedFileComposerAttachment): string {
  return renderToStaticMarkup(
    <WorkbenchPresentationProvider
      assets={{
        fileViewerAssetBaseUrl: "/file-viewer",
        materialIconThemeBaseUrl: "/material-icons",
      }}
      branding={{ productName: "Workbench", runtimeName: "Runtime" }}
    >
      <WorkbenchSettingsProvider service={SETTINGS}>
        <I18nProvider initialLocale="en-US">
          <ComposerAttachments
            attachments={[attachment]}
            onRemove={() => undefined}
            onRetry={() => undefined}
            onRestore={async () => undefined}
          />
        </I18nProvider>
      </WorkbenchSettingsProvider>
    </WorkbenchPresentationProvider>,
  );
}

test("keeps the local image thumbnail visible when persistence fails", () => {
  const source = "data:image/png;base64,aW1hZ2U=";
  const markup = renderAttachment({
    kind: "managed-file",
    key: "image",
    name: "image.png",
    source,
    mediaType: "image/png",
    status: "error",
    error: "file-attachment-failed",
  });

  assert.match(markup, new RegExp(`<img[^>]+src="${source}"`));
  assert.doesNotMatch(markup, /data-slot="avatar-fallback"/);
});

test("uses the shared file-type icon for non-image attachments", () => {
  const markup = renderAttachment({
    kind: "managed-file",
    key: "slides",
    name: "quarterly-review.pptx",
    source:
      "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEs=",
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    status: "saving",
  });

  assert.match(markup, /<img[^>]+src="\/material-icons\/icons\/file\.svg"/);
  assert.doesNotMatch(markup, /lucide-file-text/);
});
