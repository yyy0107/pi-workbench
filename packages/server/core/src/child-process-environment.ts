/**
 * Remove launcher-only variables before starting a user-owned child process.
 *
 * Packaged Electron uses its own executable as Node for the Workbench server.
 * Letting that mode escape into terminals or local applications can make another
 * Electron executable start as Node instead of as its desktop application.
 */
export function childProcessEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const environment = { ...source };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}
