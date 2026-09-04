import type { WorkbenchProjectTrust } from "@workbench/host-contracts/runtime-capabilities";

type DescribedWorkspaceTrust = Pick<WorkbenchProjectTrust, "path" | "trusted">;

/**
 * Returns the canonical path that still needs explicit confirmation. Only an
 * affirmative trust decision may cross the workspace creation boundary.
 */
export async function admitTrustedWorkspace(
  trust: DescribedWorkspaceTrust,
  admit: (path: string) => void | Promise<void>,
): Promise<string | undefined> {
  if (trust.trusted !== true) return trust.path;
  await admit(trust.path);
  return undefined;
}
