import assert from "node:assert/strict";
import test from "node:test";

import {
  bindCapabilityToCatalogTarget,
  builtinExtensionSurfaceParams,
  extensionSurfaceParams,
  npmPackageNameFromSource,
  sectionForCapability,
  skillSurfaceParams,
  toolboxDirectoryResource,
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

test("maps Pi extensions to their toolbox section", () => {
  assert.equal(sectionForCapability(capability("extension")), "extensions");
});

test("built-in extensions open alongside Pi extensions without an editable directory resource", () => {
  const params = builtinExtensionSurfaceParams({
    name: "workbench.rpiv-todo",
    toolNames: ["todo"],
    commandNames: [],
    eventNames: ["session_start"],
    toolDetails: [{ name: "todo", label: "Todo" }],
    commandDetails: [],
    eventDetails: [{ name: "session_start", handlerCount: 1 }],
  });
  assert.equal(sectionForCapability(params), "extensions");
  assert.equal(params.builtin, true);
  assert.deepEqual(params.toolNames, ["todo"]);
  assert.equal(params.filePath, undefined);
  assert.equal(toolboxDirectoryResource(params, { scope: "user" }), undefined);
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

test("gives project capabilities a project-specific identity and label context", () => {
  const params = bindCapabilityToCatalogTarget(
    capability("skill"),
    "project",
    { scope: "project", workspaceId: "project-1" },
    {
      id: "project-1",
      name: "Workbench UI",
      path: "/projects/workbench-ui",
    },
  );

  assert.equal(params.capabilityId, "test:skill:project:project-1");
  assert.deepEqual(params.catalogTarget, { scope: "project", workspaceId: "project-1" });
  assert.equal(params.projectId, "project-1");
  assert.equal(params.projectName, "Workbench UI");
  assert.equal(params.projectPath, "/projects/workbench-ui");
});

test("preserves the loaded Pi extension path for the details header", () => {
  const params = extensionSurfaceParams({
    name: "review",
    filePath: "/home/user/.pi/agent/extensions/review.ts",
    source: "auto",
    scope: "user",
    origin: "top-level",
    enabled: true,
    eventNames: [],
    toolNames: [],
    commandNames: [],
    eventDetails: [{ name: "session_start", handlerCount: 1 }],
    toolDetails: [
      {
        name: "review_changes",
        label: "Review changes",
        description: "Reviews the current diff.",
        parameterSchemaJson: '{"type":"object"}',
      },
    ],
    commandDetails: [
      {
        name: "review",
        description: "Review the current changes.",
        hasArgumentCompletions: false,
      },
    ],
  });

  assert.equal(params.filePath, "/home/user/.pi/agent/extensions/review.ts");
  assert.equal(params.extensionName, "review");
  assert.equal(params.enabled, true);
  assert.deepEqual(params.eventDetails, [{ name: "session_start", handlerCount: 1 }]);
  assert.equal(params.toolDetails?.[0]?.label, "Review changes");
  assert.equal(params.commandDetails?.[0]?.description, "Review the current changes.");
});

test("uses the npm package name to display package-provided Pi extensions", () => {
  const params = extensionSurfaceParams({
    name: "dist",
    filePath: "/home/user/.pi/agent/npm/node_modules/@narumitw/pi-goal/dist/index.ts",
    source: "npm:@narumitw/pi-goal",
    scope: "user",
    origin: "package",
    enabled: true,
    eventNames: [],
    toolNames: [],
    commandNames: [],
    eventDetails: [],
    toolDetails: [],
    commandDetails: [],
  });

  assert.equal(params.name, "@narumitw/pi-goal");
  assert.equal(params.packageName, "@narumitw/pi-goal");
  assert.match(params.capabilityId, /dist$/);
});

test("describes a selected Skill directory without waiting for a default file", () => {
  assert.deepEqual(toolboxDirectoryResource(capability("skill"), { scope: "user" }), {
    scheme: "skill-directory",
    path: "skill",
    label: "skill",
    metadata: {
      resourceTarget: { scope: "user" },
      skillName: "skill",
    },
  });
});

test("keeps the complete extension identity in its directory resource", () => {
  assert.deepEqual(
    toolboxDirectoryResource(
      {
        capabilityId: "extension:review",
        capabilityKind: "extension",
        name: "pi-review",
        extensionName: "review",
        filePath: "/extensions/review.ts",
        source: "npm:pi-review",
        scope: "user",
        origin: "package",
      },
      { scope: "user" },
    ),
    {
      scheme: "extension-directory",
      path: "/extensions/review.ts",
      label: "review",
      metadata: {
        resourceTarget: { scope: "user" },
        extensionName: "review",
        extensionFilePath: "/extensions/review.ts",
        extensionSource: "npm:pi-review",
        extensionScope: "user",
        extensionOrigin: "package",
      },
    },
  );
});

test("does not invent directory resources for capabilities without an authorized root", () => {
  assert.equal(toolboxDirectoryResource(capability("prompt"), { scope: "user" }), undefined);
  assert.equal(toolboxDirectoryResource(capability("skill"), undefined), undefined);
});

test("binds user capabilities directly to the user resource catalog", () => {
  const params = bindCapabilityToCatalogTarget(capability("skill"), "user", { scope: "user" });

  assert.equal(params.capabilityId, "test:skill");
  assert.deepEqual(params.catalogTarget, { scope: "user" });
  assert.equal(params.projectId, undefined);
  assert.equal(params.projectName, undefined);
});
