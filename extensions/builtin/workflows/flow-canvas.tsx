"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge as CanvasEdge,
  type EdgeChange,
  type EdgeMouseHandler,
  type Node as CanvasNode,
  type NodeChange,
  type NodeMouseHandler,
  type OnMoveEnd,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { FlowEdge, FlowNode, WorkflowDocument } from "@/runtime/shared/execution";

import {
  createCanvasEdge,
  createCanvasNode,
  NODE_ICONS,
  NODE_TYPES,
  type CanvasNodeData,
  type NodeLabels,
} from "./workflow-canvas-elements";
import { useWorkflowEditorStore } from "./workflow-state";

const LARGE_GRAPH_ELEMENT_THRESHOLD = 100;

function reconcileCanvasNodes(
  currentNodes: CanvasNode<CanvasNodeData>[],
  flowNodes: FlowNode[],
  nodeLabels: NodeLabels,
  selectedNodeId?: string,
): CanvasNode<CanvasNodeData>[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  let changed = currentNodes.length !== flowNodes.length;
  const nextNodes = flowNodes.map((flowNode, index) => {
    const current = currentById.get(flowNode.id);
    const label = flowNode.name === flowNode.type ? nodeLabels[flowNode.type] : flowNode.name;
    const typeLabel = nodeLabels[flowNode.type];
    const selected = selectedNodeId === flowNode.id;
    const deletable = flowNode.type !== "start" && flowNode.type !== "end";
    if (
      current &&
      currentNodes[index] === current &&
      current.position.x === flowNode.position.x &&
      current.position.y === flowNode.position.y &&
      current.selected === selected &&
      current.deletable === deletable &&
      current.data.label === label &&
      current.data.typeLabel === typeLabel &&
      current.data.type === flowNode.type
    ) {
      return current;
    }

    changed = true;
    return {
      ...current,
      id: flowNode.id,
      type: "workflow",
      position: flowNode.position,
      selected,
      deletable,
      data: { label, typeLabel, type: flowNode.type },
    };
  });
  return changed ? nextNodes : currentNodes;
}

function reconcileCanvasEdges(
  currentEdges: CanvasEdge[],
  flowEdges: FlowEdge[],
  selectedEdgeId?: string,
): CanvasEdge[] {
  const currentById = new Map(currentEdges.map((edge) => [edge.id, edge]));
  let changed = currentEdges.length !== flowEdges.length;
  const nextEdges = flowEdges.map((flowEdge, index) => {
    const current = currentById.get(flowEdge.id);
    const selected = selectedEdgeId === flowEdge.id;
    if (
      current &&
      currentEdges[index] === current &&
      current.source === flowEdge.source &&
      current.target === flowEdge.target &&
      current.sourceHandle === flowEdge.sourceHandle &&
      current.selected === selected
    ) {
      return current;
    }

    changed = true;
    return createCanvasEdge(flowEdge, selectedEdgeId);
  });
  return changed ? nextEdges : currentEdges;
}

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
  const nodeLabels = useMemo<NodeLabels>(
    () => ({
      start: t("extensions.workflows.node.start"),
      end: t("extensions.workflows.node.end"),
      agent: t("extensions.workflows.node.agent"),
      command: t("extensions.workflows.node.command"),
      condition: t("extensions.workflows.node.condition"),
      approval: t("extensions.workflows.node.approval"),
    }),
    [t],
  );
  const selectedNodeId = selection?.type === "node" ? selection.id : undefined;
  const selectedEdgeId = selection?.type === "edge" ? selection.id : undefined;
  const [nodes, setNodes] = useState<CanvasNode<CanvasNodeData>[]>(() =>
    document.graph.nodes.map((node) => createCanvasNode(node, nodeLabels, selectedNodeId)),
  );
  const [edges, setEdges] = useState<CanvasEdge[]>(() =>
    document.graph.edges.map((edge) => createCanvasEdge(edge, selectedEdgeId)),
  );
  const protectedNodeIds = useMemo(
    () =>
      new Set(
        document.graph.nodes
          .filter((node) => node.type === "start" || node.type === "end")
          .map((node) => node.id),
      ),
    [document.graph.nodes],
  );

  useEffect(() => {
    setNodes((current) =>
      reconcileCanvasNodes(current, document.graph.nodes, nodeLabels, selectedNodeId),
    );
  }, [document.graph.nodes, nodeLabels, selectedNodeId]);

  useEffect(() => {
    setEdges((current) => reconcileCanvasEdges(current, document.graph.edges, selectedEdgeId));
  }, [document.graph.edges, selectedEdgeId]);

  const updateNodes = useCallback(
    (changes: NodeChange<CanvasNode<CanvasNodeData>>[]) => {
      const allowed = changes.filter(
        (change) => change.type !== "remove" || !protectedNodeIds.has(change.id),
      );
      setNodes((current) => applyNodeChanges(allowed, current));

      const removedNodeIds = new Set(
        allowed.filter((change) => change.type === "remove").map((change) => change.id),
      );
      const completedPositions = new Map(
        allowed.flatMap((change) =>
          change.type === "position" && change.position && change.dragging !== true
            ? [[change.id, change.position] as const]
            : [],
        ),
      );
      if (removedNodeIds.size === 0 && completedPositions.size === 0) return;

      updateDocument((current) => ({
        ...current,
        graph: {
          ...current.graph,
          nodes: current.graph.nodes
            .filter((node) => !removedNodeIds.has(node.id))
            .map((node) => ({
              ...node,
              position: completedPositions.get(node.id) ?? node.position,
            })),
          edges: current.graph.edges.filter(
            (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
          ),
        },
      }));
      const currentSelection = useWorkflowEditorStore.getState().selection;
      if (currentSelection?.type === "node" && removedNodeIds.has(currentSelection.id)) {
        setSelection(undefined);
      }
    },
    [protectedNodeIds, setSelection, updateDocument],
  );

  const updateEdges = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      setEdges((current) => applyEdgeChanges(changes, current));
      const removedEdgeIds = new Set(
        changes.filter((change) => change.type === "remove").map((change) => change.id),
      );
      if (removedEdgeIds.size === 0) return;

      updateDocument((current) => ({
        ...current,
        graph: {
          ...current.graph,
          edges: current.graph.edges.filter((edge) => !removedEdgeIds.has(edge.id)),
        },
      }));
      const currentSelection = useWorkflowEditorStore.getState().selection;
      if (currentSelection?.type === "edge" && removedEdgeIds.has(currentSelection.id)) {
        setSelection(undefined);
      }
    },
    [setSelection, updateDocument],
  );

  const connect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target)
        return;
      const next = addEdge({ ...connection, id: globalThis.crypto.randomUUID() }, edges);
      if (next === edges) return;
      setEdges(next);
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

  const addNode = useCallback(
    (type: Exclude<FlowNode["type"], "start" | "end">) => {
      const node = newNode(type, nodeLabels[type], document.graph.nodes.length);
      updateDocument((current) => ({
        ...current,
        graph: { ...current.graph, nodes: [...current.graph.nodes, node] },
      }));
      setSelection({ type: "node", id: node.id });
    },
    [document.graph.nodes.length, nodeLabels, setSelection, updateDocument],
  );

  const selectNode = useCallback<NodeMouseHandler<CanvasNode<CanvasNodeData>>>(
    (_, node) => setSelection({ type: "node", id: node.id }),
    [setSelection],
  );
  const selectEdge = useCallback<EdgeMouseHandler<CanvasEdge>>(
    (_, edge) => setSelection({ type: "edge", id: edge.id }),
    [setSelection],
  );
  const clearSelection = useCallback(() => setSelection(undefined), [setSelection]);
  const updateViewport = useCallback<OnMoveEnd>(
    (_, viewport) => {
      const currentViewport = useWorkflowEditorStore.getState().document?.graph.editor.viewport;
      if (
        currentViewport?.x === viewport.x &&
        currentViewport.y === viewport.y &&
        currentViewport.zoom === viewport.zoom
      ) {
        return;
      }
      updateDocument((current) => ({
        ...current,
        graph: { ...current.graph, editor: { ...current.graph.editor, viewport } },
      }));
    },
    [updateDocument],
  );
  const onlyRenderVisibleElements = nodes.length + edges.length >= LARGE_GRAPH_ELEMENT_THRESHOLD;

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden bg-muted/20"
      aria-label={t("extensions.workflows.editor.canvasLabel")}
    >
      <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1 rounded-[var(--radius-lg)] border bg-background/95 p-1 shadow-sm">
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
        fitView={!document.graph.editor.viewport}
        defaultViewport={document.graph.editor.viewport}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onlyRenderVisibleElements={onlyRenderVisibleElements}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        onNodesChange={updateNodes}
        onEdgesChange={updateEdges}
        onConnect={connect}
        onNodeClick={selectNode}
        onEdgeClick={selectEdge}
        onPaneClick={clearSelection}
        onMoveEnd={updateViewport}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <MiniMap pannable zoomable className="!bg-background/90" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
