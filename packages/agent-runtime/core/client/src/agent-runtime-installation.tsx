"use client";

import { Fragment, type ReactElement, type ReactNode } from "react";

import type { WorkbenchAgentRuntimeDescriptor } from "@workbench/agent-runtime-contracts/descriptor";

/**
 * Browser installation for one already selected Agent Runtime.
 *
 * The implementation owns manager, transport, adapter, and cleanup lifecycles. This boundary only
 * mounts that complete implementation; it is intentionally not a registry or selection service.
 */
export interface WorkbenchAgentRuntimeInstallation {
  readonly descriptor: WorkbenchAgentRuntimeDescriptor;
  render(children: ReactNode): ReactElement;
}

/** Mount the one installation chosen by the application composition root. */
export function WorkbenchAgentRuntimeInstallationHost({
  installation,
  children,
}: Readonly<{ installation: WorkbenchAgentRuntimeInstallation; children: ReactNode }>) {
  return <Fragment key={installation.descriptor.id}>{installation.render(children)}</Fragment>;
}
