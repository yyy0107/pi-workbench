import type { layoutTranslationBundle } from "@workbench/ui-layout/i18n";
import type { panelsTranslationBundle } from "@workbench/ui-panels/i18n";
import type { sidebarTranslationBundle } from "@workbench/ui-sidebar/i18n";
import { extensionsEnUS } from "./extensions-en-US";
import { extensionsZhCN } from "./extensions-zh-CN";

import type { Locale } from "@workbench/i18n/runtime";
import type { CatalogShape } from "@workbench/i18n/runtime";

const enUS = {
  extensions: extensionsEnUS,
} as const;

export type Messages = CatalogShape<typeof enUS> &
  (typeof sidebarTranslationBundle.messages)["en-US"] &
  (typeof panelsTranslationBundle.messages)["en-US"] &
  (typeof layoutTranslationBundle.messages)["en-US"];

const zhCN = {
  extensions: extensionsZhCN,
} satisfies CatalogShape<typeof enUS>;

export const messages = {
  "en-US": enUS,
  "zh-CN": zhCN,
} satisfies Record<Locale, CatalogShape<typeof enUS>>;
