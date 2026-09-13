export interface AgentCommandDescriptor {
  readonly name: string;
  readonly invocationName: string;
}

export interface AgentCommandTextMatch<
  TCommand extends AgentCommandDescriptor = AgentCommandDescriptor,
> {
  readonly command: TCommand;
  readonly argumentsText: string;
  readonly hasSeparator: boolean;
}

const AGENT_COMMAND_ACRONYMS = new Map(
  [
    "ai",
    "api",
    "cli",
    "http",
    "https",
    "id",
    "json",
    "llm",
    "mcp",
    "rpc",
    "sdk",
    "ui",
    "url",
    "ux",
  ].map((value) => [value, value.toUpperCase()]),
);

export function formatAgentCommandLabel(name: string): string {
  const withoutCollisionSuffix = name.replace(/:\d+$/, "");
  const words = withoutCollisionSuffix
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(/[\s._:/-]+/)
    .filter(Boolean);

  return words
    .map((word) => {
      const acronym = AGENT_COMMAND_ACRONYMS.get(word.toLowerCase());
      if (acronym) return acronym;
      return /^[A-Z\d]+$/.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

export function parseAgentCommandText<TCommand extends AgentCommandDescriptor>(
  text: string,
  commands: readonly TCommand[],
): AgentCommandTextMatch<TCommand> | undefined {
  const match = /^\/(\S+)(?:(\s)([\s\S]*))?$/.exec(text);
  if (!match) return undefined;

  const command = commands.find((candidate) => candidate.invocationName === match[1]);
  if (!command) return undefined;

  return {
    command,
    argumentsText: match[3] ?? "",
    hasSeparator: match[2] !== undefined,
  };
}

export function removeAgentCommandBuffer(argumentsText: string): string {
  return argumentsText.startsWith(" ") ? argumentsText.slice(1) : argumentsText;
}
