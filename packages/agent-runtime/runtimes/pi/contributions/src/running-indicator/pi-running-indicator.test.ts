import assert from "node:assert/strict";
import test from "node:test";

import {
  createRunningIndicatorCatalog,
  DEFAULT_RUNNING_INDICATOR_STYLE_ID,
  shellRunningIndicatorDefinitions,
} from "@workbench/shell/running-indicator";

import { createPiI18n } from "../i18n";
import {
  createPiRunningIndicatorRenderer,
  isPiRunningIndicatorWordmarkStyle,
  piRunningIndicatorDefinitions,
  piRunningIndicatorLabels,
  PI_RUNNING_INDICATOR_STYLE_IDS,
} from "./pi-running-indicator";

test("exports all four persisted Pi activity indicator styles with localized labels", () => {
  assert.deepEqual(
    piRunningIndicatorDefinitions.map((definition) => definition.id),
    PI_RUNNING_INDICATOR_STYLE_IDS,
  );

  const i18n = createPiI18n("en-US");
  assert.equal(i18n.text(piRunningIndicatorDefinitions[0]!.label), "Pi logo · Light sweep");
  assert.equal(i18n.text(piRunningIndicatorDefinitions[3]!.label), "Pixel wordmark · Dark theme");
  for (const styleId of PI_RUNNING_INDICATOR_STYLE_IDS) {
    assert.equal(
      piRunningIndicatorDefinitions.find((definition) => definition.id === styleId)?.label,
      piRunningIndicatorLabels[styleId],
    );
    assert.equal(typeof createPiRunningIndicatorRenderer(styleId), "function");
  }
});

test("a combined catalog resolves every historical Pi style id", () => {
  const catalog = createRunningIndicatorCatalog({
    defaultStyleId: DEFAULT_RUNNING_INDICATOR_STYLE_ID,
    definitions: [...shellRunningIndicatorDefinitions, ...piRunningIndicatorDefinitions],
  });

  for (const id of PI_RUNNING_INDICATOR_STYLE_IDS) assert.equal(catalog.resolve(id).id, id);
  assert.equal(isPiRunningIndicatorWordmarkStyle("pi-wordmark-on-light"), true);
  assert.equal(isPiRunningIndicatorWordmarkStyle("pi-logo-shine"), false);
});
