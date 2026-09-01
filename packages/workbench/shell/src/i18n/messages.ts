import { assistantEnUS } from "../assistant-ui/i18n/en-US";
import { assistantZhCN } from "../assistant-ui/i18n/zh-CN";
import { rightWorkspaceEnUS } from "../right-workspace/presentation/i18n/en-US";
import { rightWorkspaceZhCN } from "../right-workspace/presentation/i18n/zh-CN";
import { platformExtensionsEnUS } from "@workbench/extension-host/i18n/en-US";
import { platformExtensionsZhCN } from "@workbench/extension-host/i18n/zh-CN";
import { extensionsEnUS } from "./extensions/en-US";
import { extensionsZhCN } from "./extensions/zh-CN";
import { workbenchEnUS } from "./workbench/en-US";
import { workbenchZhCN } from "./workbench/zh-CN";

import type { Locale } from "./config";
import type { CatalogShape } from "./types";

const enUS = {
  assistant: assistantEnUS,
  rightWorkspace: rightWorkspaceEnUS,
  workbench: workbenchEnUS,
  extensions: extensionsEnUS,
  platform: {
    extensions: platformExtensionsEnUS,
  },
} as const;

export type Messages = CatalogShape<typeof enUS>;

const zhCN = {
  assistant: assistantZhCN,
  rightWorkspace: rightWorkspaceZhCN,
  workbench: workbenchZhCN,
  extensions: extensionsZhCN,
  platform: {
    extensions: platformExtensionsZhCN,
  },
} satisfies Messages;

export const messages = {
  "en-US": enUS,
  "zh-CN": zhCN,
} satisfies Record<Locale, Messages>;
