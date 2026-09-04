import path from "node:path";

import type { PackageSource } from "@earendil-works/pi-coding-agent";

function patternTarget(pattern: string): string {
  return /^[!+-]/.test(pattern) ? pattern.slice(1) : pattern;
}

export function withResourceEnabled(
  current: readonly string[],
  resourcePath: string,
  enabled: boolean,
): string[] {
  return [
    ...current.filter((pattern) => patternTarget(pattern) !== resourcePath),
    `${enabled ? "+" : "-"}${resourcePath}`,
  ];
}

export function clonePackageSource(source: PackageSource): PackageSource {
  if (typeof source === "string") return source;
  return {
    ...source,
    ...(source.extensions ? { extensions: [...source.extensions] } : {}),
    ...(source.skills ? { skills: [...source.skills] } : {}),
    ...(source.prompts ? { prompts: [...source.prompts] } : {}),
    ...(source.themes ? { themes: [...source.themes] } : {}),
  };
}

export function pathWithin(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}
