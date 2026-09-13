export function archivedChatGroupHeadingId(instancePrefix: string, groupId: string): string {
  return `${instancePrefix}-archived-chat-group-${encodeURIComponent(groupId)}`;
}
