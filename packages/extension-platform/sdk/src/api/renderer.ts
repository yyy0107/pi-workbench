import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import type {
  AssistantMessageNode,
  DataBlock,
  MessageBlock,
  SystemNode,
  ToolCallBlock,
  UserMessageNode,
} from "@workbench/agent-runtime-contracts/conversation";

import type { Disposable } from "./disposable";
import type { LocalizableText } from "./localizable-text";

/** User and assistant Nodes that may be owned by the single Message Renderer. */
export type MessageRendererNode = UserMessageNode | AssistantMessageNode;

/** Block-bearing Nodes accepted by leaf renderers. */
export type MessageBlockNode = MessageRendererNode | SystemNode;

/** Props for an exact `toolName` renderer. Arguments may be partial while streaming. */
export interface ToolRendererProps {
  readonly node: MessageBlockNode;
  readonly block: ToolCallBlock;
  readonly fallback: ReactNode;
}

export type ToolRendererComponent = ComponentType<ToolRendererProps>;

/** Props for an exact `data.name` renderer. */
export interface DataRendererProps {
  readonly node: MessageBlockNode;
  readonly block: DataBlock;
  readonly fallback: ReactNode;
}

export type DataRendererComponent = ComponentType<DataRendererProps>;

/**
 * A controlled disclosure companion for a Tool Block in the message timeline.
 * It owns presentation state only; it must not execute or mutate the tool call.
 */
export interface ToolPresentationDisclosureControllerProps {
  readonly block: ToolCallBlock;
  readonly running: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export type ToolPresentationDisclosureController =
  ComponentType<ToolPresentationDisclosureControllerProps>;

/** Props for the single renderer that owns a complete user or assistant message body. */
export interface MessageRendererProps {
  readonly node: MessageRendererNode;
}

export type MessageRendererComponent = ComponentType<MessageRendererProps>;

/** Single-instance Message Renderer contribution. */
export interface MessageRendererContribution {
  /** Stable, non-localized id used for lifecycle and error isolation. */
  readonly id: string;
  readonly component: MessageRendererComponent;
}

export interface MessageRendererRegistry {
  register(contribution: MessageRendererContribution): Disposable;
  get(): MessageRendererContribution | undefined;
  subscribe(listener: () => void): () => void;
}

/** Props for a predicate-matched Message Block renderer. */
export interface MessageBlockRendererProps {
  readonly node: MessageBlockNode;
  readonly block: MessageBlock;
  readonly fallback: ReactNode;
}

export type MessageBlockRendererComponent = ComponentType<MessageBlockRendererProps>;

/**
 * A composable Message Block renderer. `canRender` runs during React render and must be pure and
 * tolerant of partial streaming data. The first matching contribution wins.
 */
export interface MessageBlockRendererContribution {
  readonly id: string;
  readonly canRender: (block: MessageBlock) => boolean;
  readonly component: MessageBlockRendererComponent;
}

export interface MessageBlockRendererRegistry {
  register(contribution: MessageBlockRendererContribution): Disposable;
  getAll(): readonly Readonly<MessageBlockRendererContribution>[];
  subscribe(listener: () => void): () => void;
}

/** Exact, case-sensitive named renderer registry shared by Tool and Data renderers. */
export interface NamedRendererRegistry<TComponent> {
  register(name: string, component: TComponent): Disposable;
  get(name: string): TComponent | undefined;
  getComponentMap(): Readonly<Record<string, TComponent>>;
  subscribe(listener: () => void): () => void;
}

/**
 * Lightweight timeline presentation for one Tool Block. These functions may run while arguments
 * are incomplete and must be pure. The renderer still owns the tool detail body.
 */
export interface ToolPresentationDefinition {
  readonly label: LocalizableText;
  readonly activeLabel: LocalizableText;
  readonly getActiveLabel?: (block: ToolCallBlock) => LocalizableText | undefined;
  readonly icon: LucideIcon;
  readonly summarize?: (block: ToolCallBlock) => LocalizableText | undefined;
  readonly disclosureController?: ToolPresentationDisclosureController;
}

export interface ToolPresentationRegistry {
  register(toolName: string, presentation: ToolPresentationDefinition): Disposable;
  get(toolName: string): ToolPresentationDefinition | undefined;
  getPresentationMap(): Readonly<Record<string, ToolPresentationDefinition>>;
  subscribe(listener: () => void): () => void;
}

/** Timeline placement for a named Data Block. */
export interface DataPresentationDefinition {
  readonly display: "timeline";
  readonly isVisible?: (block: DataBlock) => boolean;
  readonly isActive?: (block: DataBlock) => boolean;
  readonly group?: {
    readonly getKey: (block: DataBlock) => string | undefined;
    readonly label: LocalizableText;
    readonly activeLabel: LocalizableText;
    readonly icon: LucideIcon;
  };
}

export interface DataPresentationRegistry {
  register(dataName: string, presentation: DataPresentationDefinition): Disposable;
  get(dataName: string): DataPresentationDefinition | undefined;
  getPresentationMap(): Readonly<Record<string, DataPresentationDefinition>>;
  subscribe(listener: () => void): () => void;
}

/** Message presentation capabilities exposed to extensions. */
export interface RendererRegistry {
  /** Single renderer responsible for grouping the complete message body. */
  readonly message: MessageRendererRegistry;
  /** Ordered predicate renderers for arbitrary Message Blocks. */
  readonly blocks: MessageBlockRendererRegistry;
  /** Exact `toolName` renderers. */
  readonly tools: NamedRendererRegistry<ToolRendererComponent>;
  /** Exact `data.name` renderers. */
  readonly data: NamedRendererRegistry<DataRendererComponent>;
  readonly toolPresentations: ToolPresentationRegistry;
  readonly dataPresentations: DataPresentationRegistry;
}
