import type { ExtensionToolboxCapability, WorkbenchExtension } from "@workbench/extension-sdk";

import { generativeUiExtension } from "./installable/generative-ui";

type InstallableComponentExtension = Omit<WorkbenchExtension, "toolbox"> & {
  readonly toolbox: ExtensionToolboxCapability & { readonly distribution: "installable" };
};

/**
 * 随应用构建、但由用户安装状态决定是否激活的组件拓展目录。
 *
 * 它与 `builtinExtensions` 分离：这里的定义可以被安装、卸载并重新安装；静态目录只负责提供
 * 受信任的可安装代码，不代表当前处于激活状态。
 */
export const installableComponentExtensions = [
  generativeUiExtension,
] satisfies readonly InstallableComponentExtension[];
