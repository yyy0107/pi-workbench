import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SKILL_SERVICE = new URL("./skill-service.ts", import.meta.url);
const SKILL_RPC_ROUTES = new URL("../transport/routes/skill-rpc-routes.ts", import.meta.url);
const RESOURCE_RPC_VALIDATORS = new URL("../transport/resource-rpc-validators.ts", import.meta.url);
const RPC_ROUTE_COMPOSITION = new URL("../transport/rpc-route-composition.ts", import.meta.url);

const SKILL_RPC_METHODS = [
  "skill.list",
  "skill.describe",
  "skill.setEnabled",
  "skill.remove",
  "skill.files.list",
  "skill.files.read",
] as const;

test("Skill transport depends only on its protocol and shared resource validators", async () => {
  const source = await readFile(SKILL_RPC_ROUTES, "utf8");

  assert.match(source, /import type \{ SkillProtocol \}/);
  assert.match(source, /from "\.\.\/resource-rpc-validators"/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  assert.doesNotMatch(source, /session-registry|scoped-resource-context/);
  assert.doesNotMatch(source, /pi-resource-mutation-coordinator|WorkspaceStore/);
  assert.doesNotMatch(source, /node:fs|node:path/);
  for (const method of SKILL_RPC_METHODS) {
    assert.ok(source.includes(`case "${method}":`), `Missing extracted Skill route: ${method}`);
  }
  for (const method of ["command.list", "extension.list", "package.list"]) {
    assert.ok(
      !source.includes(`case "${method}":`),
      `Non-Skill route leaked into Skills: ${method}`,
    );
  }
});

test("SkillService implements the narrow protocol while retaining Pi resource ownership", async () => {
  const source = await readFile(SKILL_SERVICE, "utf8");

  assert.match(source, /export interface SkillProtocol/);
  assert.match(source, /export class SkillService implements SkillProtocol/);
  assert.match(source, /from "@earendil-works\/pi-coding-agent"/);
  assert.match(source, /from "\.\.\/resources\/scoped-resource-context"/);
  assert.match(source, /from "\.\.\/sessions\/session-registry"/);
  assert.match(source, /from "\.\.\/resources\/pi-resource-mutation-coordinator"/);
  assert.doesNotMatch(source, /rpc-transport|skill-rpc-routes/);
});

test("shared Resource validators own catalog identities without importing a domain", async () => {
  const source = await readFile(RESOURCE_RPC_VALIDATORS, "utf8");

  assert.match(source, /export const resourceCatalogTarget/);
  assert.match(source, /export function resourceRequestPayload/);
  assert.match(source, /export const resourceListPayload/);
  assert.match(source, /Expected exactly one of sessionId or target\./);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  assert.doesNotMatch(source, /skill-service|extension-service|package/);
  assert.doesNotMatch(source, /WorkspaceStore|session-registry|scoped-resource-context/);
});

test("the route composition creates Skills without retaining transport details", async () => {
  const source = await readFile(RPC_ROUTE_COMPOSITION, "utf8");

  assert.match(source, /createSkillRpcRoutes/);
  assert.match(source, /const skillService = new SkillService/);
  assert.match(source, /createSkillRpcRoutes\(dependencies\.skill\)/);
  assert.match(source, /skill: \{ service: skillService, \.\.\.domainErrors \}/);
  assert.doesNotMatch(source, /resource-rpc-validators/);
  assert.match(source, /projectRpcDomainError/);
  for (const method of SKILL_RPC_METHODS) {
    assert.ok(!source.includes(`case "${method}":`), `Router still owns Skill route: ${method}`);
  }
  assert.doesNotMatch(source, /const skillDescribePayload/);
  assert.doesNotMatch(source, /const skillSetEnabledPayload/);
  assert.doesNotMatch(source, /const skillFilesListPayload/);
  assert.doesNotMatch(source, /const skillFileReadPayload/);
  assert.doesNotMatch(source, /const resourceCatalogTarget/);
  assert.doesNotMatch(source, /function resourceRequestPayload/);
});
