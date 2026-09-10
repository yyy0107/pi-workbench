import path from "node:path";

import {
  getAgentDir,
  loadSkillsFromDir,
  SettingsManager,
  type LoadSkillsResult,
} from "@earendil-works/pi-coding-agent";
import { skillMatchesEnablePattern } from "./skill-enablement";

export function withWorkbenchBuiltinSkills(
  base: LoadSkillsResult,
  agentDir = getAgentDir(),
  patterns = SettingsManager.create(agentDir, agentDir, {
    projectTrusted: false,
  }).getGlobalSettings().skills ?? [],
  includeDisabled = false,
): LoadSkillsResult {
  const builtins = loadSkillsFromDir({
    dir: path.join(agentDir, "skills", ".builtin"),
    source: "builtin",
  });
  return {
    skills: [
      ...base.skills,
      ...builtins.skills
        .filter((skill) => !base.skills.some((existing) => existing.name === skill.name))
        .filter(
          (skill) => includeDisabled || builtinSkillEnabled(skill.filePath, agentDir, patterns),
        )
        .map((skill) => ({
          ...skill,
          sourceInfo: { ...skill.sourceInfo, scope: "user" as const, baseDir: agentDir },
        })),
    ],
    diagnostics: [...base.diagnostics, ...builtins.diagnostics],
  };
}

/** Hidden bundled skills use the exact +/- paths written by the resource toggle. */
export function builtinSkillEnabled(
  filePath: string,
  agentDir: string,
  patterns: readonly string[],
) {
  return (
    skillMatchesEnablePattern(filePath, agentDir, patterns) &&
    !patterns.some(
      (pattern) =>
        pattern.startsWith("-") &&
        [filePath, path.dirname(filePath)].includes(path.resolve(agentDir, pattern.slice(1))),
    )
  );
}
