"use client";

import { HistoryIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import dynamic from "next/dynamic";

import { defineMessage } from "@/i18n";
import { defineExtension, type WorkspaceSurfaceDefinition } from "@/platform/extensions/authoring";

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

const ExecutionMainView = dynamic(
  () => import("./execution-main-view-content").then((module) => module.ExecutionMainView),
  {
    ssr: false,
    loading: () => <div className="bg-background size-full" aria-busy="true" />,
  },
);

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
      title: defineMessage("extensions.workflows.sidebar.newWorkflow"),
      category: defineMessage("extensions.workflows.title"),
      icon: PlusIcon,
      run(commandContext) {
        commandContext.mainViews.open(workflowMainViewRequest({ page: "create" }));
      },
    });
    const runsCommand = context.commands.register({
      id: "workflows.runs.open",
      title: defineMessage("extensions.workflows.runs.title"),
      category: defineMessage("extensions.workflows.title"),
      icon: HistoryIcon,
      run(commandContext) {
        commandContext.mainViews.open(workflowMainViewRequest({ page: "runs" }));
      },
    });
    return [sidebar, mainView, inspector, createCommand, runsCommand];
  },
});
