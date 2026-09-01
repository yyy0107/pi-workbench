import {
  createWorkbenchDraftPersistence as createBrowserDraftPersistence,
  createWorkbenchThreadScrollPersistence,
  type WorkbenchSessionStorageResolver,
} from "@workbench/shell/browser-session-persistence";

function legacyWebDraftKeys(logicalKey: string): readonly string[] {
  const keys = [logicalKey];
  const browserPrefix = "workbench:browser-address-draft:v2:";
  if (logicalKey.startsWith(browserPrefix)) {
    keys.push(`pi-workbench:browser-address-draft:v1:${logicalKey.slice(browserPrefix.length)}`);
  }
  const feedbackPrefix = "workbench:right-workspace-feedback-draft:v2:";
  if (logicalKey.startsWith(feedbackPrefix)) {
    keys.push(
      `pi-workbench:right-workspace-feedback-draft:v1:${logicalKey.slice(feedbackPrefix.length)}`,
    );
  }
  return Object.freeze(keys);
}

/** Preserve Web's historical draft aliases at the application compatibility edge. */
export function createWorkbenchDraftPersistence(
  namespace: string,
  resolveStorage?: WorkbenchSessionStorageResolver,
) {
  return createBrowserDraftPersistence(namespace, resolveStorage, legacyWebDraftKeys);
}

export { createWorkbenchThreadScrollPersistence };
