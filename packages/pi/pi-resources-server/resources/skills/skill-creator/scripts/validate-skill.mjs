import { readFile, stat } from "node:fs/promises";
import path from "node:path";

try {
  if (process.argv.length !== 3)
    throw new Error("Usage: node validate-skill.mjs <skill-directory>");
  const { piCodingAgentModule } = JSON.parse(
    await readFile(new URL("../runtime.json", import.meta.url), "utf8"),
  );
  const { loadSkillsFromDir, parseFrontmatter } = await import(piCodingAgentModule);
  const directory = path.resolve(process.argv[2]);
  if (!(await stat(path.join(directory, "SKILL.md"))).isFile()) {
    throw new Error("SKILL.md must be a regular file.");
  }
  const { frontmatter, body } = parseFrontmatter(
    await readFile(path.join(directory, "SKILL.md"), "utf8"),
  );
  if (typeof frontmatter.name !== "string" || !frontmatter.name.trim()) {
    throw new Error("Frontmatter must include a name.");
  }
  if (!body.trim()) throw new Error("SKILL.md must include instructions.");
  const { skills, diagnostics } = loadSkillsFromDir({ dir: directory, source: "validation" });
  if (diagnostics.length) throw new Error(diagnostics.map(({ message }) => message).join("\n"));
  if (skills.length !== 1) throw new Error("Expected one discoverable skill.");
  if (skills[0].name !== path.basename(directory)) {
    throw new Error("The skill name must match its directory name.");
  }
  console.log(`Valid skill: ${skills[0].name}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
