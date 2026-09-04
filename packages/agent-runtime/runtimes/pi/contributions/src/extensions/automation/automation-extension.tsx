"use client";

import { PlusIcon, ZapIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import { defineExtension, type MainViewProps } from "@workbench/extension-sdk";

import { definePiMessage } from "../../i18n";
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
    const sidebar = context.sidebarSections.register({
      id: "automations",
      title: definePiMessage("extensions.automations.automationHome.title"),
      icon: ZapIcon,
      component: AutomationSidebar,
      order: 30,
      mainViewKinds: [AUTOMATION_MAIN_VIEW_KIND],
    });
    const mainView = context.mainViews.register<AutomationMainViewParams>({
      kind: AUTOMATION_MAIN_VIEW_KIND,
      component: AutomationMainView,
      chrome: {
        headerLeft: "hidden",
        rightWorkspace: "hidden",
      },
    });
    const createCommand = context.commands.register({
      id: "automations.create",
      title: definePiMessage("extensions.automations.automationHome.newAutomation"),
      category: definePiMessage("extensions.automations.automationHome.title"),
      icon: PlusIcon,
      run(commandContext) {
        commandContext.mainViews.open(automationMainViewRequest({ page: "automation-create" }));
      },
    });
    return [sidebar, mainView, createCommand];
  },
});
