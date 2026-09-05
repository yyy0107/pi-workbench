import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import { piTranslationBundle } from "../../i18n";
import { SkillDocumentPanel, skillDocumentBody } from "./toolbox-capability-presentation";

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
        <I18nProvider initialLocale="en-US" bundles={[piTranslationBundle]}>
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
