import type { PiResourceCatalogTarget } from "@/workbench/runtime-contributions/pi/protocol/rpc";
import type { WorkbenchToolboxScopePreference } from "@workbench/agent-runtime-contracts/settings";

import type { ToolboxCapabilitySurfaceParams } from "./toolbox-capability";

export const USER_TOOLBOX_SCOPE = Object.freeze({
  kind: "user",
}) satisfies WorkbenchToolboxScopePreference;

const PROJECT_SCOPE_PREFIX = "project:";

export function toolboxScopeKey(scope: WorkbenchToolboxScopePreference): string {
  return scope.kind === "user"
    ? "user"
    : `${PROJECT_SCOPE_PREFIX}${encodeURIComponent(scope.workspaceId)}`;
}

export function parseToolboxScopeKey(value: string): WorkbenchToolboxScopePreference | undefined {
  if (value === "user") return USER_TOOLBOX_SCOPE;
  if (!value.startsWith(PROJECT_SCOPE_PREFIX)) return undefined;
  try {
    const workspaceId = decodeURIComponent(value.slice(PROJECT_SCOPE_PREFIX.length));
    return workspaceId ? { kind: "project", workspaceId } : undefined;
  } catch {
    return undefined;
  }
}

export function toolboxScopeTarget(
  scope: WorkbenchToolboxScopePreference,
): PiResourceCatalogTarget {
  return scope.kind === "user"
    ? { scope: "user" }
    : { scope: "project", workspaceId: scope.workspaceId };
}

export function toolboxScopeMatchesResource(
  scope: WorkbenchToolboxScopePreference,
  resourceScope: "user" | "project" | "temporary",
): boolean {
  return scope.kind === resourceScope;
}

export function toolboxScopeMatchesCapability(
  scope: WorkbenchToolboxScopePreference,
  capability: ToolboxCapabilitySurfaceParams,
): boolean {
  const resourceScope = capability.packageScope ?? capability.scope;
  if (!resourceScope) return true;
  if (!toolboxScopeMatchesResource(scope, resourceScope)) return false;
  return scope.kind === "user" || capability.projectId === scope.workspaceId;
}
