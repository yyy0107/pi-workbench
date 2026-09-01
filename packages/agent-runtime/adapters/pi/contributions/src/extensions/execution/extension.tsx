"use client";

import { HistoryIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import {
  defineExtension,
  type MainViewProps,
  type WorkspaceSurfaceDefinition,
} from "@workbench/extension-sdk";

import { definePiMessage } from "../../i18n";

import {
  WorkflowInspectorSurface,
  type WorkflowInspectorParams,
} from "./workflow/workflow-inspector";
import {
  WORKFLOW_MAIN_VIEW_KIND,
  workflowMainViewRequest,
  type WorkflowMainViewParams,
} from "./execution-main-view";
import { WorkflowRuntimeBridge } from "./execution-runtime-bridge";
import { WorkflowSidebar } from "./execution-sidebar";

const ExecutionMainViewContent = lazy(() =>
  import("./execution-main-view-content").then((module) => ({ default: module.ExecutionMainView })),
);

function ExecutionMainView(props: MainViewProps<WorkflowMainViewParams>) {
  return (
    <Suspense fallback={<div className="bg-background size-full" aria-busy="true" />}>
      <ExecutionMainViewContent {...props} />
    </Suspense>
  );
}

export const workflowInspectorSurfaceDefinition = {
  kind: "workflow-inspector",
  icon: WorkflowIcon,
  cachePolicy: "keep-alive",
  persistence: "session",
  allowDuplicateResources: false,
  getResourceKey: (params) => `workflow-inspector:${encodeURIComponent(params.workflowId)}`,
  getDefaultScope: (_params, context) => ({
    type: "application",
    key: context.applicationId,
  }),
  render: WorkflowInspectorSurface,
  runtime: WorkflowRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<WorkflowInspectorParams>;

export const executionExtension = defineExtension({
  id: "workbench.workflows",
  name: "Workflows",
  version: "1.0.0",
  setup(context) {
    const sidebar = context.slots.register("sidebar.workflows", {
      id: "workbench.workflows.sidebar",
      component: WorkflowSidebar,
    });
    const mainView = context.mainViews.register<WorkflowMainViewParams>({
      kind: WORKFLOW_MAIN_VIEW_KIND,
      component: ExecutionMainView,
      chrome: {
        headerLeft: "hidden",
        rightWorkspace: "visible",
      },
    });
    const inspector = context.workspace.register(workflowInspectorSurfaceDefinition);
    const createCommand = context.commands.register({
      id: "workflows.create",
      title: definePiMessage("extensions.workflows.sidebar.newWorkflow"),
      category: definePiMessage("extensions.workflows.title"),
      icon: PlusIcon,
      run(commandContext) {
        commandContext.mainViews.open(workflowMainViewRequest({ page: "create" }));
      },
    });
    const runsCommand = context.commands.register({
      id: "workflows.runs.open",
      title: definePiMessage("extensions.workflows.runs.title"),
      category: definePiMessage("extensions.workflows.title"),
      icon: HistoryIcon,
      run(commandContext) {
        commandContext.mainViews.open(workflowMainViewRequest({ page: "runs" }));
      },
    });
    return [sidebar, mainView, inspector, createCommand, runsCommand];
  },
});
