import assert from "node:assert/strict";
import test from "node:test";

import {
  componentExtensionCapabilityId,
  npmPackageNameFromSource,
  sectionForCapability,
  skillSurfaceParams,
  type ToolboxCapabilitySurfaceParams,
} from "./toolbox-capability";

function capability(
  capabilityKind: ToolboxCapabilitySurfaceParams["capabilityKind"],
): ToolboxCapabilitySurfaceParams {
  return {
    capabilityId: `test:${capabilityKind}`,
    capabilityKind,
    name: capabilityKind,
  };
}

test("keeps frontend component extensions separate from Pi extensions", () => {
  assert.equal(sectionForCapability(capability("component-extension")), "component-extensions");
  assert.equal(sectionForCapability(capability("extension")), "extensions");
});

test("uses a component-specific capability id namespace", () => {
  assert.equal(
    componentExtensionCapabilityId("workbench.generative-ui"),
    "component-extension:workbench.generative-ui",
  );
});

test("derives official catalog package names only from canonical npm sources", () => {
  assert.equal(npmPackageNameFromSource("npm:pi-review"), "pi-review");
  assert.equal(npmPackageNameFromSource("npm:@acme/pi-review"), "@acme/pi-review");
  assert.equal(npmPackageNameFromSource("git:github.com/acme/pi-review"), undefined);
  assert.equal(npmPackageNameFromSource("npm:@acme/pi-review@next"), undefined);
});

test("preserves a disabled Skill when opening its Toolbox details", () => {
  assert.equal(
    skillSurfaceParams({
      name: "review",
      description: "Review changes.",
      enabled: false,
      modelInvocable: true,
      source: "auto",
      scope: "user",
      origin: "top-level",
    }).enabled,
    false,
  );
});
