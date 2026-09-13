/** Stable installed-resource identity used by protection and migration rules. */
export const WORKBENCH_BROWSER_PACKAGE_SOURCE = "./packages/.builtin/browser";

export function isWorkbenchBuiltinPackage(source: string, scope = "user"): boolean {
  return (
    scope === "user" &&
    source.replaceAll("\\", "/").replace(/^\.\//u, "") === "packages/.builtin/browser"
  );
}
