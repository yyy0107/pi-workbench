"use client";

import {
  useWorkbenchAutomationCapability,
  useWorkbenchRuntimeHostCapability,
  useWorkbenchModelSelectionCapability,
} from "@workbench/agent-runtime-client/context";
import { RuntimeCapabilityUnavailable } from "../../runtime-capability-unavailable";

import type { MainViewProps } from "@workbench/extension-sdk";

import { AutomationHome } from "./automation/automation-home";
import { AutomationTaskForm } from "./automation/automation-task-form";
import type { AutomationMainViewParams } from "./automation-main-view";

export function AutomationMainView({ view }: MainViewProps<AutomationMainViewParams>) {
  const automationClient = useWorkbenchAutomationCapability();
  const host = useWorkbenchRuntimeHostCapability();
  const models = useWorkbenchModelSelectionCapability();
  if (!automationClient || !host || !models) return <RuntimeCapabilityUnavailable />;
  return view.params.page === "automations" ? (
    <AutomationHome automationClient={automationClient} host={host} />
  ) : (
    <AutomationTaskForm
      params={view.params}
      automationClient={automationClient}
      host={host}
      models={models}
    />
  );
}
