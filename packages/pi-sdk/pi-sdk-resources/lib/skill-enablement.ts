import { homedir } from "node:os";
import path from "node:path";

import type {
  PathMetadata,
  ResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export function requireSkillOptIn(loader: ResourceLoader, settings: SettingsManager): void {
  // Pi attaches authoritative package/scope metadata after skillsOverride runs.
  const getSkills = loader.getSkills.bind(loader);
  loader.getSkills = () => {
    const result = getSkills();
    return {
      ...result,
      skills: result.skills.filter((skill) =>
        skillExplicitlyEnabled(skill.filePath, skill.sourceInfo, settings),
      ),
    };
  };
}

/** Pi still owns exclusions and discovery; Workbench additionally requires an explicit opt-in. */
export function skillExplicitlyEnabled(
  filePath: string,
  metadata: PathMetadata,
  settingsManager: SettingsManager,
): boolean {
  const settings =
    metadata.scope === "project"
      ? settingsManager.getProjectSettings()
      : settingsManager.getGlobalSettings();
  const entry = settings.packages?.find(
    (entry) => (typeof entry === "string" ? entry : entry.source) === metadata.source,
  );
  const patterns =
    metadata.origin === "package"
      ? typeof entry === "object"
        ? entry.skills
        : undefined
      : settings.skills;
  return skillMatchesEnablePattern(filePath, metadata.baseDir ?? path.dirname(filePath), patterns);
}

export function skillMatchesEnablePattern(
  filePath: string,
  baseDir: string,
  patterns: readonly string[] = [],
): boolean {
  return patterns.some((pattern) => {
    if (pattern.startsWith("-") || pattern.startsWith("!")) return false;
    const exact = pattern.startsWith("+");
    const target = (exact ? pattern.slice(1) : pattern).replace(/^~(?=\/|$)/u, homedir());
    const absolute = path.resolve(baseDir, target);
    return [filePath, path.dirname(filePath)].some((candidate) =>
      exact
        ? candidate === absolute
        : candidate === absolute ||
          candidate.startsWith(`${absolute}${path.sep}`) ||
          [candidate, path.relative(baseDir, candidate), path.basename(candidate)].some((value) =>
            path.matchesGlob(value, target),
          ),
    );
  });
}
