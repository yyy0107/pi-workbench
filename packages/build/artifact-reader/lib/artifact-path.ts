import path from "node:path";

export function canonicalRequestedPath(requestedPath: string, label: string): string {
  if (
    typeof requestedPath !== "string" ||
    !path.isAbsolute(requestedPath) ||
    path.normalize(requestedPath) !== requestedPath ||
    path.resolve(requestedPath) !== requestedPath
  ) {
    throw new Error(`${label} must be an absolute canonical path without aliases.`);
  }
  return requestedPath;
}
