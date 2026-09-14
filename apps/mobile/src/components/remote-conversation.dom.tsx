"use dom";

import { I18nProvider } from "@workbench/i18n";
import type { Locale } from "@workbench/i18n/runtime";
import {
  RemoteConversationSurface,
  remoteConversationTranslationBundles,
  type RemoteConversationPalette,
} from "@workbench/ui-remote-conversation";

import "@workbench/ui-remote-conversation/styles.css";

export interface RemoteConversationDomProps {
  readonly sessionId: string;
  readonly items: readonly import("@workbench/remote-control-contracts/protocol").RemoteConversationItemV1[];
  readonly loading: boolean;
  readonly loadFailed: boolean;
  readonly hasMore: boolean;
  readonly ready: boolean;
  readonly dark: boolean;
  readonly locale: Locale;
  readonly palette: RemoteConversationPalette;
  readonly onLoadMore: () => Promise<void>;
  readonly dom?: import("expo/dom").DOMProps;
}

export default function RemoteConversationDom({
  locale,
  dom: _dom,
  ...props
}: RemoteConversationDomProps) {
  return (
    <I18nProvider
      locale={locale}
      onLocaleChange={() => undefined}
      bundles={remoteConversationTranslationBundles}
    >
      <RemoteConversationSurface {...props} />
    </I18nProvider>
  );
}
