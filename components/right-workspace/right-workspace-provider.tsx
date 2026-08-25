"use client";

import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import type { OpenerRegistry } from "@/platform/extensions";
import { DefaultOpenerService } from "@/services/opener-service";
import {
  loadWorkbenchSettingsPreferences,
  toWorkbenchSettingsJsonObject,
  updateWorkbenchSettingsPreferences,
} from "@/runtime/pi/client/settings/workbench-settings-client";

import {
  DefaultRightWorkspaceController,
  RIGHT_WORKSPACE_STORAGE_KEY,
  type WorkspaceStorage,
} from "./core/workspace-controller";
import type { WorkspaceContext, WorkspaceSurfaceRegistry } from "./core/surface-types";
import { createRightWorkspaceStore } from "./core/workspace-store";
import { MemoryWorkspaceFeedbackStore } from "./feedback/feedback-store";
import { RightWorkspaceReactContext, type RightWorkspaceEnvironment } from "./workspace-context";

const DEFAULT_CONTEXT: WorkspaceContext = {
  applicationId: "pi-workbench",
};

export function RightWorkspaceProvider({
  children,
  openers,
  registry,
}: Readonly<{
  children: ReactNode;
  openers: OpenerRegistry;
  registry: WorkspaceSurfaceRegistry;
}>) {
  const [store] = useState(createRightWorkspaceStore);
  const [feedback] = useState(() => new MemoryWorkspaceFeedbackStore());
  const controller = useMemo(
    () => new DefaultRightWorkspaceController(store, registry),
    [registry, store],
  );
  const hydrationRevision = useMemo(() => controller.captureMutationRevision(), [controller]);
  const opener = useMemo(
    () => new DefaultOpenerService(openers, controller),
    [controller, openers],
  );
  const [context, setContext] = useState<WorkspaceContext>(DEFAULT_CONTEXT);

  useLayoutEffect(() => {
    let cancelled = false;
    const legacySerialized = window.localStorage.getItem(RIGHT_WORKSPACE_STORAGE_KEY);

    void loadWorkbenchSettingsPreferences()
      .then(async (preferences) => {
        const storedSerialized = preferences.rightWorkspace
          ? JSON.stringify(preferences.rightWorkspace)
          : null;
        if (!storedSerialized && legacySerialized) {
          const legacyValue: unknown = JSON.parse(legacySerialized);
          if (
            typeof legacyValue === "object" &&
            legacyValue !== null &&
            !Array.isArray(legacyValue)
          ) {
            await updateWorkbenchSettingsPreferences({
              rightWorkspace: toWorkbenchSettingsJsonObject(legacyValue),
            });
          }
        }
        if (cancelled) return;

        let serialized = storedSerialized ?? legacySerialized;
        const storage: WorkspaceStorage = {
          getItem(key) {
            return key === RIGHT_WORKSPACE_STORAGE_KEY ? serialized : null;
          },
          setItem(key, value) {
            if (key !== RIGHT_WORKSPACE_STORAGE_KEY) return;
            serialized = value;
            try {
              const parsed: unknown = JSON.parse(value);
              if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                void updateWorkbenchSettingsPreferences({
                  rightWorkspace: toWorkbenchSettingsJsonObject(parsed),
                }).catch(() => undefined);
              }
            } catch {
              // The controller serializer is expected to produce JSON; keep the live layout.
            }
          },
        };
        controller.hydrate(storage, hydrationRevision);
        window.localStorage.removeItem(RIGHT_WORKSPACE_STORAGE_KEY);
      })
      .catch(() => {
        if (!cancelled) controller.hydrate(window.localStorage, hydrationRevision);
      });

    return () => {
      cancelled = true;
    };
  }, [controller, hydrationRevision]);

  const value = useMemo<RightWorkspaceEnvironment>(
    () => ({
      controller,
      opener,
      store,
      registry,
      feedback,
      context,
      setContext,
    }),
    [context, controller, feedback, opener, registry, store],
  );

  return (
    <RightWorkspaceReactContext.Provider value={value}>
      {children}
    </RightWorkspaceReactContext.Provider>
  );
}
