import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { PiWorkspaceSummary } from "@workbench/agent-runtime-pi-protocol/messages";
import { PiServerError } from "../core/errors";
import {
  NativeWorkspacePickerUnavailableError,
  pickNativeWorkspaceDirectory,
} from "../host/native-workspace-picker";

let nativeWorkspacePickerOpen = false;

function normalizeWorkspacePath(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return path.resolve(homedir(), cwd.slice(2));
  return path.resolve(cwd);
}

function canonicalWorkspacePath(cwd: string): string {
  const resolved = normalizeWorkspacePath(cwd);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function workspaceFromCwd(cwd: string): PiWorkspaceSummary {
  const canonicalCwd = canonicalWorkspacePath(cwd);
  return {
    id: createHash("sha256").update(canonicalCwd).digest("base64url").slice(0, 20),
    name: path.basename(canonicalCwd) || canonicalCwd,
    cwd: canonicalCwd,
  };
}

export function validateWorkspace(cwd: string): PiWorkspaceSummary {
  const candidate = cwd.trim();
  if (!candidate) throw new PiServerError("pi_workspace_path_required", 400);
  const normalized = normalizeWorkspacePath(candidate);

  try {
    if (!statSync(normalized).isDirectory()) {
      throw new PiServerError("pi_workspace_not_directory", 400);
    }
  } catch (error) {
    if (error instanceof PiServerError) throw error;
    throw new PiServerError("pi_workspace_not_found", 400);
  }

  return workspaceFromCwd(normalized);
}

export async function pickWorkspaceDirectory(
  signal: AbortSignal = new AbortController().signal,
): Promise<PiWorkspaceSummary | undefined> {
  if (nativeWorkspacePickerOpen) {
    throw new PiServerError("pi_workspace_picker_busy", 409);
  }

  nativeWorkspacePickerOpen = true;
  try {
    try {
      const cwd = await pickNativeWorkspaceDirectory(signal);
      return cwd ? validateWorkspace(cwd) : undefined;
    } catch (error) {
      if (error instanceof NativeWorkspacePickerUnavailableError) {
        throw new PiServerError("pi_workspace_picker_unavailable", 501);
      }
      throw error;
    }
  } finally {
    nativeWorkspacePickerOpen = false;
  }
}
