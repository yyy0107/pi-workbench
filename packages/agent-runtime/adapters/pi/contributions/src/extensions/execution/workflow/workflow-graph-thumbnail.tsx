"use client";

import { lazy, Suspense } from "react";

import type { FlowGraph } from "@workbench/execution-contracts";

const WorkflowGraphThumbnailCore = lazy(() =>
  import("./workflow-graph-thumbnail-core").then((module) => ({
    default: module.WorkflowGraphThumbnailCore,
  })),
);

export function WorkflowGraphThumbnail({ graph }: { graph?: FlowGraph }) {
  if (!graph) return <WorkflowGraphThumbnailLoading />;
  return (
    <Suspense fallback={<WorkflowGraphThumbnailLoading />}>
      <WorkflowGraphThumbnailCore key={graphLayoutKey(graph)} graph={graph} />
    </Suspense>
  );
}

function WorkflowGraphThumbnailLoading() {
  return (
    <div aria-busy="true" className="bg-muted/20 relative size-full overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--border)_1px,transparent_1px)] bg-size-[18px_18px] opacity-50" />
    </div>
  );
}

function graphLayoutKey(graph: FlowGraph): string {
  return graph.nodes
    .map(({ id, position }) => `${id}:${position.x}:${position.y}`)
    .concat(graph.edges.map(({ id, source, target }) => `${id}:${source}:${target}`))
    .join("|");
}
