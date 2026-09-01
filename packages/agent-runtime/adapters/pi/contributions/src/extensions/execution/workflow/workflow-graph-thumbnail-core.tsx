"use client";

import "@xyflow/react/dist/style.css";

import { useMemo } from "react";
import { Background, BackgroundVariant, ReactFlow } from "@xyflow/react";

import { usePiI18n } from "../../../i18n";
import type { FlowGraph } from "@workbench/execution-contracts";

import {
  createCanvasEdge,
  createCanvasNode,
  NODE_TYPES,
  type NodeLabels,
} from "./workflow-canvas-elements";

export function WorkflowGraphThumbnailCore({ graph }: { graph: FlowGraph }) {
  const { t } = usePiI18n();
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
  const nodes = useMemo(
    () => graph.nodes.map((node) => createCanvasNode(node, nodeLabels)),
    [graph.nodes, nodeLabels],
  );
  const edges = useMemo(() => graph.edges.map((edge) => createCanvasEdge(edge)), [graph.edges]);

  return (
    <div className="pointer-events-none size-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 0.9 }}
        minZoom={0.02}
        maxZoom={1}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        disableKeyboardA11y
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      </ReactFlow>
    </div>
  );
}
