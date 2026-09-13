import type { BuiltinResourcePreferenceKey } from "@workbench/agent-runtime-contracts/settings";
import type { PiAgentHostBindings } from "../src/host-bindings";
export async function readBuiltinResourceEnabled(
  bindings: Pick<PiAgentHostBindings, "readBuiltinResourceEnabled">,
  key: BuiltinResourcePreferenceKey,
): Promise<boolean> {
  try {
    return (await bindings.readBuiltinResourceEnabled?.(key)) ?? true;
  } catch (error) {
    console.error(`[workbench-pi] ${key} preference could not be read.`, error);
    return true;
  }
}
