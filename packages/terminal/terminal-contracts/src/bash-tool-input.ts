export const MAX_AGENT_BASH_INPUT_CHARACTERS = 16 * 1024;

export type WorkbenchBashInput = { source: "agent"; data: string } | { source: "user" };

export function workbenchBashInputFromArgs(args: unknown): WorkbenchBashInput | undefined {
  if (!args || typeof args !== "object") return undefined;
  const input = (args as { input?: unknown }).input;
  if (!input || typeof input !== "object") return undefined;

  const source = (input as { source?: unknown }).source;
  if (source === "user") return { source };
  if (source !== "agent") return undefined;

  const data = (input as { data?: unknown }).data;
  return typeof data === "string" ? { source, data } : undefined;
}
