"use client";

import { UserRoundIcon } from "lucide-react";

import { WorkspaceSelector, type WorkspaceSelectorOption } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import { usePiHostDescription } from "@workbench/agent-runtime-pi-client/host";
import { usePiWorkspaces } from "@workbench/agent-runtime-pi-client/workspace";

import { parseToolboxScopeKey, toolboxScopeKey } from "./toolbox-scope";
import { useSetToolboxScope, useToolboxScope } from "./toolbox-scope-store";

export function ToolboxScopeSelect() {
  const { t } = usePiI18n();
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
