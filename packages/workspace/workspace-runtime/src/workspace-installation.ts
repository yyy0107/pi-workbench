import type {
  OpenerService,
  WorkspaceContext,
  WorkspaceSurfaceOpenOperations,
  WorkspaceSurfaceRegistry,
} from "@workbench/extension-sdk";

import {
  DefaultRightWorkspaceController,
  type LocalizableTextValidator,
  type RightWorkspacePersistencePort,
} from "./workspace-controller";
import {
  createWorkspaceDraftStore,
  type RightWorkspaceDraftPersistencePort,
  type WorkspaceDraftStore,
} from "./workspace-draft-store";
import { MemoryWorkspaceFeedbackStore } from "./workspace-feedback-store";
import { createRightWorkspaceStore, type RightWorkspaceStoreApi } from "./workspace-store";

export type RightWorkspaceOpenerFactory = (
  surfaces: WorkspaceSurfaceOpenOperations,
) => OpenerService;

export type RightWorkspaceStateStore = Pick<
  RightWorkspaceStoreApi,
  "getInitialState" | "getState" | "subscribe"
>;

export interface RightWorkspaceInstallationInputs {
  readonly createOpener: RightWorkspaceOpenerFactory;
  readonly draftPersistence?: RightWorkspaceDraftPersistencePort;
  readonly initialContext: WorkspaceContext;
  readonly persistence?: RightWorkspacePersistencePort;
  readonly registry: WorkspaceSurfaceRegistry;
  readonly validateLocalizableText: LocalizableTextValidator;
}

export interface RightWorkspaceInstallation {
  readonly controller: DefaultRightWorkspaceController;
  readonly feedback: MemoryWorkspaceFeedbackStore;
  readonly initialContext: WorkspaceContext;
  readonly inputs: RightWorkspaceInstallationInputs;
  readonly opener: OpenerService;
  readonly registry: WorkspaceSurfaceRegistry;
  readonly store: RightWorkspaceStateStore;
  activatePersistence(): void;
  deactivatePersistence(): void;
  resolveDraftStore(): WorkspaceDraftStore;
  dispose(): void;
}

function createReadonlyStore(store: RightWorkspaceStoreApi): RightWorkspaceStateStore {
  return Object.freeze({
    getInitialState: store.getInitialState,
    getState: store.getState,
    subscribe: store.subscribe,
  });
}

/** Creates the single mutable state installation consumed by headless and React hosts. */
export function createRightWorkspaceInstallation(
  inputs: RightWorkspaceInstallationInputs,
): RightWorkspaceInstallation {
  const mutableStore = createRightWorkspaceStore();
  let persistenceActive = false;
  let disposed = false;
  let draftStore: ReturnType<typeof createWorkspaceDraftStore> | undefined;
  const controller = new DefaultRightWorkspaceController(mutableStore, inputs.registry, {
    validateLocalizableText: inputs.validateLocalizableText,
    ...(inputs.persistence
      ? {
          persistence: {
            read: () => inputs.persistence?.read() ?? Promise.resolve(null),
            write: (serialized) =>
              persistenceActive
                ? (inputs.persistence?.write(serialized) ?? Promise.resolve())
                : Promise.resolve(),
          },
        }
      : {}),
  });
  const feedback = new MemoryWorkspaceFeedbackStore();

  return Object.freeze({
    controller,
    feedback,
    initialContext: Object.freeze({ ...inputs.initialContext }),
    inputs,
    opener: inputs.createOpener(controller),
    registry: inputs.registry,
    store: createReadonlyStore(mutableStore),
    activatePersistence() {
      if (!disposed) persistenceActive = true;
    },
    deactivatePersistence() {
      persistenceActive = false;
    },
    resolveDraftStore() {
      if (disposed) {
        throw new Error("The RightWorkspace installation has been disposed.");
      }
      draftStore ??= createWorkspaceDraftStore(inputs.draftPersistence);
      return draftStore;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      persistenceActive = false;
      draftStore?.dispose();
      controller.dispose();
      feedback.dispose();
    },
  });
}
