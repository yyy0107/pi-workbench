export type { BuiltinToolSettings } from "@workbench/pi-sdk-ports/tools";
import {
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { PiAgentHostBindings, PiBashToolFactoryInput } from "@workbench/pi-sdk-ports/host";
import { createEnhancedSearchTools } from "./enhanced-search";

/** Use SDK definitions for catalog metadata without replacing configured native execution. */
export function createBuiltinToolDefinitions(cwd: string) {
  return [
    createReadToolDefinition(cwd),
    createBashToolDefinition(cwd),
    createEditToolDefinition(cwd),
    createWriteToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ];
}

/** Share override selection with the catalog without constructing session-bound tools there. */
export function workbenchToolOverrides(
  cwd: string,
  bindings: PiAgentHostBindings,
  enhancedSearch = false,
) {
  const overrides: Array<{
    name: string;
    source: string;
    create(input: PiBashToolFactoryInput): ToolDefinition;
  }> = (enhancedSearch ? createEnhancedSearchTools(cwd) : []).map((definition) => ({
    name: definition.name,
    source: "workbench.enhanced-search",
    create: () => definition,
  }));
  if (bindings.createBashToolOverride) {
    overrides.push({
      name: "bash",
      source: "workbench.terminal",
      create: bindings.createBashToolOverride,
    });
  }
  return overrides;
}
