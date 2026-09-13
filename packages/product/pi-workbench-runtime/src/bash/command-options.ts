import type {
  BashCommandPolicy,
  BashCommandPolicyResult,
} from "@workbench/terminal-server/bash-command-policy";

export function normalizedResolvedCommand(
  command: string,
  commandPrefix: string | undefined,
  policy: Pick<BashCommandPolicy, "normalize">,
): BashCommandPolicyResult {
  const prefix = commandPrefix === undefined ? undefined : `${commandPrefix}\n`;
  const hasPrefix = prefix !== undefined && command.startsWith(prefix);
  const policyCommand = hasPrefix ? command.slice(prefix.length) : command;
  const result = policy.normalize(policyCommand);
  if (result.action === "reject") {
    throw new Error(result.reason || "Bash command rejected by runtime policy.");
  }
  return {
    ...result,
    command: hasPrefix ? `${prefix}${result.command}` : result.command,
  };
}

export function effectiveTimeout(
  requested: number | undefined,
  planned: number | undefined,
): number | undefined {
  if (requested === undefined) return planned;
  if (planned === undefined) return requested;
  return Math.min(requested, planned);
}
