import type {
  Unstable_DirectiveFormatter,
  Unstable_DirectiveSegment,
  Unstable_TriggerItem,
} from "@assistant-ui/react";

import type {
  CompiledComposerRequest,
  ComposerCommandArgsBinding,
  ComposerCommandDefinition,
  ComposerCommandNode,
  ComposerCommandRegistry,
  ComposerCommandRequestDraft,
  ComposerDocument,
  ComposerDocumentNode,
  ComposerJsonValue,
} from "@/platform/extensions";

export const WORKBENCH_COMMAND_DIRECTIVE_TYPE = "workbench-command";
export const PI_COMMAND_DIRECTIVE_TYPE = "pi-command";
export const COMMAND_ARGUMENT_END_DIRECTIVE_TYPE = "workbench-command-argument-end";

const COMMAND_DIRECTIVE_RE =
  /:(workbench-command|pi-command|workbench-command-argument-end)\[([^|\]\n]{1,2048})\|([^\]\n]{1,4096})\]/gu;

function decodeDirectiveValue(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export const workbenchComposerDirectiveFormatter: Unstable_DirectiveFormatter = {
  serialize(item: Unstable_TriggerItem): string {
    if (
      item.type !== WORKBENCH_COMMAND_DIRECTIVE_TYPE &&
      item.type !== PI_COMMAND_DIRECTIVE_TYPE &&
      item.type !== COMMAND_ARGUMENT_END_DIRECTIVE_TYPE
    ) {
      throw new Error(`Unsupported Workbench directive type "${item.type}"`);
    }
    return `:${item.type}[${encodeURIComponent(item.id)}|${encodeURIComponent(item.label)}]`;
  },

  parse(text: string): readonly Unstable_DirectiveSegment[] {
    const segments: Unstable_DirectiveSegment[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(COMMAND_DIRECTIVE_RE)) {
      if (match.index > lastIndex) {
        segments.push({ kind: "text", text: text.slice(lastIndex, match.index) });
      }

      const id = decodeDirectiveValue(match[2]!);
      const label = decodeDirectiveValue(match[3]!);
      if (id && label) {
        segments.push({ kind: "mention", type: match[1]!, id, label });
      } else {
        segments.push({ kind: "text", text: match[0] });
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({ kind: "text", text: text.slice(lastIndex) });
    }
    return segments;
  },
};

type RegistryReader = Pick<ComposerCommandRegistry, "get">;

/** Serializable Pi command semantics supplied by the session-scoped command catalog. */
export interface ComposerCommandCompilationDescriptor {
  readonly invocationName: string;
  readonly exclusive: boolean;
  readonly argsBinding?: ComposerCommandArgsBinding;
}

function commandArgumentDescriptor(
  source: "workbench" | "pi",
  commandId: string,
  registry: RegistryReader | undefined,
  piCommands: ReadonlyMap<string, ComposerCommandCompilationDescriptor>,
): { binding?: ComposerCommandArgsBinding; exclusive: boolean; scope: "message" | "segment" } {
  const definition = registry?.get(commandId);
  const piCommand = source === "pi" ? piCommands.get(commandId) : undefined;
  const binding = definition?.composer.argsBinding ?? piCommand?.argsBinding;
  return {
    ...(binding ? { binding } : {}),
    exclusive: definition?.composer.exclusive ?? piCommand?.exclusive ?? false,
    scope: definition?.composer.scope ?? "message",
  };
}

export function parseComposerDocument(
  text: string,
  registry?: RegistryReader,
  _commandCatalog: readonly ComposerCommandCompilationDescriptor[] = [],
): ComposerDocument {
  const nodes: ComposerDocumentNode[] = [];
  let commandIndex = 0;

  const appendText = (value: string) => {
    if (!value) return;
    const previous = nodes.at(-1);
    if (previous?.type === "text")
      nodes[nodes.length - 1] = { ...previous, text: previous.text + value };
    else nodes.push({ type: "text", text: value });
  };

  for (const segment of workbenchComposerDirectiveFormatter.parse(text)) {
    if (segment.kind === "text") {
      appendText(segment.text);
      continue;
    }

    if (segment.type === COMMAND_ARGUMENT_END_DIRECTIVE_TYPE) {
      // Retained only so drafts written by the former inline-argument editor remain parseable.
      continue;
    }

    const source = segment.type === PI_COMMAND_DIRECTIVE_TYPE ? "pi" : "workbench";
    const commandNode: ComposerCommandNode = {
      type: "command",
      id: `command:${source}:${segment.id}:${commandIndex++}`,
      commandId: segment.id,
      label: segment.label,
      scope: registry?.get(segment.id)?.composer.scope ?? "message",
      source,
    };
    nodes.push(commandNode);
  }

  return Object.freeze(nodes);
}

export function composerCommandArgumentKey(
  source: ComposerCommandNode["source"],
  commandId: string,
): string {
  return `${source}:${commandId}`;
}

/** Applies parameter-panel values to command entities without rewriting ordinary Composer text. */
export function applyComposerCommandArguments(
  document: ComposerDocument,
  argumentsByCommand: Readonly<Record<string, ComposerJsonValue>>,
): ComposerDocument {
  return Object.freeze(
    document.map((node) => {
      if (node.type !== "command") return node;
      const args = argumentsByCommand[composerCommandArgumentKey(node.source, node.commandId)];
      return args === undefined ? node : { ...node, args };
    }),
  );
}

/** Removes the single editor buffer immediately following each atomic command token. */
export function composerDocumentText(document: ComposerDocument): string {
  let text = "";
  let removeNextBuffer = false;

  for (const node of document) {
    switch (node.type) {
      case "command":
        removeNextBuffer = true;
        break;
      case "command-argument":
        removeNextBuffer = true;
        break;
      case "text": {
        const value =
          removeNextBuffer && node.text.startsWith(" ") ? node.text.slice(1) : node.text;
        text += value;
        removeNextBuffer = false;
        break;
      }
      case "mention":
        text += node.label;
        removeNextBuffer = false;
        break;
      case "attachment":
        removeNextBuffer = false;
        break;
    }
  }

  return text;
}

/** Serializes the structural document without flattening command entities into slash text. */
export function composerDocumentSourceText(document: ComposerDocument): string {
  return document
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.text;
        case "command":
          return workbenchComposerDirectiveFormatter.serialize({
            id: node.commandId,
            type:
              node.source === "pi" ? PI_COMMAND_DIRECTIVE_TYPE : WORKBENCH_COMMAND_DIRECTIVE_TYPE,
            label: node.label,
          });
        case "command-argument":
          return node.text;
        case "mention":
          return node.label;
        case "attachment":
          return "";
      }
    })
    .join("");
}

function createDraft(document: ComposerDocument): ComposerCommandRequestDraft {
  return {
    text: composerDocumentText(document),
    context: [],
    metadata: {},
  };
}

function definitionFor(
  node: ComposerCommandNode,
  registry: RegistryReader,
): ComposerCommandDefinition {
  const definition = registry.get(node.commandId);
  if (!definition) {
    throw new Error(`Unknown Workbench composer command "${node.commandId}"`);
  }
  return definition;
}

function activeCommandIndexes(
  document: ComposerDocument,
  registry: RegistryReader,
): ReadonlySet<number> {
  const active = new Set<number>();
  const lastByGroup = new Map<string, number>();
  const lastModifierById = new Map<string, number>();

  for (let index = 0; index < document.length; index += 1) {
    const node = document[index];
    if (node?.type !== "command") continue;
    const definition = registry.get(node.commandId);
    if (!definition) {
      active.add(index);
      continue;
    }
    const group = definition.composer.group;
    if (group) lastByGroup.set(group, index);
    else if (definition.composer.behavior === "modifier") {
      lastModifierById.set(node.commandId, index);
    }
  }

  for (let index = 0; index < document.length; index += 1) {
    const node = document[index];
    if (node?.type !== "command") continue;
    const definition = registry.get(node.commandId);
    if (!definition) continue;
    const group = definition.composer.group;
    if (group && lastByGroup.get(group) !== index) continue;
    if (
      !group &&
      definition.composer.behavior === "modifier" &&
      lastModifierById.get(node.commandId) !== index
    ) {
      continue;
    }
    active.add(index);
  }

  return active;
}

function commandArgumentSemantics(
  node: ComposerCommandNode,
  registry: RegistryReader,
  piCommands: ReadonlyMap<string, ComposerCommandCompilationDescriptor>,
): { binding?: ComposerCommandArgsBinding; exclusive: boolean } {
  const descriptor = commandArgumentDescriptor(node.source, node.commandId, registry, piCommands);
  return {
    ...(descriptor.binding ? { binding: descriptor.binding } : {}),
    exclusive: descriptor.exclusive,
  };
}

function bindMessageTextArguments(
  document: ComposerDocument,
  activeIndexes: ReadonlySet<number>,
  registry: RegistryReader,
  piCommands: ReadonlyMap<string, ComposerCommandCompilationDescriptor>,
): { document: ComposerDocument; consumeText: boolean } {
  let owner:
    | { index: number; node: ComposerCommandNode; binding: ComposerCommandArgsBinding }
    | undefined;

  for (const index of activeIndexes) {
    const node = document[index];
    if (node?.type !== "command") continue;
    const semantics = commandArgumentSemantics(node, registry, piCommands);
    if (!semantics.binding) continue;
    if (!semantics.exclusive || node.scope !== "message") {
      throw new Error(
        `Composer command "${node.commandId}" message-text arguments require an exclusive message-level command`,
      );
    }
    if (owner) {
      throw new Error("Only one Composer command can own message-text arguments");
    }
    owner = { index, node, binding: semantics.binding };
  }

  if (!owner) return { document, consumeText: false };
  const structuredArguments = document.filter(
    (node): node is Extract<ComposerDocumentNode, { type: "command-argument" }> =>
      node.type === "command-argument" &&
      node.commandNodeId === owner.node.id &&
      node.field === owner.binding.field,
  );
  const hasStructuredArguments = structuredArguments.length > 0;
  const hasExplicitArguments = owner.node.args !== undefined;
  const argumentText = (
    hasStructuredArguments
      ? structuredArguments.map((node) => node.text).join("")
      : hasExplicitArguments
        ? ""
        : composerDocumentText(document)
  ).trim();
  const args =
    owner.node.args ??
    (hasStructuredArguments
      ? argumentText
        ? { [owner.binding.field]: argumentText }
        : {}
      : argumentText
        ? { [owner.binding.field]: argumentText }
        : undefined);
  if (args === undefined) {
    return {
      document,
      consumeText: !hasStructuredArguments && !hasExplicitArguments && owner.binding.consumeText,
    };
  }

  return {
    document: Object.freeze(
      document.map((node, index) =>
        index === owner.index && node.type === "command" ? { ...node, args } : node,
      ),
    ),
    consumeText: !hasStructuredArguments && !hasExplicitArguments && owner.binding.consumeText,
  };
}

export function compileComposerDocument(
  document: ComposerDocument,
  registry: RegistryReader,
  commandCatalog: readonly ComposerCommandCompilationDescriptor[] = [],
): CompiledComposerRequest {
  const activeIndexes = activeCommandIndexes(document, registry);
  const piCommands = new Map(commandCatalog.map((command) => [command.invocationName, command]));
  const bound = bindMessageTextArguments(document, activeIndexes, registry, piCommands);
  const compiledDocument = bound.document;
  const draft = createDraft(compiledDocument);
  if (bound.consumeText) draft.text = "";
  const commands: ComposerCommandNode[] = [];

  for (let index = 0; index < compiledDocument.length; index += 1) {
    const node = compiledDocument[index];
    if (node?.type !== "command") continue;

    const definition = registry.get(node.commandId);
    if (!definition && node.source === "pi") {
      commands.push(node);
      continue;
    }
    if (!definition) {
      throw new Error(`Unknown Workbench composer command "${node.commandId}"`);
    }
    if (!activeIndexes.has(index)) continue;
    if (definition.composer.behavior === "immediate") {
      throw new Error(`Immediate composer command "${node.commandId}" cannot be submitted`);
    }
    definition.composer.apply(draft, {
      phase: "submit",
      command: node,
      document: compiledDocument,
      index,
    });
    commands.push(node);
  }

  return Object.freeze({
    version: 1,
    document: Object.freeze(compiledDocument.map((node) => Object.freeze({ ...node }))),
    sourceText: composerDocumentSourceText(compiledDocument),
    text: draft.text,
    ...(draft.mode === undefined ? {} : { mode: draft.mode }),
    ...(draft.model === undefined ? {} : { model: draft.model }),
    context: Object.freeze([...draft.context]),
    metadata: Object.freeze({ ...draft.metadata }),
    commands: Object.freeze(commands),
  });
}

export function applyImmediateComposerCommand(
  document: ComposerDocument,
  commandIndex: number,
  registry: RegistryReader,
): void {
  const node = document[commandIndex];
  if (node?.type !== "command") {
    throw new Error("Immediate command selection did not resolve to a command node");
  }
  const definition = definitionFor(node, registry);
  if (definition.composer.behavior !== "immediate") {
    throw new Error(`Composer command "${node.commandId}" is not immediate`);
  }
  definition.composer.apply(createDraft(document), {
    phase: "selection",
    command: node,
    document,
    index: commandIndex,
  });
}
