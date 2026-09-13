# Workbench 产品装配

| 包                                                     | 执行环境       | 所有权与入口                                                                                                     |
| ------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| [pi-workbench](pi-workbench/README.md)                 | 浏览器 / React | 产品 Shell、Provider、界面贡献及默认安装顺序：`@workbench/pi-workbench/application`、`/installation`             |
| [pi-workbench-runtime](pi-workbench-runtime/README.md) | Node           | 内置 Skills、Prompts、Pi 默认扩展清单及资源部署/升级：`@workbench/pi-workbench-runtime/resources`、`/extensions` |

Node 产品包不依赖前端产品包、React 或 `pi-runtime-server`；它消费工具工厂和 SDK 资源服务，由服务端装配层选择。两个包分别拥有前端与 Node 产品策略。

[返回包导航](../README.md)
