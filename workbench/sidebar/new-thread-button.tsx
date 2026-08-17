"use client";

import { ThreadListPrimitive } from "@assistant-ui/react";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

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
  const router = useRouter();
  const beginNewThread = useWorkspaceDirectoryStore((state) => state.beginNewThread);

  const openNewThreadRoute = () => {
    beginNewThread(workspaceId);
    router.push("/");
    onNavigate?.();
  };

  const button =
    variant === "icon" ? (
      <button
        type="button"
        aria-label={t("workbench.sidebar.newThread")}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "aui-button-icon size-7 p-1 active:scale-90",
          className,
        )}
      >
        <PlusIcon className="size-[18px]" />
      </button>
    ) : (
      <button
        type="button"
        data-slot="button"
        className={cn(
          buttonVariants({ variant: "ghost" }),
          variant === "menu"
            ? "hover:bg-accent focus-visible:bg-accent h-8 w-full justify-start gap-2 rounded-md border-0 px-2 text-sm font-normal shadow-none"
            : "hover:bg-sidebar-accent focus-visible:ring-sidebar-ring data-active:bg-sidebar-accent -ms-6 h-9 w-[calc(100%+1.5rem)] justify-start rounded-lg border-0 pe-2.5 ps-[34px] text-sm font-normal shadow-none focus-visible:ring-2",
          variant === "row" && active && "bg-sidebar-accent",
          className,
        )}
        aria-current={variant === "row" && active ? "page" : undefined}
      >
        {variant === "menu" ? <PlusIcon className="size-4" /> : null}
        {t("workbench.sidebar.newThread")}
      </button>
    );

  return (
    <ThreadListPrimitive.New asChild onClick={openNewThreadRoute}>
      {button}
    </ThreadListPrimitive.New>
  );
}
