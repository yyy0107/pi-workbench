import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PromptService } from "../../src/prompts/prompt-service";
import { PiResourceMutationCoordinator } from "../../src/resources/pi-resource-mutation-coordinator";
import { ScopedResourceContextService } from "../../src/resources/scoped-resource-context";

async function setup(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-prompts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = path.join(root, "agent");
  const project = path.join(root, "project");
  await Promise.all([
    mkdir(path.join(agentDir, "prompts"), { recursive: true }),
    mkdir(path.join(project, ".pi", "prompts"), { recursive: true }),
  ]);
  let trusted = true;
  let busy = false;
  let reloads = 0;
  const scopedResources = new ScopedResourceContextService({
    agentDir: () => agentDir,
    applicationCwd: () => root,
    getWorkspace: async (id) => (id === "project" ? { path: project } : undefined),
    isProjectTrusted: () => trusted,
  });
  const service = new PromptService({
    agentDir: () => agentDir,
    scopedResources,
    isProjectTrusted: () => trusted,
    mutationCoordinator: new PiResourceMutationCoordinator({
      getLoadedSessions: () => [
        {
          id: "session",
          isBusy: busy,
          session: {
            sessionManager: { getCwd: () => project },
            reload: async () => {
              reloads++;
            },
          },
        },
      ],
    }),
  });
  return {
    service,
    root,
    agentDir,
    project,
    reloads: () => reloads,
    trust: (value: boolean) => {
      trusted = value;
    },
    busy: (value: boolean) => {
      busy = value;
    },
  };
}

const user = { scope: "user" } as const;
const projectTarget = { scope: "project", workspaceId: "project" } as const;
const code = (expected: string) => (error: unknown) =>
  (error as { code: string }).code === expected;

test("prompt catalog includes disabled package resources and preserves identities and source files", async (t) => {
  const { service, root, project, agentDir } = await setup(t);
  const pkg = path.join(root, "package");
  await mkdir(path.join(pkg, "prompts"), { recursive: true });
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "test-prompts", pi: { prompts: ["./prompts"] } }),
  );
  const content =
    '---\ndescription: Review changes\nargument-hint: "[path]"\n---\nReview $1 and ${2:-tests}. $ARGUMENTS';
  await writeFile(path.join(pkg, "prompts", "review.md"), content);
  await writeFile(path.join(project, ".pi", "prompts", "review.md"), "Project review");
  await writeFile(path.join(agentDir, "prompts", "review.md"), "User review");
  await writeFile(
    path.join(project, ".pi", "settings.json"),
    JSON.stringify({ packages: [{ source: pkg, prompts: ["-prompts/review.md"] }] }),
  );
  const { prompts } = await service.list({ target: projectTarget });
  assert.equal(prompts.length, 2);
  const bundled = prompts.find((item) => item.origin === "package")!;
  const local = prompts.find((item) => item.origin === "top-level")!;
  assert.equal(bundled.enabled, false);
  assert.equal(bundled.editable, false);
  assert.equal(local.editable, true);
  assert.notEqual(bundled.id, local.id);
  assert.equal((await service.list({ target: user })).prompts.length, 1);
  const detail = await service.describe({ target: projectTarget, id: bundled.id });
  assert.equal(detail.content, content);
  assert.equal(detail.argumentHint, "[path]");
  await assert.rejects(
    service.expand({ target: projectTarget, id: bundled.id, arguments: "x" }),
    code("prompt-disabled"),
  );
  await assert.rejects(
    service.remove({ target: projectTarget, id: bundled.id, version: detail.version }),
    code("prompt-read-only"),
  );
  await assert.rejects(
    service.save({
      target: projectTarget,
      id: bundled.id,
      version: detail.version,
      name: "review",
      content: "Changed",
    }),
    code("prompt-read-only"),
  );
  await service.setEnabled({ target: projectTarget, id: bundled.id, enabled: true });
  assert.equal(
    (await service.list({ target: projectTarget })).prompts.find((item) => item.id === bundled.id)
      ?.enabled,
    true,
  );
  assert.equal(
    (await service.expand({ target: projectTarget, id: bundled.id, arguments: '"some file"' }))
      .content,
    "Review some file and tests. some file",
  );
  const copy = await service.save({
    target: projectTarget,
    name: "review-copy",
    content: detail.content,
  });
  assert.equal(copy.editable, true);
  assert.equal(await readFile(path.join(pkg, "prompts", "review.md"), "utf8"), content);
  await assert.rejects(
    service.describe({ target: user, id: bundled.id }),
    code("prompt-not-found"),
  );
});

test("prompt CRUD validates versions, names, trust and busy sessions before writing", async (t) => {
  const context = await setup(t);
  const { service, project } = context;
  const created = await service.save({
    target: projectTarget,
    name: "review",
    content: "Review $ARGUMENTS",
  });
  assert.equal(created.enabled, true);
  assert.equal(created.editable, true);
  assert.equal(context.reloads(), 1);
  await assert.rejects(
    service.save({ target: projectTarget, name: "../escape", content: "bad" }),
    code("prompt-invalid-content"),
  );
  await assert.rejects(
    service.save({ target: projectTarget, name: "review", content: "duplicate" }),
    code("prompt-name-exists"),
  );
  await assert.rejects(
    service.save({
      target: projectTarget,
      name: "invalid",
      content: "---\ndescription: []\n---\nHello",
    }),
    code("prompt-invalid-content"),
  );
  await assert.rejects(
    service.save({ target: projectTarget, name: "large", content: "x".repeat(256 * 1024 + 1) }),
    code("prompt-invalid-content"),
  );
  context.busy(true);
  await assert.rejects(
    service.setEnabled({ target: projectTarget, id: created.id, enabled: false }),
    code("session-busy"),
  );
  context.busy(false);
  await service.setEnabled({ target: projectTarget, id: created.id, enabled: false });
  assert.equal((await service.list({ target: projectTarget })).prompts[0].enabled, false);
  await writeFile(created.filePath, "Changed externally");
  await assert.rejects(
    service.save({
      target: projectTarget,
      id: created.id,
      version: created.version,
      name: created.name,
      content: "Lost update",
    }),
    code("prompt-conflict"),
  );
  await assert.rejects(
    service.remove({ target: projectTarget, id: created.id, version: created.version }),
    code("prompt-conflict"),
  );
  const current = await service.describe({ target: projectTarget, id: created.id });
  const updated = await service.save({
    target: projectTarget,
    id: current.id,
    version: current.version,
    name: current.name,
    content: "Saved",
  });
  assert.equal(updated.content, "Saved");
  assert.notEqual(updated.version, current.version);
  context.trust(false);
  await assert.rejects(
    service.save({ target: projectTarget, name: "untrusted", content: "bad" }),
    code("project-untrusted"),
  );
  context.trust(true);
  await service.remove({ target: projectTarget, id: updated.id, version: updated.version });
  assert.deepEqual((await service.list({ target: projectTarget })).prompts, []);
  await assert.rejects(readFile(path.join(project, ".pi", "prompts", "review.md")));
});

test("prompt management never follows a symlink outside the authorized resource root", async (t) => {
  const { service, root, project } = await setup(t);
  const outside = path.join(root, "outside.md");
  await writeFile(outside, "Private outside content");
  await symlink(outside, path.join(project, ".pi", "prompts", "escape.md"));
  assert.deepEqual((await service.list({ target: projectTarget })).prompts, []);
  await rm(path.join(project, ".pi", "prompts"), { recursive: true });
  await symlink(root, path.join(project, ".pi", "prompts"));
  await assert.rejects(
    service.save({ target: projectTarget, name: "escape", content: "bad" }),
    code("prompt-read-only"),
  );
  assert.equal(await readFile(outside, "utf8"), "Private outside content");
});
