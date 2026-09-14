# @workbench/ui-remote-conversation

负责原生远控产品使用的 DOM 对话区。它组合电脑端对话区正在使用的 Workbench 消息对、Markdown、用户消息、工具调用、折叠策略和语义 token。Expo 应用通过本地 DOM Component 嵌入该界面，不再维护第二套 React Native 消息渲染器。

本包只接收封闭的 `RemoteConversationItemV1` 安全投影，不具备 Runtime、Pi RPC、Shell、工具箱、终端、文件、电脑浏览器控制、扩展注册、模型或供应商能力。所有修改操作仍由原生端负责，并继续通过现有加密远控协议发送。

`src/` 放置 DOM 界面、本地化文案、样式和公开入口；`lib/` 放置界面消费的纯投影转录模型。
