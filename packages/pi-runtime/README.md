# Pi 的 Workbench Runtime 适配

这里负责 Workbench 工具实现，并将 Pi 能力接到 Workbench：客户端安装、服务端接线、RPC 合同/连接、数据与会话投影。寻找底层 SDK 会话、模型、资源或工具实现请到 [pi-sdk](../pi-sdk/README.md)。完整协议与生命周期说明见 [integration.md](integration.md)。

[返回包导航](../README.md)

| 包                                                              | 职责                                           | 常用公开入口                                                                                                                        |
| --------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [pi-runtime-client](pi-runtime-client/package.json)             | 浏览器端 Runtime 安装、会话管理与能力适配      | `@workbench/pi-runtime-client/installation`、`@workbench/pi-runtime-client/resources`、`@workbench/pi-runtime-client/configuration` |
| [pi-runtime-server](pi-runtime-server/package.json)             | Node 端安装、HTTP/WebSocket/RPC 编排与依赖装配 | `@workbench/pi-runtime-server/installation`、`@workbench/pi-runtime-server/http`、`@workbench/pi-runtime-server/websocket`          |
| [pi-conversation-adapter](pi-conversation-adapter/package.json) | Pi 消息/事件到 Workbench 会话节点的解析与投影  | `@workbench/pi-conversation-adapter/assembler`、`@workbench/pi-conversation-adapter/projection`                                     |
| [pi-rpc-contracts](pi-rpc-contracts/package.json)               | Pi RPC、消息、流帧等跨端合同                   | `@workbench/pi-rpc-contracts/rpc`、`@workbench/pi-rpc-contracts/stream`、`@workbench/pi-rpc-contracts/messages`                     |
| [pi-rpc-client](pi-rpc-client/package.json)                     | Pi HTTP/RPC 客户端与配对 WebSocket 连接        | `@workbench/pi-rpc-client`、`@workbench/pi-rpc-client/api`、`@workbench/pi-rpc-client/connections`                                  |
| [pi-runtime-adapters](pi-runtime-adapters/package.json)         | Pi 模型/命令/会话数据转换与 Runtime 描述       | `@workbench/pi-runtime-adapters/descriptor`、`@workbench/pi-runtime-adapters/models`                                                |

## Workbench 工具与扩展实现

| 包                                                    | 职责                                                             | 入口                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| [pi-runtime-browser](pi-runtime-browser/package.json) | 可独立安装的 Browser Pi Package，包含工具和配套 browser-use 技能 | `@workbench/pi-runtime-browser`、`/resources` |

默认选择哪些内联扩展及其顺序由 `@workbench/pi-workbench-runtime/extensions` 持有。`pi-runtime-server` 的装配代码选择此 Node 产品配置，提供 Host 依赖后再注入 SDK 会话；工具实现与 SDK 服务均不导入该产品包。

Browser 包的 `skills/browser-use` 与 Browser 扩展一同分发，供独立 Pi CLI 复用，因而与扩展共置；Workbench 是否内置安装它，由产品配置决定。

Workbench 专属工具、产品提示与内联扩展在 [pi-workbench-runtime](../product/pi-workbench-runtime/README.zh-CN.md)。例如自定义 bash 使用 `@workbench/pi-workbench-runtime/tools/bash`；本层保留 Pi RPC/客户端/服务端适配与可独立复用的 Browser 包。
