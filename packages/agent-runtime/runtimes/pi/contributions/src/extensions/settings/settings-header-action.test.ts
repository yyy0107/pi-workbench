import assert from "node:assert/strict";
import test from "node:test";

import {
  openPiSettingsConfigurationDocument,
  type PiSettingsDocumentClient,
} from "./settings-header-action";

test("opens only the Pi settings document through the installed configuration client", async () => {
  const opened: string[] = [];
  const client: PiSettingsDocumentClient = {
    async openAgentSettingsDocument() {
      opened.push("pi");
    },
  };

  await openPiSettingsConfigurationDocument(client);

  assert.deepEqual(opened, ["pi"]);
});
