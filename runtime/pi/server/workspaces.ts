import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { PiWorkspaceSummary, PiWorkspaceDirectoryEntry } from "../contracts";
import { PiServerError } from "./errors";

type NativePickerResult =
  | { status: "selected"; path: string }
  | { status: "cancelled" }
  | { status: "unavailable" };

interface NativePickerCommand {
  file: string;
  args: readonly string[];
  cancelExitCodes?: readonly number[];
}

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

function runNativePickerCommand(command: NativePickerCommand): Promise<NativePickerResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command.file,
      [...command.args],
      { encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: false },
      (error, stdout) => {
        if (error) {
          if (error.code === "ENOENT") {
            resolve({ status: "unavailable" });
            return;
          }
          if (typeof error.code === "number" && command.cancelExitCodes?.includes(error.code)) {
            resolve({ status: "cancelled" });
            return;
          }
          reject(error);
          return;
        }

        const selectedPath = stdout.trim();
        resolve(
          selectedPath ? { status: "selected", path: selectedPath } : { status: "cancelled" },
        );
      },
    );
  });
}

function nativePickerCommands(): readonly NativePickerCommand[] {
  if (process.platform === "darwin") {
    return [
      {
        file: "osascript",
        args: [
          "-e",
          "try",
          "-e",
          "POSIX path of (choose folder)",
          "-e",
          "on error number -128",
          "-e",
          'return ""',
          "-e",
          "end try",
        ],
      },
    ];
  }

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.ShowNewFolderButton = $true",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "  Write-Output $dialog.SelectedPath",
      "}",
    ].join("; ");
    return [
      {
        file: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      },
    ];
  }

  if (process.platform === "linux") {
    return [
      {
        file: "zenity",
        args: ["--file-selection", "--directory"],
        cancelExitCodes: [1],
      },
      {
        file: "kdialog",
        args: ["--getexistingdirectory", homedir()],
        cancelExitCodes: [1],
      },
      {
        file: "yad",
        args: ["--file-selection", "--directory"],
        cancelExitCodes: [1, 252],
      },
    ];
  }

  return [];
}

async function showNativeWorkspacePicker(): Promise<string | undefined> {
  for (const command of nativePickerCommands()) {
    const result = await runNativePickerCommand(command);
    if (result.status === "unavailable") continue;
    return result.status === "selected" ? result.path : undefined;
  }
  throw new PiServerError("pi_workspace_picker_unavailable", 501);
}

export async function pickWorkspaceDirectory(): Promise<PiWorkspaceSummary | undefined> {
  if (nativeWorkspacePickerOpen) {
    throw new PiServerError("pi_workspace_picker_busy", 409);
  }

  nativeWorkspacePickerOpen = true;
  try {
    const cwd = await showNativeWorkspacePicker();
    return cwd ? validateWorkspace(cwd) : undefined;
  } finally {
    nativeWorkspacePickerOpen = false;
  }
}

function shouldListWindowsDrives(requestedPath: string | undefined): boolean {
  return process.platform === "win32" && !requestedPath;
}

async function listWindowsDrives(): Promise<PiWorkspaceDirectoryEntry[]> {
  const candidates = await Promise.all(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(async (letter) => {
      const drive = `${letter}:\\`;
      try {
        return (await stat(drive)).isDirectory() ? { name: `${letter}:`, path: drive } : null;
      } catch {
        return null;
      }
    }),
  );
  return candidates.filter((entry): entry is PiWorkspaceDirectoryEntry => entry !== null);
}

async function listDirectories(cwd: string): Promise<PiWorkspaceDirectoryEntry[]> {
  const entries = await readdir(cwd, { withFileTypes: true });
  const directories = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(cwd, entry.name);
      if (entry.isDirectory()) return { name: entry.name, path: entryPath };
      if (!entry.isSymbolicLink()) return null;
      try {
        return (await stat(await realpath(entryPath))).isDirectory()
          ? { name: entry.name, path: entryPath }
          : null;
      } catch {
        return null;
      }
    }),
  );
  return directories
    .filter((entry): entry is PiWorkspaceDirectoryEntry => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function browseWorkspaceDirectories(requestedPath?: string): Promise<{
  path: string;
  parentPath: string | null;
  directories: PiWorkspaceDirectoryEntry[];
  drives?: PiWorkspaceDirectoryEntry[];
}> {
  if (shouldListWindowsDrives(requestedPath)) {
    return { path: "", parentPath: null, directories: [], drives: await listWindowsDrives() };
  }

  const candidate = requestedPath?.trim() || homedir();
  let cwd: string;
  try {
    cwd = await realpath(normalizeWorkspacePath(candidate));
  } catch {
    throw new PiServerError("pi_workspace_not_found", 404);
  }
  if (!(await stat(cwd)).isDirectory()) {
    throw new PiServerError("pi_workspace_not_directory", 400);
  }

  const parent = path.dirname(cwd);
  return {
    path: cwd,
    parentPath: parent === cwd ? null : parent,
    directories: await listDirectories(cwd),
  };
}
