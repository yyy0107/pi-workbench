# Workbench Pi 扩展资源

[English](README.md)

每个目录包含实际的 Pi 注册和生命周期行为。工具参数、执行、状态、结果格式与来源说明继续归 `src/<tool-name>/`。

| 资源                                                | 职责                                      |
| --------------------------------------------------- | ----------------------------------------- |
| [builtin-tools](builtin-tools/index.ts)             | 内置工具偏好绑定与调用守卫                |
| [ask-user](ask-user/index.ts)                       | 注册 Ask User，并接入既有启停规则         |
| [rpiv-todo](rpiv-todo/index.ts)                     | 注册 Todo，恢复和清理会话状态             |
| [workbench-settings](workbench-settings/index.ts)   | 宿主提供能力时注册设置工具                |
| [workspace-review](workspace-review/index.ts)       | Agent 运行前后捕获工作区快照              |
| [composer-context](composer-context/index.ts)       | 将记录的 Composer 上下文投影为模型输入    |
| [message-termination](message-termination/index.ts) | 分类助手消息终止结果                      |
| [context-trace](context-trace/index.ts)             | 观察提示词、压缩、Provider 请求和模型输出 |

产品[装配入口](../../src/extensions.ts)静态导入这些工厂，注入 Workbench 协作者，并以具名内联扩展交给 SDK，Trace 仍最后安装。
依赖宿主的工厂继续要求显式传入原有依赖；本目录不是可单独安装的 Pi Package。不要再通过文件发现注册一次，否则会重复注册并绕过产品依赖注入。稳定名称、隐藏标记和启停规则保持不变。

共享快照白名单将本目录复制到产物 `internal-extensions/resources/extensions/`，再部署到 `extensions/.builtin/resources/extensions/`。
这些文件用于查看源码，执行工厂已打包进 Runtime。
