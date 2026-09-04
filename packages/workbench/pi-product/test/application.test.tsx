import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  defineRuntimeConnection,
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
} from "@workbench/host-contracts";
import { defineTranslationBundle, useI18n, useTranslationBundle } from "@workbench/shell/i18n";
import {
  PiWorkbenchApplicationProviders,
  useWorkbenchApplicationInstallationId,
} from "../src/application";

const applicationBundle = defineTranslationBundle({
  id: "test.application",
  messages: {
    "en-US": { title: "Web application" },
    "zh-CN": { title: "桌面应用" },
  },
});
function Probe() {
  const { t } = useI18n();
  const application = useTranslationBundle(applicationBundle);
  return (
    <p>
      {useWorkbenchApplicationInstallationId()}:{application.t("title")}:
      {t("workbench.chat.titles.attachmentAnalysis")}
    </p>
  );
}

test("product providers retain the app identity and app/Shell catalogs in both languages", () => {
  const runtimeConnection = defineRuntimeConnection({
    kind: "same-origin",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: "https://workbench.example",
  });
  const render = (locale: "en-US" | "zh-CN", installationId: string) =>
    renderToStaticMarkup(
      <PiWorkbenchApplicationProviders
        bundles={[applicationBundle]}
        initialLocale={locale}
        installationId={installationId}
        runtimeConnection={runtimeConnection}
      >
        <Probe />
      </PiWorkbenchApplicationProviders>,
    );
  assert.equal(render("en-US", "web"), "<p>web:Web application:Attachment analysis</p>");
  assert.equal(render("zh-CN", "desktop"), "<p>desktop:桌面应用:附件分析</p>");
  assert.equal(render("en-US", "web-2"), "<p>web-2:Web application:Attachment analysis</p>");
});
