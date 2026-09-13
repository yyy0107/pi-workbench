import { readBuiltinResourceEnabled } from "@workbench/pi-server-ports/preferences";
import type { PiAgentHostBindings } from "@workbench/pi-server-ports/host";
export type { PiBashToolFactoryInput, PiAgentHostBindings } from "@workbench/pi-server-ports/host";
import type { BuiltinResourcePreferenceKey } from "@workbench/agent-runtime-contracts/settings";

/** Workbench Host capabilities required while constructing a Pi session. */

interface PiAgentHostBindingsGlobal {
  __workbenchPiAgentHostBindings?: PiAgentHostBindings;
}

const bindingGlobal = globalThis as typeof globalThis & PiAgentHostBindingsGlobal;
const EMPTY_PI_AGENT_HOST_BINDINGS = Object.freeze({}) satisfies PiAgentHostBindings;

export function bindPiAgentHostBindings(bindings: PiAgentHostBindings): void {
  bindingGlobal.__workbenchPiAgentHostBindings = bindings;
}

export function getPiAgentHostBindings(): PiAgentHostBindings {
  return bindingGlobal.__workbenchPiAgentHostBindings ?? EMPTY_PI_AGENT_HOST_BINDINGS;
}

export async function isBuiltinResourceEnabled(
  key: BuiltinResourcePreferenceKey,
): Promise<boolean> {
  return readBuiltinResourceEnabled(getPiAgentHostBindings(), key);
}
