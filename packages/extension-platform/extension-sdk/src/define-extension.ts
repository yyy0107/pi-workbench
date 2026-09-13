import type { WorkbenchExtension } from "./api/extension";

export function defineExtension<const TExtension extends WorkbenchExtension>(
  extension: TExtension,
): TExtension {
  return extension;
}
