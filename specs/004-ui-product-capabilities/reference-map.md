# 参考目录逐项对照

参考：用户附件 pasted-text.txt（1043行目录树）。目录展示包边界和文件名，不提供实现内容；以下结论基于本仓实际代码，不能推断两个项目实现相同。

| 参考包                       | 本仓处理                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| connection                   | services-client、agent-runtime-client和现有RPC/host契约继续负责；非本轮UI拆分            |
| hmr                          | 沿用apps/scripts开发构建，无独立业务UI需要迁移                                           |
| locale                       | i18n已有共享runtime；语言设置迁ui-settings-general                                       |
| modules                      | extension-sdk/extension-host已有扩展生命周期能力，不新造loader                           |
| runtime                      | agent-runtime-*与pi-conversation保留模型/会话所有权                                      |
| schema-form                  | 问题表单随ui-user-questions，Pi模型表单随pi-ui-settings-models；本轮不新建通用schema框架 |
| ui-agent-preset              | Pi agent配置保留pi-ui-settings；不因参考名新增预设功能                                   |
| ui-attachment                | 本期独立ui-attachment，附件预览/粘贴helper同迁                                           |
| ui-commands                  | extension-host命令服务保留；Composer触发和参数迁ui-input-trigger                         |
| ui-conversation              | conversation收窄为会话/消息装配，不机械改已有包名                                        |
| ui-deliverables              | 已有workspace-artifact/workspace-files负责产物与文件                                     |
| ui-directory-picker-browse   | 本期保留workspace-directory-picker，已记录进一步候选                                     |
| ui-directory-picker-native   | 当前是同一dialog的capability分支；缺独立实现闭包，本期不造包                             |
| ui-goal                      | 未确认本仓存在对应goalbar/goal-command独立UI，本轮不新增功能                             |
| ui-input-trigger             | 本期独立ui-input-trigger                                                                 |
| ui-jobs                      | 现有ui-automation及automation runtime/server保持owner                                    |
| ui-layout                    | 已有ui-layout，本期不重拆                                                                |
| ui-message-feedback          | 本期ui-message-actions覆盖当前消息操作；不是反馈评分功能的同义包                         |
| ui-model-selection           | 本期独立ui-model-selection                                                               |
| ui-permission-presets        | 本轮不新增权限预设功能；已有审批展示归ui-user-questions                                  |
| ui-plan                      | 本仓现成实现为Todo面板，准确命名ui-todo；不声称拥有plan-mode                             |
| ui-primitives                | 当前ui已是基础控件，连同selectors/resize/disclosure保留既有owner                         |
| ui-settings                  | 保留ui-settings为设置容器与注册表视图                                                    |
| ui-settings-general          | 本期独立语言/通用会话设置，容器留ui-settings                                             |
| ui-settings-models           | 本期独立pi-ui-settings-models，名称明确Pi实现                                            |
| ui-settings-plugin-inventory | pi-ui-toolbox已含installed/catalog，列为后续需先解耦scope/file opener的候选              |
| ui-settings-plugins          | pi-ui-toolbox/Pi配置已有实现，本期不重复建立插件设置框架                                 |
| ui-sidebar                   | 已有ui-sidebar，本期不重复拆                                                             |
| ui-skill                     | pi-ui-toolbox已有skill-reading与详情；后续随toolbox边界审计                              |
| ui-slots                     | extension-sdk/extension-host已有slots/renderer registry，复用现有实例                    |
| ui-subagent                  | 未确认专用Subagent UI；现有side-chat独立ui-side-chat，不能混称subagent                   |
| ui-theme                     | 本期独立ui-theme；appearance共享偏好runtime保留                                          |
| ui-tool                      | 本期独立完整工具/推理时间线与展示模型                                                    |
| ui-trajectory                | pi-conversation context-trace是模型投影，未确认对应trajectory表格UI，不据名称搬运行时    |
| ui-user-questions            | 本期独立ui-user-questions，服务端ask_user继续pi-tools                                    |
| ui-workflow-run              | 未确认对应workflow-run独立UI，本轮不新增功能                                             |
| ui-workspace                 | workspace-runtime/browser/explorer等已有具体owner，保留                                  |

本仓额外明确拆出的ui-token-usage、ui-message-queue、ui-user-message-index、ui-settings-archived-chats均来自现有完整实现。参考是粒度依据，不是必须一一复制的包名清单。
