import {
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  type InlineExtension,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  BUILTIN_TOOL_PREFERENCE_KEYS,
  builtinToolEnabled,
  type BuiltinToolName,
} from "@workbench/agent-runtime-contracts/settings";
import { bindToolAvailability, type ToolCapabilitySettings } from "../_shared/tool-availability";
import type {
  PiAgentHostBindings,
  PiBashToolFactoryInput,
} from "../../agent-runtime/pi-agent-host-bindings";
import { createEnhancedSearchTools } from "../enhanced-search";

export type BuiltinToolSettings = (name: BuiltinToolName) => ToolCapabilitySettings;

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

export function createBuiltinToolExtensions(settings?: BuiltinToolSettings) {
  return (Object.keys(BUILTIN_TOOL_PREFERENCE_KEYS) as BuiltinToolName[]).map((name) => {
    return {
      name: `workbench.tool.${name}`,
      hidden: true,
      factory(pi) {
        const readEnabled = bindToolAvailability(
          pi,
          name,
          settings?.(name),
          builtinToolEnabled(name, {}),
        );
        pi.on("tool_call", async (event) => {
          if (event.toolName === name && !(await readEnabled()))
            return { block: true, reason: `${name} is disabled in Workbench settings.` };
        });
      },
    } satisfies InlineExtension;
  });
}
