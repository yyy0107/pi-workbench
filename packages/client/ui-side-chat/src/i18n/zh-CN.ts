import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    sideChat: {
      title: "临时侧聊",
      indexedTitle: ({ sequence }: { sequence: number }, { number }: MessageFormatters) =>
        `临时侧聊 (${number(sequence)})`,
      open: "打开临时侧聊",
      creating: "正在创建临时侧聊…",
      promote: "保留为会话",
      promoteDescription: "将这个临时侧聊保存为普通会话。",
      promoting: "正在保存…",
    },
  },
};
