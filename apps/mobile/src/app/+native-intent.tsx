export function normalizeMobileSystemPath(path: string): string {
  void path;
  // Direct remote control has no OAuth or push deep-link surface. Pairing is accepted only
  // inside the foreground scanner/manual flow, so every unsolicited system URL is rejected.
  return "/";
}

export function redirectSystemPath({ path }: { readonly path: string; readonly initial: boolean }) {
  return normalizeMobileSystemPath(path);
}
