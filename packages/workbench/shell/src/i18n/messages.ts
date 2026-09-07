import { chatContentEnUS } from "../chat/i18n/en-US";
import { chatContentZhCN } from "../chat/i18n/zh-CN";
import { assistantEnUS } from "./chat/en-US";
import { assistantZhCN } from "./chat/zh-CN";
import { rightWorkspaceEnUS } from "../right-workspace/presentation/i18n/en-US";
import { rightWorkspaceZhCN } from "../right-workspace/presentation/i18n/zh-CN";
import { platformExtensionsEnUS } from "@workbench/extension-host/i18n/en-US";
import { platformExtensionsZhCN } from "@workbench/extension-host/i18n/zh-CN";
import { extensionsEnUS } from "./extensions/en-US";
import { extensionsZhCN } from "./extensions/zh-CN";
import { workbenchEnUS } from "./workbench/en-US";
import { workbenchZhCN } from "./workbench/zh-CN";
import { uiEnUS } from "../ui/i18n/en-US";
import { uiZhCN } from "../ui/i18n/zh-CN";

import type { Locale } from "./config";
import type { CatalogShape } from "./types";

const enUS = {
  chatContent: chatContentEnUS,
  assistant: assistantEnUS,
  rightWorkspace: rightWorkspaceEnUS,
  workbench: workbenchEnUS,
  extensions: extensionsEnUS,
  ui: uiEnUS,
  platform: {
    extensions: platformExtensionsEnUS,
  },
} as const;

export type Messages = CatalogShape<typeof enUS>;

const zhCN = {
  chatContent: chatContentZhCN,
  assistant: assistantZhCN,
  rightWorkspace: rightWorkspaceZhCN,
  workbench: workbenchZhCN,
  extensions: extensionsZhCN,
  ui: uiZhCN,
  platform: {
    extensions: platformExtensionsZhCN,
  },
} satisfies Messages;

export const messages = {
  "en-US": enUS,
  "zh-CN": zhCN,
} satisfies Record<Locale, Messages>;
