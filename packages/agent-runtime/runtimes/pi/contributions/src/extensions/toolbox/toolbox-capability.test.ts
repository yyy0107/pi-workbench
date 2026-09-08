import assert from "node:assert/strict";
import test from "node:test";

import {
  bindCapabilityToCatalogTarget,
  browserCapabilityPresentation,
  builtinExtensionSurfaceParams,
  extensionSurfaceParams,
  installedPackageSurfaceParams,
  npmPackageNameFromSource,
  resourcePackageSurfaceParams,
  sectionForCapability,
  skillSurfaceParams,
  toolboxDirectoryResource,
  type ToolboxCapabilitySurfaceParams,
} from "./toolbox-capability";
import { createPiI18n } from "../../i18n";

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

test("Browser is a bundled package while its resources retain native Pi identities", () => {
  const source = "./packages/.builtin/browser";
  const packageParams = installedPackageSurfaceParams({
    source,
    scope: "user",
    filtered: true,
    builtin: true,
    name: "@workbench/pi-browser",
    description: "Browser package",
  });
  assert.equal(packageParams.capabilityKind, "package");
  assert.equal(packageParams.builtin, true);
  assert.equal(packageParams.packageFiltered, true);
  assert.equal(packageParams.description, "Browser package");
  assert.equal(packageParams.packageName, undefined);
  for (const sourceAlias of ["packages/.builtin/browser", ".\\packages\\.builtin\\browser"]) {
    assert.equal(
      browserCapabilityPresentation(
        { ...packageParams, name: sourceAlias, source: sourceAlias },
        createPiI18n("en-US").t,
      )?.name,
      "Browser",
    );
  }
  assert.equal(
    browserCapabilityPresentation(packageParams, createPiI18n("en-US").t)?.name,
    "Browser",
  );

  const skill = skillSurfaceParams({
    name: "browser",
    description: "Use the browser",
    enabled: false,
    modelInvocable: true,
    source,
    scope: "user",
    origin: "package",
    packageBuiltin: true,
  });
  assert.equal(skill.builtin, undefined);
  assert.equal(skill.packageBuiltin, true);
  assert.equal(skill.enabled, false);
  assert.equal(browserCapabilityPresentation(skill, createPiI18n("en-US").t), undefined);
  const extension = extensionSurfaceParams({
    name: "browser",
    filePath: "/agent/packages/.builtin/browser/dist/index.js",
    source,
    scope: "user",
    origin: "package",
    packageBuiltin: true,
    enabled: true,
    eventNames: ["session_start", "session_shutdown"],
    toolNames: ["workbench_browser"],
    commandNames: [],
    eventDetails: [],
    toolDetails: [],
    commandDetails: [],
  });
  assert.equal(extension.builtin, undefined);
  assert.equal(extension.packageBuiltin, true);
  assert.equal(
    toolboxDirectoryResource(extension, { scope: "user" })?.scheme,
    "extension-directory",
  );
  assert.equal(
    browserCapabilityPresentation(
      {
        capabilityId: "old-inline",
        capabilityKind: "extension",
        name: "workbench.browser",
        builtin: true,
      },
      createPiI18n("en-US").t,
    ),
    undefined,
  );

  for (const resource of [skill, extension]) {
    const supplying = resourcePackageSurfaceParams(resource, { scope: "user" });
    assert.equal(supplying?.source, source);
    assert.equal(supplying?.installed, true);
    assert.equal(supplying?.builtin, true);
    assert.equal(supplying?.packageName, undefined);
    assert.equal(supplying?.packageFiltered, undefined);
    assert.deepEqual(supplying?.catalogTarget, { scope: "user" });
  }
});

test("package source links preserve pinned local identity and project target", () => {
  const resource = {
    ...capability("extension"),
    source: "npm:@example/pi-tools@1.2.3",
    scope: "project" as const,
    origin: "package" as const,
    projectId: "project-1",
    projectName: "Workbench",
  };
  const target = { scope: "project" as const, workspaceId: "project-1" };
  const supplying = resourcePackageSurfaceParams(resource, target);
  assert.equal(supplying?.source, resource.source);
  assert.equal(supplying?.projectId, "project-1");
  assert.deepEqual(supplying?.catalogTarget, target);
  assert.equal(supplying?.installed, true);
  assert.equal(resourcePackageSurfaceParams(resource, { scope: "user" }), undefined);
  assert.equal(resourcePackageSurfaceParams(resource, undefined), undefined);
  assert.equal(
    resourcePackageSurfaceParams({ ...resource, origin: "top-level" }, target),
    undefined,
  );
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

test("marks bundled skills as built-in while retaining their readable directory", () => {
  const skill = {
    name: "skill-creator",
    description: "Create reusable skills.",
    enabled: true,
    modelInvocable: true,
    source: "builtin",
    scope: "user" as const,
    origin: "top-level" as const,
  };
  const params = skillSurfaceParams(skill);
  assert.equal(params.builtin, true);
  assert.equal(params.modelInvocable, true);
  assert.equal(toolboxDirectoryResource(params, { scope: "user" })?.scheme, "skill-directory");
  assert.equal(skillSurfaceParams({ ...skill, source: "auto" }).builtin, undefined);
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
