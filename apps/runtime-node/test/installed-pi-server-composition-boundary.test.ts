import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const INSTALLED_PI_SERVER = new URL("../src/composition/installed-pi-server.ts", import.meta.url);

function count(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

test("the Runtime application owns the one installed Pi service graph", async () => {
  const source = await readFile(INSTALLED_PI_SERVER, "utf8");

  assert.match(source, /createInstalledWorkbenchAgentServerAdapter/);
  assert.match(source, /createPiAgentServerInstallation/);
  assert.match(source, /CommandService/);
  assert.match(source, /createDefaultPiRpcRouteGroups/);
  assert.match(source, /createPiRpcRouter/);
  assert.match(source, /createPiRuntimeHttpRouter/);
  assert.match(source, /const commands = new CommandService\(\)/);
  assert.match(
    source,
    /createInstalledWorkbenchAgentServerAdapter\(\s*createPiAgentServerInstallation\(\{ commands, host \}\),?\s*\)/,
  );
  assert.match(source, /const routeGroups = createDefaultPiRpcRouteGroups\(\{/);
  assert.match(source, /const handleRpcPost = createPiRpcRouter\(\{/);
  assert.match(source, /handleHttpRequest: createInstalledPiRuntimeHttpHandler\(handleRpcPost\)/);
  assert.match(source, /return createPiRuntimeHttpRouter\(\{/);

  assert.equal(count(source, /new CommandService\(\)/g), 1);
  assert.equal(count(source, /createPiAgentServerInstallation\(/g), 1);
  assert.equal(count(source, /createDefaultPiRpcRouteGroups\(/g), 1);
  assert.equal(count(source, /createPiRpcRouter\(/g), 1);
  assert.equal(count(source, /createPiRuntimeHttpRouter\(/g), 1);
});

test("the Runtime application reuses the installed graph across its public Pi handlers", async () => {
  const source = await readFile(INSTALLED_PI_SERVER, "utf8");

  assert.match(source, /const installedGlobal = globalThis/);
  assert.match(source, /const current = installedGlobal\.__workbenchInstalledPiServer/);
  assert.match(source, /if \(current\)/);
  assert.match(source, /installedGlobal\.__workbenchInstalledPiServer = installed/);
  assert.match(source, /return getInstalledPiServer\(\)\.handleRpcPost\(request, method\)/);
  assert.doesNotMatch(source, /createPiSessionProtocolFacade/);
  assert.doesNotMatch(source, /new SessionRpcService\(/);
});
