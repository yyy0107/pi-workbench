import type { WorkbenchProjectTrust } from "@workbench/host-contracts/runtime-capabilities";

type DescribedWorkspaceTrust = Pick<WorkbenchProjectTrust, "path" | "promptRequired">;

/**
 * Returns the canonical path when the runtime needs a trust decision.
 * Untrusted projects can open with their project resources disabled by the runtime.
 */
export async function admitWorkspace(
  trust: DescribedWorkspaceTrust,
  admit: (path: string) => void | Promise<void>,
): Promise<string | undefined> {
  if (trust.promptRequired) return trust.path;
  await admit(trust.path);
  return undefined;
}
