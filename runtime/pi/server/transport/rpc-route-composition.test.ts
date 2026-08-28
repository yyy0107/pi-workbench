import assert from "node:assert/strict";
import test from "node:test";

import { createPiRpcRouteGroups, type PiRpcRouteGroupsDependencies } from "./rpc-route-composition";

const ROUTE_METHODS = [
  "session.list",
  "session.contextTrace.list",
  "sessionImport.scan",
  "workspace.list",
  "workspace.git.describe",
  "workspace.files.list",
  "skill.list",
  "extension.list",
  "package.list",
  "packageCatalog.search",
  "llm.providers",
  "llm.modelContextWindow",
  "settings.describe",
  "workbenchSettings.describe",
  "imageUnderstanding.describe",
  "host.describe",
  "host.localApps.list",
  "projectTrust.describe",
  "command.list",
] as const;

function unusedDependencies(): PiRpcRouteGroupsDependencies {
  const empty = {} as never;
  return {
    session: empty,
    sessionContextTrace: empty,
    externalSessionImport: empty,
    workspace: empty,
    workspaceGit: empty,
    workspaceFile: empty,
    skill: empty,
    extension: empty,
    installedPackage: empty,
    packageCatalog: empty,
    modelProvider: empty,
    modelContextWindow: empty,
    agentSettings: empty,
    workbenchSettings: empty,
    imageUnderstandingSettings: empty,
    host: empty,
    localApp: empty,
    projectTrust: empty,
    resourceCatalog: empty,
  };
}

test("creates all nineteen route groups in stable first-claim order", async () => {
  const groups = createPiRpcRouteGroups(unusedDependencies());

  assert.equal(groups.length, ROUTE_METHODS.length);
  for (const [index, method] of ROUTE_METHODS.entries()) {
    const request = new Request(`http://127.0.0.1:3000/api/${method}`, {
      headers: { host: "127.0.0.1:3000" },
    });
    for (const [candidateIndex, group] of groups.entries()) {
      const response = group.handle(request, method);
      assert.equal(
        response !== undefined,
        candidateIndex === index,
        `${method} was claimed by route group ${candidateIndex}`,
      );
      if (response) assert.equal((await response).status, 405);
    }
  }
});
