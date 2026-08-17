import { appEnUS } from "@/app/i18n/en-US";
import { appZhCN } from "@/app/i18n/zh-CN";
import { assistantEnUS } from "@/components/assistant-ui/i18n/en-US";
import { assistantZhCN } from "@/components/assistant-ui/i18n/zh-CN";
import { extensionsEnUS } from "@/extensions/i18n/en-US";
import { extensionsZhCN } from "@/extensions/i18n/zh-CN";
import { platformExtensionsEnUS } from "@/platform/extensions/i18n/en-US";
import { platformExtensionsZhCN } from "@/platform/extensions/i18n/zh-CN";
import { workbenchEnUS } from "@/workbench/i18n/en-US";
import { workbenchZhCN } from "@/workbench/i18n/zh-CN";

import type { Locale } from "./config";
import type { CatalogShape } from "./types";

const enUS = {
  app: appEnUS,
  assistant: assistantEnUS,
  workbench: workbenchEnUS,
  extensions: extensionsEnUS,
  platform: {
    extensions: platformExtensionsEnUS,
  },
} as const;

export type Messages = CatalogShape<typeof enUS>;

const zhCN = {
  app: appZhCN,
  assistant: assistantZhCN,
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
