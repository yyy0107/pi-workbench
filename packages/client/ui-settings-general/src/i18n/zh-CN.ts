export const messages = {
  extensions: {
    settings: {
      conversation: {
        title: "会话",
        description: "设置运行中的消息发送方式，以及会话详情的显示方式。",
        runningMessageMode: "跟进处理方式",
        runningMessageDescription:
          "在会话运行时将后续消息加入队列，或调整当前运行的方向。按 Ctrl/Cmd+↵ 可对单条消息执行相反操作。",
        queue: "加入队列",
        steer: "调整方向",
        askUserAutoContinue: "提问自动继续",
        askUserAutoContinueDescription:
          "每个问题 5 分钟未回答会自动跳过。关闭后，当前和后续问题都会等待你的回答。授权请求仍需你明确决定。",
        retainAllModelIO: "完整保留模型 I/O",
        retainAllModelIODescription:
          "保留已采集的全部模型请求与响应历史，不自动清理。关闭时，每个会话最多保留 100 次已结束的激活记录或 1 GiB 审计历史。下次打开会话时生效，已删除的历史无法恢复。",
        showTodos: "显示待办",
        showTodosDescription: "在输入框上方和消息时间线中显示受支持的 Todo 工具记录的任务清单。",
        groupExplorationTools: "分组探索工具",
        groupExplorationToolsDescription: "将连续的读取和搜索工具调用聚合为可展开的探索分组。",
        groupTerminalTools: "分组终端命令",
        groupTerminalToolsDescription: "将连续的 Bash 工具调用聚合为可展开的终端分组。",
        groupFileChanges: "分组文件更改",
        groupFileChangesDescription:
          "将连续的 Write、Edit 和 Apply Patch 调用聚合为可展开的更改分组。",

        todosEmpty: "当前没有待办事项。",

        showReasoning: "显示思考过程",
        showReasoningDescription:
          "显示模型返回的思考内容。关闭后仅从消息视图中隐藏，已保存的历史记录不受影响。",
        groupParallelTools: "分组并行工具调用",
        groupParallelToolsDescription:
          "将同一批并行执行的工具调用合并为可展开的分组，关闭后逐条显示。",
        loadError: "无法加载会话偏好，请重试后再修改。",
        saveError: "保存失败，仍使用原来的设置，请重试。",
        retry: "重试",
      },
    },
    localeSelector: {
      languageTitle: "语言",
      languageDescription: "选择工作台控件和菜单使用的语言。",
      selectLanguage: "选择界面语言",
    },
  },
} as const;
