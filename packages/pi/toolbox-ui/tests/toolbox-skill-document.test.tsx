import { uiTranslationBundle } from "@workbench/ui/i18n";
import { markdownTranslationBundle } from "@workbench/markdown/i18n";
import { codeHighlightingTranslationBundle } from "@workbench/code-highlighting/i18n";
import { piSettingsUiTranslationBundle } from "@workbench/pi-settings-ui/i18n";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@workbench/i18n";
import { WorkbenchSettingsProvider } from "@workbench/settings-runtime";
import { toolboxUiTranslationBundle as piTranslationBundle } from "../src/i18n";
import { SkillDocumentPanel, skillDocumentBody } from "../src/toolbox-capability-presentation";

test("skill preview omits leading frontmatter while source preserves the complete document", () => {
  const body = "# Setup\n\nInstructions\n\n---\n\nMore instructions\n";
  const metadata = "---\nname: setup\ndescription: Install the tool\n---\n";
  for (const prefix of [
    metadata,
    "\uFEFF" + metadata,
    metadata.replaceAll("\n", "\r\n"),
    "---\n---\n",
    "---\nname: setup\n...\n",
  ]) {
    assert.equal(skillDocumentBody(prefix + body), body);
  }
  for (const unchanged of [
    body,
    "---\nname: setup\n",
    "---\nname: setup\n--- not a delimiter\n",
    "# Guide\n" + metadata,
  ]) {
    assert.equal(skillDocumentBody(unchanged), unchanged);
  }

  const render = (documentMode: "preview" | "source") =>
    renderToStaticMarkup(
      <WorkbenchSettingsProvider
        service={{ load: async () => ({}), update: async () => undefined }}
      >
        <I18nProvider
          locale="en-US"
          onLocaleChange={() => {}}
          bundles={[
            piTranslationBundle,
            uiTranslationBundle,
            markdownTranslationBundle,
            codeHighlightingTranslationBundle,
            piSettingsUiTranslationBundle,
          ]}
        >
          <SkillDocumentPanel
            content={metadata + body}
            documentMode={documentMode}
            loadState="ready"
            scopeAvailable
            onDocumentModeChange={() => undefined}
            onRefresh={() => undefined}
          />
        </I18nProvider>
      </WorkbenchSettingsProvider>,
    );
  const preview = render("preview");
  assert.match(preview, /Setup/);
  assert.doesNotMatch(preview, /name: setup|description: Install the tool/);
  assert.ok(render("source").includes(metadata + body));
});
