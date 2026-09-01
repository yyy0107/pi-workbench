import path from "node:path";

export function extensionDisplayName(extensionPath: string): string {
  const inline = /^<inline:(.+)>$/u.exec(extensionPath)?.[1];
  if (inline) return inline;
  const fileName = path.basename(extensionPath);
  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return stem === "index" ? path.basename(path.dirname(extensionPath)) : stem;
}
