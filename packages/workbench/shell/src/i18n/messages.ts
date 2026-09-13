import { platformExtensionsEnUS } from "@workbench/extension-host/i18n/en-US";
import { platformExtensionsZhCN } from "@workbench/extension-host/i18n/zh-CN";
import { extensionsEnUS } from "./extensions-en-US";
import { extensionsZhCN } from "./extensions-zh-CN";
import { workbenchEnUS } from "./workbench-en-US";
import { workbenchZhCN } from "./workbench-zh-CN";

import type { Locale } from "@workbench/i18n/runtime";
import type { CatalogShape } from "@workbench/i18n/runtime";

const enUS = {
  workbench: workbenchEnUS,
  extensions: extensionsEnUS,
  platform: {
    extensions: platformExtensionsEnUS,
  },
} as const;

export type Messages = CatalogShape<typeof enUS>;

const zhCN = {
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
