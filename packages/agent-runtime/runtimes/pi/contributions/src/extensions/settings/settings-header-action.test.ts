import assert from "node:assert/strict";
import test from "node:test";

import {
  openSettingsConfigurationDocument,
  type PiSettingsDocumentClient,
} from "./settings-header-action";

test("opens the selected settings document through the installed configuration client", async () => {
  const opened: string[] = [];
  const client: PiSettingsDocumentClient = {
    async openAgentSettingsDocument() {
      opened.push("pi");
    },
    async openWorkbenchSettingsDocument() {
      opened.push("workbench");
    },
  };

  await openSettingsConfigurationDocument(client, "pi");
  await openSettingsConfigurationDocument(client, "workbench");

  assert.deepEqual(opened, ["pi", "workbench"]);
});
