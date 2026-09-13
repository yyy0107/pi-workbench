import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    archivedChats: {
      title: "归档",
      description: "查看、恢复或永久删除已经归档的聊天。",
      searchLabel: "搜索已归档聊天",
      searchPlaceholder: "搜索已归档聊天",
      sortLabel: "排序已归档聊天",
      newestFirst: "最新优先",
      oldestFirst: "最早优先",
      projectFilterLabel: "按项目筛选已归档聊天",
      allProjects: "所有项目",
      ungroupedProject: "其他聊天",
      totalCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `共 ${number(count)} 个已归档聊天`,
      groupCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} 个聊天`,
      untitled: "未命名聊天",
      loading: "正在加载已归档聊天…",
      loadingMore: "正在加载更多已归档聊天…",
      empty: "目前没有已归档的聊天。",
      noMatches: "没有符合当前筛选条件的已归档聊天。",
      unarchive: "取消归档",
      working: "处理中…",
      delete: "删除",
      deleteChat: ({ title }: { title: string }) => `删除${title}`,
      deleteAll: "全部删除",
      actionFailed: "无法更新已归档聊天，请重试。",
      deleteDialogTitle: "永久删除已归档聊天？",
      deleteChatDescription: ({ title }: { title: string }) =>
        `“${title}”及其完整聊天记录将被永久删除，此操作无法撤销。`,
      deleteAllDescription: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `全部 ${number(count)} 个已归档聊天及其完整记录将被永久删除，此操作无法撤销。`,
      cancel: "取消",
      confirmDelete: "永久删除",
      deleting: "正在删除…",
    },
  },
};
