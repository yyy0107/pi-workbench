import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { readPackageResourceDetails } from "../../src/packages/package-resource-details";

test("resolves package directories into named resources, includes disabled prompts, and never executes extensions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-package-resources-"));
  try {
    const root = join(directory, "workflow");
    await mkdir(join(root, "skills", "review"), { recursive: true });
    await mkdir(join(root, "prompts"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "workflow",
        pi: { skills: ["./skills"], prompts: ["./prompts"], extensions: ["./index.ts"] },
      }),
    );
    await writeFile(
      join(root, "skills", "review", "SKILL.md"),
      "---\nname: review-code\ndescription: Review code for regressions\n---\n# Review\n",
    );
    await writeFile(
      join(root, "prompts", "plan.md"),
      "---\ndescription: Plan the implementation\n---\nPlan $ARGUMENTS",
    );
    await writeFile(join(root, "index.ts"), "throw new Error('Must never execute package code');");
    const settingsManager = SettingsManager.inMemory({
      packages: [{ source: root, prompts: ["!prompts/plan.md"] }],
    });
    const manager = new DefaultPackageManager({
      cwd: directory,
      agentDir: join(directory, "agent"),
      settingsManager,
    });
    const paths = await manager.resolve(async () => {
      throw new Error("Must never install a package");
    });
    const resources = await readPackageResourceDetails(
      paths,
      root,
      root,
      "user",
      [],
      settingsManager,
    );
    assert.deepEqual(resources, [
      {
        type: "skill",
        name: "review-code",
        description: "Review code for regressions",
        enabled: false,
      },
      { type: "prompt", name: "plan", description: "Plan the implementation", enabled: false },
      { type: "extension", name: "workflow", enabled: true },
    ]);
    await writeFile(
      join(directory, "outside.md"),
      "---\ndescription: Private file outside this package\n---",
    );
    await symlink(join(directory, "outside.md"), join(root, "prompts", "outside.md"));
    const linkedPaths = await manager.resolve(async () => "skip");
    const safe = await readPackageResourceDetails(
      linkedPaths,
      root,
      root,
      "user",
      [],
      settingsManager,
    );
    assert.equal(
      safe.some((item) => item.description?.includes("Private file")),
      false,
    );
    assert.deepEqual(
      await readPackageResourceDetails(paths, root, root, "project", [], settingsManager),
      [],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
