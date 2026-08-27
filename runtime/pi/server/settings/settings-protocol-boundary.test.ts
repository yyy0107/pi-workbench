import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const AGENT_SETTINGS_SERVICE = new URL("./agent-settings-service.ts", import.meta.url);
const WORKBENCH_SETTINGS_SERVICE = new URL("./workbench-settings-service.ts", import.meta.url);
const IMAGE_SETTINGS_STORE = new URL(
  "../attachment-understanding/settings-store.ts",
  import.meta.url,
);
const AGENT_SETTINGS_ROUTES = new URL(
  "../transport/routes/agent-settings-rpc-routes.ts",
  import.meta.url,
);
const WORKBENCH_SETTINGS_ROUTES = new URL(
  "../transport/routes/workbench-settings-rpc-routes.ts",
  import.meta.url,
);
const IMAGE_SETTINGS_ROUTES = new URL(
  "../transport/routes/image-understanding-settings-rpc-routes.ts",
  import.meta.url,
);
const RPC_ROUTER = new URL("../transport/rpc-router.ts", import.meta.url);

const AGENT_SETTINGS_METHODS = [
  "settings.describe",
  "settings.openDocument",
  "settings.update",
] as const;
const WORKBENCH_SETTINGS_METHODS = [
  "workbenchSettings.describe",
  "workbenchSettings.update",
] as const;
const IMAGE_SETTINGS_METHODS = [
  "imageUnderstanding.describe",
  "imageUnderstanding.update",
] as const;

test("each Settings transport depends on only its narrow protocol", async () => {
  const [agent, workbench, image] = await Promise.all([
    readFile(AGENT_SETTINGS_ROUTES, "utf8"),
    readFile(WORKBENCH_SETTINGS_ROUTES, "utf8"),
    readFile(IMAGE_SETTINGS_ROUTES, "utf8"),
  ]);

  assert.match(agent, /import type \{[\s\S]*AgentSettingsProtocol/);
  assert.match(workbench, /import type \{ WorkbenchSettingsProtocol \}/);
  assert.match(image, /import type \{ ImageUnderstandingSettingsProtocol \}/);
  for (const source of [agent, workbench, image]) {
    assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
    assert.doesNotMatch(source, /node:fs|node:path/);
    assert.doesNotMatch(source, /withCrossProcessFileLock|atomicReplaceFile/);
  }
  assert.doesNotMatch(agent, /WorkbenchSettingsProtocol|ImageUnderstandingSettingsProtocol/);
  assert.doesNotMatch(workbench, /AgentSettingsProtocol|ImageUnderstandingSettingsProtocol/);
  assert.doesNotMatch(image, /AgentSettingsProtocol|WorkbenchSettingsProtocol/);
});

test("Settings routes preserve their distinct trust, budget, and lifecycle boundaries", async () => {
  const [agent, workbench, image] = await Promise.all([
    readFile(AGENT_SETTINGS_ROUTES, "utf8"),
    readFile(WORKBENCH_SETTINGS_ROUTES, "utf8"),
    readFile(IMAGE_SETTINGS_ROUTES, "utf8"),
  ]);

  assert.equal(agent.match(/loopbackOnly: true/g)?.length, 3);
  assert.match(agent, /RPC_REQUEST_BODY_LIMITS\.agentSettingsUpdate/);
  assert.match(agent, /service\.prepareDocument\(\)/);
  assert.match(agent, /openDocument\(settingsFile, signal\)/);
  assert.match(agent, /Opening settings was cancelled/);

  assert.doesNotMatch(workbench, /loopbackOnly: true/);
  assert.match(workbench, /RPC_REQUEST_BODY_LIMITS\.workbenchSettingsUpdate/);
  assert.match(workbench, /getService\(\)\.describe\(\)/);
  assert.match(workbench, /getService\(\)\.update\(payload\)/);

  assert.equal(image.match(/loopbackOnly: true/g)?.length, 2);
  assert.match(image, /getStore\(\)\.describe\(\)/);
  assert.match(image, /getStore\(\)\.update\(payload\)/);
  assert.match(image, /const imageUnderstandingCredential/);
});

test("Settings services implement narrow protocols while retaining persistence ownership", async () => {
  const [agent, workbench, image] = await Promise.all([
    readFile(AGENT_SETTINGS_SERVICE, "utf8"),
    readFile(WORKBENCH_SETTINGS_SERVICE, "utf8"),
    readFile(IMAGE_SETTINGS_STORE, "utf8"),
  ]);

  assert.match(agent, /export interface AgentSettingsProtocol/);
  assert.match(agent, /export class AgentSettingsService implements AgentSettingsProtocol/);
  assert.match(agent, /getAgentDir/);
  assert.match(agent, /SYSTEM\.md/);
  assert.match(agent, /withCrossProcessFileLock/);
  assert.doesNotMatch(agent, /agent-settings-rpc-routes|rpc-transport/);

  assert.match(workbench, /export interface WorkbenchSettingsProtocol/);
  assert.match(
    workbench,
    /export class WorkbenchSettingsService implements WorkbenchSettingsProtocol/,
  );
  assert.match(workbench, /readWorkbenchSettingsDocument/);
  assert.match(workbench, /preferenceListenersByStateFile/);
  assert.doesNotMatch(workbench, /workbench-settings-rpc-routes|rpc-transport/);

  assert.match(image, /export interface ImageUnderstandingSettingsProtocol/);
  assert.match(
    image,
    /export class ImageUnderstandingSettingsStore implements ImageUnderstandingSettingsProtocol/,
  );
  assert.match(image, /parseOcrAdapterSource/);
  assert.match(image, /secrets/);
  assert.match(image, /legacyStateFile/);
  assert.doesNotMatch(image, /image-understanding-settings-rpc-routes|rpc-transport/);
});

test("the RPC router composes Settings groups without retaining their transport details", async () => {
  const source = await readFile(RPC_ROUTER, "utf8");

  assert.match(source, /import \{ createAgentSettingsRpcRoutes \}/);
  assert.match(source, /import \{ createWorkbenchSettingsRpcRoutes \}/);
  assert.match(source, /import \{ createImageUnderstandingSettingsRpcRoutes \}/);
  assert.match(source, /const agentSettingsRpcRoutes = createAgentSettingsRpcRoutes\(/);
  assert.match(source, /const workbenchSettingsRpcRoutes = createWorkbenchSettingsRpcRoutes\(/);
  assert.match(
    source,
    /const imageUnderstandingSettingsRpcRoutes = createImageUnderstandingSettingsRpcRoutes\(/,
  );
  assert.match(source, /\n\s+agentSettingsRpcRoutes,/);
  assert.match(source, /\n\s+workbenchSettingsRpcRoutes,/);
  assert.match(source, /\n\s+imageUnderstandingSettingsRpcRoutes,/);
  assert.match(source, /error instanceof AgentSettingsServiceError/);
  assert.match(source, /error instanceof WorkbenchSettingsServiceError/);
  assert.match(source, /error instanceof ImageUnderstandingSettingsStoreError/);
  for (const method of [
    ...AGENT_SETTINGS_METHODS,
    ...WORKBENCH_SETTINGS_METHODS,
    ...IMAGE_SETTINGS_METHODS,
  ]) {
    assert.ok(!source.includes(`case "${method}":`), `Router still owns Settings route: ${method}`);
  }
  assert.doesNotMatch(source, /const agentSettingsPatch/);
  assert.doesNotMatch(source, /const settingsUpdatePayload/);
  assert.doesNotMatch(source, /const workbenchSettingsUpdatePayload/);
  assert.doesNotMatch(source, /const imageUnderstandingCredential/);
  assert.doesNotMatch(source, /const imageUnderstandingUpdatePayload/);
  assert.doesNotMatch(source, /compaction-rpc-validator/);
});
