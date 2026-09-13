# 能力与状态归属

本次不新增数据库实体或协议字段。

| 现有状态/契约                       | 目标所有权                                          | 关系与不变量                                                      |
| ----------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| Model selector store、effort option | ui-model-selection                                  | catalog/session来自现有agent runtime，选择ID/回调保持             |
| Token usage/statistics/animation    | ui-token-usage                                      | 复用原会话订阅，不复制模型store                                   |
| Appearance preferences              | appearance保持；UI归ui-theme                        | key/revision/背景资源持久化和hydration不变                        |
| Settings main-view request/registry | ui-settings                                         | general/theme/Pi只贡献项目，inactive section保持安装策略          |
| Attachment payload/restore          | agent-runtime-contracts保持；UI归ui-attachment      | 文件引用、异步读取、恢复/移除callback不变                         |
| Trigger/token/document              | ui-input-trigger拥有触发/参数；composer拥有document | 单一编辑器，结构化输入和token操作契约不新建全局单例               |
| Interaction form/preferences        | ui-user-questions                                   | 保持request identity、required、timeout、answer/approval envelope |
| Todo snapshot/adapters              | ui-todo                                             | tool name/schema保持，服务端durable todo不搬                      |
| Queue preview/order                 | ui-message-queue                                    | runtime queue是唯一状态来源，拖放/提交命令不变                    |
| Tool disclosure                     | ui-tool                                             | Context与默认policy一份实现；phase转换不re-key原挂载树            |
| Scratch session lease               | ui-side-chat                                        | runtime持有会话；retain/release、promote/dismiss顺序不变          |

每项迁移记录需包含sourceFiles、target、public exports、消费者、bundle键、资源顺序、测试去向和验证状态。capability-inventory当前是核心源码输入；实施W0扩展为完整逐文件迁移清单后才移动代码。
