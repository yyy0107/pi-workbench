# Pi SDK 接入服务

这里封装 Pi SDK 的模型、会话和资源服务。产品内置内容归 [product/pi-workbench-runtime](../product/pi-workbench-runtime/README.md)，Workbench 工具适配归 [pi-runtime](../pi-runtime/README.md)。

| 包                                                | 职责                                | 常用入口                                                                     |
| ------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| [pi-sdk-models](pi-sdk-models/package.json)       | 模型、Provider、认证与 SDK services | `@workbench/pi-sdk-models`、`/services`、`/config`                           |
| [pi-sdk-sessions](pi-sdk-sessions/package.json)   | 会话注册、执行、历史与导入          | `@workbench/pi-sdk-sessions/registry`、`/execution`、`/history`、`/imports`  |
| [pi-sdk-resources](pi-sdk-resources/package.json) | 资源加载、查询、启停、持久化与重载  | `@workbench/pi-sdk-resources/skills`、`/extensions`、`/packages`、`/prompts` |
| [pi-sdk-ports](pi-sdk-ports/package.json)         | SDK 接入的依赖注入合同              | `@workbench/pi-sdk-ports/host`、`/sessions`、`/tools`                        |

`pi-sdk-models/src/agent-session-services.ts` 调用上游 `createAgentSessionServices`；`pi-sdk-sessions/src/session-registry.ts` 调用 `createAgentSessionFromServices`。SDK 会话通过注入回调取得所选扩展和资源安装行为。

本目录不携带产品 Skills/Prompts，也不声明产品默认扩展清单。`pi-sdk-resources` 保留已安装内置资源的稳定来源识别和保护规则，供查询、禁止卸载和兼容持久化状态使用；默认注册和升级迁移由产品包执行。

这些服务仍含既有 Workbench 适配合同，目录调整不代表所有服务已成为与 Workbench 无关的上游 SDK。准确导入示例见[总导航](../README.md)。
