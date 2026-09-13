import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchPresentationProvider } from "@workbench/shell-context/presentation";

import { createPiI18n } from "../src/i18n";
import {
  createPiRunningIndicatorRenderer,
  isPiRunningIndicatorWordmarkStyle,
  piRunningIndicatorDefinitions,
  piRunningIndicatorLabels,
  PI_RUNNING_INDICATOR_STYLE_IDS,
} from "../src/pi-running-indicator";

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

test("identifies Pi wordmark presentation styles", () => {
  assert.equal(isPiRunningIndicatorWordmarkStyle("pi-wordmark-on-light"), true);
  assert.equal(isPiRunningIndicatorWordmarkStyle("pi-logo-shine"), false);
});

test("Pi logo activity styles use the supplied product logo with a stable alpha mask", () => {
  for (const id of ["pi-logo-shine", "pi-logo-shine-inverted"] as const) {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchPresentationProvider, {
        branding: {
          productName: "Pi Workbench",
          runtimeName: "Pi",
          productLogoUrl: "/custom-logo.svg",
        },
        assets: { fileViewerAssetBaseUrl: "/file-viewer", materialIconThemeBaseUrl: "/icons" },
        children: createElement(createPiRunningIndicatorRenderer(id), { paused: true }),
      }),
    );
    assert.match(markup, /<image href="\/custom-logo\.svg"/);
    assert.match(markup, /<mask[^>]+maskUnits="userSpaceOnUse"[^>]+mask-type:alpha/);
    assert.doesNotMatch(markup, /<animate\b/);
  }
});
