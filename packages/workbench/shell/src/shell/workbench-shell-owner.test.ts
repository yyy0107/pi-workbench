import assert from "node:assert/strict";
import test from "node:test";

import { resolveWorkbenchShellOwner } from "./workbench-shell-owner";

test("resolves the nearest Workbench installation before the document fallback", () => {
  const documentRoot = {} as HTMLElement;
  const firstShell = {} as HTMLElement;
  const secondShell = {} as HTMLElement;
  const firstContainer = {
    closest: () => firstShell,
    ownerDocument: { documentElement: documentRoot },
  } as unknown as HTMLElement;
  const secondContainer = {
    closest: () => secondShell,
    ownerDocument: { documentElement: documentRoot },
  } as unknown as HTMLElement;
  const detachedContainer = {
    closest: () => null,
    ownerDocument: { documentElement: documentRoot },
  } as unknown as HTMLElement;

  assert.equal(resolveWorkbenchShellOwner(firstContainer), firstShell);
  assert.equal(resolveWorkbenchShellOwner(secondContainer), secondShell);
  assert.equal(resolveWorkbenchShellOwner(detachedContainer), documentRoot);
});
