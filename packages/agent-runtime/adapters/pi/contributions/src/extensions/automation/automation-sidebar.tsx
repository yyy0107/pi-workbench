"use client";

import { ListIcon, PlusIcon } from "lucide-react";
import { useEffect } from "react";

import { useMainViewService } from "@workbench/extension-host";
import { Button } from "@workbench/shell/ui";

import { usePiI18n } from "../../i18n";
import { AUTOMATION_MAIN_VIEW_KIND, automationMainViewRequest } from "./automation-main-view";

export function AutomationSidebar() {
  const { t } = usePiI18n();
  const mainViews = useMainViewService();

  useEffect(() => {
    if (mainViews.getSnapshot()?.kind !== AUTOMATION_MAIN_VIEW_KIND) {
      mainViews.open(automationMainViewRequest({ page: "automations" }));
    }
  }, [mainViews]);

  return (
    <nav
      aria-label={t("extensions.automations.sidebar.region")}
      className="flex min-h-0 flex-1 flex-col gap-0.5 px-3 py-1"
    >
      <Button
        type="button"
        variant="ghost"
        className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground h-9 w-full justify-start"
        onClick={() => mainViews.open(automationMainViewRequest({ page: "automations" }))}
      >
        <ListIcon aria-hidden="true" />
        {t("extensions.automations.automationHome.myAutomations")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground h-9 w-full justify-start"
        onClick={() => mainViews.open(automationMainViewRequest({ page: "automation-create" }))}
      >
        <PlusIcon aria-hidden="true" />
        {t("extensions.automations.automationHome.newAutomation")}
      </Button>
    </nav>
  );
}
