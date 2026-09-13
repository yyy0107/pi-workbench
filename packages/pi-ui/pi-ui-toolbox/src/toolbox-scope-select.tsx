"use client";
import { toolboxUiTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { UserRoundIcon } from "lucide-react";

import { WorkspaceSelector, type WorkspaceSelectorOption } from "@workbench/ui-selectors";

import { usePiHostDescription } from "@workbench/pi-runtime-client/host";
import { usePiWorkspaces } from "@workbench/pi-runtime-client/workspace";

import { parseToolboxScopeKey, toolboxScopeKey } from "../lib/toolbox-scope";
import { useSetToolboxScope, useToolboxScope } from "./toolbox-scope-store";

export function ToolboxScopeSelect() {
  const { t } = useI18n(toolboxUiTranslationBundle);
  const setToolboxScope = useSetToolboxScope();
  const scope = useToolboxScope();
  const workspaces = usePiWorkspaces();
  const userResourceDir = usePiHostDescription()?.userResourceDir;
  const options: WorkspaceSelectorOption[] = [
    {
      id: "user",
      name: t("extensions.toolbox.scope.user"),
      rootPath: userResourceDir,
      icon: <UserRoundIcon aria-hidden="true" className="size-[var(--icon-size-md)] shrink-0" />,
    },
    ...workspaces.map((workspace) => ({
      id: toolboxScopeKey({ kind: "project", workspaceId: workspace.id }),
      name: workspace.name,
      rootPath: workspace.cwd,
    })),
  ];

  return (
    <WorkspaceSelector
      labels={{
        select: t("extensions.toolbox.scope.select"),
        clear: t("extensions.toolbox.scope.clear"),
        selecting: t("extensions.toolbox.scope.selecting"),
        selectError: t("extensions.toolbox.scope.selectError"),
        empty: t("extensions.toolbox.scope.unavailableProject"),
        search: t("extensions.toolbox.scope.search"),
        searchPlaceholder: t("extensions.toolbox.scope.searchPlaceholder"),
        noSearchResults: t("extensions.toolbox.scope.noSearchResults"),
      }}
      selectedWorkspace={options.find((option) => option.id === toolboxScopeKey(scope))}
      workspaces={options}
      onValueChange={(value) => {
        const nextScope = parseToolboxScopeKey(value);
        if (nextScope) setToolboxScope(nextScope);
      }}
    />
  );
}
