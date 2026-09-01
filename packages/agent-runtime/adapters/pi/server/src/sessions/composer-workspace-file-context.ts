import {
  COMPOSER_WORKSPACE_FILE_CONTEXT_TYPE,
  type ComposerJsonValue,
} from "@workbench/contracts/composer";
import type {
  WorkspaceFileReadPayload,
  WorkspaceFileSnapshotValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type { WorkbenchResolvedContext } from "@workbench/contracts/composer/request";

const MAX_REFERENCED_WORKSPACE_FILES = 12;
const MAX_WORKSPACE_FILE_CHARACTERS = 60_000;
const MAX_WORKSPACE_FILES_TOTAL_CHARACTERS = 120_000;

interface WorkspaceFileReference {
  readonly workspaceId: string;
  readonly relativePath: string;
  readonly name: string;
}

function record(value: ComposerJsonValue): Readonly<Record<string, ComposerJsonValue>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, ComposerJsonValue>>;
}

function workspaceFileReference(
  context: WorkbenchResolvedContext,
): WorkspaceFileReference | undefined {
  if (
    context.source !== COMPOSER_WORKSPACE_FILE_CONTEXT_TYPE ||
    context.trust !== "untrusted-context"
  ) {
    return undefined;
  }
  const value = record(context.value);
  const workspaceId = value?.workspaceId;
  const relativePath = value?.relativePath;
  const name = value?.name;
  if (
    value?.version !== 1 ||
    typeof workspaceId !== "string" ||
    workspaceId.length === 0 ||
    workspaceId.length > 2048 ||
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > 16_384 ||
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 4096
  ) {
    return undefined;
  }
  return { workspaceId, relativePath, name };
}

export function boundedWorkspaceFileContent(
  content: string,
  maximumCharacters = MAX_WORKSPACE_FILE_CHARACTERS,
): { readonly content: string; readonly truncated: boolean } {
  const limit = Math.max(0, Math.min(maximumCharacters, MAX_WORKSPACE_FILE_CHARACTERS));
  return {
    content: content.slice(0, limit),
    truncated: content.length > limit,
  };
}

function resolvedContextValue(
  reference: WorkspaceFileReference,
  status: "available" | "limit-reached" | "unavailable",
  snapshot?: WorkspaceFileSnapshotValue,
  bounded?: ReturnType<typeof boundedWorkspaceFileContent>,
): ComposerJsonValue {
  const value: Record<string, ComposerJsonValue> = {
    version: 1,
    kind: "workspace-file-reference",
    workspaceId: reference.workspaceId,
    relativePath: reference.relativePath,
    name: reference.name,
    status,
  };
  if (snapshot && bounded) {
    value.file = {
      name: snapshot.name,
      content: bounded.content,
      truncated: bounded.truncated,
      version: snapshot.version,
      size: snapshot.size,
      modifiedAt: snapshot.modifiedAt,
    };
  }
  return value;
}

export async function resolveWorkspaceFileReferenceContexts({
  contexts,
  readFile,
}: Readonly<{
  contexts: readonly WorkbenchResolvedContext[];
  readFile(input: WorkspaceFileReadPayload): Promise<WorkspaceFileSnapshotValue>;
}>): Promise<WorkbenchResolvedContext[]> {
  let referencedCount = 0;
  let remainingCharacters = MAX_WORKSPACE_FILES_TOTAL_CHARACTERS;
  const resolved: WorkbenchResolvedContext[] = [];

  for (const context of contexts) {
    const reference = workspaceFileReference(context);
    if (!reference) {
      resolved.push(context);
      continue;
    }
    referencedCount += 1;

    if (referencedCount > MAX_REFERENCED_WORKSPACE_FILES || remainingCharacters <= 0) {
      resolved.push({ ...context, value: resolvedContextValue(reference, "limit-reached") });
      continue;
    }

    try {
      const snapshot = await readFile({
        workspaceId: reference.workspaceId,
        relativePath: reference.relativePath,
      });
      const bounded = boundedWorkspaceFileContent(snapshot.content, remainingCharacters);
      remainingCharacters -= bounded.content.length;
      resolved.push({
        ...context,
        value: resolvedContextValue(reference, "available", snapshot, bounded),
      });
    } catch {
      resolved.push({ ...context, value: resolvedContextValue(reference, "unavailable") });
    }
  }

  return resolved;
}
