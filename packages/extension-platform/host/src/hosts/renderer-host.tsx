"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import type {
  DataPresentationDefinition,
  DataRendererComponent,
  MessageBlockNode,
  MessageBlockRendererContribution,
  MessageRendererNode,
  ToolPresentationDefinition,
  ToolRendererComponent,
} from "@workbench/extension-sdk";

import { useExtensionEnvironment } from "../extension-context";
import { ExtensionErrorBoundary } from "./extension-error-boundary";

const EMPTY_TOOL_RENDERERS = Object.freeze(Object.create(null)) as Readonly<
  Record<string, ToolRendererComponent>
>;
const EMPTY_DATA_RENDERERS = Object.freeze(Object.create(null)) as Readonly<
  Record<string, DataRendererComponent>
>;
const EMPTY_DATA_PRESENTATIONS = Object.freeze(Object.create(null)) as Readonly<
  Record<string, DataPresentationDefinition>
>;
const EMPTY_TOOL_PRESENTATIONS = Object.freeze(Object.create(null)) as Readonly<
  Record<string, ToolPresentationDefinition>
>;
const EMPTY_BLOCK_RENDERERS = Object.freeze(
  [],
) as readonly Readonly<MessageBlockRendererContribution>[];

export function MessageRendererHost({
  node,
  fallback = null,
}: Readonly<{ node: MessageRendererNode; fallback?: ReactNode }>) {
  const { manager, reportError } = useExtensionEnvironment();
  const contribution = useSyncExternalStore(
    manager.renderers.message.subscribe,
    () => manager.renderers.message.get(),
    () => undefined,
  );

  if (!contribution) return fallback;
  const MessageRenderer = contribution.component;

  return (
    <ExtensionErrorBoundary
      contributionId={contribution.id}
      source="renderer"
      onError={reportError}
      resetKey={node}
      fallback={fallback}
    >
      <MessageRenderer node={node} />
    </ExtensionErrorBoundary>
  );
}

export function useMessageBlockRenderers(): readonly Readonly<MessageBlockRendererContribution>[] {
  const { manager } = useExtensionEnvironment();
  return useSyncExternalStore(
    manager.renderers.blocks.subscribe,
    () => manager.renderers.blocks.getAll(),
    () => EMPTY_BLOCK_RENDERERS,
  );
}

export function useToolRendererMap(): Readonly<Record<string, ToolRendererComponent>> {
  const { manager } = useExtensionEnvironment();
  return useSyncExternalStore(
    manager.renderers.tools.subscribe,
    () => manager.renderers.tools.getComponentMap(),
    () => EMPTY_TOOL_RENDERERS,
  );
}

export function useDataRendererMap(): Readonly<Record<string, DataRendererComponent>> {
  const { manager } = useExtensionEnvironment();
  return useSyncExternalStore(
    manager.renderers.data.subscribe,
    () => manager.renderers.data.getComponentMap(),
    () => EMPTY_DATA_RENDERERS,
  );
}

export function useToolPresentationMap(): Readonly<Record<string, ToolPresentationDefinition>> {
  const { manager } = useExtensionEnvironment();
  return useSyncExternalStore(
    manager.renderers.toolPresentations.subscribe,
    () => manager.renderers.toolPresentations.getPresentationMap(),
    () => EMPTY_TOOL_PRESENTATIONS,
  );
}

export function useDataPresentationMap(): Readonly<Record<string, DataPresentationDefinition>> {
  const { manager } = useExtensionEnvironment();
  return useSyncExternalStore(
    manager.renderers.dataPresentations.subscribe,
    () => manager.renderers.dataPresentations.getPresentationMap(),
    () => EMPTY_DATA_PRESENTATIONS,
  );
}

export interface RendererHostProps {
  readonly node: MessageBlockNode;
  readonly block: MessageBlockNode["blocks"][number];
  readonly fallback?: ReactNode;
}

/** Resolve predicate renderers first, then exact Tool/Data renderers, then the caller fallback. */
export function RendererHost({ node, block, fallback = null }: RendererHostProps) {
  const renderers = useMessageBlockRenderers();
  const toolRenderers = useToolRendererMap();
  const dataRenderers = useDataRendererMap();
  const { reportError } = useExtensionEnvironment();

  return (
    <ExtensionErrorBoundary
      contributionId="message-block-renderer.match"
      source="renderer"
      onError={reportError}
      resetKey={block}
      fallback={fallback}
    >
      <MatchedRenderer
        node={node}
        block={block}
        renderers={renderers}
        toolRenderers={toolRenderers}
        dataRenderers={dataRenderers}
        fallback={fallback}
      />
    </ExtensionErrorBoundary>
  );
}

function MatchedRenderer({
  node,
  block,
  renderers,
  toolRenderers,
  dataRenderers,
  fallback,
}: RendererHostProps & {
  readonly renderers: readonly Readonly<MessageBlockRendererContribution>[];
  readonly toolRenderers: Readonly<Record<string, ToolRendererComponent>>;
  readonly dataRenderers: Readonly<Record<string, DataRendererComponent>>;
  readonly fallback: ReactNode;
}) {
  const { reportError } = useExtensionEnvironment();
  const contribution = renderers.find((renderer) => renderer.canRender(block));

  if (contribution) {
    const BlockRenderer = contribution.component;
    return (
      <ExtensionErrorBoundary
        contributionId={contribution.id}
        source="renderer"
        onError={reportError}
        resetKey={block}
        fallback={fallback}
      >
        <BlockRenderer node={node} block={block} fallback={fallback} />
      </ExtensionErrorBoundary>
    );
  }

  if (block.kind === "tool-call") {
    const ToolRenderer = Object.hasOwn(toolRenderers, block.toolName)
      ? toolRenderers[block.toolName]
      : undefined;
    return ToolRenderer ? (
      <ExtensionErrorBoundary
        contributionId={`tool:${block.toolName}`}
        source="renderer"
        onError={reportError}
        resetKey={block}
        fallback={fallback}
      >
        <ToolRenderer node={node} block={block} fallback={fallback} />
      </ExtensionErrorBoundary>
    ) : (
      fallback
    );
  }

  if (block.kind === "data") {
    const DataRenderer = Object.hasOwn(dataRenderers, block.name)
      ? dataRenderers[block.name]
      : undefined;
    return DataRenderer ? (
      <ExtensionErrorBoundary
        contributionId={`data:${block.name}`}
        source="renderer"
        onError={reportError}
        resetKey={block}
        fallback={fallback}
      >
        <DataRenderer node={node} block={block} fallback={fallback} />
      </ExtensionErrorBoundary>
    ) : (
      fallback
    );
  }

  return fallback;
}
