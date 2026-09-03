"use client";

/** Finite renderer-composition seam for installing one Extension Host. */
export { ExtensionProvider, type ExtensionProviderProps } from "./extension-provider";
export {
  useOpenerRegistry,
  useSidebarSectionRegistry,
  useWorkspaceSurfaceRegistry,
} from "./extension-context";
