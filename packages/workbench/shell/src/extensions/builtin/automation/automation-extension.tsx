"use client";

import {
  useWorkbenchAutomationCapability,
  useWorkbenchRuntimeHostCapability,
  useWorkbenchModelSelectionCapability,
} from "@workbench/agent-runtime-client/context";
import { registerRuntimeEntries } from "../../runtime-entries";

import { PlusIcon, ZapIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import { defineExtension, type MainViewProps } from "@workbench/extension-sdk";

import { defineMessage } from "@workbench/shell/i18n";
import {
  AUTOMATION_MAIN_VIEW_KIND,
  automationMainViewRequest,
  type AutomationMainViewParams,
} from "./automation-main-view";
import { AutomationSidebar } from "./automation-sidebar";

const AutomationMainViewContent = lazy(() =>
  import("./automation-main-view-content").then((module) => ({
    default: module.AutomationMainView,
  })),
);

function AutomationMainView(props: MainViewProps<AutomationMainViewParams>) {
  return (
    <Suspense fallback={<div className="bg-background size-full" aria-busy="true" />}>
      <AutomationMainViewContent {...props} />
    </Suspense>
  );
}

export const automationExtension = defineExtension({
  id: "workbench.automations",
  name: "Automations",
  version: "1.0.0",
  setup(context) {
    const mainView = context.mainViews.register<AutomationMainViewParams>({
      kind: AUTOMATION_MAIN_VIEW_KIND,
      component: AutomationMainView,
      chrome: {
        headerLeft: "hidden",
        rightWorkspace: "hidden",
      },
    });
    const entries = registerRuntimeEntries(
      context,
      "workbench.automations.entries",
      () => {
        const automation = useWorkbenchAutomationCapability();
        const host = useWorkbenchRuntimeHostCapability();
        const models = useWorkbenchModelSelectionCapability();
        return Boolean(automation && host && models);
      },
      () => {
        const sidebar = context.sidebarSections.register({
          id: "automations",
          title: defineMessage("extensions.automations.automationHome.title"),
          icon: ZapIcon,
          component: AutomationSidebar,
          order: 30,
          mainViewKinds: [AUTOMATION_MAIN_VIEW_KIND],
        });
        const createCommand = context.commands.register({
          id: "automations.create",
          title: defineMessage("extensions.automations.automationHome.newAutomation"),
          category: defineMessage("extensions.automations.automationHome.title"),
          icon: PlusIcon,
          run(commandContext) {
            commandContext.mainViews.open(automationMainViewRequest({ page: "automation-create" }));
          },
        });
        return [sidebar, createCommand];
      },
    );
    return [mainView, entries];
  },
});
