import { readFileSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export const LEGACY_WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE =
  "workbench-message-termination.ts";

export type LegacyWorkbenchMessageTerminationMigrationStatus = "absent" | "removed" | "preserved";

export interface LegacyWorkbenchMessageTerminationMigrationResult {
  path: string;
  status: LegacyWorkbenchMessageTerminationMigrationStatus;
}

export function legacyWorkbenchMessageTerminationExtensionSource(): string {
  return readFileSync(
    new URL("./legacy-message-termination-extension.user.js", import.meta.url),
    "utf8",
  );
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/** Removes only the byte-identical extension previously installed by Workbench. */
export async function migrateLegacyWorkbenchMessageTerminationExtension(
  agentDir?: string,
): Promise<LegacyWorkbenchMessageTerminationMigrationResult> {
  const resolvedAgentDir =
    agentDir ?? (await import("@earendil-works/pi-coding-agent")).getAgentDir();
  const extensionPath = join(
    resolvedAgentDir,
    "extensions",
    LEGACY_WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE,
  );

  let existing: string;
  try {
    existing = await readFile(extensionPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { path: extensionPath, status: "absent" };
    throw error;
  }

  if (existing !== legacyWorkbenchMessageTerminationExtensionSource()) {
    return { path: extensionPath, status: "preserved" };
  }

  try {
    await unlink(extensionPath);
    return { path: extensionPath, status: "removed" };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { path: extensionPath, status: "absent" };
    throw error;
  }
}
