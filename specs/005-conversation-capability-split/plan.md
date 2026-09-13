# Implementation Plan — 会话能力细分

状态：Implemented，17 项任务完成；允许范围内的验证通过，见 validation.md。实际 Git 分支 codex/package-refactor；setup-plan 返回的 feature 标识为 005-conversation-capability-split，不代表创建了 Git 分支。基于 Spec 004 已验收的未提交工作树；见 source-inventory.json 的路径与哈希。

## Summary

整体改名 ui-composer 与 ui-conversation，新增四个真实 owner：ui-conversation-list（侧栏会话导航）、ui-conversation-messages（消息流列表）、ui-conversation-nodes（节点与轮次呈现）、ui-message-blocks（块渲染）。保留运行时的节点协议和 session store。以公开入口形成无环依赖，完整迁移组件/helper/词典/CSS/tests/文档，禁止只搬一个外观组件再回引原大包。

## Technical Context

TypeScript 7.0.2、React 19.2.8、pnpm 11.22.0 workspace；现有 Lexical/agent-runtime-client/extension-host/i18n 和 Shell 外观系统继续复用。不更新 SDK、协议、持久化格式或构建系统。目标 Web 与 Electron；UI capability libraries。性能目标为保持节点 selector equality、稳定 key、订阅粒度、滚动补偿、保活与释放时机，无未经测量的性能提升承诺。
范围：两个包改名、四个新包、ui-sidebar 职责收窄及公共消费者集成。现有 89 库包预计变为 93；如清单有变化以实际结构检查为准。UI 测试排除，允许静态/明确纯逻辑、lint/typecheck/build。

## Constitution Check

| Gate                       | 设计前 | 设计后                                                       |
| -------------------------- | ------ | ------------------------------------------------------------ |
| 两级领域/独立职责          | PASS   | PASS，四个不同 UI owner，非重复 runtime                      |
| 真实浅层 src/lib 与 TS/TSX | PASS   | PASS，blocks 提取已有文件辅助；sidebar 泛型 reorder 辅助保留 |
| 公共入口与生产无环         | PASS   | PASS，依赖方向及 Context 所有权见合同                        |
| 稳定行为/资源/释放         | PASS   | PASS（设计约束，实施待验证）                                 |
| 验证后完成                 | PASS   | PASS，仅计划；用户明确覆盖宪章中的 UI/跨宿主冒烟要求         |

## Project Structure

所有目标最终位于 packages/client/（按用户后续要求调整）：

- ui-composer：现 composer 整包改名，保留完整编辑器状态闭包。
- ui-conversation：页面/session/路由/空状态和最终装配。
- ui-conversation-list：侧栏的线程导航、分组、排序、pin/move、菜单与工作区会话索引。
- ui-conversation-messages：消息流列表、日期与轮次排列、视口/滚动。
- ui-conversation-nodes：单个节点选择与呈现、message Context、轮次折叠、消息级扩展。
- ui-message-blocks：文本/附件/文件/图片/来源/命令响应/错误等块内容。

ui-sidebar 留在 packages/client，拥有 Sidebar primitives、泛型 pointer reorder、区域 token/CSS。workspace sidebar 扩展和其完整业务 controller 一起迁往 ui-conversation-list，由 Shell 直接安装新包，稳定扩展 ID 不变；ui-sidebar 不导入新业务包。

每包 src 和 lib 最多一级子目录，tests 位于根。不复制参考 src/client/chat 的多层树。包根保留现有 tsconfig/源码 exports 工具链。

## Dependency and phases

W0：按 source-inventory 及 package-map 展开最终逐文件/测试/API/词典键/CSS清单；包含当前未提交基线，禁止仅用 HEAD 还原。
W1：独立整包改名 ui-composer；在 ui-sidebar 将泛型 reorder 算法提取至 lib，src 公开入口消费辅助。盘点并冻结跨包消费者。
W2：ui-message-blocks 先拆：把 composer-message-text 中读取节点 Context 的 wrapper 留 nodes，实际 Content 与解析辅助搬 blocks。blocks 可继续复用 runtime actions/hooks；禁止回引 nodes。
W3：nodes 拥有唯一 message/structure/steered-turn Context 和 message renderer 扩展；ConversationNodeSeat 从原 list 拆到 nodes。messages 消费其公共 NodeSeat/SteeredTurn，不让 nodes 导入 messages。
W4：消息列表/视口/滚动完整搬 messages；侧栏业务闭包完整搬 conversation-list（可并行但不共写同一目录）；原 conversation 收口改名。
W5：主 Agent 集成 Shell/Pi/side-chat/message-actions 等所有消费者、唯一 bundle 安装和 CSS 原层叠位置，删除旧 exports/目录，更新 pnpm 锁与静态扫描根。
W6：精确允许验证，通过后才生成实施 validation 并勾选 tasks。

Luna：独立 ui-composer 改名与块 renderer 的已确定文件迁移。Sol：nodes/messages 的 Context、轮次与订阅边界，以及侧栏业务闭包。主 Agent：共享接线、manifest/lock、词典、样式、验收；最多两个实施子 Agent，明确文件所有权后派发。

## Complexity Tracking

不增加独立 conversation-contracts 包：协议已在 runtime contracts，React Context 在 nodes 有唯一 owner。块级数据通过既有 props/runtime 接口传入。新增四包对应明确不同消费者和状态边界，不能以目录数量替代行为边界。

## Workflow

setup-plan 已运行，constitution 已读取；不存在 extensions.yml，无 before/after hooks；update-agent-context.sh 不存在，手动追加根 AGENTS 当前计划路径。已通过 speckit-tasks 生成并执行全部任务。本轮已完成源码迁移并独立验证，Spec 004 验收不替代 Spec 005。

## 实施校准

messages 无独占文案，直接使用共享 date API，不创建空 bundle；共置词典要求用于有文案的能力。共享区域 CSS 保持完整规则及原导入顺序并归 messages；ui-conversation 的 CSS 入口负责聚合。blocks 保留合法公共 runtime hooks，无向 nodes/top-level 的反向依赖。

## 最终目录归属调整

按用户后续要求，原 packages/conversation 的 16 个前端 UI 能力统一归 packages/client。包名/exports 保持，之前分包设计及职责不变。原路径为本期迁移过程的历史来源，最终去向见 client-placement.json；workspace 不再单列 conversation 领域。
