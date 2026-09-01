import type { WorkbenchNavigationPort } from "@workbench/shell/navigation";

/** The app owns route syntax; Pi side-chat only promotes into a semantic conversation. */
export function openPromotedSideChatConversation(
  navigation: Pick<WorkbenchNavigationPort, "openConversation">,
  sessionId: string,
): void {
  navigation.openConversation(sessionId);
}
