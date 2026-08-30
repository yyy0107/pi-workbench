import type { WorkbenchAgentRuntimeDescriptor } from "@workbench/agent-runtime-contracts/descriptor";

import type { WorkbenchAgentServerAdapter } from "./adapter";

/** Server installation for one already selected Agent Runtime implementation. */
export interface WorkbenchAgentServerInstallation {
  readonly descriptor: WorkbenchAgentRuntimeDescriptor;
  createAdapter(): WorkbenchAgentServerAdapter;
}

/** Instantiate the selected implementation and enforce its shared client/server identity. */
export function createInstalledWorkbenchAgentServerAdapter(
  installation: WorkbenchAgentServerInstallation,
): WorkbenchAgentServerAdapter {
  const adapter = installation.createAdapter();
  if (adapter.id !== installation.descriptor.id) {
    throw new Error(
      `Workbench Agent Runtime installation id ${installation.descriptor.id} does not match adapter id ${adapter.id}`,
    );
  }
  return adapter;
}
