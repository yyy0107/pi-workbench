import assert from "node:assert/strict";
import test from "node:test";

import { createPiI18n } from "../../i18n";
import { formatToolboxCount } from "./toolbox-sidebar";

test("sidebar counts reflect the catalog and retain known counts while refreshing", () => {
  const { number } = createPiI18n("en-US");
  assert.equal(formatToolboxCount("idle", 0, number), "—");
  assert.equal(formatToolboxCount("ready", 2, number), "2");
  assert.equal(formatToolboxCount("loading", 2, number), "2");
  assert.equal(formatToolboxCount("ready", 1, number), "1");
  assert.equal(formatToolboxCount("ready", 0, number), "0");
  assert.equal(formatToolboxCount("loading", 0, number), "…");
  assert.equal(formatToolboxCount("failed", 0, number), "—");
  assert.equal(formatToolboxCount("ready", 1234, number), number(1234));
});
