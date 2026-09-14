import { codeHighlightingTranslationBundle } from "@workbench/code-highlighting/i18n";
import { markdownTranslationBundle } from "@workbench/markdown/i18n";
import { conversationTranslationBundle as messageBlocksTranslationBundle } from "@workbench/ui-message-blocks/i18n";
import { conversationTranslationBundle as conversationNodesTranslationBundle } from "@workbench/ui-conversation-nodes/i18n";

import { remoteConversationTranslationBundle } from "./i18n";

export {
  RemoteConversationSurface,
  type RemoteConversationPalette,
  type RemoteConversationSurfaceProps,
} from "./remote-conversation-surface";
export { remoteConversationTranslationBundle } from "./i18n";

/** Translation bundles required by the isolated Expo DOM conversation surface. */
export const remoteConversationTranslationBundles = [
  remoteConversationTranslationBundle,
  codeHighlightingTranslationBundle,
  markdownTranslationBundle,
  messageBlocksTranslationBundle,
  conversationNodesTranslationBundle,
];
