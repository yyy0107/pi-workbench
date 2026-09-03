"use client";

import { useCallback, useMemo, type ReactNode } from "react";

import { PiAgentRuntimeContributionsProvider } from "@workbench/agent-runtime-pi-contributions/installation";
import {
  WorkbenchAgentRuntimeApplicationProvider,
  type WorkbenchAgentRuntimeInstallationOptions,
  type WorkbenchRuntimeContributionsProviderProps,
} from "@workbench/shell/application";
import { useI18n } from "@workbench/shell/i18n";

import { createInstalledAgentRuntime } from "./installed-agent-runtime";

const WEB_APPLICATION_ID = "pi-workbench";

function InstalledRuntimeContributions({
  children,
  runtimeConnection,
}: WorkbenchRuntimeContributionsProviderProps) {
  return (
    <PiAgentRuntimeContributionsProvider
      assets={{ fileViewerAssetBaseUrl: "/file-viewer/" }}
      branding={{ piLogoUrl: "/pi-logo-on-light.svg", runtimeName: "Pi" }}
      runtimeConnection={runtimeConnection}
    >
      {children}
    </PiAgentRuntimeContributionsProvider>
  );
}

/** Web selection point for the concrete Agent Runtime and its contribution bundle. */
export function WorkbenchAssistantRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useI18n();
  const copy = useMemo(
    () => ({
      titles: {
        attachment: t("workbench.chat.titles.attachmentAnalysis"),
        image: t("workbench.chat.titles.imageConversation"),
      },
      errors: {
        sessionBusy: t("workbench.chat.errors.sessionBusy"),
        emptyPrompt: t("workbench.chat.errors.emptyPrompt"),
        sessionNotFound: t("workbench.chat.errors.sessionNotFound"),
        invalidWorkingDirectory: t("workbench.chat.errors.invalidWorkingDirectory"),
        invalidWorkspace: t("workbench.chat.errors.invalidWorkspace"),
        modelNotAvailable: t("workbench.chat.errors.modelNotAvailable"),
        requestFailed: t("workbench.chat.errors.requestFailed"),
      },
    }),
    [t],
  );
  const createInstallation = useCallback(
    (options: WorkbenchAgentRuntimeInstallationOptions) =>
      createInstalledAgentRuntime({ ...options, copy }),
    [copy],
  );

  return (
    <WorkbenchAgentRuntimeApplicationProvider
      applicationId={WEB_APPLICATION_ID}
      createInstallation={createInstallation}
      runtimeContributionsProvider={InstalledRuntimeContributions}
    >
      {children}
    </WorkbenchAgentRuntimeApplicationProvider>
  );
}
