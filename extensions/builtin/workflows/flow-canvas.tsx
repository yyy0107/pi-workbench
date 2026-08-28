"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useMemo } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge as CanvasEdge,
  type EdgeChange,
  type Node as CanvasNode,
  type NodeChange,
  type NodeProps,
  applyEdgeChanges,
  applyNodeChanges,
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

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { FlowEdge, FlowNode, WorkflowDocument } from "@/runtime/shared/execution";

import { useWorkflowEditorStore } from "./workflow-state";

interface CanvasNodeData extends Record<string, unknown> {
  label: string;
  typeLabel: string;
  type: FlowNode["type"];
}

const NODE_ICONS: Record<FlowNode["type"], LucideIcon> = {
  start: PlayCircleIcon,
  end: CircleStopIcon,
  agent: BotIcon,
  command: SquareTerminalIcon,
  condition: GitForkIcon,
  approval: CheckCircle2Icon,
};

function FlowCanvasNode({ data, selected }: NodeProps<CanvasNode<CanvasNodeData>>) {
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
}

const NODE_TYPES = { workflow: FlowCanvasNode } as const;

function newNode(
  type: Exclude<FlowNode["type"], "start" | "end">,
  name: string,
  index: number,
): FlowNode {
  const id = globalThis.crypto.randomUUID();
  const base = { id, name, position: { x: 260 + (index % 3) * 220, y: 80 + index * 70 } };
  switch (type) {
    case "agent":
      return { ...base, type, config: { prompt: "" } };
    case "command":
      return { ...base, type, config: { command: "" } };
    case "condition":
      return {
        ...base,
        type,
        config: { binding: { source: "run-input", path: "" }, operator: "exists" },
      };
    case "approval":
      return { ...base, type, config: { message: "Please approve this step." } };
  }
}

export function FlowCanvasCore({ document }: { document: WorkflowDocument }) {
  const { t } = useI18n();
  const updateDocument = useWorkflowEditorStore((state) => state.updateDocument);
  const setSelection = useWorkflowEditorStore((state) => state.setSelection);
  const selection = useWorkflowEditorStore((state) => state.selection);
  const nodeLabels: Record<FlowNode["type"], string> = {
    start: t("extensions.workflows.node.start"),
    end: t("extensions.workflows.node.end"),
    agent: t("extensions.workflows.node.agent"),
    command: t("extensions.workflows.node.command"),
    condition: t("extensions.workflows.node.condition"),
    approval: t("extensions.workflows.node.approval"),
  };
  const nodes = useMemo<CanvasNode<CanvasNodeData>[]>(
    () =>
      document.graph.nodes.map((node) => ({
        id: node.id,
        type: "workflow",
        position: node.position,
        selected: selection?.type === "node" && selection.id === node.id,
        data: {
          label: node.name === node.type ? nodeLabels[node.type] : node.name,
          typeLabel: nodeLabels[node.type],
          type: node.type,
        },
      })),
    [document.graph.nodes, nodeLabels, selection],
  );
  const edges = useMemo<CanvasEdge[]>(
    () =>
      document.graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        selected: selection?.type === "edge" && selection.id === edge.id,
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    [document.graph.edges, selection],
  );

  const updateNodes = useCallback(
    (changes: NodeChange<CanvasNode<CanvasNodeData>>[]) => {
      const semanticChanges = changes.filter(
        (change) => change.type === "position" || change.type === "remove",
      );
      if (semanticChanges.length === 0) return;
      const allowed = semanticChanges.filter((change) => {
        if (change.type !== "remove") return true;
        const node = document.graph.nodes.find(({ id }) => id === change.id);
        return node?.type !== "start" && node?.type !== "end";
      });
      const next = applyNodeChanges(allowed, nodes);
      updateDocument((current) => ({
        ...current,
        graph: {
          ...current.graph,
          nodes: current.graph.nodes
            .filter((node) => next.some(({ id }) => id === node.id))
            .map((node) => ({
              ...node,
              position: next.find(({ id }) => id === node.id)?.position ?? node.position,
            })),
          edges: current.graph.edges.filter(
            (edge) =>
              next.some(({ id }) => id === edge.source) &&
              next.some(({ id }) => id === edge.target),
          ),
        },
      }));
    },
    [document.graph.nodes, nodes, updateDocument],
  );

  const updateEdges = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      const next = applyEdgeChanges(changes, edges);
      updateDocument((current) => ({
        ...current,
        graph: {
          ...current.graph,
          edges: next.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            ...(edge.sourceHandle === "true" || edge.sourceHandle === "false"
              ? { sourceHandle: edge.sourceHandle }
              : {}),
          })),
        },
      }));
    },
    [edges, updateDocument],
  );

  const connect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target)
        return;
      const next = addEdge({ ...connection, id: globalThis.crypto.randomUUID() }, edges);
      updateDocument((current) => ({
        ...current,
        graph: {
          ...current.graph,
          edges: next.map((edge): FlowEdge => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            ...(edge.sourceHandle === "true" || edge.sourceHandle === "false"
              ? { sourceHandle: edge.sourceHandle }
              : {}),
          })),
        },
      }));
    },
    [edges, updateDocument],
  );

  const addNode = (type: Exclude<FlowNode["type"], "start" | "end">) => {
    const node = newNode(type, nodeLabels[type], document.graph.nodes.length);
    updateDocument((current) => ({
      ...current,
      graph: { ...current.graph, nodes: [...current.graph.nodes, node] },
    }));
    setSelection({ type: "node", id: node.id });
  };

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden bg-muted/20"
      aria-label={t("extensions.workflows.editor.canvasLabel")}
    >
      <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1 rounded-[var(--radius-lg)] border bg-background/95 p-1 shadow-sm backdrop-blur">
        {(["agent", "command", "condition", "approval"] as const).map((type) => {
          const Icon = NODE_ICONS[type];
          return (
            <Button key={type} variant="ghost" size="xs" onClick={() => addNode(type)}>
              <Icon aria-hidden="true" />
              {nodeLabels[type]}
            </Button>
          );
        })}
      </div>
      <ReactFlow
        fitView
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        onNodesChange={updateNodes}
        onEdgesChange={updateEdges}
        onConnect={connect}
        onNodeClick={(_, node) => setSelection({ type: "node", id: node.id })}
        onEdgeClick={(_, edge) => setSelection({ type: "edge", id: edge.id })}
        onPaneClick={() => setSelection(undefined)}
        onMoveEnd={(_, viewport) =>
          updateDocument((current) => ({
            ...current,
            graph: { ...current.graph, editor: { ...current.graph.editor, viewport } },
          }))
        }
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <MiniMap pannable zoomable className="!bg-background/90" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
