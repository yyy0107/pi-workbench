/** Stable, serializable identity shared by one Agent Runtime's client and server installations. */
export interface WorkbenchAgentRuntimeDescriptor<Id extends string = string> {
  readonly id: Id;
}

/** Define one Runtime identity without introducing discovery, registration, or selection policy. */
export function defineWorkbenchAgentRuntimeDescriptor<const Id extends string>(
  id: Id,
): Readonly<WorkbenchAgentRuntimeDescriptor<Id>> {
  if (id.length === 0 || id !== id.trim()) {
    throw new Error("Workbench Agent Runtime id must be non-empty and have no outer whitespace");
  }
  return Object.freeze({ id });
}
