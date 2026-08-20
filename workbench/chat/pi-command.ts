export interface PiCommandDescriptor {
  name: string;
  invocationName: string;
}

export interface PiCommandTextMatch<TCommand extends PiCommandDescriptor = PiCommandDescriptor> {
  command: TCommand;
  argumentsText: string;
  hasSeparator: boolean;
}

export function formatPiCommandLabel(name: string): string {
  const withoutCollisionSuffix = name.replace(/:\d+$/, "");
  const words = withoutCollisionSuffix
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(/[\s._:/-]+/)
    .filter(Boolean);

  return words
    .map((word) =>
      /^[A-Z\d]+$/.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");
}

export function parsePiCommandText<TCommand extends PiCommandDescriptor>(
  text: string,
  commands: readonly TCommand[],
): PiCommandTextMatch<TCommand> | undefined {
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

export function removePiCommandBuffer(argumentsText: string): string {
  return argumentsText.startsWith(" ") ? argumentsText.slice(1) : argumentsText;
}
