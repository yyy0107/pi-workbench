"use client";

import "@xyflow/react/dist/style.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  type ReactFlowInstance,
  type XYPosition,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react";
import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
const ADDABLE_NODE_TYPES = ["agent", "command", "condition", "approval"] as const;
const PALETTE_DRAG_THRESHOLD = 4;

type AddableNodeType = (typeof ADDABLE_NODE_TYPES)[number];

interface PaletteNodeDrag {
  type: AddableNodeType;
  pointerId: number;
  start: XYPosition;
  current: XYPosition;
  dragging: boolean;
}

interface CanvasContextMenuTarget {
  position: XYPosition;
  selection?: {
    type: "node" | "edge";
    id: string;
    deletable: boolean;
  };
}

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
  type: AddableNodeType,
  name: string,
  index: number,
  position?: XYPosition,
): FlowNode {
  const id = globalThis.crypto.randomUUID();
  const base = {
    id,
    name,
    position: position ?? { x: 260 + (index % 3) * 220, y: 80 + index * 70 },
  };
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

export function FlowCanvasCore({
  document,
  onNodeSelect,
}: {
  document: WorkflowDocument;
  onNodeSelect(): void;
}) {
  const { t } = useI18n();
  const reactFlowElementRef = useRef<HTMLDivElement>(null);
  const reactFlowInstanceRef = useRef<ReactFlowInstance<
    CanvasNode<CanvasNodeData>,
    CanvasEdge
  > | null>(null);
  const paletteNodeDragRef = useRef<PaletteNodeDrag | null>(null);
  const suppressNextPaletteClickRef = useRef(false);
  const [paletteNodeDrag, setPaletteNodeDrag] = useState<PaletteNodeDrag | null>(null);
  const [contextMenuTarget, setContextMenuTarget] = useState<CanvasContextMenuTarget>({
    position: { x: 0, y: 0 },
  });
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
    (type: AddableNodeType, position?: XYPosition) => {
      const node = newNode(type, nodeLabels[type], document.graph.nodes.length, position);
      updateDocument((current) => ({
        ...current,
        graph: { ...current.graph, nodes: [...current.graph.nodes, node] },
      }));
      setSelection({ type: "node", id: node.id });
      onNodeSelect();
    },
    [document.graph.nodes.length, nodeLabels, onNodeSelect, setSelection, updateDocument],
  );

  const activatePaletteNode = useCallback(
    (type: AddableNodeType) => {
      if (suppressNextPaletteClickRef.current) {
        suppressNextPaletteClickRef.current = false;
        return;
      }
      addNode(type);
    },
    [addNode],
  );
  const beginPaletteNodeDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, type: AddableNodeType) => {
      if (!event.isPrimary || event.button !== 0) return;

      paletteNodeDragRef.current = {
        type,
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        current: { x: event.clientX, y: event.clientY },
        dragging: false,
      };
    },
    [],
  );
  const movePaletteNodeDrag = useCallback((event: PointerEvent) => {
    const drag = paletteNodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const current = { x: event.clientX, y: event.clientY };
    const dragging =
      drag.dragging ||
      Math.hypot(current.x - drag.start.x, current.y - drag.start.y) >= PALETTE_DRAG_THRESHOLD;
    const nextDrag = { ...drag, current, dragging };
    paletteNodeDragRef.current = nextDrag;
    if (!dragging) return;

    event.preventDefault();
    setPaletteNodeDrag(nextDrag);
  }, []);
  const finishPaletteNodeDrag = useCallback(
    (event: PointerEvent) => {
      const drag = paletteNodeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      paletteNodeDragRef.current = null;
      setPaletteNodeDrag(null);
      if (!drag.dragging) return;

      event.preventDefault();
      suppressNextPaletteClickRef.current = true;
      globalThis.setTimeout(() => {
        suppressNextPaletteClickRef.current = false;
      }, 0);

      const reactFlowElement = reactFlowElementRef.current;
      const reactFlowInstance = reactFlowInstanceRef.current;
      if (!reactFlowElement || !reactFlowInstance) return;
      const bounds = reactFlowElement.getBoundingClientRect();
      const isInsideCanvas =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      if (!isInsideCanvas) return;

      addNode(
        drag.type,
        reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
    },
    [addNode],
  );
  const cancelPaletteNodeDrag = useCallback((event: PointerEvent) => {
    const drag = paletteNodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    paletteNodeDragRef.current = null;
    setPaletteNodeDrag(null);
  }, []);

  const getContextMenuPosition = useCallback((event: { clientX: number; clientY: number }) => {
    const position = { x: event.clientX, y: event.clientY };
    return reactFlowInstanceRef.current?.screenToFlowPosition(position) ?? position;
  }, []);
  const openPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".react-flow__node, .react-flow__edge")) {
        return;
      }

      setSelection(undefined);
      setContextMenuTarget({ position: getContextMenuPosition(event) });
    },
    [getContextMenuPosition, setSelection],
  );
  const openNodeContextMenu = useCallback<NodeMouseHandler<CanvasNode<CanvasNodeData>>>(
    (event, node) => {
      setSelection({ type: "node", id: node.id });
      onNodeSelect();
      setContextMenuTarget({
        position: getContextMenuPosition(event),
        selection: {
          type: "node",
          id: node.id,
          deletable: !protectedNodeIds.has(node.id),
        },
      });
    },
    [getContextMenuPosition, onNodeSelect, protectedNodeIds, setSelection],
  );
  const openEdgeContextMenu = useCallback<EdgeMouseHandler<CanvasEdge>>(
    (event, edge) => {
      setSelection({ type: "edge", id: edge.id });
      setContextMenuTarget({
        position: getContextMenuPosition(event),
        selection: { type: "edge", id: edge.id, deletable: true },
      });
    },
    [getContextMenuPosition, setSelection],
  );
  const deleteContextMenuSelection = useCallback(() => {
    const target = contextMenuTarget.selection;
    if (!target?.deletable) return;

    if (target.type === "node") {
      updateNodes([{ id: target.id, type: "remove" }]);
    } else {
      updateEdges([{ id: target.id, type: "remove" }]);
    }
    setContextMenuTarget((current) => ({ position: current.position }));
  }, [contextMenuTarget.selection, updateEdges, updateNodes]);

  useEffect(() => {
    window.addEventListener("pointermove", movePaletteNodeDrag, { passive: false });
    window.addEventListener("pointerup", finishPaletteNodeDrag);
    window.addEventListener("pointercancel", cancelPaletteNodeDrag);
    return () => {
      window.removeEventListener("pointermove", movePaletteNodeDrag);
      window.removeEventListener("pointerup", finishPaletteNodeDrag);
      window.removeEventListener("pointercancel", cancelPaletteNodeDrag);
    };
  }, [cancelPaletteNodeDrag, finishPaletteNodeDrag, movePaletteNodeDrag]);

  const selectNode = useCallback<NodeMouseHandler<CanvasNode<CanvasNodeData>>>(
    (_, node) => {
      setSelection({ type: "node", id: node.id });
      onNodeSelect();
    },
    [onNodeSelect, setSelection],
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
  const DraggedNodeIcon = paletteNodeDrag ? NODE_ICONS[paletteNodeDrag.type] : undefined;

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden bg-muted/20"
      aria-label={t("extensions.workflows.editor.canvasLabel")}
    >
      <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1 rounded-[var(--radius-lg)] border bg-background/95 p-1 shadow-sm">
        {ADDABLE_NODE_TYPES.map((type) => {
          const Icon = NODE_ICONS[type];
          return (
            <Button
              key={type}
              variant="ghost"
              size="xs"
              className="cursor-grab touch-none active:cursor-grabbing"
              onClick={() => activatePaletteNode(type)}
              onPointerDown={(event) => beginPaletteNodeDrag(event, type)}
            >
              <Icon aria-hidden="true" />
              {nodeLabels[type]}
            </Button>
          );
        })}
      </div>
      {paletteNodeDrag && DraggedNodeIcon ? (
        <div
          aria-hidden="true"
          className="border-border bg-card text-card-foreground pointer-events-none fixed top-0 left-0 z-50 flex h-[var(--button-height-default)] items-center gap-2 rounded-[var(--button-radius)] border px-2.5 text-sm font-medium shadow-lg will-change-transform"
          style={{
            transform: `translate3d(${paletteNodeDrag.current.x + 12}px, ${paletteNodeDrag.current.y + 12}px, 0)`,
          }}
        >
          <DraggedNodeIcon className="size-[var(--icon-size-sm)]" />
          {nodeLabels[paletteNodeDrag.type]}
        </div>
      ) : null}
      <ContextMenu>
        <ContextMenuTrigger className="block h-full w-full">
          <ReactFlow
            ref={reactFlowElementRef}
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
            onNodeContextMenu={openNodeContextMenu}
            onEdgeContextMenu={openEdgeContextMenu}
            onPaneContextMenu={openPaneContextMenu}
            onMoveEnd={updateViewport}
            onInit={(instance) => {
              reactFlowInstanceRef.current = instance;
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <MiniMap
              pannable
              zoomable
              bgColor="var(--background)"
              maskColor="color-mix(in oklab, var(--muted) 60%, transparent)"
              maskStrokeColor="var(--border)"
              nodeColor="var(--muted-foreground)"
              nodeStrokeColor="var(--border)"
              className="border-border overflow-hidden rounded-[var(--button-radius)] border shadow-sm!"
            />
            <Controls
              showInteractive={false}
              className="border-border bg-background/95 overflow-hidden rounded-[var(--button-radius)] border shadow-sm! [--xy-controls-button-background-color:transparent] [--xy-controls-button-background-color-hover:var(--button-background-hover)] [--xy-controls-button-border-color:var(--border)] [--xy-controls-button-color-hover:var(--foreground)] [--xy-controls-button-color:var(--foreground)] [&_.react-flow__controls-button]:size-[var(--icon-frame-size-default)]! [&_.react-flow__controls-button_svg]:size-[var(--icon-size-sm)]! [&_.react-flow__controls-button_svg]:max-h-none! [&_.react-flow__controls-button_svg]:max-w-none!"
            />
          </ReactFlow>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {ADDABLE_NODE_TYPES.map((type) => {
            const Icon = NODE_ICONS[type];
            return (
              <ContextMenuItem key={type} onClick={() => addNode(type, contextMenuTarget.position)}>
                <Icon aria-hidden="true" />
                {nodeLabels[type]}
              </ContextMenuItem>
            );
          })}
          {contextMenuTarget.selection ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                disabled={!contextMenuTarget.selection.deletable}
                onClick={deleteContextMenuSelection}
              >
                <Trash2Icon aria-hidden="true" />
                {t("extensions.workflows.actions.delete")}
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
