"use client";

import {
  $applyNodeReplacement,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  DecoratorNode,
  DELETE_CHARACTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { createContext, useContext, useEffect, type FC, type ReactNode } from "react";

import type { ComposerJsonValue } from "@workbench/contracts/composer";

export interface ComposerTriggerItem {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, ComposerJsonValue>>;
}

export type ComposerDirectiveSegment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "mention";
      readonly type: string;
      readonly label: string;
      readonly id: string;
    };

export interface ComposerDirectiveFormatter {
  serialize(item: ComposerTriggerItem): string;
  parse(text: string): readonly ComposerDirectiveSegment[];
}

export interface DirectiveChipProps {
  readonly directiveId: string;
  readonly directiveType: string;
  readonly label: string;
}

const DirectiveChipContext = createContext<FC<DirectiveChipProps> | null>(null);
export const DirectiveChipProvider = DirectiveChipContext.Provider;

type SerializedDirectiveNode = Spread<
  {
    directiveId: string;
    directiveType: string;
    label: string;
    description?: string;
    metadata?: Readonly<Record<string, ComposerJsonValue>>;
    directiveText: string;
  },
  SerializedLexicalNode
>;

function DefaultDirectiveChip({ directiveId, directiveType, label }: DirectiveChipProps) {
  return (
    <span
      className="aui-directive-chip"
      data-directive-type={directiveType}
      data-directive-id={directiveId}
    >
      {label}
    </span>
  );
}

function DirectiveChipRenderer(props: DirectiveChipProps) {
  const Chip = useContext(DirectiveChipContext) ?? DefaultDirectiveChip;
  return <Chip {...props} />;
}

export class DirectiveNode extends DecoratorNode<ReactNode> {
  __directiveId: string;
  __directiveType: string;
  __label: string;
  __description?: string;
  __metadata?: Readonly<Record<string, ComposerJsonValue>>;
  __directiveText: string;

  static override getType(): string {
    return "workbench-directive";
  }

  static override clone(node: DirectiveNode): DirectiveNode {
    return new DirectiveNode(node.getDirectiveItem(), node.__directiveText, node.__key);
  }

  constructor(item: ComposerTriggerItem, directiveText: string, key?: NodeKey) {
    super(key);
    this.__directiveId = item.id;
    this.__directiveType = item.type;
    this.__label = item.label;
    this.__description = item.description;
    this.__metadata = item.metadata;
    this.__directiveText = directiveText;
  }

  static override importJSON(serialized: SerializedDirectiveNode): DirectiveNode {
    return $createDirectiveNode(
      {
        id: serialized.directiveId,
        type: serialized.directiveType,
        label: serialized.label,
        description: serialized.description,
        metadata: serialized.metadata,
      },
      serialized.directiveText,
    );
  }

  override exportJSON(): SerializedDirectiveNode {
    return {
      type: "workbench-directive",
      version: 1,
      directiveId: this.__directiveId,
      directiveType: this.__directiveType,
      label: this.__label,
      description: this.__description,
      metadata: this.__metadata,
      directiveText: this.__directiveText,
    };
  }

  override createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.style.display = "inline";
    span.contentEditable = "false";
    span.setAttribute("aria-label", this.__label);
    return span;
  }

  override updateDOM(): false {
    return false;
  }

  override exportDOM(_editor: LexicalEditor): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-directive-id", this.__directiveId);
    element.setAttribute("data-directive-type", this.__directiveType);
    element.setAttribute("data-directive-text", this.__directiveText);
    element.className = "aui-directive-chip";
    element.textContent = this.__label;
    return { element };
  }

  static override importDOM(): DOMConversionMap | null {
    return {
      span: (element: HTMLElement) => {
        const id = element.getAttribute("data-directive-id");
        if (!id) return null;
        return {
          conversion: (node: HTMLElement): DOMConversionOutput => ({
            node: $createDirectiveNode(
              {
                id,
                type: node.getAttribute("data-directive-type") ?? "",
                label: node.textContent ?? "",
              },
              node.getAttribute("data-directive-text") ?? node.textContent ?? "",
            ),
          }),
          priority: 1,
        };
      },
    };
  }

  override getTextContent(): string {
    return this.__directiveText;
  }

  override isInline(): boolean {
    return true;
  }

  override isIsolated(): boolean {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }

  override decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    return (
      <DirectiveChipRenderer
        directiveId={this.__directiveId}
        directiveType={this.__directiveType}
        label={this.__label}
      />
    );
  }

  getDirectiveItem(): ComposerTriggerItem {
    return {
      id: this.__directiveId,
      type: this.__directiveType,
      label: this.__label,
      description: this.__description,
      metadata: this.__metadata,
    };
  }
}

function $createDirectiveNode(item: ComposerTriggerItem, directiveText: string): DirectiveNode {
  return $applyNodeReplacement(new DirectiveNode(item, directiveText));
}

export function $createDirectiveNodeWithFormatter(
  item: ComposerTriggerItem,
  formatter: ComposerDirectiveFormatter,
): DirectiveNode {
  return $createDirectiveNode(item, formatter.serialize(item));
}

export function $isDirectiveNode(node: LexicalNode | null | undefined): node is DirectiveNode {
  return node instanceof DirectiveNode;
}

export function $insertDirectiveAtSelection(
  trigger: string,
  item: ComposerTriggerItem,
  formatter: ComposerDirectiveFormatter,
): DirectiveNode | undefined {
  const selection = $getSelection();
  if (
    !$isRangeSelection(selection) ||
    !selection.isCollapsed() ||
    selection.anchor.type !== "text"
  ) {
    return undefined;
  }
  const node = selection.anchor.getNode();
  if (!$isTextNode(node)) return undefined;
  const prefix = node.getTextContent().slice(0, selection.anchor.offset);
  const startOffset = prefix.lastIndexOf(trigger);
  if (startOffset < 0 || (startOffset > 0 && !/\s/u.test(prefix[startOffset - 1] ?? ""))) {
    return undefined;
  }

  const endOffset = selection.anchor.offset;
  const directive = $createDirectiveNodeWithFormatter(item, formatter);
  if (startOffset === 0 && endOffset === node.getTextContentSize()) {
    node.replace(directive);
  } else if (startOffset === 0) {
    const [left, right] = node.splitText(endOffset);
    right?.insertBefore(directive);
    left?.remove();
  } else {
    node.splitText(startOffset, endOffset)[1]?.replace(directive);
  }
  directive.selectNext();
  return directive;
}

function $removeSelectedDirectives(): boolean {
  const selection = $getSelection();
  if (!$isNodeSelection(selection)) return false;
  let handled = false;
  for (const node of selection.getNodes()) {
    if (!$isDirectiveNode(node)) continue;
    node.remove();
    handled = true;
  }
  return handled;
}

function $removeAdjacentDirective(backward: boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const anchor = selection.anchor;
  const node = anchor.getNode();
  if ($isTextNode(node)) {
    const atEdge = backward ? anchor.offset === 0 : anchor.offset === node.getTextContentSize();
    if (!atEdge) return false;
    const sibling = backward ? node.getPreviousSibling() : node.getNextSibling();
    if (!$isDirectiveNode(sibling)) return false;
    sibling.remove();
    return true;
  }
  if (!$isElementNode(node)) return false;
  const child = node.getChildAtIndex(backward ? anchor.offset - 1 : anchor.offset);
  if (!$isDirectiveNode(child)) return false;
  child.remove();
  return true;
}

export function ComposerDirectivePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const unregister = [
      editor.registerCommand(
        DELETE_CHARACTER_COMMAND,
        (backward) => $removeSelectedDirectives() || $removeAdjacentDirective(backward),
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          if (!$removeSelectedDirectives()) return false;
          event?.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        (event) => {
          if (!$removeSelectedDirectives()) return false;
          event?.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    ];
    return () => unregister.forEach((cleanup) => cleanup());
  }, [editor]);
  return null;
}
