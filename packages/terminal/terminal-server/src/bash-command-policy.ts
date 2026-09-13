import Parser from "tree-sitter";
import Bash from "tree-sitter-bash";

const MAX_POLICY_COMMAND_LENGTH = 64 * 1024;
const REDUNDANT_CAPTURE_REASON = "PTY already captures command output";

export interface BashCommandPolicyResult {
  action: "allow" | "rewrite" | "reject";
  originalCommand: string;
  command: string;
  executionMode: "pty";
  timeoutSeconds?: number;
  reason?: string;
}

interface PlannedRewrite {
  command: string;
  timeoutSeconds?: number;
}

interface TemporaryCapture {
  primaryCommand: string;
  target: string;
}

function allow(command: string): BashCommandPolicyResult {
  return {
    action: "allow",
    originalCommand: command,
    command,
    executionMode: "pty",
  };
}

function rewrite(originalCommand: string, plan: PlannedRewrite): BashCommandPolicyResult {
  return {
    action: "rewrite",
    originalCommand,
    command: plan.command,
    executionMode: "pty",
    ...(plan.timeoutSeconds === undefined ? {} : { timeoutSeconds: plan.timeoutSeconds }),
    reason: REDUNDANT_CAPTURE_REASON,
  };
}

function staticLiteral(node: Parser.SyntaxNode): string | undefined {
  if (node.type === "word" || node.type === "number") {
    return node.namedChildCount === 0 ? node.text : undefined;
  }
  if (node.type === "raw_string") return node.text.slice(1, -1);
  if (node.type !== "string") return undefined;
  if (!node.namedChildren.every((child) => child.type === "string_content")) return undefined;
  return node.namedChildren.map((child) => child.text).join("");
}

function isTemporaryLogPath(value: string): boolean {
  if (!(value.startsWith("/tmp/") || value.startsWith("/private/tmp/"))) return false;
  if (value.split("/").includes("..")) return false;
  return value.toLowerCase().endsWith(".log");
}

function redirectOperator(node: Parser.SyntaxNode): string | undefined {
  return node.children.find((child) => !child.isNamed)?.type;
}

function isStderrToStdoutRedirect(node: Parser.SyntaxNode): boolean {
  return (
    node.type === "file_redirect" &&
    redirectOperator(node) === ">&" &&
    node.childForFieldName("descriptor")?.text === "2" &&
    node.childForFieldName("destination")?.text === "1"
  );
}

function outputCaptureTarget(node: Parser.SyntaxNode): string | undefined {
  if (node.type !== "file_redirect" || redirectOperator(node) !== ">") return undefined;
  const descriptor = node.childForFieldName("descriptor")?.text;
  if (descriptor !== undefined && descriptor !== "1") return undefined;
  const destination = node.childForFieldName("destination");
  if (!destination) return undefined;
  const target = staticLiteral(destination);
  return target && isTemporaryLogPath(target) ? target : undefined;
}

function temporaryRedirectCapture(node: Parser.SyntaxNode): TemporaryCapture | undefined {
  if (node.type !== "redirected_statement") return undefined;
  const body = node.childForFieldName("body");
  const redirects = node.childrenForFieldName("redirect");
  if (!body || redirects.length === 0) return undefined;

  const outputTargets = redirects.map(outputCaptureTarget).filter((value) => value !== undefined);
  if (outputTargets.length !== 1) return undefined;
  if (
    redirects.some(
      (redirect) =>
        outputCaptureTarget(redirect) === undefined && !isStderrToStdoutRedirect(redirect),
    )
  ) {
    return undefined;
  }

  const target = outputTargets[0];
  if (!target || body.text.includes(target)) return undefined;
  return { primaryCommand: body.text, target };
}

function commandBaseName(node: Parser.SyntaxNode): string | undefined {
  if (node.type !== "command") return undefined;
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return undefined;
  const name = staticLiteral(nameNode.firstNamedChild ?? nameNode);
  if (!name) return undefined;
  return name.split("/").at(-1) ?? name;
}

function commandParts(node: Parser.SyntaxNode): { name: string; arguments: string[] } | undefined {
  const name = commandBaseName(node);
  if (!name) return undefined;
  const args = node.childrenForFieldName("argument").map(staticLiteral);
  if (args.some((value) => value === undefined)) return undefined;
  return {
    name,
    arguments: args as string[],
  };
}

function isFiniteReadbackOptions(command: "head" | "tail", options: string[]): boolean {
  if (options.length === 0 || (options.length === 1 && options[0] === "--")) return true;
  if (options.length === 1 && /^-\d+$/.test(options[0]!)) return true;
  if (options.length === 1 && /^-(?:n|c)\d+$/.test(options[0]!)) return true;
  if (options.length === 1 && /^--(?:lines|bytes)=\d+$/.test(options[0]!)) return true;
  if (options.length === 2 && ["-n", "-c", "--lines", "--bytes"].includes(options[0]!)) {
    return /^\d+$/.test(options[1]!);
  }
  return command === "head" && options.length === 1 && options[0] === "-q";
}

function isReadbackCommand(node: Parser.SyntaxNode, target: string): boolean {
  const command = commandParts(node);
  if (!command) return false;
  const targetIndexes = command.arguments.flatMap((argument, index) =>
    argument === target ? [index] : [],
  );
  if (targetIndexes.length !== 1 || targetIndexes[0] !== command.arguments.length - 1) return false;

  const options = command.arguments.slice(0, -1);
  if (command.name === "cat") return options.length === 0 || options.join("\0") === "--";
  if (command.name !== "head" && command.name !== "tail") return false;
  return isFiniteReadbackOptions(command.name, options);
}

function isExitStatusObservation(node: Parser.SyntaxNode): boolean {
  const command = commandBaseName(node);
  if (command !== "echo" && command !== "printf") return false;
  if (
    node.descendantsOfType(["arithmetic_expansion", "command_substitution", "process_substitution"])
      .length > 0
  ) {
    return false;
  }
  return node.descendantsOfType("special_variable_name").some((variable) => variable.text === "?");
}

function hasOnlySequentialProgramSeparators(program: Parser.SyntaxNode): boolean {
  return program.children.every((child) => child.isNamed || child.type === ";");
}

function redirectedReadbackRewrite(root: Parser.SyntaxNode): string | undefined {
  if (root.type !== "program" || !hasOnlySequentialProgramSeparators(root)) return undefined;
  const statements = root.namedChildren;

  if (statements.length === 2 || statements.length === 3) {
    const capture = temporaryRedirectCapture(statements[0]!);
    if (capture) {
      const readback = statements.at(-1)!;
      const status = statements.length === 3 ? statements[1] : undefined;
      if (
        isReadbackCommand(readback, capture.target) &&
        (!status || isExitStatusObservation(status))
      ) {
        return capture.primaryCommand;
      }
    }
  }

  if (statements.length !== 1 || statements[0]?.type !== "list") return undefined;
  const list = statements[0];
  const operator = list.children.find((child) => !child.isNamed)?.type;
  if (operator !== "&&" || list.namedChildren.length !== 2) return undefined;
  const capture = temporaryRedirectCapture(list.namedChildren[0]!);
  if (!capture || !isReadbackCommand(list.namedChildren[1]!, capture.target)) return undefined;
  return capture.primaryCommand;
}

function teeReadbackRewrite(root: Parser.SyntaxNode): string | undefined {
  if (
    root.type !== "program" ||
    !hasOnlySequentialProgramSeparators(root) ||
    root.namedChildren.length !== 1 ||
    root.namedChildren[0]?.type !== "pipeline"
  ) {
    return undefined;
  }

  const pipeline = root.namedChildren[0];
  if (pipeline.namedChildren.length !== 2) return undefined;
  const operator = pipeline.children.find((child) => !child.isNamed)?.type;
  if (operator !== "|") return undefined;

  const primary = pipeline.namedChildren[0]!;
  const tee = commandParts(pipeline.namedChildren[1]!);
  if (!tee || tee.name !== "tee") return undefined;
  const teeArgs = tee.arguments[0] === "--" ? tee.arguments.slice(1) : tee.arguments;
  if (teeArgs.length !== 1 || !isTemporaryLogPath(teeArgs[0]!)) return undefined;
  const target = teeArgs[0]!;
  if (primary.text.includes(target)) return undefined;

  if (primary.type !== "redirected_statement") return primary.text;
  const redirects = primary.childrenForFieldName("redirect");
  if (redirects.length !== 1 || !isStderrToStdoutRedirect(redirects[0]!)) return undefined;
  return primary.childForFieldName("body")?.text;
}

function finiteOutputFilter(node: Parser.SyntaxNode): boolean {
  const command = commandParts(node);
  if (!command || (command.name !== "head" && command.name !== "tail")) return false;
  return isFiniteReadbackOptions(command.name, command.arguments);
}

function primaryWithoutStderrPipeRedirect(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  if (node.type !== "redirected_statement") return node;
  const redirects = node.childrenForFieldName("redirect");
  if (redirects.length !== 1 || !isStderrToStdoutRedirect(redirects[0]!)) return undefined;
  return node.childForFieldName("body") ?? undefined;
}

function timeoutSeconds(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multiplier = match[2] === "m" ? 60 : match[2] === "h" ? 3600 : match[2] === "d" ? 86400 : 1;
  const seconds = amount * multiplier;
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 7 * 86400 ? seconds : undefined;
}

function unwrapSimpleTimeout(node: Parser.SyntaxNode): PlannedRewrite {
  if (node.type !== "command" || commandBaseName(node) !== "timeout") {
    return { command: node.text };
  }
  const argumentsNodes = node.childrenForFieldName("argument");
  if (argumentsNodes.length < 2) return { command: node.text };
  const duration = staticLiteral(argumentsNodes[0]!);
  const seconds = duration ? timeoutSeconds(duration) : undefined;
  if (seconds === undefined) return { command: node.text };
  return {
    command: argumentsNodes
      .slice(1)
      .map((argument) => argument.text)
      .join(" "),
    timeoutSeconds: seconds,
  };
}

/** Detects `command 2>&1 | head; echo $?`, where the pipeline only reimplements tool capture. */
function limitedPipelineReadbackRewrite(root: Parser.SyntaxNode): PlannedRewrite | undefined {
  if (
    root.type !== "program" ||
    !hasOnlySequentialProgramSeparators(root) ||
    root.namedChildren.length !== 2 ||
    !isExitStatusObservation(root.namedChildren[1]!)
  ) {
    return undefined;
  }
  const pipeline = root.namedChildren[0]!;
  if (pipeline.type !== "pipeline" || pipeline.namedChildren.length !== 2) return undefined;
  const operator = pipeline.children.find((child) => !child.isNamed)?.type;
  if (operator !== "|" || !finiteOutputFilter(pipeline.namedChildren[1]!)) return undefined;
  const primary = primaryWithoutStderrPipeRedirect(pipeline.namedChildren[0]!);
  return primary ? unwrapSimpleTimeout(primary) : undefined;
}

function isDevNullOutputRedirect(node: Parser.SyntaxNode): boolean {
  if (node.type !== "file_redirect" || redirectOperator(node) !== ">") return false;
  const descriptor = node.childForFieldName("descriptor")?.text;
  if (descriptor !== undefined && descriptor !== "1") return false;
  const destination = node.childForFieldName("destination");
  return Boolean(destination && staticLiteral(destination) === "/dev/null");
}

function isDevNullRedirect(node: Parser.SyntaxNode): boolean {
  if (node.type !== "file_redirect" || redirectOperator(node) !== ">") return false;
  const destination = node.childForFieldName("destination");
  return Boolean(destination && staticLiteral(destination) === "/dev/null");
}

function redirectedCommandParts(
  node: Parser.SyntaxNode,
): { command: { name: string; arguments: string[] }; redirects: Parser.SyntaxNode[] } | undefined {
  if (node.type !== "redirected_statement") return undefined;
  const body = node.childForFieldName("body");
  const command = body ? commandParts(body) : undefined;
  return command ? { command, redirects: node.childrenForFieldName("redirect") } : undefined;
}

function isBackgroundPidObservation(node: Parser.SyntaxNode): boolean {
  const command = commandBaseName(node);
  if (command !== "echo" && command !== "printf") return false;
  if (
    node.descendantsOfType(["arithmetic_expansion", "command_substitution", "process_substitution"])
      .length > 0
  ) {
    return false;
  }
  return node.descendantsOfType("special_variable_name").some((item) => item.text === "!");
}

function isProcessObservationPipeline(node: Parser.SyntaxNode): boolean {
  if (node.type !== "pipeline" || node.namedChildren.length < 2) return false;
  if (node.children.some((child) => !child.isNamed && child.type !== "|")) return false;
  const commands = node.namedChildren.map(commandParts);
  if (commands.some((command) => command === undefined)) return false;
  const names = (commands as { name: string; arguments: string[] }[]).map(({ name }) => name);
  return (
    names[0] === "ps" &&
    names
      .slice(1)
      .every((name) => ["grep", "head", "tail", "awk", "wc", "sed", "cut"].includes(name))
  );
}

function isDetachedCaptureCleanup(node: Parser.SyntaxNode, target: string): boolean {
  const command = commandParts(node);
  if (command?.name === "rm") {
    const args = command.arguments[0] === "--" ? command.arguments.slice(1) : command.arguments;
    return args.length === 2 && args[0] === "-f" && args[1] === target;
  }

  const redirected = redirectedCommandParts(node);
  return Boolean(
    redirected &&
    redirected.command.name === "pkill" &&
    redirected.command.arguments.length === 2 &&
    redirected.command.arguments[0] === "-f" &&
    redirected.redirects.length > 0 &&
    redirected.redirects.every(isDevNullRedirect),
  );
}

function isFiniteSleepCommand(node: Parser.SyntaxNode): boolean {
  const command = commandParts(node);
  return Boolean(
    command?.name === "sleep" &&
    command.arguments.length === 1 &&
    /^\d+(?:\.\d+)?$/.test(command.arguments[0]!),
  );
}

function isBackgroundObservationScaffolding(node: Parser.SyntaxNode, target: string): boolean {
  if (isReadbackCommand(node, target)) return true;
  if (isProcessObservationPipeline(node)) return true;
  if (isBackgroundPidObservation(node)) return true;
  if (isDetachedCaptureCleanup(node, target)) return true;
  if (node.type === "variable_assignment") {
    return node.descendantsOfType("special_variable_name").some((item) => item.text === "!");
  }
  if (isFiniteSleepCommand(node)) return true;
  if (commandBaseName(node) === "wait") {
    return node.descendantsOfType("variable_name").length === 1;
  }
  return false;
}

function isStrongBackgroundObservation(node: Parser.SyntaxNode, target: string): boolean {
  return isReadbackCommand(node, target) || isProcessObservationPipeline(node);
}

function isDirectBackgroundChild(root: Parser.SyntaxNode, node: Parser.SyntaxNode): boolean {
  const childIndex = root.children.findIndex(
    (child) => child.startIndex === node.startIndex && child.endIndex === node.endIndex,
  );
  return childIndex >= 0 && root.children[childIndex + 1]?.type === "&";
}

interface DetachedScriptCapture {
  inner: string;
  node: Parser.SyntaxNode;
  target: string;
}

function detachedScriptCapture(
  root: Parser.SyntaxNode,
  node: Parser.SyntaxNode,
): DetachedScriptCapture | undefined {
  if (node.type !== "redirected_statement" || !isDirectBackgroundChild(root, node)) {
    return undefined;
  }
  const redirects = node.childrenForFieldName("redirect");
  if (
    redirects.length !== 2 ||
    !redirects.some(isDevNullOutputRedirect) ||
    !redirects.some(isStderrToStdoutRedirect)
  ) {
    return undefined;
  }

  const body = node.childForFieldName("body");
  const command = body ? commandParts(body) : undefined;
  if (!command) return undefined;
  const scriptArguments =
    command.name === "script"
      ? command.arguments
      : command.name === "setsid" && command.arguments[0] === "script"
        ? command.arguments.slice(1)
        : undefined;
  if (
    !scriptArguments ||
    scriptArguments.length !== 4 ||
    scriptArguments[0] !== "-q" ||
    scriptArguments[1] !== "-c"
  ) {
    return undefined;
  }
  const inner = scriptArguments[2];
  const target = scriptArguments[3];
  return inner && target && isTemporaryLogPath(target) ? { inner, node, target } : undefined;
}

function unwrapObservedInnerCommand(inner: string, parser: Parser): PlannedRewrite {
  let innerTree: Parser.Tree;
  try {
    innerTree = parser.parse(inner);
  } catch {
    parser.reset();
    return { command: inner };
  }
  const innerRoot = innerTree.rootNode;
  if (
    innerRoot.hasError ||
    innerRoot.type !== "program" ||
    !hasOnlySequentialProgramSeparators(innerRoot) ||
    innerRoot.namedChildren.length === 0
  ) {
    return { command: inner };
  }
  const [primary, ...observers] = innerRoot.namedChildren;
  if (
    primary?.type !== "command" ||
    !observers.every((node) => isExitStatusObservation(node) || isFiniteSleepCommand(node))
  ) {
    return { command: inner };
  }
  return unwrapSimpleTimeout(primary);
}

interface DetachedTmuxCapture {
  inner: string;
  node: Parser.SyntaxNode;
  sessionName: string;
}

function detachedTmuxCapture(node: Parser.SyntaxNode): DetachedTmuxCapture | undefined {
  const command = commandParts(node);
  if (!command || command.name !== "tmux") return undefined;
  const args = command.arguments;
  if (args[0] !== "new-session" && args[0] !== "new") return undefined;

  let detached = false;
  let sessionName: string | undefined;
  let index = 1;
  for (; index < args.length - 1; index += 1) {
    const argument = args[index];
    if (argument === "-d") {
      detached = true;
      continue;
    }
    if (argument === "-s" && index + 1 < args.length - 1) {
      sessionName = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--") {
      index += 1;
      break;
    }
    return undefined;
  }
  if (!detached || !sessionName || index !== args.length - 1) return undefined;
  const inner = args[index];
  return inner ? { inner, node, sessionName } : undefined;
}

function tmuxCommandTargetsSession(arguments_: string[], sessionName: string): boolean {
  const targetIndex = arguments_.findIndex((argument) => argument === "-t");
  return targetIndex >= 0 && arguments_[targetIndex + 1] === sessionName;
}

function isTmuxObservation(node: Parser.SyntaxNode, sessionName: string): boolean {
  const command = commandParts(node);
  if (!command || command.name !== "tmux") return false;
  const operation = command.arguments[0];
  if (["ls", "list-sessions"].includes(operation ?? "")) return command.arguments.length === 1;
  return (
    ["capture-pane", "has-session", "display-message"].includes(operation ?? "") &&
    tmuxCommandTargetsSession(command.arguments, sessionName)
  );
}

function isTmuxObservationPipeline(node: Parser.SyntaxNode, sessionName: string): boolean {
  if (node.type !== "pipeline" || node.namedChildren.length < 2) return false;
  if (node.children.some((child) => !child.isNamed && child.type !== "|")) return false;
  const [tmux, ...filters] = node.namedChildren;
  if (!tmux || !isTmuxObservation(tmux, sessionName)) return false;
  return filters.every((filter) => {
    const command = commandParts(filter);
    return Boolean(
      command && ["grep", "head", "tail", "awk", "wc", "sed", "cut"].includes(command.name),
    );
  });
}

function isTmuxStatusObservation(node: Parser.SyntaxNode, sessionName: string): boolean {
  const command = commandParts(node);
  if (!command || (command.name !== "echo" && command.name !== "printf")) return false;
  const status = command.arguments.join(" ").toLowerCase();
  return status.includes("tmux") || status.includes(sessionName.toLowerCase());
}

function isTmuxCleanup(node: Parser.SyntaxNode, sessionName: string): boolean {
  const redirected = redirectedCommandParts(node);
  return Boolean(
    redirected &&
    redirected.command.name === "tmux" &&
    redirected.command.arguments[0] === "kill-session" &&
    tmuxCommandTargetsSession(redirected.command.arguments, sessionName) &&
    redirected.redirects.length > 0 &&
    redirected.redirects.every(isDevNullRedirect),
  );
}

/** Pulls a detached tmux command back into the Workbench PTY when the rest only inspects it. */
function detachedTmuxObservationRewrite(
  root: Parser.SyntaxNode,
  parser: Parser,
): PlannedRewrite | undefined {
  if (
    root.type !== "program" ||
    root.namedChildren.length < 2 ||
    root.children.some((child) => !child.isNamed && child.type !== ";")
  ) {
    return undefined;
  }
  const captures = root.namedChildren
    .map(detachedTmuxCapture)
    .filter((capture) => capture !== undefined);
  if (captures.length !== 1) return undefined;
  const [{ inner, node: captureNode, sessionName }] = captures;
  const observers = root.namedChildren.filter(
    (node) => node.startIndex !== captureNode.startIndex || node.endIndex !== captureNode.endIndex,
  );
  if (
    !observers.some(
      (node) =>
        isTmuxObservation(node, sessionName) || isTmuxObservationPipeline(node, sessionName),
    ) ||
    !observers.every(
      (node) =>
        isFiniteSleepCommand(node) ||
        isTmuxObservation(node, sessionName) ||
        isTmuxObservationPipeline(node, sessionName) ||
        isTmuxStatusObservation(node, sessionName) ||
        isTmuxCleanup(node, sessionName),
    )
  ) {
    return undefined;
  }
  return unwrapObservedInnerCommand(inner, parser);
}

/**
 * Detects an agent-created detached `script` recorder whose only consumers poll and read its log.
 * The nested command is returned to the Workbench-owned PTY so stdin remains attachable.
 */
function detachedScriptReadbackRewrite(
  root: Parser.SyntaxNode,
  parser: Parser,
): PlannedRewrite | undefined {
  if (root.type !== "program" || root.namedChildren.length < 2) return undefined;
  if (root.children.some((child) => !child.isNamed && child.type !== ";" && child.type !== "&")) {
    return undefined;
  }
  const captures = root.namedChildren
    .map((node) => detachedScriptCapture(root, node))
    .filter((capture) => capture !== undefined);
  if (captures.length !== 1) return undefined;
  const [{ inner, node: captureNode, target }] = captures;
  const observers = root.namedChildren.filter(
    (node) => node.startIndex !== captureNode.startIndex || node.endIndex !== captureNode.endIndex,
  );
  if (
    !observers.some((node) => isStrongBackgroundObservation(node, target)) ||
    !observers.every((node) => isBackgroundObservationScaffolding(node, target))
  ) {
    return undefined;
  }

  return unwrapObservedInnerCommand(inner, parser);
}

export class BashCommandPolicy {
  readonly #parser: Parser;

  constructor() {
    this.#parser = new Parser();
    this.#parser.setLanguage(Bash);
  }

  normalize(command: string): BashCommandPolicyResult {
    if (command.length === 0 || command.length > MAX_POLICY_COMMAND_LENGTH) return allow(command);

    let tree: Parser.Tree;
    try {
      tree = this.#parser.parse(command);
    } catch {
      this.#parser.reset();
      return allow(command);
    }

    const root = tree.rootNode;
    if (root.hasError) return allow(command);
    const structured =
      detachedTmuxObservationRewrite(root, this.#parser) ??
      detachedScriptReadbackRewrite(root, this.#parser) ??
      limitedPipelineReadbackRewrite(root);
    if (structured && structured.command !== command) return rewrite(command, structured);
    const normalized = redirectedReadbackRewrite(root) ?? teeReadbackRewrite(root);
    return normalized && normalized !== command
      ? rewrite(command, { command: normalized })
      : allow(command);
  }
}

export const bashCommandPolicy = new BashCommandPolicy();
