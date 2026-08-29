"use client";

import dynamic from "next/dynamic";

import type { WorkflowDocument } from "@/runtime/shared/execution";

import { SopStepListRenderer } from "./sop/sop-step-list";

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
  return document.kind === "sop" ? (
    <SopStepListRenderer document={document} onNodeSelect={onNodeSelect} />
  ) : (
    <FlowCanvasCore key={document.id} document={document} onNodeSelect={onNodeSelect} />
  );
}
