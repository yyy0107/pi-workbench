"use client";

import {
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  FileCode2Icon,
  FolderIcon,
  GitPullRequestIcon,
  HouseIcon,
  LanguagesIcon,
  Maximize2Icon,
  MicIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquareTerminalIcon,
  ToolboxIcon,
  WorkflowIcon,
  WrenchIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@workbench/shell/i18n";
import { usePiI18n } from "../../i18n";
import { cn } from "@workbench/shell/utils";
import type { WorkbenchSlot } from "@workbench/extension-sdk";

import { usePiContributionBranding } from "../../public/assets-context";
import type { ToolboxComponentContribution } from "./toolbox-capability";

type ProjectPreviewRegion =
  | WorkbenchSlot
  | "main-view"
  | "message.content"
  | "message.root"
  | "panel.bottom"
  | "panel.left"
  | "panel.right"
  | "settings"
  | "workspace.surface";

export function resolveComponentProjectPreviewRegion(
  contribution: Pick<ToolboxComponentContribution, "kind" | "target">,
): ProjectPreviewRegion {
  if (contribution.kind === "slot") return contribution.target as WorkbenchSlot;

  switch (contribution.kind) {
    case "panel":
      if (/bottom/i.test(contribution.target)) return "panel.bottom";
      if (/left/i.test(contribution.target)) return "panel.left";
      return "panel.right";
    case "message-renderer":
      return "message.root";
    case "message-part-renderer":
    case "tool-renderer":
    case "data-renderer":
      return "message.content";
    case "settings-section":
    case "settings-item":
      return "settings";
    case "main-view":
      return "main-view";
    case "workspace-surface":
      return "workspace.surface";
  }
}

function PanoramaTarget({
  activeRegion,
  children,
  className,
  label,
  region,
}: {
  activeRegion: ProjectPreviewRegion;
  children?: ReactNode;
  className?: string;
  label: string;
  region: ProjectPreviewRegion;
}) {
  const active = activeRegion === region;

  return (
    <div
      aria-label={active ? label : undefined}
      className={cn(
        "relative min-h-0 min-w-0",
        active &&
          "z-20 rounded-[0.35rem] bg-sky-500/15 shadow-[0_0_0_1px_color-mix(in_oklab,var(--background)_80%,transparent)] ring-2 ring-sky-500 ring-offset-1 ring-offset-background",
        className,
      )}
      data-project-preview-active={active ? "true" : undefined}
      title={active ? label : undefined}
    >
      {children}
      {active ? (
        <span className="pointer-events-none absolute -top-1 -right-1 z-30 size-2.5 rounded-full border-2 border-background bg-sky-500 shadow-sm" />
      ) : null}
    </div>
  );
}

function MiniIconButton({ children }: { children: ReactNode }) {
  return (
    <span className="text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-md">
      {children}
    </span>
  );
}

function MiniSidebar({
  activeRegion,
  toolboxMode,
}: {
  activeRegion: ProjectPreviewRegion;
  toolboxMode: boolean;
}) {
  const { t: tPi } = usePiI18n();
  const { t: tShell } = useI18n();
  const { piLogoUrl } = usePiContributionBranding();
  const target = (
    value: ProjectPreviewRegion,
    label: string,
    className?: string,
    children?: ReactNode,
  ) => (
    <PanoramaTarget activeRegion={activeRegion} region={value} label={label} className={className}>
      {children}
    </PanoramaTarget>
  );
  return (
    <aside className="bg-sidebar text-sidebar-foreground relative flex min-h-0 flex-col border-r">
      <span className="group/brand-toggle absolute start-[3px] top-[1.75px] z-10 size-[14px] shrink-0">
        <img
          src={piLogoUrl}
          alt=""
          aria-hidden="true"
          className="size-[14px] group-hover/brand-toggle:opacity-0 dark:invert"
        />
        <PanelLeftCloseIcon
          aria-hidden="true"
          className="bg-sidebar text-muted-foreground absolute inset-0 size-[14px] opacity-0 group-hover/brand-toggle:opacity-100"
        />
      </span>

      {activeRegion === "sidebar.brand"
        ? target(
            "sidebar.brand",
            tPi("extensions.toolbox.details.projectRegions.sidebarBrand"),
            "flex h-5 shrink-0 items-center ps-[21px] pe-1",
            <span className="text-muted-foreground truncate text-[6px] font-medium">
              {tPi("extensions.toolbox.details.projectRegions.sidebarBrand")}
            </span>,
          )
        : null}

      {activeRegion === "sidebar.header"
        ? target(
            "sidebar.header",
            tPi("extensions.toolbox.details.projectRegions.sidebarHeader"),
            "mx-2 flex h-4 shrink-0 items-center gap-1 rounded-md px-1.5",
            <>
              <CircleIcon className="size-1.5 fill-emerald-500 text-emerald-500" />
              <span className="text-muted-foreground text-[6px]">
                {tPi("extensions.toolbox.details.projectPanorama.connected")}
              </span>
            </>,
          )
        : null}

      <div className="flex h-5 shrink-0 items-center gap-0.5 ps-[21px] pe-0.5">
        <span
          className={cn(
            "flex h-[14px] items-center overflow-hidden rounded-md px-1 text-[6px] font-semibold",
            !toolboxMode ? "bg-sidebar-accent w-14" : "text-muted-foreground w-[14px]",
          )}
        >
          <HouseIcon className="size-2.5 shrink-0" />
          {!toolboxMode ? (
            <span className="ms-1 truncate">
              {tPi("extensions.toolbox.details.projectPanorama.workspace")}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "flex h-[14px] items-center overflow-hidden rounded-md px-1 text-[6px] font-semibold",
            toolboxMode ? "bg-sidebar-accent w-14" : "text-muted-foreground w-[14px]",
          )}
        >
          <ToolboxIcon className="size-2.5 shrink-0" />
          {toolboxMode ? (
            <span className="ms-1 truncate">
              {tPi("extensions.toolbox.details.projectPanorama.toolbox")}
            </span>
          ) : null}
        </span>
        <span className="text-muted-foreground flex size-[14px] items-center justify-center rounded-md">
          <WorkflowIcon className="size-2.5" />
        </span>
        <span className="text-muted-foreground ms-auto flex size-[14px] items-center justify-center rounded-md">
          <SearchIcon className="size-2.5" />
        </span>
      </div>

      {activeRegion === "sidebar.navigation"
        ? target(
            "sidebar.navigation",
            tPi("extensions.toolbox.details.projectRegions.navigation"),
            "mx-1.5 mb-0.5 flex h-4 shrink-0 items-center gap-1 rounded-md px-1.5 text-[6px]",
            <>
              <GitPullRequestIcon className="size-2.5" />
              <span className="truncate">codex/component-extension</span>
            </>,
          )
        : null}

      {toolboxMode ? (
        <div className="flex min-h-0 flex-1 flex-col px-2 pt-2">
          <div className="px-1 text-[6px] font-semibold tracking-wide text-muted-foreground uppercase">
            {tPi("extensions.toolbox.details.projectPanorama.capabilities")}
          </div>
          {target(
            "sidebar.toolbox",
            tPi("extensions.toolbox.details.projectRegions.toolbox"),
            "mt-1 grid gap-1",
            <>
              <div className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[7px]">
                <WrenchIcon className="size-2.5" />
                <span className="flex-1">
                  {tPi("extensions.toolbox.details.projectPanorama.skills")}
                </span>
                <ChevronRightIcon className="size-2" />
              </div>
              <div className="bg-sidebar-accent flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[7px] font-medium">
                <ToolboxIcon className="size-2.5" />
                <span className="min-w-0 flex-1 truncate">
                  {tShell("extensions.generativeUi.name")}
                </span>
                <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[5.5px] text-emerald-700 dark:text-emerald-300">
                  {tPi("extensions.toolbox.status.installed")}
                </span>
              </div>
            </>,
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-2 pt-2">
          <div className="order-2 flex h-5 items-center gap-1 rounded-md px-1 text-[6.5px] font-medium text-muted-foreground">
            <span className="flex-1">
              {tPi("extensions.toolbox.details.projectPanorama.projects")}
            </span>
            <ChevronDownIcon className="size-2.5" />
            {target(
              "sidebar.workspace.actions",
              tPi("extensions.toolbox.details.projectRegions.workspace"),
              "flex items-center",
              <PlusIcon className="size-2.5" />,
            )}
          </div>
          {target(
            "sidebar.top",
            tPi("extensions.toolbox.details.projectRegions.sidebarTop"),
            "order-1 mt-1 flex h-5 shrink-0 items-center gap-1 rounded-md bg-sidebar-accent px-1.5 text-[6.5px] font-medium",
            <>
              <PlusIcon className="size-2.5" />
              <span className="truncate">
                {tPi("extensions.toolbox.details.projectPanorama.newThread")}
              </span>
            </>,
          )}
          <div className="order-3 mt-1 grid gap-0.5">
            <div className="flex h-5 items-center gap-1 rounded-md px-1.5 text-[6.5px] font-medium">
              <FolderIcon className="size-2.5" />
              <span className="truncate">
                {tPi("extensions.toolbox.details.projectPanorama.activeProject")}
              </span>
              <ChevronDownIcon className="text-muted-foreground ms-auto size-2.5" />
            </div>
            <div className="bg-sidebar-accent flex h-8 items-center gap-1.5 rounded-md px-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[7px] font-medium">
                  {tPi("extensions.toolbox.details.projectPanorama.activeThread")}
                </span>
                <span className="text-muted-foreground block truncate text-[5.5px]">
                  {tPi("extensions.toolbox.details.projectPanorama.activeProject")}
                </span>
              </span>
            </div>
            <div className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[6.5px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground/30" />
              <span className="truncate">
                {tPi("extensions.toolbox.details.projectPanorama.previousThread")}
              </span>
            </div>
          </div>
          {target(
            "sidebar.bottom",
            tPi("extensions.toolbox.details.projectRegions.sidebarBottom"),
            "order-4 mt-auto flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[6px] text-muted-foreground",
            <>
              <CircleIcon className="size-1.5 fill-sky-500 text-sky-500" />
              <span>{tPi("extensions.toolbox.details.projectPanorama.backgroundTask")}</span>
            </>,
          )}
        </div>
      )}

      {target(
        "sidebar.footer",
        tPi("extensions.toolbox.details.projectRegions.footer"),
        "mx-2 mb-2 flex h-7 shrink-0 items-center gap-1 border-t pt-1",
        <>
          <MiniIconButton>
            <SettingsIcon className="size-2.5" />
          </MiniIconButton>
          <span className="flex-1 text-[6.5px]">
            {tPi("extensions.toolbox.details.projectPanorama.settings")}
          </span>
          <span className="text-muted-foreground flex items-center gap-1 text-[5.5px]">
            <LanguagesIcon className="size-2.5" />
            {tPi("extensions.toolbox.details.projectPanorama.localeName")}
          </span>
        </>,
      )}
    </aside>
  );
}

function MiniHeader({
  activeRegion,
  toolboxMode,
}: {
  activeRegion: ProjectPreviewRegion;
  toolboxMode: boolean;
}) {
  const { t: tPi } = usePiI18n();
  const target = (value: ProjectPreviewRegion, label: string, children: ReactNode) => (
    <PanoramaTarget activeRegion={activeRegion} region={value} label={label}>
      {children}
    </PanoramaTarget>
  );

  return (
    <header className="bg-background grid h-5 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b ps-1.5 pe-1.5">
      <div className="flex min-w-0 items-center gap-1">
        <span className="truncate text-[7px] font-semibold">
          {toolboxMode
            ? tPi("extensions.toolbox.componentExtensions.title")
            : tPi("extensions.toolbox.details.projectPanorama.activeThread")}
        </span>
        {activeRegion === "header.left"
          ? target(
              "header.left",
              "header.left",
              <span className="rounded bg-muted px-1 py-0.5 font-mono text-[5.5px] text-muted-foreground">
                main
              </span>,
            )
          : null}
      </div>
      {activeRegion === "header.center"
        ? target(
            "header.center",
            tPi("extensions.toolbox.details.projectRegions.header"),
            <span className="rounded-full border px-2 py-0.5 text-[6px] text-muted-foreground">
              GPT-5
            </span>,
          )
        : null}
      <div className="flex min-w-0 justify-end">
        {activeRegion === "header.right"
          ? target(
              "header.right",
              "header.right",
              <div className="flex items-center gap-0.5">
                <MiniIconButton>
                  <MoreHorizontalIcon className="size-2.5" />
                </MiniIconButton>
              </div>,
            )
          : null}
      </div>
    </header>
  );
}

function MiniConversation({ activeRegion }: { activeRegion: ProjectPreviewRegion }) {
  const { t: tPi } = usePiI18n();
  const { t: tShell } = useI18n();
  const target = (
    value: ProjectPreviewRegion,
    label: string,
    className?: string,
    children?: ReactNode,
  ) => (
    <PanoramaTarget activeRegion={activeRegion} region={value} label={label} className={className}>
      {children}
    </PanoramaTarget>
  );
  const messageRoleLabels = {
    assistant: tPi("extensions.toolbox.details.projectPanorama.messageRoles.assistant"),
    system: tPi("extensions.toolbox.details.projectPanorama.messageRoles.system"),
    user: tPi("extensions.toolbox.details.projectPanorama.messageRoles.user"),
  } as const;
  const messageSlotExample = (
    region: "message.before" | "message.after",
    role: keyof typeof messageRoleLabels,
  ) =>
    activeRegion === region
      ? target(
          region,
          region,
          "my-0.5 flex h-3 items-center rounded px-1 text-[5px] font-medium text-sky-700 dark:text-sky-200",
          tPi("extensions.toolbox.details.projectPanorama.messageSlotExample", {
            role: messageRoleLabels[role],
            slot: region,
          }),
        )
      : null;
  const messageActionsExample = (align: "start" | "end", role: "assistant" | "user") =>
    target(
      "message.actions",
      "message.actions",
      cn(
        "mt-0.5 flex h-3 items-center gap-1 text-muted-foreground",
        align === "end" && "justify-end",
      ),
      <>
        {activeRegion === "message.actions" ? (
          <span className="me-1 text-[5px] font-medium text-sky-700 dark:text-sky-200">
            {tPi("extensions.toolbox.details.projectPanorama.messageActionsExample", {
              role: messageRoleLabels[role],
            })}
          </span>
        ) : null}
        <CircleIcon className="size-2" />
        <MoreHorizontalIcon className="size-2.5" />
      </>,
    );

  return (
    <div className="relative flex size-full min-h-0 flex-col overflow-hidden bg-background">
      {activeRegion === "thread.header"
        ? target(
            "thread.header",
            "thread.header",
            "mx-auto flex h-5 w-full max-w-[24rem] shrink-0 items-center justify-center border-b text-[5.5px] text-muted-foreground",
            <span>{tPi("extensions.toolbox.details.projectPanorama.today")}</span>,
          )
        : null}
      {activeRegion === "thread.before"
        ? target("thread.before", "thread.before", "mx-auto h-2 w-full max-w-[22rem] shrink-0")
        : null}

      <div className="relative mx-auto min-h-0 w-full max-w-[24rem] flex-1 px-4 pt-2">
        {activeRegion === "thread.left"
          ? target("thread.left", "thread.left", "absolute inset-y-0 left-0 w-3")
          : null}
        {activeRegion === "thread.right"
          ? target("thread.right", "thread.right", "absolute inset-y-0 right-0 w-3")
          : null}

        <div className="mb-1">
          {messageSlotExample("message.before", "system")}
          <div className="text-muted-foreground flex items-center gap-1.5 text-[5.5px]">
            <span className="h-px flex-1 bg-border" />
            <span className="rounded-full border bg-background px-1.5 py-0.5">
              {tPi("extensions.toolbox.details.projectPanorama.systemMessage")}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
          {messageSlotExample("message.after", "system")}
        </div>

        <div className="mb-1.5 flex flex-col items-end">
          <div className="w-full">{messageSlotExample("message.before", "user")}</div>
          <div className="max-w-[74%] rounded-xl rounded-br-sm bg-muted px-2.5 py-1.5 text-[6.5px] leading-[1.35]">
            <div>{tPi("extensions.toolbox.details.projectPanorama.userMessage")}</div>
            <div className="mt-1 flex flex-wrap justify-end gap-1 text-[5px] text-muted-foreground">
              <span className="rounded border bg-background/70 px-1 py-0.5">
                {tPi("extensions.toolbox.details.projectPanorama.imageMessage")}
              </span>
              <span className="rounded border bg-background/70 px-1 py-0.5">
                {tPi("extensions.toolbox.details.projectPanorama.fileMessage")}
              </span>
            </div>
          </div>
          <div className="w-full">{messageActionsExample("end", "user")}</div>
          <div className="w-full">{messageSlotExample("message.after", "user")}</div>
        </div>

        {target(
          "message.root",
          tPi("extensions.toolbox.details.projectRegions.message"),
          "p-1",
          <div className="w-full min-w-0">
            {messageSlotExample("message.before", "assistant")}
            <p className="text-[6px] leading-[1.4]">
              {tPi("extensions.toolbox.details.projectPanorama.assistantTextMessage")}
            </p>
            <div className="mt-1 grid grid-cols-2 gap-1 text-[5px] text-muted-foreground">
              <span className="rounded-md border bg-muted/30 px-1.5 py-1">
                {tPi("extensions.toolbox.details.projectPanorama.reasoningMessage")}
              </span>
              <span className="rounded-md border bg-muted/30 px-1.5 py-1">
                {tPi("extensions.toolbox.details.projectPanorama.toolMessage")}
              </span>
            </div>
            {target(
              "message.content",
              tPi("extensions.toolbox.details.projectRegions.part"),
              "mt-1 rounded-lg border bg-card p-2 shadow-sm",
              <>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[8px] font-semibold">
                      {tShell("extensions.generativeUi.preview.title")}
                    </div>
                    <div className="mt-0.5 truncate text-[6px] text-muted-foreground">
                      {tShell("extensions.generativeUi.preview.caption")}
                    </div>
                  </div>
                  <span className="rounded-md border px-2 py-1 text-[6px] font-medium">
                    {tShell("extensions.generativeUi.preview.action")}
                  </span>
                </div>
                <div className="my-2 border-t" />
                <p className="line-clamp-2 text-[6.5px] leading-[1.45] text-muted-foreground">
                  {tShell("extensions.generativeUi.preview.body")}
                </p>
              </>,
            )}
            <div className="mt-1 flex flex-wrap gap-1 text-[5px] text-muted-foreground">
              <span className="rounded-full bg-muted px-1.5 py-0.5">
                {tPi("extensions.toolbox.details.projectPanorama.dataMessage")}
              </span>
              <span className="rounded-full bg-muted px-1.5 py-0.5">
                {tPi("extensions.toolbox.details.projectPanorama.sourceMessage")}
              </span>
              <span className="rounded-full bg-muted px-1.5 py-0.5">
                {tPi("extensions.toolbox.details.projectPanorama.audioMessage")}
              </span>
              <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-destructive">
                {tPi("extensions.toolbox.details.projectPanorama.errorMessage")}
              </span>
            </div>
            {messageActionsExample("start", "assistant")}
            {messageSlotExample("message.after", "assistant")}
          </div>,
        )}
      </div>

      {activeRegion === "thread.after"
        ? target("thread.after", "thread.after", "mx-auto h-2 w-full max-w-[22rem] shrink-0")
        : null}
      <div className="mx-auto w-full max-w-[23rem] shrink-0 px-4 pb-2">
        {activeRegion === "composer.before"
          ? target("composer.before", "composer.before", "h-2")
          : null}
        <div className="relative overflow-hidden rounded-[0.9rem] border bg-muted/45 p-px shadow-sm [--composer-preview-height:4.0625rem] [--protruding-preview-height:1.5625rem]">
          <div className="flex h-[var(--protruding-preview-height)] min-w-0 items-center justify-between gap-1 px-2">
            {target(
              "composer.header.left",
              "composer.header.left",
              "flex min-w-0 items-center gap-1 text-[5.5px] text-muted-foreground",
              <>
                <FolderIcon className="size-2.5 shrink-0" />
                <span className="truncate">
                  {tPi("extensions.toolbox.details.projectPanorama.activeProject")}
                </span>
              </>,
            )}
            {target(
              "composer.header.right",
              "composer.header.right",
              "flex shrink-0 items-center gap-1 text-[5.5px] text-muted-foreground",
              <>
                <GitPullRequestIcon className="size-2.5" />
                <span>main</span>
              </>,
            )}
          </div>
          <div className="relative z-10 min-h-[var(--composer-preview-height)] -mt-px rounded-[0.8rem] border bg-background p-2 shadow-sm">
            {activeRegion === "composer.overlay"
              ? target(
                  "composer.overlay",
                  "composer.overlay",
                  "absolute inset-0 z-10 rounded-[0.8rem] bg-primary/10 ring-1 ring-primary/50",
                )
              : null}
            <div className="h-7 text-[6.5px] text-muted-foreground">
              {tPi("extensions.toolbox.details.projectPanorama.inputPlaceholder")}
            </div>
            <div className="flex items-center gap-1">
              {target(
                "composer.actions.left",
                "composer.actions.left",
                "flex items-center gap-0.5",
                <span className="rounded-full border px-1.5 py-0.5 text-[5.5px] text-muted-foreground">
                  GPT-5
                </span>,
              )}
              <MiniIconButton>
                <PaperclipIcon className="size-2.5" />
              </MiniIconButton>
              <span className="flex-1" />
              {activeRegion === "composer.actions.right"
                ? target(
                    "composer.actions.right",
                    "composer.actions.right",
                    "flex items-center",
                    <MiniIconButton>
                      <MoreHorizontalIcon className="size-2.5" />
                    </MiniIconButton>,
                  )
                : null}
              <MiniIconButton>
                <MicIcon className="size-2.5" />
              </MiniIconButton>
              <span className="bg-foreground text-background flex size-5 items-center justify-center rounded-full">
                <ArrowUpIcon className="size-2.5" />
              </span>
            </div>
          </div>
        </div>
        {activeRegion === "composer.after"
          ? target("composer.after", "composer.after", "h-2")
          : null}
      </div>
    </div>
  );
}

function MiniMainView() {
  const { t: tPi } = usePiI18n();
  const { t: tShell } = useI18n();

  return (
    <div className="size-full overflow-hidden bg-background p-3">
      <div className="mx-auto grid h-full max-w-[28rem] grid-rows-[auto_auto_1fr] gap-2">
        <div className="flex items-center gap-2">
          <span className="bg-muted flex size-7 items-center justify-center rounded-lg">
            <ToolboxIcon className="size-3" />
          </span>
          <div className="min-w-0">
            <div className="text-[9px] font-semibold">{tShell("extensions.generativeUi.name")}</div>
            <div className="text-[6px] text-muted-foreground">
              {tPi("extensions.toolbox.origins.installedComponent")}
            </div>
          </div>
          <span className="ml-auto rounded bg-emerald-500/10 px-1.5 py-0.5 text-[6px] text-emerald-700 dark:text-emerald-300">
            {tPi("extensions.toolbox.status.installed")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-lg border p-2 text-[6px]">
          <div>
            <div className="text-muted-foreground">
              {tPi("extensions.toolbox.details.insertionPosition")}
            </div>
            <div className="mt-0.5 font-medium">
              {tShell("extensions.generativeUi.placement.surface")}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {tPi("extensions.toolbox.details.extensionPoint")}
            </div>
            <code className="mt-0.5 block truncate">context.renderers.parts</code>
          </div>
        </div>
        <div className="grid min-h-0 grid-cols-[1.15fr_0.85fr] gap-2">
          <div className="rounded-lg border bg-muted/20 p-2">
            <div className="text-[6px] font-semibold">
              {tPi("extensions.toolbox.details.componentContributions")}
            </div>
            <div className="mt-2 rounded-md border bg-background p-2">
              <div className="flex items-center gap-1">
                <span className="rounded bg-muted px-1 py-0.5 text-[5.5px]">
                  {tPi("extensions.toolbox.componentContributionKinds.messagePartRenderer")}
                </span>
                <code className="truncate text-[5.5px] text-muted-foreground">
                  workbench.generative-ui.message-part
                </code>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[5.5px]">
                <div>
                  <div className="text-muted-foreground">
                    {tPi("extensions.toolbox.details.insertionPosition")}
                  </div>
                  <div className="mt-0.5 line-clamp-2">
                    {tShell("extensions.generativeUi.placement.surface")}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">
                    {tPi("extensions.toolbox.details.renderMountPoint")}
                  </div>
                  <code className="mt-0.5 block truncate">MessagePartRendererHost</code>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-lg border p-2">
            <div className="text-[6px] font-semibold">
              {tPi("extensions.toolbox.details.stylePreview")}
            </div>
            <div className="mt-2 rounded-md border bg-card p-2 shadow-sm">
              <div className="text-[6px] font-semibold">
                {tShell("extensions.generativeUi.preview.title")}
              </div>
              <div className="mt-1 text-[5.5px] text-muted-foreground">
                {tShell("extensions.generativeUi.preview.caption")}
              </div>
              <div className="mt-2 rounded-md border px-2 py-1 text-center text-[5.5px]">
                {tShell("extensions.generativeUi.preview.action")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniWorkspace({ activeRegion }: { activeRegion: ProjectPreviewRegion }) {
  const { t: tPi } = usePiI18n();
  const target = (
    value: ProjectPreviewRegion,
    label: string,
    className?: string,
    children?: ReactNode,
  ) => (
    <PanoramaTarget activeRegion={activeRegion} region={value} label={label} className={className}>
      {children}
    </PanoramaTarget>
  );

  return (
    <aside className="bg-background flex min-h-0 flex-col border-l">
      <header className="flex h-5 shrink-0 items-center gap-0.5 px-1">
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[6px] font-medium">
            <FileCode2Icon className="size-2" />
            {tPi("extensions.toolbox.details.projectPanorama.files")}
          </span>
          <span className="text-muted-foreground flex items-center gap-1 px-1 text-[6px]">
            <GitPullRequestIcon className="size-2" />
            {tPi("extensions.toolbox.details.projectPanorama.review")}
          </span>
        </span>
        {target(
          "panel.right.add-menu",
          "panel.right.add-menu",
          "flex items-center",
          <MiniIconButton>
            <PlusIcon className="size-2.5" />
          </MiniIconButton>,
        )}
        {target(
          "panel.right.actions",
          "panel.right.actions",
          "flex items-center",
          <MiniIconButton>
            <MoreHorizontalIcon className="size-2.5" />
          </MiniIconButton>,
        )}
        <MiniIconButton>
          <Maximize2Icon className="size-2.5" />
        </MiniIconButton>
        {activeRegion === "workspace.actions"
          ? target(
              "workspace.actions",
              tPi("extensions.toolbox.details.projectRegions.workspace"),
              "flex items-center",
              <MiniIconButton>
                <MoreHorizontalIcon className="size-2.5" />
              </MiniIconButton>,
            )
          : null}
      </header>

      {target(
        "workspace.surface",
        tPi("extensions.toolbox.details.projectRegions.surface"),
        "flex min-h-0 flex-1 flex-col",
        <>
          <div className="flex h-6 shrink-0 items-center gap-1 border-b px-2 text-[6px] text-muted-foreground">
            <FolderIcon className="size-2.5" />
            <span>workbench-ui</span>
            <ChevronRightIcon className="size-2" />
            <span>extensions</span>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[4.7rem_1fr]">
            <div className="border-r p-1.5 text-[6px]">
              <div className="flex items-center gap-1 py-0.5 font-medium">
                <ChevronDownIcon className="size-2" />
                <FolderIcon className="size-2.5" />
                extensions
              </div>
              <div className="flex items-center gap-1 py-0.5 pl-2 text-muted-foreground">
                <ChevronDownIcon className="size-2" />
                installable
              </div>
              <div className="flex items-center gap-1 py-0.5 pl-4 text-sky-700 dark:text-sky-300">
                <FileCode2Icon className="size-2.5" />
                extension.ts
              </div>
            </div>
            <div className="overflow-hidden bg-muted/20 p-2 font-mono text-[5.5px] leading-[1.65] text-muted-foreground">
              <div>
                <span className="mr-2 text-muted-foreground/50">1</span>
                <span className="text-violet-600 dark:text-violet-300">export const</span>{" "}
                generativeUiExtension
              </div>
              <div>
                <span className="mr-2 text-muted-foreground/50">2</span>
                defineExtension({"{"}
              </div>
              <div>
                <span className="mr-2 text-muted-foreground/50">3</span>
                {"  "}distribution:{" "}
                <span className="text-emerald-600">&quot;installable&quot;</span>
              </div>
              <div>
                <span className="mr-2 text-muted-foreground/50">4</span>
                {"  "}setup(context) {"{"}
              </div>
              <div>
                <span className="mr-2 text-muted-foreground/50">5</span>
                {"    "}context.renderers.parts.register(...)
              </div>
            </div>
          </div>
          {activeRegion === "workspace.empty.actions"
            ? target(
                "workspace.empty.actions",
                tPi("extensions.toolbox.details.projectRegions.emptyActions"),
                "absolute right-2 bottom-2 flex items-center",
                <span className="rounded-md border bg-background px-1.5 py-1 text-[5.5px]">
                  {tPi("extensions.toolbox.details.projectPanorama.openFile")}
                </span>,
              )
            : null}
        </>,
      )}
    </aside>
  );
}

function MiniStatusbar({ activeRegion }: { activeRegion: ProjectPreviewRegion }) {
  const { t: tPi } = usePiI18n();

  return (
    <footer className="bg-background text-muted-foreground flex h-3.5 shrink-0 items-center justify-between gap-2 border-t px-1.5 text-[5.5px]">
      <PanoramaTarget
        activeRegion={activeRegion}
        region="statusbar.left"
        label="statusbar.left"
        className="flex items-center gap-1"
      >
        <CircleIcon className="size-1.5 fill-emerald-500 text-emerald-500" />
        Pi v0.84
      </PanoramaTarget>
      <PanoramaTarget
        activeRegion={activeRegion}
        region="statusbar.right"
        label="statusbar.right"
        className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap"
      >
        <span>{tPi("extensions.toolbox.details.projectPanorama.runtimeReady")}</span>
        <span>{tPi("extensions.toolbox.details.projectPanorama.turns")}</span>
        <span>·</span>
        <span>{tPi("extensions.toolbox.details.projectPanorama.steps")}</span>
        <span>|</span>
        <span>{tPi("extensions.toolbox.details.projectPanorama.llmTime")}</span>
        <span>|</span>
        <span>{tPi("extensions.toolbox.details.projectPanorama.inputTokens")}</span>
        <span>·</span>
        <span>{tPi("extensions.toolbox.details.projectPanorama.outputTokens")}</span>
      </PanoramaTarget>
    </footer>
  );
}

function MiniPanel({
  activeRegion,
  region,
}: {
  activeRegion: ProjectPreviewRegion;
  region: "panel.bottom" | "panel.left" | "panel.right";
}) {
  const { t: tPi } = usePiI18n();
  const position =
    region === "panel.left"
      ? "top-5 bottom-3.5 left-[8.375rem] w-28"
      : region === "panel.bottom"
        ? "right-[13.125rem] bottom-3.5 left-[8.375rem] h-24"
        : "top-0 right-0 bottom-0 w-[13.125rem]";

  return (
    <PanoramaTarget
      activeRegion={activeRegion}
      region={region}
      label={tPi("extensions.toolbox.details.projectRegions.panel")}
      className={cn(
        "bg-background absolute z-30 overflow-hidden border shadow-xl",
        position,
        activeRegion !== region && "hidden",
      )}
    >
      <div className="flex h-7 items-center gap-1 border-b px-2 text-[6.5px] font-semibold">
        <SquareTerminalIcon className="size-2.5" />
        {tPi("extensions.toolbox.details.projectPanorama.panelTitle")}
        <span className="ml-auto text-muted-foreground">×</span>
      </div>
      <div className="bg-muted/20 h-full p-2 font-mono text-[5.5px] leading-4 text-muted-foreground">
        <div>$ pnpm dev</div>
        <div className="text-emerald-600 dark:text-emerald-300">✓ Ready on localhost:3000</div>
      </div>
    </PanoramaTarget>
  );
}

function MiniGlobalLayer({ activeRegion }: { activeRegion: ProjectPreviewRegion }) {
  const { t: tPi } = usePiI18n();
  const overlayActive = activeRegion === "shell.overlay";
  const settingsActive = activeRegion === "settings";
  if (!overlayActive && !settingsActive) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/55 p-6 backdrop-blur-[1px]">
      {settingsActive ? (
        <PanoramaTarget
          activeRegion={activeRegion}
          region="settings"
          label={tPi("extensions.toolbox.details.projectRegions.settings")}
          className="bg-background grid h-52 w-[27rem] grid-cols-[7rem_1fr] overflow-hidden rounded-xl border shadow-2xl"
        >
          <div className="bg-muted/40 border-r p-2">
            <div className="mb-2 text-[8px] font-semibold">
              {tPi("extensions.toolbox.details.projectPanorama.settings")}
            </div>
            {[
              tPi("extensions.toolbox.details.projectPanorama.general"),
              tPi("extensions.toolbox.details.projectPanorama.appearance"),
              tPi("extensions.toolbox.details.projectPanorama.language"),
            ].map((item, index) => (
              <div
                key={item}
                className={cn(
                  "rounded-md px-1.5 py-1 text-[6px]",
                  index === 0 && "bg-background font-medium shadow-sm",
                )}
              >
                {item}
              </div>
            ))}
          </div>
          <div className="p-3">
            <div className="text-[9px] font-semibold">
              {tPi("extensions.toolbox.details.projectPanorama.general")}
            </div>
            <div className="mt-3 grid gap-2">
              <div className="rounded-lg border p-2">
                <div className="text-[6px] font-medium">
                  {tPi("extensions.toolbox.details.projectPanorama.appearance")}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1">
                  <div className="h-8 rounded-md border bg-background" />
                  <div className="h-8 rounded-md border bg-zinc-900" />
                  <div className="h-8 rounded-md border bg-muted" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-2 text-[6px]">
                <span>{tPi("extensions.toolbox.details.projectPanorama.language")}</span>
                <span className="rounded-md border px-2 py-1">
                  {tPi("extensions.toolbox.details.projectPanorama.localeName")}
                </span>
              </div>
            </div>
          </div>
        </PanoramaTarget>
      ) : (
        <PanoramaTarget
          activeRegion={activeRegion}
          region="shell.overlay"
          label={tPi("extensions.toolbox.details.projectRegions.overlay")}
          className="bg-background w-80 overflow-hidden rounded-xl border p-2 shadow-2xl"
        >
          <div className="flex h-8 items-center gap-2 rounded-lg border px-2 text-[7px] text-muted-foreground">
            <SearchIcon className="size-3" />
            {tPi("extensions.toolbox.details.projectPanorama.commandSearch")}
          </div>
          <div className="mt-1 rounded-lg bg-muted/45 px-2 py-2 text-[7px] font-medium">
            {tPi("extensions.toolbox.details.projectPanorama.openComponentExtension")}
          </div>
        </PanoramaTarget>
      )}
    </div>
  );
}

export function ComponentPlacementPreview({
  contribution,
}: {
  contribution: ToolboxComponentContribution;
}) {
  const { t: tPi } = usePiI18n();
  const activeRegion = resolveComponentProjectPreviewRegion(contribution);
  const shellActive = activeRegion === "shell.background";
  const toolboxMode = activeRegion === "sidebar.toolbox" || activeRegion === "main-view";

  return (
    <figure
      className="grid gap-2"
      aria-label={tPi("extensions.toolbox.details.projectPreviewAria", {
        surface: contribution.surface,
      })}
    >
      <div className="overflow-x-auto pb-1">
        <PanoramaTarget
          activeRegion={activeRegion}
          region="shell.background"
          label={tPi("extensions.toolbox.details.projectRegions.background")}
          className={cn(
            "bg-background relative h-[24rem] min-w-[48rem] overflow-hidden rounded-xl border shadow-[0_16px_45px_-28px_rgba(0,0,0,0.6)]",
            shellActive && "bg-sky-500/5",
          )}
        >
          <div className="grid size-full grid-cols-[8.375rem_minmax(0,1fr)]">
            <MiniSidebar activeRegion={activeRegion} toolboxMode={toolboxMode} />
            <div className="flex min-h-0 min-w-0 flex-col">
              <MiniHeader activeRegion={activeRegion} toolboxMode={toolboxMode} />
              <div className="grid min-h-0 flex-1 grid-cols-[minmax(22rem,1fr)_13.125rem]">
                <div className="flex min-h-0 min-w-0 flex-col">
                  <PanoramaTarget
                    activeRegion={activeRegion}
                    region="main-view"
                    label={tPi("extensions.toolbox.details.projectRegions.main")}
                    className="min-h-0 flex-1 overflow-hidden"
                  >
                    {toolboxMode ? (
                      <MiniMainView />
                    ) : (
                      <MiniConversation activeRegion={activeRegion} />
                    )}
                  </PanoramaTarget>
                  <MiniStatusbar activeRegion={activeRegion} />
                </div>
                <MiniWorkspace activeRegion={activeRegion} />
              </div>
            </div>
          </div>

          <MiniPanel activeRegion={activeRegion} region="panel.left" />
          <MiniPanel activeRegion={activeRegion} region="panel.bottom" />
          <MiniPanel activeRegion={activeRegion} region="panel.right" />
          <MiniGlobalLayer activeRegion={activeRegion} />
        </PanoramaTarget>
      </div>

      <figcaption className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-500 shadow-sm" />
        <span>
          {tPi("extensions.toolbox.details.projectPreviewLegend", {
            surface: contribution.surface,
          })}
        </span>
      </figcaption>
    </figure>
  );
}
