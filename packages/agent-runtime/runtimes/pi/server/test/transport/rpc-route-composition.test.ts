import assert from "node:assert/strict";
import test from "node:test";

import {
  createPiRpcRouteGroups,
  type PiRpcRouteGroupsDependencies,
} from "../../src/transport/rpc-route-composition";

const ROUTE_METHODS = [
  "session.list",
  "session.contextTrace.list",
  "sessionImport.scan",
  "workspace.list",
  "skill.list",
  "extension.list",
  "package.list",
  "packageCatalog.search",
  "llm.providers",
  "llm.modelContextWindow",
  "settings.describe",
  "host.describe",
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
    skill: empty,
    extension: empty,
    installedPackage: empty,
    packageCatalog: empty,
    modelProvider: empty,
    modelContextWindow: empty,
    agentSettings: empty,
    host: empty,
    projectTrust: empty,
    resourceCatalog: empty,
  };
}

test("creates the Pi route groups in stable first-claim order", async () => {
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
