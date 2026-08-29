"use client";

import dynamic from "next/dynamic";

import type { WorkflowDocument } from "@/runtime/shared/execution";

import { SopStepListRenderer } from "./sop-step-list";

const FlowCanvasCore = dynamic<{ document: WorkflowDocument }>(
  () => import("./flow-canvas").then((module) => module.FlowCanvasCore),
  {
    ssr: false,
    loading: () => <div className="bg-muted/20 size-full" aria-busy="true" />,
  },
);

export function WorkflowRendererRouter({ document }: { document: WorkflowDocument }) {
  return document.kind === "sop" ? (
    <SopStepListRenderer document={document} />
  ) : (
    <FlowCanvasCore key={document.id} document={document} />
  );
}
