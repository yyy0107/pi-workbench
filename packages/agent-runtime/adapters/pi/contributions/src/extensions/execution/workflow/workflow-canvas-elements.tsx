"use client";

import { memo } from "react";
import {
  Handle,
  MarkerType,
  Position,
  type Edge as CanvasEdge,
  type Node as CanvasNode,
  type NodeProps,
} from "@xyflow/react";
import {
  BotIcon,
  CheckCircle2Icon,
  CircleStopIcon,
  GitForkIcon,
  PlayCircleIcon,
  SquareTerminalIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@workbench/shell/utils";
import type { FlowEdge, FlowNode } from "@workbench/execution-contracts";

export interface CanvasNodeData extends Record<string, unknown> {
  label: string;
  typeLabel: string;
  type: FlowNode["type"];
}

export type NodeLabels = Record<FlowNode["type"], string>;

export const NODE_ICONS: Record<FlowNode["type"], LucideIcon> = {
  start: PlayCircleIcon,
  end: CircleStopIcon,
  agent: BotIcon,
  command: SquareTerminalIcon,
  condition: GitForkIcon,
  approval: CheckCircle2Icon,
};

const EDGE_MARKER_END = { type: MarkerType.ArrowClosed } as const;

const FlowCanvasNode = memo(function FlowCanvasNode({
  data,
  selected,
}: NodeProps<CanvasNode<CanvasNodeData>>) {
  const Icon = NODE_ICONS[data.type];
  const isStart = data.type === "start";
  const isEnd = data.type === "end";
  const isCondition = data.type === "condition";
  return (
    <div
      className={cn(
        "bg-card text-card-foreground min-w-40 rounded-[var(--radius-lg)] border px-3 py-2 shadow-sm",
        selected ? "border-primary ring-primary/20 ring-2" : "border-border",
      )}
    >
      {!isStart ? <Handle type="target" position={Position.Left} /> : null}
      <div className="flex items-center gap-2">
        <span className="bg-muted flex size-7 items-center justify-center rounded-[var(--button-radius)]">
          <Icon aria-hidden="true" className="size-[var(--icon-size-md)]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{data.label}</span>
          <span className="text-muted-foreground block text-[11px]">{data.typeLabel}</span>
        </span>
      </div>
      {isCondition ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: "35%" }} />
          <Handle id="false" type="source" position={Position.Right} style={{ top: "70%" }} />
        </>
      ) : !isEnd ? (
        <Handle type="source" position={Position.Right} />
      ) : null}
    </div>
  );
});

export const NODE_TYPES = { workflow: FlowCanvasNode } as const;

export function createCanvasNode(
  node: FlowNode,
  nodeLabels: NodeLabels,
  selectedNodeId?: string,
): CanvasNode<CanvasNodeData> {
  return {
    id: node.id,
    type: "workflow",
    position: node.position,
    selected: selectedNodeId === node.id,
    deletable: node.type !== "start" && node.type !== "end",
    data: {
      label: node.name === node.type ? nodeLabels[node.type] : node.name,
      typeLabel: nodeLabels[node.type],
      type: node.type,
    },
  };
}

export function createCanvasEdge(edge: FlowEdge, selectedEdgeId?: string): CanvasEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    selected: selectedEdgeId === edge.id,
    markerEnd: EDGE_MARKER_END,
  };
}
