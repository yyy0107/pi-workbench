import { piAgentRuntimeExtensions } from "./pi/extensions";

/** Build-time contribution selection; intentionally not a dynamic registry or fallback chain. */
export const installedAgentRuntimeExtensions = piAgentRuntimeExtensions;
