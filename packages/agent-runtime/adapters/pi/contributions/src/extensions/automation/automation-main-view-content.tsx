"use client";

import type { MainViewProps } from "@workbench/extension-sdk";

import { AutomationHome } from "./automation/automation-home";
import { AutomationTaskForm } from "./automation/automation-task-form";
import type { AutomationMainViewParams } from "./automation-main-view";

export function AutomationMainView({ view }: MainViewProps<AutomationMainViewParams>) {
  return view.params.page === "automations" ? (
    <AutomationHome />
  ) : (
    <AutomationTaskForm params={view.params} />
  );
}
