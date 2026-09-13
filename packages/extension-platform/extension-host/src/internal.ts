/** Host-side composition primitives. SDK lifecycle/registry internals are not re-exported here. */
export type {
  ExtensionEnvironment,
  ExtensionErrorDetails,
  ExtensionErrorHandler,
  ExtensionErrorSource,
} from "./extension-context";
export {
  ExtensionReactContext,
  useExtensionEnvironment,
  useExtensionManager,
  useOpenerRegistry,
  useWorkspaceSurfaceRegistry,
} from "./extension-context";
export { ExtensionProvider, type ExtensionProviderProps } from "./extension-provider";
