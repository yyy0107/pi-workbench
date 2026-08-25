"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import type {
  DataMessagePartComponent,
  EnrichedPartState,
  ToolCallMessagePartComponent,
} from "@assistant-ui/react";

import type {
  DataPresentationDefinition,
  DataRendererComponent,
  ToolPresentationDefinition,
  ToolRendererComponent,
  MessagePartRendererContribution,
} from "../api/renderer";
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
const EMPTY_PART_RENDERERS = Object.freeze(
  [],
) as readonly Readonly<MessagePartRendererContribution>[];

export function MessageRendererHost({ fallback = null }: { fallback?: ReactNode }) {
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
      resetKey={MessageRenderer}
      fallback={fallback}
    >
      <MessageRenderer />
    </ExtensionErrorBoundary>
  );
}

export function useMessagePartRenderers(): readonly Readonly<MessagePartRendererContribution>[] {
  const { manager } = useExtensionEnvironment();
  return useSyncExternalStore(
    manager.renderers.parts.subscribe,
    () => manager.renderers.parts.getAll(),
    () => EMPTY_PART_RENDERERS,
  );
}

export function MessagePartRendererHost({
  part,
  fallback = null,
}: {
  part: EnrichedPartState;
  fallback?: ReactNode;
}) {
  const renderers = useMessagePartRenderers();
  const { reportError } = useExtensionEnvironment();

  return (
    <ExtensionErrorBoundary
      key={JSON.stringify(renderers.map((renderer) => renderer.id))}
      contributionId="message-part-renderer.match"
      source="renderer"
      onError={reportError}
      resetKey={part}
      fallback={fallback}
    >
      <MatchedMessagePartRenderer part={part} renderers={renderers} fallback={fallback} />
    </ExtensionErrorBoundary>
  );
}

function MatchedMessagePartRenderer({
  part,
  renderers,
  fallback,
}: {
  part: EnrichedPartState;
  renderers: readonly Readonly<MessagePartRendererContribution>[];
  fallback: ReactNode;
}) {
  const { reportError } = useExtensionEnvironment();
  const contribution = renderers.find((renderer) => renderer.canRender(part));

  if (!contribution) return fallback;
  const PartRenderer = contribution.component;

  return (
    <ExtensionErrorBoundary
      contributionId={contribution.id}
      source="renderer"
      onError={reportError}
      resetKey={part}
      fallback={fallback}
    >
      <PartRenderer part={part} />
    </ExtensionErrorBoundary>
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
  part: EnrichedPartState;
  toolFallback?: ToolCallMessagePartComponent;
  dataFallback?: DataMessagePartComponent;
  children?: ReactNode;
}

export function RendererHost({
  part,
  toolFallback: ToolFallback,
  dataFallback: DataFallback,
  children = null,
}: RendererHostProps) {
  const toolRenderers = useToolRendererMap();
  const dataRenderers = useDataRendererMap();
  const { reportError } = useExtensionEnvironment();

  if (part.type === "tool-call") {
    const ToolRenderer = Object.hasOwn(toolRenderers, part.toolName)
      ? toolRenderers[part.toolName]
      : undefined;
    if (ToolRenderer) {
      return (
        <ExtensionErrorBoundary
          key={part.toolCallId}
          contributionId={`tool:${part.toolName}`}
          source="renderer"
          onError={reportError}
          resetKey={`${part.status.type}:${part.argsText}`}
        >
          <ToolRenderer {...part} />
        </ExtensionErrorBoundary>
      );
    }
    if (part.toolUI != null) return part.toolUI;
    if (ToolFallback) return <ToolFallback {...part} />;
    return children;
  }

  if (part.type === "data") {
    const DataRenderer = Object.hasOwn(dataRenderers, part.name)
      ? dataRenderers[part.name]
      : undefined;
    if (DataRenderer) {
      return (
        <ExtensionErrorBoundary
          contributionId={`data:${part.name}`}
          source="renderer"
          onError={reportError}
          resetKey={part.data}
        >
          <DataRenderer {...part} />
        </ExtensionErrorBoundary>
      );
    }
    if (part.dataRendererUI != null) return part.dataRendererUI;
    if (DataFallback) return <DataFallback {...part} />;
    return children;
  }

  return children;
}
