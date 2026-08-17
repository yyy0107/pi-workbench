import type * as React from "react";
import { GitHubIcon } from "@/components/icons/github";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { useI18n } from "@/i18n";

export function ThreadListSidebar({
  ...props
}: Omit<React.ComponentProps<typeof Sidebar>, "closeLabel" | "mobileDescription" | "mobileTitle">) {
  const { t } = useI18n();

  return (
    <Sidebar
      closeLabel={t("assistant.common.close")}
      mobileDescription={t("assistant.threads.sidebarDescription")}
      mobileTitle={t("assistant.threads.sidebarTitle")}
      {...props}
    >
      <SidebarHeader className="aui-sidebar-header mb-2 border-b">
        <div className="aui-sidebar-header-content flex items-center justify-between">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                render={
                  <a href="https://assistant-ui.com" target="_blank" rel="noopener noreferrer" />
                }
              >
                <div className="aui-sidebar-header-icon-wrapper bg-white text-sidebar-primary-foreground flex aspect-square size-9 items-center justify-center rounded-lg border">
                  <img
                    src="/pi-logo-on-light.svg"
                    alt="pi"
                    className="aui-sidebar-header-icon size-6"
                  />
                </div>
                <div className="aui-sidebar-header-heading me-6 flex flex-col gap-0.5 leading-none">
                  <span className="aui-sidebar-header-title font-semibold">Pi-Workbench</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>
      <SidebarContent className="aui-sidebar-content px-2">
        <ThreadList />
      </SidebarContent>
      <SidebarRail label={t("assistant.threads.toggleSidebar")} />
      <SidebarFooter className="aui-sidebar-footer border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={
                <a
                  href="https://github.com/assistant-ui/assistant-ui"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <div className="aui-sidebar-footer-icon-wrapper bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <GitHubIcon className="aui-sidebar-footer-icon size-4" />
              </div>
              <div className="aui-sidebar-footer-heading flex flex-col gap-0.5 leading-none">
                <span className="aui-sidebar-footer-title font-semibold">GitHub</span>
                <span>{t("assistant.sourceLink")}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
