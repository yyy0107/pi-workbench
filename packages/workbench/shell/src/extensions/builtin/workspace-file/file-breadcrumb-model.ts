export interface FileBreadcrumbSegment {
  label: string;
  path: string;
  kind: "directory" | "file";
  current: boolean;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function workspacePath(rootPath: string, parts: readonly string[]): string {
  if (!parts.length) return rootPath;
  const separator = rootPath.includes("\\") && !rootPath.includes("/") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${parts.join(separator)}`;
}

export function fileBreadcrumbSegments(
  rootPath: string | undefined,
  relativePath: string | undefined,
  absolutePath: string | undefined,
): readonly FileBreadcrumbSegment[] {
  if (!absolutePath) {
    return rootPath
      ? [{ label: fileName(rootPath), path: rootPath, kind: "directory", current: true }]
      : [{ label: "/", path: "/", kind: "directory", current: true }];
  }

  const relativeParts = relativePath?.split(/[\\/]/).filter(Boolean) ?? [];
  if (rootPath && relativeParts.length) {
    return [
      { label: fileName(rootPath), path: rootPath, kind: "directory", current: false },
      ...relativeParts.map((label, index) => ({
        label,
        path: workspacePath(rootPath, relativeParts.slice(0, index + 1)),
        kind: index === relativeParts.length - 1 ? ("file" as const) : ("directory" as const),
        current: index === relativeParts.length - 1,
      })),
    ];
  }

  if (rootPath) {
    const targetName = fileName(absolutePath);
    const rootName = fileName(rootPath);
    return targetName === rootName
      ? [{ label: rootName, path: rootPath, kind: "file", current: true }]
      : [
          { label: rootName, path: rootPath, kind: "directory", current: false },
          { label: targetName, path: absolutePath, kind: "file", current: true },
        ];
  }

  const normalized = absolutePath.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const rooted = normalized.startsWith("/");
  return parts.map((label, index) => ({
    label,
    path: `${rooted ? "/" : ""}${parts.slice(0, index + 1).join("/")}`,
    kind: index === parts.length - 1 ? ("file" as const) : ("directory" as const),
    current: index === parts.length - 1,
  }));
}

export function fileBreadcrumbTreeRootPath(
  segments: readonly FileBreadcrumbSegment[],
  index: number,
): string | undefined {
  const segment = segments[index];
  if (!segment) return undefined;
  if (segment.kind === "directory") return segment.path;
  return segments[index - 1]?.path ?? segment.path;
}
