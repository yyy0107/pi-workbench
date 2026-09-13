export const messages = {
  extensions: {
    externalSessionImport: {
      title: "导入",
      description:
        "把本机 Codex、Claude Code 和 Cursor 会话转换为 Pi 原生会话。来源文件不会被修改；系统提示词、凭据、加密状态及应用专用元数据不会被复制。",
      refresh: "重新扫描",
      selectAll: "选择全部可导入项",
      clearSelection: "清除选择",
      selectedCount: ({ count }: { count: string }) => `已选择 ${count} 项`,
      importSelected: "导入所选会话",
      importing: "正在导入…",
      empty: "没有发现受支持的本机 Codex、Claude Code 或 Cursor 会话。",
      noSessions: "此来源中没有发现会话。",
      selectSession: ({ title }: { title: string }) => `选择导入 ${title}`,
      messageCount: ({ count }: { count: string }) => `${count} 条记录`,
      result: ({ imported, skipped }: { imported: string; skipped: string }) =>
        `已导入 ${imported} 项，跳过 ${skipped} 项。`,
      sources: {
        codex: "Codex",
        "claude-code": "Claude Code",
        cursor: "Cursor",
      },
      sourceStatus: {
        ready: "可用",
        "not-found": "未安装或没有本机数据",
        error: "无法读取此来源",
      },
      states: {
        ready: "可导入",
        imported: "已导入",
        subagent: "子代理",
        unknownProject: "未知项目",
      },
      issues: {
        "source-unavailable": "来源不可用",
        "source-unreadable": "无法读取来源",
        "workspace-missing": "项目文件夹已不存在",
        "workspace-not-directory": "项目路径不是文件夹",
        "conversation-empty": "没有完整会话",
        "conversation-unsupported": "不支持的会话格式",
      },
      errors: {
        requestFailed: "扫描或导入未能完成，请重试。",
      },
    },
  },
};
