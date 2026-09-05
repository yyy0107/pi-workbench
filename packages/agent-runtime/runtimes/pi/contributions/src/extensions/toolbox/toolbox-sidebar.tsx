"use client";

import {
  BoxIcon,
  DownloadIcon,
  FileTextIcon,
  PackageIcon,
  StoreIcon,
  PlugIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { SidebarRow, SidebarStatus } from "@workbench/shell/ui";
import { type LocalizableText } from "@workbench/shell/i18n";
import { useMainViewService } from "@workbench/extension-host";
import type { SidebarSectionComponentProps } from "@workbench/extension-sdk";
import type { PiResourceCatalogTarget } from "@workbench/agent-runtime-pi-protocol/rpc";

import { definePiMessage, usePiI18n } from "../../i18n";
import { type ToolboxMainSection } from "./toolbox-capability";
import { useToolboxCatalogs } from "./toolbox-catalog";
import { usePiPackageUpdates } from "./use-pi-package-updates";
import { toolboxScopeTarget } from "./toolbox-scope";
import { ToolboxScopeSelect } from "./toolbox-scope-select";
import { useToolboxScope } from "./toolbox-scope-store";

const TOOLBOX_SECTION_TITLES = {
  skills: definePiMessage("extensions.toolbox.skills.title"),
  extensions: definePiMessage("extensions.toolbox.extensions.title"),
  prompts: definePiMessage("extensions.toolbox.prompts.title"),
  installed: definePiMessage("extensions.toolbox.packages.installedTitle"),
  packages: definePiMessage("extensions.toolbox.packages.title"),
  updates: definePiMessage("extensions.toolbox.updates"),
} satisfies Readonly<Record<ToolboxMainSection, LocalizableText>>;

export function ToolboxSidebar({ onNavigate }: SidebarSectionComponentProps) {
  const { number, t, text } = usePiI18n();
  const mainViews = useMainViewService();
  const activeView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getSnapshot,
  );
  useEffect(() => {
    const kind = mainViews.getSnapshot()?.kind;
    if (kind === "toolbox" || kind === "system-prompts") return;
    mainViews.open({
      kind: "toolbox",
      title: TOOLBOX_SECTION_TITLES.skills,
      params: { section: "skills" },
    });
  }, [mainViews]);
  const scope = useToolboxScope();
  const openSystemPrompts = useCallback(() => {
    const active = mainViews.getSnapshot();
    const target = toolboxScopeTarget(scope);
    const currentTarget = active?.params.target as PiResourceCatalogTarget | undefined;
    if (
      active?.kind === "system-prompts" &&
      currentTarget?.scope === target.scope &&
      (target.scope === "user" ||
        (currentTarget.scope === "project" && currentTarget.workspaceId === target.workspaceId))
    )
      return;
    mainViews.open({
      kind: "system-prompts",
      title: definePiMessage("extensions.agentConfiguration.systemPrompt.title"),
      params: { target },
    });
  }, [mainViews, scope]);
  useEffect(() => {
    if (mainViews.getSnapshot()?.kind === "system-prompts") openSystemPrompts();
  }, [mainViews, openSystemPrompts]);
  const catalogs = useToolboxCatalogs(scope);
  const updateTarget = useMemo(
    () => (catalogs.packagesCatalog.hasTargets ? toolboxScopeTarget(scope) : undefined),
    [catalogs.packagesCatalog.hasTargets, scope],
  );
  const updates = usePiPackageUpdates(updateTarget);
  const count = (loadState: string, value: number) =>
    loadState === "ready" ? number(value) : loadState === "loading" ? "…" : "—";
  const openSection = (section: ToolboxMainSection) => {
    mainViews.open({
      kind: "toolbox",
      title: TOOLBOX_SECTION_TITLES[section],
      params: { section },
    });
    onNavigate?.();
  };
  const categories = [
    {
      section: "skills",
      icon: BoxIcon,
      catalog: catalogs.skillsCatalog,
      items: catalogs.skillItems,
    },
    {
      section: "extensions",
      icon: PlugIcon,
      catalog: catalogs.extensionsCatalog,
      items: catalogs.extensionItems,
    },
    {
      section: "prompts",
      icon: FileTextIcon,
      catalog: catalogs.promptsCatalog,
      items: catalogs.promptItems,
    },
    {
      section: "installed",
      icon: PackageIcon,
      catalog: catalogs.packagesCatalog,
      items: catalogs.packageItems,
    },
  ] as const;

  return (
    <section aria-label={t("extensions.toolbox.title")} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="mb-4 flex items-center gap-2 px-2">
          <span className="text-muted-foreground shrink-0 text-sm">
            {t("extensions.toolbox.scope.label")}
          </span>
          <div className="min-w-0 flex-1">
            <ToolboxScopeSelect />
          </div>
        </div>
        <nav
          aria-label={t("extensions.toolbox.capabilities")}
          className="flex flex-col gap-[var(--sidebar-list-gap)]"
        >
          <SidebarRow
            icon={<FileTextIcon />}
            label={t("extensions.agentConfiguration.systemPrompt.title")}
            active={activeView?.kind === "system-prompts"}
            onActivate={() => {
              openSystemPrompts();
              onNavigate?.();
            }}
          />
          {categories.map(({ section, icon: Icon, catalog, items }) => (
            <SidebarRow
              key={section}
              icon={<Icon />}
              label={text(TOOLBOX_SECTION_TITLES[section])}
              active={activeView?.kind === "toolbox" && activeView.params.section === section}
              status={<SidebarStatus>{count(catalog.loadState, items.length)}</SidebarStatus>}
              onActivate={() => openSection(section)}
            />
          ))}
        </nav>
        <nav
          aria-label={t("extensions.toolbox.manage")}
          className="mt-4 flex flex-col gap-[var(--sidebar-list-gap)] border-t pt-3"
        >
          <SidebarRow
            icon={<StoreIcon />}
            label={t("extensions.toolbox.browsePiPackages")}
            active={activeView?.kind === "toolbox" && activeView.params.section === "packages"}
            onActivate={() => openSection("packages")}
          />
          <SidebarRow
            icon={<DownloadIcon />}
            label={t("extensions.toolbox.updates")}
            active={activeView?.kind === "toolbox" && activeView.params.section === "updates"}
            status={
              <SidebarStatus>
                {count(updates.loadState, updates.value.updates.length)}
              </SidebarStatus>
            }
            onActivate={() => openSection("updates")}
          />
        </nav>
      </div>
    </section>
  );
}
