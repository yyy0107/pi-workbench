import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    archivedChats: {
      title: "Archive",
      description: "Review, restore, or permanently delete conversations you have archived.",
      searchLabel: "Search archived chats",
      searchPlaceholder: "Search archived chats",
      sortLabel: "Sort archived chats",
      newestFirst: "Newest first",
      oldestFirst: "Oldest first",
      projectFilterLabel: "Filter archived chats by project",
      allProjects: "All projects",
      ungroupedProject: "Other chats",
      totalCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        count === 1 ? "1 archived chat" : `${number(count)} archived chats`,
      groupCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        count === 1 ? "1 chat" : `${number(count)} chats`,
      untitled: "Untitled chat",
      loading: "Loading archived chats…",
      loadingMore: "Loading more archived chats…",
      empty: "You have no archived chats.",
      noMatches: "No archived chats match these filters.",
      unarchive: "Unarchive",
      working: "Working…",
      delete: "Delete",
      deleteChat: ({ title }: { title: string }) => `Delete ${title}`,
      deleteAll: "Delete all",
      actionFailed: "The archived chat could not be updated. Try again.",
      deleteDialogTitle: "Permanently delete archived chats?",
      deleteChatDescription: ({ title }: { title: string }) =>
        `“${title}” and its complete conversation history will be permanently deleted. This cannot be undone.`,
      deleteAllDescription: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `All ${number(count)} archived chats and their complete conversation histories will be permanently deleted. This cannot be undone.`,
      cancel: "Cancel",
      confirmDelete: "Delete permanently",
      deleting: "Deleting…",
    },
  },
};
