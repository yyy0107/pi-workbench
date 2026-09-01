"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import {
  MemoryGitReviewService,
  type GitReviewService,
} from "../extensions/workspace-review/git-review-service";
import {
  FileWorkspaceTargetService,
  type FileWorkspaceTargetService as FileWorkspaceTargetServicePort,
} from "../services/file-workspace-target-service";

/**
 * Mutable UI-only services owned by exactly one Pi contribution installation.
 *
 * These used to be module singletons, which let two mounted Workbench roots with identical
 * repository or capability IDs observe each other's state. Keep the factory explicit so tests and
 * alternate renderer hosts can construct isolated installations without a process-global reset.
 */
export interface PiContributionInstallationServices {
  readonly fileWorkspaceTargets: FileWorkspaceTargetServicePort;
  readonly gitReview: GitReviewService;
  dispose(): void;
}

export function createPiContributionInstallationServices(): PiContributionInstallationServices {
  const fileWorkspaceTargets = new FileWorkspaceTargetService();
  const gitReview = new MemoryGitReviewService();
  return Object.freeze({
    fileWorkspaceTargets,
    gitReview,
    dispose(): void {
      fileWorkspaceTargets.dispose();
      gitReview.dispose();
    },
  });
}

const PiContributionInstallationServicesContext =
  createContext<PiContributionInstallationServices | null>(null);

export function PiContributionInstallationServicesProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const services = useMemo(createPiContributionInstallationServices, []);
  const lifecycleRef = useRef(0);

  useLayoutEffect(() => {
    const lifecycle = ++lifecycleRef.current;
    return () => {
      // Preserve the resource for React development Strict Mode's cleanup → setup replay, but
      // release listeners and in-memory state after an actual provider unmount.
      queueMicrotask(() => {
        if (lifecycleRef.current === lifecycle) services.dispose();
      });
    };
  }, [services]);

  return (
    <PiContributionInstallationServicesContext.Provider value={services}>
      {children}
    </PiContributionInstallationServicesContext.Provider>
  );
}

function usePiContributionInstallationServices(): PiContributionInstallationServices {
  const services = useContext(PiContributionInstallationServicesContext);
  if (!services) {
    throw new Error(
      "PiAgentRuntimeContributionsProvider is required by Pi contribution components.",
    );
  }
  return services;
}

export function usePiFileWorkspaceTargetService(): FileWorkspaceTargetServicePort {
  return usePiContributionInstallationServices().fileWorkspaceTargets;
}

export function usePiGitReviewService(): GitReviewService {
  return usePiContributionInstallationServices().gitReview;
}
