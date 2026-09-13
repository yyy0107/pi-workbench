import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import type { PiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import type { PiPackageUpdatePayload } from "@workbench/agent-runtime-pi-protocol/rpc";

export type PackageUpdateFeedback =
  | { status: "idle" | "updating" | "updated" }
  | { status: "failed"; errorCode?: string };

export async function updatePackageWithFeedback(
  client: Pick<PiResourceClient, "updatePackage">,
  payload: PiPackageUpdatePayload,
  report: (feedback: PackageUpdateFeedback) => void,
): Promise<boolean> {
  report({ status: "updating" });
  try {
    await client.updatePackage(payload);
    report({ status: "updated" });
    return true;
  } catch (error) {
    report({
      status: "failed",
      ...(error instanceof PiApiError ? { errorCode: error.code } : {}),
    });
    return false;
  }
}

export function packageUpdateErrorMessageKey(code?: string) {
  switch (code) {
    case "project-untrusted":
      return "extensions.toolbox.packages.updateProjectUntrusted";
    case "workspace-not-found":
      return "extensions.toolbox.packages.updateWorkspaceMissing";
    case "package-not-installed":
      return "extensions.toolbox.packages.updateAlreadyMissing";
    case "session-not-found":
      return "extensions.toolbox.packages.updateSessionMissing";
    case "session-busy":
      return "extensions.toolbox.packages.mutationSessionBusy";
    default:
      return "extensions.toolbox.packages.updateFailed";
  }
}
