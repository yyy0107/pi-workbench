import path from "node:path";

export const STANDALONE_WEB_RELATIVE_APP_DIRECTORY = "apps/web";

export interface ResolveWebRootOptions {
  readonly configuredRoot?: string;
  readonly workingDirectory?: string;
}

/** Resolves the one explicit Next project root for source and staged supervisor launches. */
export function resolveWebRoot({
  configuredRoot = process.env.WORKBENCH_WEB_ROOT,
  workingDirectory = process.cwd(),
}: ResolveWebRootOptions = {}): string {
  const selectedRoot = configuredRoot?.trim();
  return path.resolve(workingDirectory, selectedRoot || ".");
}
