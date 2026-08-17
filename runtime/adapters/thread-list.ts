import { InMemoryThreadListAdapter } from "@assistant-ui/react";

/**
 * The first frontend-only release keeps thread metadata in memory. Replacing
 * this single adapter with cloud or durable browser storage does not affect the
 * Workbench UI or the per-thread chat runtime.
 */
export const workbenchThreadListAdapter = new InMemoryThreadListAdapter();
