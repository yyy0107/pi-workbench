import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  workbench: {
    chat: {
      composer: {
        commandSuggestions: "命令建议",
        commandParameters: {
          close: "关闭命令参数面板",
          disabled: "禁用",
          done: "完成",
          edit: ({ command }: { command: string }) => `编辑 ${command} 的参数`,
          enabled: "启用",
          notSet: "未设置",
          optional: "可选",
          required: "必填",
          reset: "重置",
          selectPlaceholder: "选择一个值",
          title: "命令参数",
          valuePlaceholder: ({ parameter }: { parameter: string }) => `填写${parameter}`,
          errors: {
            integer: "请输入整数。",
            invalidChoice: "请选择有效的值。",
            invalidNumber: "请输入有效数字。",
            maximum: ({ limit }: { limit: string }) => `请输入不大于 ${limit} 的值。`,
            maxLength: ({ limit }: { limit: string }) => `最多输入 ${limit} 个字符。`,
            minimum: ({ limit }: { limit: string }) => `请输入不小于 ${limit} 的值。`,
            minLength: ({ limit }: { limit: string }) => `至少输入 ${limit} 个字符。`,
            required: "请填写此参数。",
          },
        },
        commandGroups: {
          builtin: (
            { runtimeName, count }: { runtimeName: string; count: number },
            { number }: MessageFormatters,
          ) => `${runtimeName} 内置命令 (${number(count)})`,
          extension: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `扩展命令 (${number(count)})`,
          prompt: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `提示词模板 (${number(count)})`,
          skill: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `Skills (${number(count)})`,
          workbench: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `Workbench (${number(count)})`,
        },
        commandScopes: {
          user: "用户",
          project: "项目",
          temporary: "临时",
          manualOnly: "仅手动调用",
        },
        builtinCommands: {
          compact: {
            label: "压缩上下文",
            description: "手动压缩当前会话上下文",
            argumentHint: "[可选压缩指令]",
          },
          reload: {
            label: "重新加载",
            description: "重新加载扩展、Skills、提示词与上下文文件",
          },
        },
      },
    },
  },
};
