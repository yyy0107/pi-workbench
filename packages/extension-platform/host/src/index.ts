/** Runtime hooks for mounted extension components. Authoring contracts come from extension-sdk. */
export type {
  ExtensionErrorDetails,
  ExtensionErrorHandler,
  ExtensionErrorSource,
} from "./extension-context";
export {
  useCommandService,
  useComposerCommandRegistry,
  useExtensionErrorReporter,
  useMainViewRegistry,
  useMainViewService,
  useNavigationService,
  usePanelRegistry,
  usePanelService,
  useSettingsRegistry,
  useSidebarSectionRegistry,
} from "./extension-context";
