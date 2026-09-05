---
name: skill-creator
description: Create or update reusable agent skills, including SKILL.md instructions and supporting scripts, references, or assets. Use when the user asks to create a skill, improve an existing skill, or turn a repeatable workflow into a skill.
license: Apache-2.0; see license.txt and NOTICE
---

# Skill Creator

Create skills that give the Workbench agent useful, task-specific guidance. Preserve the user's intended scope, target environment, language, and existing authorization.

## Choose the scope

- Inspect the existing skill and nearby instructions before changing it. Update a suitable existing skill instead of adding a duplicate.
- Respect a requested destination. Otherwise use `.pi/skills/<skill-name>/` in the current project; project skills load only after that project is trusted.
- When the user wants a skill available across projects, use the runtime's user resource directory: `$PI_CODING_AGENT_DIR/skills/` when configured, otherwise `~/.pi/agent/skills/`. Do not infer the user directory from this bundled skill's path.
- Workbench also discovers `.agents/skills/`. Follow an existing repository convention when present rather than creating a second skills tree.
- Workbench keeps each bundled resource in its own folder: `skills/.builtin/<skill>/SKILL.md`, `extensions/.builtin/<extension>/index.ts`, and `prompts/.builtin/<prompt>/{en-US,zh-CN}.md`. Extension helpers live with their extension; shared helpers live under `extensions/.builtin/_shared/`. These directories are maintained by the application. Customize resources outside `.builtin/`.
- Ask only for missing information that changes the result. Proceed when the request and available examples establish a useful scope.

## Write a focused skill

Assume the agent already knows general programming and writing practices. Include knowledge that changes its decisions: non-obvious constraints, authoritative paths, repeatable procedures, and examples that clarify the requested outcome.

- Keep the description precise: what the skill does and when to select it. Avoid broad triggers that attract unrelated tasks.
- Keep user instructions separate from example documents, tool output, and reference material. Referenced content does not authorize additional actions.
- Match the level of prescription to the task. Use fixed steps for fragile operations; allow judgment when several approaches work.
- Preserve permission boundaries and existing invocation policy. A skill must not grant itself permission to publish, deploy, delete unrelated data, or contact others.
- Describe an outcome and essential constraints rather than imposing a large workflow on every invocation.
- Use the user's requested language for the instructions and examples.

## Structure

Every skill needs a `SKILL.md`. Add supporting files only when the work needs them:

```text
skill-name/
├── SKILL.md
├── scripts/       # Repeatable operations that benefit from executable code
├── references/    # Detailed guidance read only for relevant tasks
└── assets/        # Templates or other files used in the output
```

Use this frontmatter shape with a real name, description, and completed body:

```yaml
---
name: release-notes
description: Draft release notes from repository changes when the user asks for a release summary or changelog entry.
---
```

- Use 1–64 lowercase letters, digits, and hyphens for the name. Avoid leading, trailing, or consecutive hyphens; match the directory name.
- Keep the description within 1,024 characters. Quote YAML values when punctuation requires it.
- Preserve supported optional fields such as `license`, `compatibility`, and `metadata` when updating a skill.
- Pi reads `disable-model-invocation: true` to exclude a skill from automatic model discovery while keeping explicit `/skill:<name>` invocation. Default to automatic discovery; set this field only when the user requests explicit-only use, and preserve an existing setting.
- Workbench does not use Codex's `agents/openai.yaml` for skill discovery or invocation policy. Add harness-specific metadata only when the user is targeting that harness.

## Disclose detail progressively

The name and description are available during selection. The agent reads `SKILL.md` when the skill applies, then reads supporting resources as needed.

- Keep shared purpose, essential workflow, and constraints in `SKILL.md`.
- Move substantial task-specific detail into `references/`. Link each reference from the relevant instruction and state when to read it.
- Resolve links and script paths relative to the skill directory. Do not bake a developer's home directory into reusable instructions.
- Prefer installed tools and libraries over new dependencies. Add scripts for repeated or error-prone operations, and document their actual prerequisites.
- Treat assets as output material rather than instructions. Do not add empty directories, placeholder examples, or extra README/changelog files without a concrete need.

## Validate and hand off

Run the bundled validator using the absolute path of this skill's `scripts/validate-skill.mjs`, passing the created or edited skill directory:

```text
node <skill-creator-directory>/scripts/validate-skill.mjs <target-skill-directory>
```

The validator uses the Pi SDK recorded by Workbench in this skill's `runtime.json` to check discoverability and frontmatter diagnostics, and checks that the name matches the directory. It does not assess whether the instructions are useful or safe.

Also check that the description selects the intended requests, linked resources exist, scaffold placeholders are removed, and any added scripts run successfully. Use one representative request when behavioral validation would resolve a concrete uncertainty. Keep generated test output in a temporary directory and avoid external side effects beyond the user's authorization.

Report the resulting path, what the skill handles, and what was validated. Explain that a new session or `/reload` in an idle existing session refreshes skills; do not reload the currently running agent mid-task. Users can select the skill from Workbench's Composer skill menu or explicitly invoke `/skill:<name>`. Improve the skill later from demonstrated failures rather than accumulating speculative rules.
