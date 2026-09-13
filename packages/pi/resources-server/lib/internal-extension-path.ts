export const WORKBENCH_INTERNAL_PI_EXTENSION_PATH_PREFIX = "<inline:workbench.";
export function isWorkbenchInternalPiExtensionPath(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(WORKBENCH_INTERNAL_PI_EXTENSION_PATH_PREFIX);
}
