# Pi 的 Workbench Runtime 适配

这里将 Pi 能力接到 Workbench：客户端安装、服务端接线、RPC 合同/连接、数据与会话投影。寻找底层 SDK 会话、模型与资源加载请到 [pi-sdk](../pi-sdk/README.md)。完整协议与生命周期说明见 [integration.md](integration.md)。

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

Workbench 专属工具、扩展和 Skill 归 [pi-workbench-runtime](../product/pi-workbench-runtime/README.zh-CN.md)，包括 Browser。通用浏览器能力归 browser-server/browser-contracts。

本层只保留 Pi RPC、客户端/服务端适配与装配；SDK 不反向导入产品。默认内联扩展由产品 `/extensions` 装配，Browser 由产品生成的兼容 Pi package 加载，保留已有安装过滤。
