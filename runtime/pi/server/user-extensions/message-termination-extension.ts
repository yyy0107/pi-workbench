import { readFileSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export const WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE = "workbench-message-termination.ts";
export const WORKBENCH_MESSAGE_TERMINATION_EXTENSION_MARKER =
  "// @pi-workbench-managed-extension workbench.message-termination v1";

export type WorkbenchUserExtensionInstallStatus =
  | "installed"
  | "present"
  | "managed-version-mismatch"
  | "conflict";

export interface WorkbenchUserExtensionInstallResult {
  path: string;
  status: WorkbenchUserExtensionInstallStatus;
}

export function workbenchMessageTerminationExtensionSource(): string {
  return readFileSync(new URL("./message-termination-extension.user.js", import.meta.url), "utf8");
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export async function ensureWorkbenchMessageTerminationExtension(
  agentDir?: string,
): Promise<WorkbenchUserExtensionInstallResult> {
  const resolvedAgentDir =
    agentDir ?? (await import("@earendil-works/pi-coding-agent")).getAgentDir();
  const extensionDirectory = join(resolvedAgentDir, "extensions");
  const extensionPath = join(extensionDirectory, WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE);
  const source = workbenchMessageTerminationExtensionSource();

  try {
    const existing = await readFile(extensionPath, "utf8");
    if (existing === source) return { path: extensionPath, status: "present" };
    return {
      path: extensionPath,
      status: existing.startsWith(WORKBENCH_MESSAGE_TERMINATION_EXTENSION_MARKER)
        ? "managed-version-mismatch"
        : "conflict",
    };
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }

  await mkdir(extensionDirectory, { recursive: true });
  let handle: FileHandle | undefined;
  try {
    handle = await open(extensionPath, "wx", 0o644);
    await handle.writeFile(source, "utf8");
    return { path: extensionPath, status: "installed" };
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      const existing = await readFile(extensionPath, "utf8");
      if (existing === source) return { path: extensionPath, status: "present" };
      return {
        path: extensionPath,
        status: existing.startsWith(WORKBENCH_MESSAGE_TERMINATION_EXTENSION_MARKER)
          ? "managed-version-mismatch"
          : "conflict",
      };
    }
    if (handle) {
      await handle.close().catch(() => undefined);
      handle = undefined;
      await unlink(extensionPath).catch(() => undefined);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}
