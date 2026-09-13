# Workbench 产品能力与装配

| 包                                                           | 执行环境       | 所有权与入口                                                                                                        |
| ------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| [pi-workbench](pi-workbench/README.zh-CN.md)                 | 浏览器 / React | 产品 Shell、Provider、界面贡献及默认安装顺序：`/application`、`/installation`                                       |
| [pi-workbench-runtime](pi-workbench-runtime/README.zh-CN.md) | Node           | Workbench 自定义工具、产品规则、默认扩展、Skills/Prompts 与部署：`/tools/*`、`/todo/*`、`/extensions`、`/resources` |

Node 产品包拥有 bash、设置、用户询问、搜索、审查、Todo 和 Trace 的具体产品实现。PTY、工作区、SDK 会话和资源加载仍由通用能力包拥有；Runtime 装配层注入产品所需的协作者，并把产品策略回调提供给 SDK 会话。

Node 产品包不依赖前端产品、React 或 pi-runtime-server，SDK 也不反向依赖产品。模型可调用的 Browser 工具、扩展和 browser-use Skill 已退役；右侧浏览器标签仍由 workspace-browser 与通用 browser-server 提供。

[返回包导航](../README.md)
