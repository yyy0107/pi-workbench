"use client";

import { WorkbenchThread } from "@/workbench/chat/workbench-thread";
import { WorkbenchClient } from "@/workbench/workbench-client";

/**
 * Backwards-compatible entry point for code that imported the starter's
 * `Assistant` component before the Workbench route group was introduced.
 */
export function Assistant() {
  return (
    <WorkbenchClient>
      <WorkbenchThread />
    </WorkbenchClient>
  );
}
