import { execFile } from "node:child_process";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { homedir, release } from "node:os";
import path from "node:path";

import type {
  DirectoryEntry,
  HostDirectoryListing,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";
import {
  NativeWorkspacePickerUnavailableError,
  pickNativeWorkspaceDirectory,
  type NativeWorkspacePickerInternals,
} from "./native-workspace-picker";

export type {
  DirectoryEntry,
  HostDirectoryListing,
} from "@workbench/agent-runtime-pi-protocol/rpc";

export type HostDirectoryErrorCode =
  | "directory-unreadable"
  | "directory-exists"
  | "directory-create-failed"
  | "directory-picker-unavailable";

export type HostDirectoryErrorDetails = { path: string } | { capability: string };

export class HostDirectoryError extends RpcDomainError<
  HostDirectoryErrorCode,
  HostDirectoryErrorDetails
> {
  readonly code: HostDirectoryErrorCode;
  readonly details: HostDirectoryErrorDetails;

  constructor(
    code: HostDirectoryErrorCode,
    details: HostDirectoryErrorDetails,
    message: string = code,
  ) {
    super(message);
    this.name = "HostDirectoryError";
    this.code = code;
    this.details = details;
  }
}

export type HostPathRunner = (
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<void>;

export interface HostPathOpenInternals {
  platform?: NodeJS.Platform;
  run?: HostPathRunner;
  signal?: AbortSignal;
}

export interface HostPathCapabilityInternals {
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  osRelease?: string;
}

export interface CreateHostDirectoryInput {
  path: string;
  name: string;
}

const DIRECTORY_ENTRY_LIMIT = 500;
const DIRECTORY_PICKER_CAPABILITY = "directory-picker";

function normalizeHostPath(requestedPath: string): string {
  if (requestedPath === "~") return homedir();
  if (requestedPath.startsWith("~/") || requestedPath.startsWith("~\\")) {
    return path.resolve(homedir(), requestedPath.slice(2));
  }
  return path.resolve(requestedPath);
}

function pathDetails(requestedPath: string): { path: string } {
  return { path: normalizeHostPath(requestedPath) };
}

function directoryError(
  code: Extract<HostDirectoryErrorCode, `directory-${string}`>,
  targetPath: string,
  message: string,
): HostDirectoryError {
  return new HostDirectoryError(code, { path: targetPath }, message);
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

async function canonicalDirectoryPath(
  requestedPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const normalized = normalizeHostPath(requestedPath);
  let canonical: string;

  try {
    throwIfAborted(signal);
    canonical = await realpath(normalized);
    throwIfAborted(signal);
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error("The path is not a directory.");
    }
    throwIfAborted(signal);
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    throw directoryError(
      "directory-unreadable",
      normalized,
      `Unable to read directory: ${normalized}`,
    );
  }

  return canonical;
}

async function canonicalHomePath(signal?: AbortSignal): Promise<string> {
  const normalized = normalizeHostPath(homedir());
  try {
    throwIfAborted(signal);
    const canonical = await realpath(normalized);
    throwIfAborted(signal);
    return canonical;
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return normalized;
  }
}

function directoryCrumbs(canonicalPath: string): DirectoryEntry[] {
  const parsed = path.parse(canonicalPath);
  const crumbs: DirectoryEntry[] = [];
  let currentPath = parsed.root;

  if (parsed.root) {
    crumbs.push({ name: parsed.root, path: parsed.root, hidden: false });
  }

  const relativePath = canonicalPath.slice(parsed.root.length);
  for (const name of relativePath.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, name);
    crumbs.push({ name, path: currentPath, hidden: name.startsWith(".") });
  }

  return crumbs;
}

async function isNavigableDirectory(
  entryPath: string,
  isDirectory: boolean,
  isLink: boolean,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  if (isDirectory) return true;
  if (!isLink) return false;

  try {
    const navigable = (await stat(entryPath)).isDirectory();
    throwIfAborted(signal);
    return navigable;
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return false;
  }
}

function compareEntryNames(left: { name: string }, right: { name: string }): number {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

export async function listHostDirectory(
  requestedPath?: string,
  signal?: AbortSignal,
): Promise<HostDirectoryListing> {
  const home = await canonicalHomePath(signal);
  const candidate = requestedPath?.trim() || home;
  const canonicalPath = await canonicalDirectoryPath(candidate, signal);

  let children;
  try {
    throwIfAborted(signal);
    children = await readdir(canonicalPath, { withFileTypes: true });
    throwIfAborted(signal);
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    throw directoryError(
      "directory-unreadable",
      canonicalPath,
      `Unable to read directory: ${canonicalPath}`,
    );
  }

  children.sort(compareEntryNames);
  const navigable: DirectoryEntry[] = [];

  for (const child of children) {
    throwIfAborted(signal);
    const childPath = path.join(canonicalPath, child.name);
    if (
      !(await isNavigableDirectory(childPath, child.isDirectory(), child.isSymbolicLink(), signal))
    ) {
      continue;
    }

    navigable.push({
      name: child.name,
      path: childPath,
      hidden: child.name.startsWith("."),
    });

    if (navigable.length > DIRECTORY_ENTRY_LIMIT) break;
  }

  return {
    path: canonicalPath,
    home,
    crumbs: directoryCrumbs(canonicalPath),
    entries: navigable.slice(0, DIRECTORY_ENTRY_LIMIT),
    truncated: navigable.length > DIRECTORY_ENTRY_LIMIT,
  };
}

function validDirectoryName(name: string): boolean {
  return Boolean(name) && name !== "." && name !== ".." && !/[\\/]/.test(name);
}

export async function createHostDirectory(
  input: CreateHostDirectoryInput,
): Promise<{ path: string }> {
  const name = input.name.trim();
  if (!validDirectoryName(name)) {
    const parentPath = pathDetails(input.path).path;
    throw directoryError(
      "directory-create-failed",
      parentPath,
      `Invalid directory name: ${input.name}`,
    );
  }

  const parentPath = await canonicalDirectoryPath(input.path.trim() || input.path);
  const targetPath = path.join(parentPath, name);

  try {
    await mkdir(targetPath);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw directoryError(
        "directory-exists",
        targetPath,
        `Directory already exists: ${targetPath}`,
      );
    }
    throw directoryError(
      "directory-create-failed",
      targetPath,
      `Unable to create directory: ${targetPath}`,
    );
  }

  try {
    return { path: await realpath(targetPath) };
  } catch {
    throw directoryError(
      "directory-create-failed",
      targetPath,
      `Unable to resolve created directory: ${targetPath}`,
    );
  }
}

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

export async function pickHostDirectory(
  signal: AbortSignal = new AbortController().signal,
  internals: NativeWorkspacePickerInternals = {},
): Promise<string | null> {
  try {
    const selectedPath = await pickNativeWorkspaceDirectory(signal, internals);
    return selectedPath ? await canonicalDirectoryPath(selectedPath, signal) : null;
  } catch (error) {
    if (error instanceof NativeWorkspacePickerUnavailableError) {
      throw new HostDirectoryError(
        "directory-picker-unavailable",
        { capability: DIRECTORY_PICKER_CAPABILITY },
        "No supported native directory picker is available.",
      );
    }
    throw error;
  }
}

function runHostPathCommand(
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { windowsHide: true, signal }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function openCommand(platform: NodeJS.Platform): string | undefined {
  if (platform === "darwin") return "open";
  if (platform === "win32") return "explorer.exe";
  if (platform === "linux") return "xdg-open";
  return undefined;
}

export function canOpenHostPath(platform?: NodeJS.Platform): boolean;
export function canOpenHostPath(internals?: HostPathCapabilityInternals): boolean;
export function canOpenHostPath(
  input: NodeJS.Platform | HostPathCapabilityInternals = {},
): boolean {
  const internals = typeof input === "string" ? { platform: input } : input;
  const platform = internals.platform ?? process.platform;
  if (platform === "darwin" || platform === "win32") return true;
  if (platform !== "linux") return false;

  const env = internals.env ?? process.env;
  const marked = (value: string | undefined) => value !== undefined && value !== "";
  const wsl =
    marked(env.WSL_DISTRO_NAME) ||
    marked(env.WSL_INTEROP) ||
    (internals.osRelease ?? release()).toLowerCase().includes("microsoft");
  return wsl || marked(env.DISPLAY) || marked(env.WAYLAND_DISPLAY);
}

export async function openHostPath(
  requestedPath: string,
  internals: HostPathOpenInternals = {},
): Promise<{ opened: true }> {
  const platform = internals.platform ?? process.platform;
  const command = openCommand(platform);
  if (!command) {
    throw new Error(`Opening host paths is unsupported on ${platform}.`);
  }

  if (!requestedPath.trim()) throw new Error("A host path is required.");
  const canonicalPath = await realpath(normalizeHostPath(requestedPath));
  await (internals.run ?? runHostPathCommand)(command, [canonicalPath], internals.signal);
  return { opened: true };
}
