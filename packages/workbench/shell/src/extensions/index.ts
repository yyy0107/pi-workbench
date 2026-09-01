export {
  shellBuiltinExtensions,
  shellCoreExtensions,
  shellExtensionGroups,
  shellSettingsExtensions,
  shellWorkspaceExtensions,
} from "./builtin-extensions";
export {
  createSettingsExtension,
  settingsExtension,
  type SettingsExtensionOptions,
} from "./builtin/settings";
export {
  setComponentExtensionInstalled,
  useInstallableComponentExtensions,
  useInstalledComponentExtensions,
  type InstallableComponentExtensionState,
} from "./component-extension-installation";
