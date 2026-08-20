"use client";

import { useRouter } from "next/navigation";

import { useI18n } from "@/i18n";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

export function DraftThreadListItem({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const activateDirectory = useWorkspaceDirectoryStore((state) => state.activateDirectory);

  return (
    <button
      type="button"
      data-workbench-selection-surface=""
      data-workbench-selection-mode="foreground"
      data-thread-status="new"
      aria-current="page"
      className="text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-sidebar-ring relative -ms-6 flex h-9 w-[calc(100%+1.5rem)] items-center rounded-lg pe-2.5 ps-[34px] text-start text-sm outline-none focus-visible:ring-2"
      onClick={() => {
        activateDirectory(workspaceId);
        router.push("/");
        onNavigate?.();
      }}
    >
      <span className="min-w-0 flex-1 truncate">{t("workbench.sidebar.newThread")}</span>
    </button>
  );
}
