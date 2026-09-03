"use client";

import {
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type DataMessagePart,
  type DataMessagePartComponent,
  type EnrichedPartState,
  type ToolCallMessagePart,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import type { ComponentProps, ReactNode } from "react";

import type { DataBlock, ToolCallBlock } from "@workbench/agent-runtime-contracts/conversation";
import {
  MessagePartRendererHost,
  MessageRendererHost,
  RendererHost,
  useDataPresentationMap,
  useDataRendererMap,
  useToolPresentationMap,
  useToolRendererMap,
} from "@workbench/extension-host/hosts/renderer-host";

export function legacyToolPresentationPart(block: ToolCallBlock): ToolCallMessagePart {
  return {
    type: "tool-call",
    toolCallId: block.callId,
    toolName: block.toolName,
    args: (block.arguments ?? {}) as ToolCallMessagePart["args"],
    argsText: block.argumentsText,
    ...(block.result === undefined ? {} : { result: block.result }),
    ...(block.status === "error" ? { isError: true } : {}),
    ...(block.timing === undefined ? {} : { timing: block.timing }),
  };
}

export function legacyDataPresentationPart(block: DataBlock): DataMessagePart {
  return { type: "data", name: block.name, data: block.data };
}

export function LegacyMessageRendererHost({ fallback }: Readonly<{ fallback: ReactNode }>) {
  return <MessageRendererHost fallback={fallback} />;
}

export function LegacyConversationMessageByIndex(
  props: ComponentProps<typeof ThreadPrimitive.MessageByIndex>,
) {
  return <ThreadPrimitive.MessageByIndex {...props} />;
}

export function LegacyMessagePartRendererHost({
  fallback,
  part,
}: Readonly<{ fallback: ReactNode; part: EnrichedPartState }>) {
  return <MessagePartRendererHost part={part} fallback={fallback} />;
}

export function LegacyEnrichedToolDataRenderer({
  dataFallback,
  part,
  toolFallback,
}: Readonly<{
  dataFallback?: DataMessagePartComponent;
  part: Extract<EnrichedPartState, { type: "tool-call" | "data" }>;
  toolFallback?: ToolCallMessagePartComponent;
}>) {
  return <RendererHost part={part} toolFallback={toolFallback} dataFallback={dataFallback} />;
}

const LegacyTimelineToolDetail: ToolCallMessagePartComponent = (part) => {
  const RegisteredToolUI = useAuiState((state) => state.tools.toolUIs[part.toolName]?.[0]?.render);
  const toolUI = RegisteredToolUI ? <RegisteredToolUI {...part} /> : null;

  return <RendererHost part={{ ...part, toolUI }} />;
};

const LegacyTimelineDataDetail: DataMessagePartComponent = (part) => (
  <RendererHost part={{ ...part, dataRendererUI: null }} />
);

const LEGACY_TOOL_DATA_COMPONENTS = {
  tools: { Override: LegacyTimelineToolDetail },
  data: { Fallback: LegacyTimelineDataDetail },
};

/**
 * The single temporary bridge from Workbench blocks to assistant-ui extension renderers.
 * Remove it when the extension SDK accepts native Block renderer props.
 */
export function LegacyToolDataRenderer({
  block,
  fallback,
  partIndex,
}: Readonly<{
  block: ToolCallBlock | DataBlock;
  fallback: ReactNode;
  partIndex: number;
}>) {
  const toolRenderers = useToolRendererMap();
  const dataRenderers = useDataRendererMap();
  const matchesPart = useAuiState((state) => {
    const part = state.message.parts[partIndex];
    return block.kind === "tool-call"
      ? part?.type === "tool-call" && part.toolCallId === block.callId
      : part?.type === "data" && part.name === block.name;
  });
  const hasAssistantToolUI = useAuiState((state) =>
    block.kind === "tool-call"
      ? state.tools.toolUIs[block.toolName]?.[0]?.render !== undefined
      : false,
  );
  const hasRenderer =
    matchesPart &&
    (block.kind === "tool-call"
      ? Object.hasOwn(toolRenderers, block.toolName) || hasAssistantToolUI
      : Object.hasOwn(dataRenderers, block.name));

  return hasRenderer ? (
    <MessagePrimitive.PartByIndex index={partIndex} components={LEGACY_TOOL_DATA_COMPONENTS} />
  ) : (
    fallback
  );
}

export const useLegacyDataPresentationMap = useDataPresentationMap;
export const useLegacyToolPresentationMap = useToolPresentationMap;
