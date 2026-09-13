import path from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

const RETIRED_WORKBENCH_BROWSER_PACKAGE_SOURCE = "packages/.builtin/browser";

function isRetiredWorkbenchBrowserPackage(source: string): boolean {
  return (
    source.replaceAll("\\", "/").replace(/^\.\//u, "") === RETIRED_WORKBENCH_BROWSER_PACKAGE_SOURCE
  );
}

function isRetiredBrowserResourcePath(
  entry: string,
  agentDir: string,
  kind: "extensions" | "skills",
): boolean {
  const relative = entry.replace(/^[!+-]/u, "").replaceAll("\\", "/");
  const resolved = path.resolve(agentDir, relative);
  const root = path.join(agentDir, kind, ".builtin", "browser");
  if (resolved === root) return true;
  return resolved === path.join(root, kind === "extensions" ? "index.ts" : "SKILL.md");
}

/** Remove the retired product Browser package and its earlier standalone resource filters. */
export async function removeRetiredWorkbenchBrowserPackage(agentDir: string): Promise<void> {
  const settings = SettingsManager.create(agentDir, agentDir, { projectTrusted: false });
  const loadFailure = settings.drainErrors()[0];
  if (loadFailure) throw loadFailure.error;
  const global = settings.getGlobalSettings();
  const packages = global.packages ?? [];
  const nextPackages = packages.filter(
    (entry) => !isRetiredWorkbenchBrowserPackage(typeof entry === "string" ? entry : entry.source),
  );
  const extensions = global.extensions ?? [];
  const nextExtensions = extensions.filter(
    (entry) => !isRetiredBrowserResourcePath(entry, agentDir, "extensions"),
  );
  const skills = global.skills ?? [];
  const nextSkills = skills.filter(
    (entry) => !isRetiredBrowserResourcePath(entry, agentDir, "skills"),
  );
  if (nextPackages.length !== packages.length) settings.setPackages(nextPackages);
  if (nextExtensions.length !== extensions.length) settings.setExtensionPaths(nextExtensions);
  if (nextSkills.length !== skills.length) settings.setSkillPaths(nextSkills);
  await settings.flush();
  const writeFailure = settings.drainErrors()[0];
  if (writeFailure) throw writeFailure.error;
}
