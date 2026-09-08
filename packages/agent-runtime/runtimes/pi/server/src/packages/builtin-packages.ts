import path from "node:path";

import { SettingsManager, type PackageSource } from "@earendil-works/pi-coding-agent";

import { withResourceEnabled } from "../resources/resource-mutations";

export const WORKBENCH_BROWSER_PACKAGE_SOURCE = "./packages/.builtin/browser";

export function isWorkbenchBuiltinPackage(source: string, scope = "user"): boolean {
  return (
    scope === "user" &&
    source.replaceAll("\\", "/").replace(/^\.\//u, "") === "packages/.builtin/browser"
  );
}

/** Register only after the application has deployed the package manifest and its resources. */
export async function registerWorkbenchBuiltinPackages(agentDir: string): Promise<void> {
  const settings = SettingsManager.create(agentDir, agentDir, { projectTrusted: false });
  const loadFailure = settings.drainErrors()[0];
  if (loadFailure) throw loadFailure.error;
  const global = settings.getGlobalSettings();
  const packages = global.packages ?? [];
  const index = packages.findIndex((entry) =>
    isWorkbenchBuiltinPackage(typeof entry === "string" ? entry : entry.source),
  );
  let browser: PackageSource = packages[index] ?? WORKBENCH_BROWSER_PACKAGE_SOURCE;
  const previousSkillRoot = path.join(agentDir, "skills", ".builtin", "browser");
  const previousSkillPatterns = (global.skills ?? []).filter(
    (pattern) =>
      /^[+-]/u.test(pattern) &&
      [previousSkillRoot, path.join(previousSkillRoot, "SKILL.md")].includes(
        path.resolve(agentDir, pattern.slice(1).replaceAll("\\", "/")),
      ),
  );
  // A package filter already saved by the user takes precedence over the retired skill switch.
  if (
    previousSkillPatterns.length > 0 &&
    (typeof browser === "string" || browser.skills === undefined)
  ) {
    browser = {
      ...(typeof browser === "string" ? { source: browser } : browser),
      skills: withResourceEnabled(
        [],
        "skills/browser/SKILL.md",
        !previousSkillPatterns.some((pattern) => pattern.startsWith("-")),
      ),
    };
  }
  if (index < 0) settings.setPackages([...packages, browser]);
  else if (browser !== packages[index]) {
    packages[index] = browser;
    settings.setPackages(packages);
  }
  if (previousSkillPatterns.length > 0)
    settings.setSkillPaths(
      (global.skills ?? []).filter((pattern) => !previousSkillPatterns.includes(pattern)),
    );
  await settings.flush();
  const writeFailure = settings.drainErrors()[0];
  if (writeFailure) throw writeFailure.error;
}
