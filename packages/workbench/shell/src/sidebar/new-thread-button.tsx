"use client";

import { PlusIcon } from "lucide-react";
import { useAgentRuntime } from "@workbench/agent-runtime-client";

import { buttonVariants } from "../ui/button";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import { useWorkspaceCapabilities } from "@workbench/agent-runtime-client/workspaces";
import { useWorkbenchNavigation } from "../navigation";

export function NewThreadButton({
  className,
  workspaceId,
  active = false,
  variant = "row",
  onNavigate,
}: {
  workspaceId: string;
  active?: boolean;
  variant?: "row" | "icon" | "menu";
  className?: string;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const runtime = useAgentRuntime();
  const navigation = useWorkbenchNavigation();
  const { beginNewThread } = useWorkspaceCapabilities();

  const prepareNewThread = () => {
    beginNewThread(workspaceId);
    runtime.createDraft({ workspaceId });
    navigation.openHome();
    onNavigate?.();
  };

  const button =
    variant === "icon" ? (
      <button
        type="button"
        aria-label={t("workbench.sidebar.newThread")}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "text-muted-foreground hover:text-foreground focus-visible:text-foreground active:text-foreground active:scale-90",
          className,
        )}
        onClick={prepareNewThread}
      >
        <PlusIcon />
      </button>
    ) : (
      <button
        type="button"
        data-slot="button"
        data-workbench-selection-surface={variant === "row" ? "" : undefined}
        data-workbench-selection-mode={variant === "row" ? "foreground" : undefined}
        className={cn(
          buttonVariants({ variant: "ghost" }),
          variant === "menu"
            ? "hover:bg-accent focus-visible:bg-accent h-8 w-full justify-start gap-2 rounded-md border-0 px-2 text-sm font-normal shadow-none"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-sidebar-ring data-active:text-sidebar-foreground -ms-6 h-9 w-[calc(100%+1.5rem)] justify-start rounded-lg border-0 pe-2.5 ps-[34px] text-sm font-normal shadow-none focus-visible:ring-2",
          variant === "row" && active && "text-sidebar-foreground",
          className,
        )}
        aria-current={variant === "row" && active ? "page" : undefined}
        onClick={prepareNewThread}
      >
        {variant === "menu" ? <PlusIcon className="size-[var(--icon-size-md)]" /> : null}
        {t("workbench.sidebar.newThread")}
      </button>
    );

  return button;
}
