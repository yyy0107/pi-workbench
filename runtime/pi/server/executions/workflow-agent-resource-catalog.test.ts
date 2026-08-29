import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PiWorkflowAgentResourceCatalog } from "./workflow-agent-resource-catalog";

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  const directory = path.join(root, "skills", name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
}

test("lists effective user and trusted Agent-local Pi resources without executing extensions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-agent-catalog-"));
  const agentDir = path.join(root, "agent");
  const workspacePath = path.join(root, "workflow-agent");
  try {
    await writeSkill(agentDir, "user-review", "Review changes from the user scope.");
    await writeSkill(path.join(workspacePath, ".pi"), "project-release", "Prepare a release.");
    await mkdir(path.join(agentDir, "extensions"), { recursive: true });
    await mkdir(path.join(workspacePath, ".pi", "extensions"), { recursive: true });
    await writeFile(
      path.join(agentDir, "extensions", "user-tools.ts"),
      'throw new Error("catalog listing must not execute extension code");\n',
    );
    await writeFile(
      path.join(workspacePath, ".pi", "extensions", "project-tools.ts"),
      'throw new Error("catalog listing must not execute extension code");\n',
    );

    const trustedCatalog = new PiWorkflowAgentResourceCatalog({
      agentDir,
      isWorkspaceTrusted: () => true,
    });
    const trusted = await trustedCatalog.read({
      workflowId: "workflow-1",
      agentId: "agent-1",
      workspacePath,
    });

    assert.equal(trusted.catalogAvailable, true);
    assert.equal(trusted.projectResourcesTrusted, true);
    assert.ok(trusted.skills.some(({ name }) => name === "user-review"));
    assert.ok(trusted.skills.some(({ name }) => name === "project-release"));
    assert.ok(trusted.extensions.some(({ name }) => name === "user-tools"));
    assert.ok(trusted.extensions.some(({ name }) => name === "project-tools"));

    const untrustedCatalog = new PiWorkflowAgentResourceCatalog({
      agentDir,
      isWorkspaceTrusted: () => false,
    });
    const untrusted = await untrustedCatalog.read({
      workflowId: "workflow-1",
      agentId: "agent-1",
      workspacePath,
    });

    assert.equal(untrusted.projectResourcesTrusted, false);
    assert.ok(untrusted.skills.some(({ name }) => name === "user-review"));
    assert.ok(!untrusted.skills.some(({ name }) => name === "project-release"));
    assert.ok(untrusted.extensions.some(({ name }) => name === "user-tools"));
    assert.ok(!untrusted.extensions.some(({ name }) => name === "project-tools"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
