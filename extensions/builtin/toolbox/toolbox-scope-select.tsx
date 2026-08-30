"use client";

import { ChevronDownIcon, FolderIcon, UserRoundIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@/components/ui/settings-control";
import {
  getSelectorDropdownWidth,
  SelectorDropdownContent,
  useAnimatedSelectorDropdown,
} from "@/components/ui/selector-dropdown";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePiWorkspaces } from "@/workbench/runtime-contributions/pi/client/workspace";

import { parseToolboxScopeKey, toolboxScopeKey } from "./toolbox-scope";
import { setToolboxScope, useToolboxScope } from "./toolbox-scope-store";

function getToolboxScopeDropdownWidth(trigger: HTMLButtonElement): number {
  const defaultWidth = getSelectorDropdownWidth();
  const availableWidth = trigger.parentElement?.getBoundingClientRect().width;
  return availableWidth && availableWidth > 0
    ? Math.min(defaultWidth, availableWidth)
    : defaultWidth;
}

export function ToolboxScopeSelect({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const selectorDropdown = useAnimatedSelectorDropdown({
    getOpenWidth: compact ? getSelectorDropdownWidth : getToolboxScopeDropdownWidth,
  });
  const scope = useToolboxScope();
  const workspaces = usePiWorkspaces();
  const selectedWorkspace =
    scope.kind === "project"
      ? workspaces.find((workspace) => workspace.id === scope.workspaceId)
      : undefined;
  const selectedLabel =
    scope.kind === "user"
      ? t("extensions.toolbox.scope.user")
      : (selectedWorkspace?.name ?? t("extensions.toolbox.scope.unavailableProject"));

  return (
    <DropdownMenu onOpenChange={selectorDropdown.onOpenChange}>
      <SettingsDropdownTrigger
        ref={selectorDropdown.triggerRef}
        type="button"
        aria-label={t("extensions.toolbox.scope.select")}
        title={selectedWorkspace?.cwd ?? selectedLabel}
        style={selectorDropdown.triggerStyle}
        className={cn(
          "group justify-start overflow-hidden rounded-lg transition-[width,background-color,color] ease-out",
          compact ? "min-w-40" : "h-9 px-2.5",
          className,
        )}
        onTransitionEnd={selectorDropdown.onTriggerTransitionEnd}
      >
        {scope.kind === "user" ? (
          <UserRoundIcon aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <FolderIcon aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDownIcon aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
      </SettingsDropdownTrigger>
      <SelectorDropdownContent align="start" side="bottom" style={selectorDropdown.contentStyle}>
        <DropdownMenuRadioGroup
          value={toolboxScopeKey(scope)}
          onValueChange={(value) => {
            const nextScope = parseToolboxScopeKey(value);
            if (nextScope) setToolboxScope(nextScope);
          }}
        >
          <DropdownMenuLabel className="px-2 py-0.5">
            {t("extensions.toolbox.scope.personal")}
          </DropdownMenuLabel>
          <SettingsDropdownRadioItem value="user" className="items-start py-1">
            <UserRoundIcon aria-hidden="true" className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t("extensions.toolbox.scope.user")}</span>
              <span className="text-muted-foreground block text-xs leading-4 whitespace-normal">
                {t("extensions.toolbox.scope.userDescription")}
              </span>
            </span>
          </SettingsDropdownRadioItem>
          <DropdownMenuSeparator className="my-0.5" />
          <DropdownMenuLabel className="px-2 py-0.5">
            {t("extensions.toolbox.scope.projects")}
          </DropdownMenuLabel>
          {workspaces.length === 0 ? (
            <DropdownMenuItem disabled className="py-1">
              <FolderIcon aria-hidden="true" />
              {t("extensions.toolbox.scope.noProjects")}
            </DropdownMenuItem>
          ) : (
            workspaces.map((workspace) => (
              <SettingsDropdownRadioItem
                key={workspace.id}
                value={toolboxScopeKey({ kind: "project", workspaceId: workspace.id })}
                className="items-start py-1"
              >
                <FolderIcon aria-hidden="true" className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium" title={workspace.name}>
                    {workspace.name}
                  </span>
                  <span
                    className="text-muted-foreground block truncate text-xs leading-4"
                    title={workspace.cwd}
                  >
                    {workspace.cwd}
                  </span>
                </span>
              </SettingsDropdownRadioItem>
            ))
          )}
        </DropdownMenuRadioGroup>
      </SelectorDropdownContent>
    </DropdownMenu>
  );
}
