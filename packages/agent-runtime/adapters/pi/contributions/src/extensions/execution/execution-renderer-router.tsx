"use client";

import { lazy, Suspense } from "react";

import type { WorkflowDocument } from "@workbench/execution-contracts";

interface WorkflowRendererProps {
  document: WorkflowDocument;
  onNodeSelect(): void;
}

const FlowCanvasCore = lazy(() =>
  import("./workflow/flow-canvas").then((module) => ({ default: module.FlowCanvasCore })),
);

export function WorkflowRendererRouter({ document, onNodeSelect }: WorkflowRendererProps) {
  return (
    <Suspense fallback={<div className="bg-muted/20 size-full" aria-busy="true" />}>
      <FlowCanvasCore key={document.id} document={document} onNodeSelect={onNodeSelect} />
    </Suspense>
  );
}
