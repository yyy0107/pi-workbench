import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ProjectTrustService,
  ProjectTrustServiceError,
} from "../../src/trust/project-trust-service";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-project-trust-"));
  const agentDir = path.join(root, "agent");
  const projectDir = path.join(root, "project");
  await mkdir(projectDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { agentDir, projectDir, service: new ProjectTrustService({ agentDir }) };
}

test("asks before admitting a new workspace even before it has project resources", async (t) => {
  const { agentDir, projectDir, service } = await fixture(t);

  assert.deepEqual(service.describe({ path: projectDir }), {
    path: projectDir,
    requiresTrust: false,
    trusted: null,
    promptRequired: true,
  });

  assert.deepEqual(service.update({ path: projectDir, trusted: false }), {
    path: projectDir,
    requiresTrust: false,
    trusted: false,
    promptRequired: false,
    decisionPath: projectDir,
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(agentDir, "trust.json"), "utf8")), {
    [projectDir]: false,
  });
});

test("persists a project decision in Pi trust.json and reuses it", async (t) => {
  const { agentDir, projectDir, service } = await fixture(t);
  await mkdir(path.join(projectDir, ".pi", "extensions"), { recursive: true });

  assert.deepEqual(service.describe({ path: projectDir }), {
    path: projectDir,
    requiresTrust: true,
    trusted: null,
    promptRequired: true,
  });

  assert.deepEqual(service.update({ path: projectDir, trusted: true }), {
    path: projectDir,
    requiresTrust: true,
    trusted: true,
    promptRequired: false,
    decisionPath: projectDir,
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(agentDir, "trust.json"), "utf8")), {
    [projectDir]: true,
  });
  assert.equal(service.isTrusted(projectDir), true);
});

test("applies the nearest saved parent-folder decision", async (t) => {
  const { agentDir, projectDir, service } = await fixture(t);
  const childDir = path.join(projectDir, "packages", "app");
  await mkdir(path.join(childDir, ".pi", "skills"), { recursive: true });

  service.update({ path: projectDir, trusted: false });
  assert.deepEqual(service.describe({ path: childDir }), {
    path: childDir,
    requiresTrust: true,
    trusted: false,
    promptRequired: false,
    decisionPath: projectDir,
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(agentDir, "trust.json"), "utf8")), {
    [projectDir]: false,
  });
});

test("defaults existing projects to trusted without overriding saved decisions", async (t) => {
  const { agentDir, projectDir, service } = await fixture(t);
  const unresolvedProject = path.join(projectDir, "unresolved");
  const blockedParent = path.join(projectDir, "blocked");
  const blockedChild = path.join(blockedParent, "child");
  const alreadyTrusted = path.join(projectDir, "trusted");
  await Promise.all([
    mkdir(unresolvedProject, { recursive: true }),
    mkdir(path.join(blockedChild, ".pi", "skills"), { recursive: true }),
    mkdir(alreadyTrusted, { recursive: true }),
  ]);
  service.update({ path: blockedParent, trusted: false });
  service.update({ path: alreadyTrusted, trusted: true });

  assert.deepEqual(
    service.trustExistingProjects([
      unresolvedProject,
      blockedChild,
      alreadyTrusted,
      unresolvedProject,
      path.join(projectDir, "missing"),
    ]),
    [unresolvedProject],
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(agentDir, "trust.json"), "utf8")), {
    [blockedParent]: false,
    [unresolvedProject]: true,
    [alreadyTrusted]: true,
  });
  assert.equal(service.isTrusted(blockedChild), false);
});

test("honors global defaultProjectTrust when no saved decision exists", async (t) => {
  const { agentDir, projectDir } = await fixture(t);
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "settings.json"), '{"defaultProjectTrust":"always"}\n');

  assert.equal(new ProjectTrustService({ agentDir }).describe({ path: projectDir }).trusted, true);

  await writeFile(path.join(agentDir, "settings.json"), '{"defaultProjectTrust":"never"}\n');
  assert.equal(new ProjectTrustService({ agentDir }).describe({ path: projectDir }).trusted, false);
});

test("only the exact Workbench trust override enables every project", async (t) => {
  const { agentDir, projectDir } = await fixture(t);
  await mkdir(path.join(projectDir, ".pi"), { recursive: true });
  await writeFile(path.join(projectDir, ".pi", "settings.json"), "{}\n");

  assert.equal(
    new ProjectTrustService({ agentDir, trustOverride: () => false }).isTrusted(projectDir),
    false,
  );
  assert.equal(
    new ProjectTrustService({ agentDir, trustOverride: () => true }).isTrusted(projectDir),
    true,
  );
});

test("rejects trust updates for invalid project paths", async (t) => {
  const { agentDir, projectDir } = await fixture(t);
  const service = new ProjectTrustService({ agentDir });

  assert.throws(
    () => service.update({ path: path.join(projectDir, "missing"), trusted: true }),
    (error: unknown) => {
      assert.ok(error instanceof ProjectTrustServiceError);
      assert.equal(error.code, "project-trust-invalid-path");
      return true;
    },
  );
});
