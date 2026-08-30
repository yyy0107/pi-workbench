import type {
  Unstable_DirectiveFormatter,
  Unstable_DirectiveSegment,
  Unstable_TriggerItem,
} from "@assistant-ui/react";

import {
  COMPOSER_CONVERSATION_CONTEXT_TYPE,
  COMPOSER_CONVERSATION_MENTION_TYPE,
  COMPOSER_WORKSPACE_FILE_CONTEXT_TYPE,
  COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
  isComposerJsonValue,
} from "@workbench/contracts/composer";
import type {
  CompiledComposerRequest,
  ComposerCommandArgsBinding,
  ComposerCommandDefinition,
  ComposerCommandNode,
  ComposerCommandRegistry,
  ComposerCommandRequestDraft,
  ComposerCommandSubmission,
  ComposerDocument,
  ComposerDocumentNode,
  ComposerJsonValue,
} from "@/platform/extensions";

export const WORKBENCH_COMMAND_DIRECTIVE_TYPE = "workbench-command";
export const AGENT_COMMAND_DIRECTIVE_TYPE = "agent-command";
export const AGENT_PROJECT_SKILL_DIRECTIVE_TYPE = "agent-project-skill";
export const AGENT_USER_SKILL_DIRECTIVE_TYPE = "agent-user-skill";
/** @deprecated Read-only compatibility for drafts persisted before the Agent boundary. */
export const PI_COMMAND_DIRECTIVE_TYPE = "pi-command";
/** @deprecated Read-only compatibility for drafts persisted before the Agent boundary. */
export const PI_PROJECT_SKILL_DIRECTIVE_TYPE = "pi-project-skill";
/** @deprecated Read-only compatibility for drafts persisted before the Agent boundary. */
export const PI_USER_SKILL_DIRECTIVE_TYPE = "pi-user-skill";
export const COMMAND_ARGUMENT_END_DIRECTIVE_TYPE = "workbench-command-argument-end";

const LEGACY_COMMAND_DIRECTIVE_RE =
  /:(workbench-command|agent-command|pi-command|workbench-command-argument-end)\[([^|\]\n]{1,2048})\|([^\]\n]{1,4096})\]/gu;
const COMMAND_LINK_RE =
  /\[\$((?:\\.|[^\]\\\n]){1,4096})\]\(command:\/\/(agent|workbench)\/([^\s?)#\n]{1,2048})(?:\?args=([^\s)#\n]{1,196608}))?\)/gu;
const SKILL_LINK_RE =
  /\[\$((?:\\.|[^\]\\\n]){1,4096})\]\(skill:\/\/(user|project)\/([^\s)\n]{1,2048})\)/gu;
const CONVERSATION_LINK_RE =
  /\[@((?:\\.|[^\]\\\n]){1,4096})\]\(conversation:\/\/([^\s)#\n]{1,2048})\)/gu;
const WORKSPACE_FILE_LINK_RE =
  /\[@((?:\\.|[^\]\\\n]){1,4096})\]\(workspace-file:\/\/([^\s)#\n]{1,65536})\)/gu;

export interface ComposerWorkspaceFileReference {
  readonly workspaceId: string;
  readonly relativePath: string;
}

type PersistedSkillScope = "project" | "user";

function persistedSkillScopeFromDirectiveType(type: string): PersistedSkillScope | undefined {
  if (type === AGENT_PROJECT_SKILL_DIRECTIVE_TYPE || type === PI_PROJECT_SKILL_DIRECTIVE_TYPE) {
    return "project";
  }
  if (type === AGENT_USER_SKILL_DIRECTIVE_TYPE || type === PI_USER_SKILL_DIRECTIVE_TYPE) {
    return "user";
  }
  return undefined;
}

export function agentSkillDirectiveType(
  scope: "project" | "temporary" | "user",
): typeof AGENT_PROJECT_SKILL_DIRECTIVE_TYPE | typeof AGENT_USER_SKILL_DIRECTIVE_TYPE | undefined {
  if (scope === "project") return AGENT_PROJECT_SKILL_DIRECTIVE_TYPE;
  if (scope === "user") return AGENT_USER_SKILL_DIRECTIVE_TYPE;
  return undefined;
}

export function isAgentComposerDirectiveType(type: string): boolean {
  return (
    type === AGENT_COMMAND_DIRECTIVE_TYPE ||
    type === AGENT_PROJECT_SKILL_DIRECTIVE_TYPE ||
    type === AGENT_USER_SKILL_DIRECTIVE_TYPE ||
    type === PI_COMMAND_DIRECTIVE_TYPE ||
    type === PI_PROJECT_SKILL_DIRECTIVE_TYPE ||
    type === PI_USER_SKILL_DIRECTIVE_TYPE
  );
}

function decodeDirectiveValue(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function escapeResourceLinkLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

function unescapeResourceLinkLabel(value: string): string {
  return value.replace(/\\([\\\]])/gu, "$1");
}

function encodeResourceLinkComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function composerWorkspaceFileMentionId(reference: ComposerWorkspaceFileReference): string {
  if (
    !reference.workspaceId ||
    reference.workspaceId.length > 2048 ||
    !reference.relativePath ||
    reference.relativePath.length > 16_384
  ) {
    throw new Error("Invalid Workspace file reference");
  }
  return encodeResourceLinkComponent(
    JSON.stringify([reference.workspaceId, reference.relativePath]),
  );
}

export function workspaceFileReferenceFromMentionId(
  value: string,
): ComposerWorkspaceFileReference | undefined {
  const decoded = decodeDirectiveValue(value);
  if (decoded === undefined) return undefined;
  try {
    const reference: unknown = JSON.parse(decoded);
    if (
      !Array.isArray(reference) ||
      reference.length !== 2 ||
      typeof reference[0] !== "string" ||
      !reference[0] ||
      reference[0].length > 2048 ||
      typeof reference[1] !== "string" ||
      !reference[1] ||
      reference[1].length > 16_384
    ) {
      return undefined;
    }
    return { workspaceId: reference[0], relativePath: reference[1] };
  } catch {
    return undefined;
  }
}

function isContextMentionType(type: string): boolean {
  return (
    type === COMPOSER_CONVERSATION_MENTION_TYPE || type === COMPOSER_WORKSPACE_FILE_MENTION_TYPE
  );
}

function skillNameFromInvocationName(invocationName: string): string | undefined {
  if (!invocationName.startsWith("skill:")) return undefined;
  const name = invocationName.slice("skill:".length);
  return name || undefined;
}

interface ParsedDirectiveMatch {
  readonly index: number;
  readonly end: number;
  readonly segment: Exclude<Unstable_DirectiveSegment, { readonly kind: "text" }> & {
    readonly args?: ComposerJsonValue;
  };
}

function commandLinkArgs(
  encoded: string | undefined,
): { readonly valid: true; readonly args?: ComposerJsonValue } | { readonly valid: false } {
  if (encoded === undefined) return { valid: true };
  const decoded = decodeDirectiveValue(encoded);
  if (decoded === undefined) return { valid: false };
  try {
    const args: unknown = JSON.parse(decoded);
    return isComposerJsonValue(args) ? { valid: true, args } : { valid: false };
  } catch {
    return { valid: false };
  }
}

function serializeCommandLink({
  id,
  label,
  source,
  args,
}: Readonly<{
  id: string;
  label: string;
  source: ComposerCommandNode["source"];
  args?: ComposerJsonValue;
}>): string {
  const target = `command://${source}/${encodeResourceLinkComponent(id)}`;
  const serializedArgs =
    args === undefined
      ? ""
      : `?args=${encodeResourceLinkComponent(JSON.stringify(args) ?? "null")}`;
  return `[$${escapeResourceLinkLabel(label)}](${target}${serializedArgs})`;
}

function parsedDirectiveMatches(text: string): readonly ParsedDirectiveMatch[] {
  const matches: ParsedDirectiveMatch[] = [];

  for (const match of text.matchAll(LEGACY_COMMAND_DIRECTIVE_RE)) {
    const id = decodeDirectiveValue(match[2]!);
    const label = decodeDirectiveValue(match[3]!);
    if (!id || !label) continue;
    matches.push({
      index: match.index,
      end: match.index + match[0].length,
      segment: { kind: "mention", type: match[1]!, id, label },
    });
  }

  for (const match of text.matchAll(COMMAND_LINK_RE)) {
    const label = unescapeResourceLinkLabel(match[1]!);
    const source = match[2] as ComposerCommandNode["source"];
    const id = decodeDirectiveValue(match[3]!);
    const parsedArgs = commandLinkArgs(match[4]);
    if (!label || !id || !parsedArgs.valid) continue;
    matches.push({
      index: match.index,
      end: match.index + match[0].length,
      segment: {
        kind: "mention",
        type: source === "agent" ? AGENT_COMMAND_DIRECTIVE_TYPE : WORKBENCH_COMMAND_DIRECTIVE_TYPE,
        id,
        label,
        ...(parsedArgs.args === undefined ? {} : { args: parsedArgs.args }),
      },
    });
  }

  for (const match of text.matchAll(SKILL_LINK_RE)) {
    const label = unescapeResourceLinkLabel(match[1]!);
    const scope = match[2] as PersistedSkillScope;
    const name = decodeDirectiveValue(match[3]!);
    if (!label || !name) continue;
    matches.push({
      index: match.index,
      end: match.index + match[0].length,
      segment: {
        kind: "mention",
        type:
          scope === "project"
            ? AGENT_PROJECT_SKILL_DIRECTIVE_TYPE
            : AGENT_USER_SKILL_DIRECTIVE_TYPE,
        id: `skill:${name}`,
        label,
      },
    });
  }

  for (const match of text.matchAll(CONVERSATION_LINK_RE)) {
    const label = unescapeResourceLinkLabel(match[1]!);
    const id = decodeDirectiveValue(match[2]!);
    if (!label || !id) continue;
    matches.push({
      index: match.index,
      end: match.index + match[0].length,
      segment: {
        kind: "mention",
        type: COMPOSER_CONVERSATION_MENTION_TYPE,
        id,
        label,
      },
    });
  }

  for (const match of text.matchAll(WORKSPACE_FILE_LINK_RE)) {
    const label = unescapeResourceLinkLabel(match[1]!);
    const reference = workspaceFileReferenceFromMentionId(match[2]!);
    if (!label || !reference) continue;
    matches.push({
      index: match.index,
      end: match.index + match[0].length,
      segment: {
        kind: "mention",
        type: COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
        id: composerWorkspaceFileMentionId(reference),
        label,
      },
    });
  }

  return matches.toSorted((left, right) => left.index - right.index);
}

export const workbenchComposerDirectiveFormatter: Unstable_DirectiveFormatter = {
  serialize(item: Unstable_TriggerItem): string {
    if (item.type === COMPOSER_CONVERSATION_MENTION_TYPE) {
      return `[@${escapeResourceLinkLabel(item.label)}](conversation://${encodeResourceLinkComponent(item.id)})`;
    }
    if (item.type === COMPOSER_WORKSPACE_FILE_MENTION_TYPE) {
      const reference = workspaceFileReferenceFromMentionId(item.id);
      if (!reference) throw new Error(`Invalid Workspace file mention "${item.id}"`);
      return `[@${escapeResourceLinkLabel(item.label)}](workspace-file://${composerWorkspaceFileMentionId(reference)})`;
    }
    const skillScope = persistedSkillScopeFromDirectiveType(item.type);
    if (skillScope) {
      const skillName = skillNameFromInvocationName(item.id);
      if (!skillName) {
        throw new Error(`Invalid Skill invocation name "${item.id}"`);
      }
      return `[$${escapeResourceLinkLabel(item.label)}](skill://${skillScope}/${encodeResourceLinkComponent(skillName)})`;
    }
    if (item.type === COMMAND_ARGUMENT_END_DIRECTIVE_TYPE) {
      return `:${item.type}[${encodeURIComponent(item.id)}|${encodeURIComponent(item.label)}]`;
    }
    const source =
      item.type === WORKBENCH_COMMAND_DIRECTIVE_TYPE
        ? "workbench"
        : item.type === AGENT_COMMAND_DIRECTIVE_TYPE || item.type === PI_COMMAND_DIRECTIVE_TYPE
          ? "agent"
          : undefined;
    if (!source) {
      throw new Error(`Unsupported Workbench directive type "${item.type}"`);
    }
    return serializeCommandLink({ id: item.id, label: item.label, source });
  },

  parse(text: string): readonly Unstable_DirectiveSegment[] {
    const segments: Unstable_DirectiveSegment[] = [];
    let lastIndex = 0;

    for (const match of parsedDirectiveMatches(text)) {
      if (match.index < lastIndex) continue;
      if (match.index > lastIndex) {
        segments.push({ kind: "text", text: text.slice(lastIndex, match.index) });
      }
      segments.push(match.segment);
      lastIndex = match.end;
    }

    if (lastIndex < text.length) {
      segments.push({ kind: "text", text: text.slice(lastIndex) });
    }
    return segments;
  },
};

type RegistryReader = Pick<ComposerCommandRegistry, "get">;

/** Serializable Agent command semantics supplied by the active Runtime's command catalog. */
export interface ComposerCommandCompilationDescriptor {
  readonly invocationName: string;
  readonly exclusive: boolean;
  readonly argsBinding?: ComposerCommandArgsBinding;
  readonly kind?: "builtin" | "extension" | "prompt" | "skill";
  readonly source?: { readonly scope: "project" | "temporary" | "user" };
}

function commandResourceScope(
  command: ComposerCommandCompilationDescriptor,
): "project" | "temporary" | "user" | undefined {
  return command.source?.scope;
}

function commandArgumentDescriptor(
  source: ComposerCommandNode["source"],
  commandId: string,
  registry: RegistryReader | undefined,
  agentCommands: ReadonlyMap<string, ComposerCommandCompilationDescriptor>,
): { binding?: ComposerCommandArgsBinding; exclusive: boolean; scope: "message" | "segment" } {
  const definition = registry?.get(commandId);
  const agentCommand = source === "agent" ? agentCommands.get(commandId) : undefined;
  const binding = definition?.composer.argsBinding ?? agentCommand?.argsBinding;
  return {
    ...(binding ? { binding } : {}),
    exclusive: definition?.composer.exclusive ?? agentCommand?.exclusive ?? false,
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
  let mentionIndex = 0;

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

    if (isContextMentionType(segment.type)) {
      nodes.push({
        type: "mention",
        id: `mention:${segment.type}:${segment.id}:${mentionIndex++}`,
        mentionType: segment.type,
        value: segment.id,
        label: segment.label,
      });
      continue;
    }

    const source = isAgentComposerDirectiveType(segment.type) ? "agent" : "workbench";
    const args = (segment as typeof segment & { readonly args?: ComposerJsonValue }).args;
    const commandNode: ComposerCommandNode = {
      type: "command",
      id: `command:${source}:${segment.id}:${commandIndex++}`,
      commandId: segment.id,
      label: segment.label,
      scope: registry?.get(segment.id)?.composer.scope ?? "message",
      source,
      ...(args === undefined ? {} : { args }),
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
        text += isContextMentionType(node.mentionType) ? `@${node.label}` : node.label;
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
export function composerDocumentSourceText(
  document: ComposerDocument,
  commandCatalog: readonly ComposerCommandCompilationDescriptor[] = [],
): string {
  const agentCommands = new Map(commandCatalog.map((command) => [command.invocationName, command]));
  return document
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.text;
        case "command": {
          const agentCommand =
            node.source === "agent" ? agentCommands.get(node.commandId) : undefined;
          const resourceScope = agentCommand ? commandResourceScope(agentCommand) : undefined;
          const skillType =
            agentCommand?.kind === "skill" && resourceScope
              ? agentSkillDirectiveType(resourceScope)
              : undefined;
          return skillType
            ? workbenchComposerDirectiveFormatter.serialize({
                id: node.commandId,
                type: skillType,
                label: node.label,
              })
            : serializeCommandLink({
                id: node.commandId,
                label: node.label,
                source: node.source,
                ...(node.args === undefined ? {} : { args: node.args }),
              });
        }
        case "command-argument":
          return node.text;
        case "mention":
          return isContextMentionType(node.mentionType)
            ? workbenchComposerDirectiveFormatter.serialize({
                id: node.value,
                type: node.mentionType,
                label: node.label,
              })
            : node.label;
        case "attachment":
          return "";
      }
    })
    .join("");
}

function createDraft(document: ComposerDocument): ComposerCommandRequestDraft {
  const referencedConversations = new Set<string>();
  const referencedWorkspaceFiles = new Set<string>();
  const context: ComposerCommandRequestDraft["context"] = [];
  for (const node of document) {
    if (node.type !== "mention") continue;
    if (node.mentionType === COMPOSER_CONVERSATION_MENTION_TYPE) {
      if (referencedConversations.has(node.value)) continue;
      referencedConversations.add(node.value);
      context.push({
        type: COMPOSER_CONVERSATION_CONTEXT_TYPE,
        value: {
          version: 1,
          conversationId: node.value,
          title: node.label,
        },
      });
      continue;
    }
    if (node.mentionType !== COMPOSER_WORKSPACE_FILE_MENTION_TYPE) continue;
    const reference = workspaceFileReferenceFromMentionId(node.value);
    if (!reference) continue;
    const referenceKey = `${reference.workspaceId}\0${reference.relativePath}`;
    if (referencedWorkspaceFiles.has(referenceKey)) continue;
    referencedWorkspaceFiles.add(referenceKey);
    context.push({
      type: COMPOSER_WORKSPACE_FILE_CONTEXT_TYPE,
      value: {
        version: 1,
        workspaceId: reference.workspaceId,
        relativePath: reference.relativePath,
        name: node.label,
      },
    });
  }

  return {
    text: composerDocumentText(document),
    context,
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

function commandSubmission(node: ComposerCommandNode): ComposerCommandSubmission {
  const { inactive: _inactive, type: _type, ...submission } = node;
  return submission;
}

function markInactiveCommands(
  document: ComposerDocument,
  activeIndexes: ReadonlySet<number>,
): ComposerDocument {
  return Object.freeze(
    document.map((node, index) => {
      if (node.type !== "command") return node;
      if (!activeIndexes.has(index)) return { ...node, inactive: true as const };
      if (node.inactive === undefined) return node;
      const { inactive: _inactive, ...activeNode } = node;
      return activeNode;
    }),
  );
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
  agentCommands: ReadonlyMap<string, ComposerCommandCompilationDescriptor>,
): { binding?: ComposerCommandArgsBinding; exclusive: boolean } {
  const descriptor = commandArgumentDescriptor(
    node.source,
    node.commandId,
    registry,
    agentCommands,
  );
  return {
    ...(descriptor.binding ? { binding: descriptor.binding } : {}),
    exclusive: descriptor.exclusive,
  };
}

function bindMessageTextArguments(
  document: ComposerDocument,
  activeIndexes: ReadonlySet<number>,
  registry: RegistryReader,
  agentCommands: ReadonlyMap<string, ComposerCommandCompilationDescriptor>,
): { document: ComposerDocument; consumeText: boolean } {
  let owner:
    | { index: number; node: ComposerCommandNode; binding: ComposerCommandArgsBinding }
    | undefined;

  for (const index of activeIndexes) {
    const node = document[index];
    if (node?.type !== "command") continue;
    const semantics = commandArgumentSemantics(node, registry, agentCommands);
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
  const agentCommands = new Map(commandCatalog.map((command) => [command.invocationName, command]));
  const bound = bindMessageTextArguments(document, activeIndexes, registry, agentCommands);
  const compiledDocument = markInactiveCommands(bound.document, activeIndexes);
  const draft = createDraft(compiledDocument);
  if (bound.consumeText) draft.text = "";
  const commands: ComposerCommandSubmission[] = [];

  for (let index = 0; index < compiledDocument.length; index += 1) {
    const node = compiledDocument[index];
    if (node?.type !== "command") continue;

    const definition = registry.get(node.commandId);
    if (!definition && node.source === "agent") {
      commands.push(commandSubmission(node));
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
    commands.push(commandSubmission(node));
  }

  return Object.freeze({
    version: 2,
    document: Object.freeze(compiledDocument.map((node) => Object.freeze({ ...node }))),
    sourceText: composerDocumentSourceText(compiledDocument, commandCatalog),
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
