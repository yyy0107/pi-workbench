"use client";

import dynamic from "next/dynamic";

import type { WorkflowDocument } from "@workbench/execution-contracts";

interface WorkflowRendererProps {
  document: WorkflowDocument;
  onNodeSelect(): void;
}

const FlowCanvasCore = dynamic<WorkflowRendererProps>(
  () => import("./workflow/flow-canvas").then((module) => module.FlowCanvasCore),
  {
    ssr: false,
    loading: () => <div className="bg-muted/20 size-full" aria-busy="true" />,
  },
);

export function WorkflowRendererRouter({ document, onNodeSelect }: WorkflowRendererProps) {
  return <FlowCanvasCore key={document.id} document={document} onNodeSelect={onNodeSelect} />;
}
