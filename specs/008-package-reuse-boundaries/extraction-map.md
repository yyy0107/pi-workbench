# 复用候选与边界映射

本文件保留 [spec.md](spec.md) 初轮候选分析。最终采用 W4 的既有 workspace-server 子入口方案；冻结的包名与职责见 [plan.md](plan.md)、[ownership-map.md](ownership-map.md) 和 [公开合同](contracts/public-boundaries.md)，实施证据见 [validation.md](validation.md)。发现编号见 [architecture-review.md](architecture-review.md)，不设置增包目标。

## 工作流

| 工作流          | 发现 / 需求    | 当前来源                                                                                                        | 建议所有者                                                                                                                                         | 消费者或独立需求                                                                   | 退出条件                                                                   |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| W1 窄端口       | F1；FR-002/003 | pi-server-ports/host-bindings；pi-browser/index；session-runtime-dependencies 及 import/automation 的 Pick 类型 | 浏览器合同归 browser-contracts；文件/目录用领域合同或消费方窄端口                                                                                  | Pi tools、session runtime、external import、automation；最小替身验证               | ports 不依赖具体 browser/file 服务，指定消费者不从 WorkspaceStore 推导类型 |
| W2 文件呈现     | F2；FR-004/005 | workspace-files 的 file-type-icon、图标/文件名辅助、file-download                                               | 候选 packages/client/ui-file-presentation，分 icons/download；树与工作区集成留原包                                                                 | ui-attachment、ui-message-blocks、ExplorerTree、原文件保存消费者                   | 唯一实现；图标入口不达树/控制器，download 无 React，资源注入且保存时机保持 |
| W3 面板状态/UI  | F3；FR-006     | workspace-runtime 的 store/controller/selectors/feedback/persistence、react/presentation/resize DOM             | workspace-runtime 保留无界面核心；候选 packages/client/ui-workspace 放 React 与呈现                                                                | ui-layout、ui-composer、workspace-files/file-view/browser、Shell；无界面控制器需求 | 核心无 React/UI/DOM 实现依赖；单 store、原 scope 和生命周期                |
| W4 项目会话目录 | F4；FR-007/008 | pi-resources-server/workspace-store、workspace-protocol-service；Pi server workspace-registry                   | 候选 packages/workspace/workspace-catalog-server 与 packages/contracts/workspace-contracts；先评估既有 workspace-server 子入口能否容纳，最终二选一 | workspace protocol、session import、automation、session deletion；无 Pi 的目录服务 | 核心零 pi-*；Pi 投影旧 DTO/events；持久化、锁与迁移不变                    |
| W5 客户端会话   | F5；FR-009/010 | pi-client/runtime/manager、session                                                                              | 优先原包按目录、history、attachments、interactions 分真实模块；消息继续 pi-conversation，连接继续 pi-transport-client                              | runtime、scratch、目录、单会话现存调用方                                           | 不传整个 manager/万能 context，不复制权威状态，五类职责独立验证            |
| W6 服务端会话   | F5；FR-009/010 | pi-session-server/session-registry 及已有 catalog/history/resume/queue/interactive helpers                      | 优先原包按 catalog/live session/composer 协调拆分，原入口只协调，Pi server 装配实例                                                                | session RPC、workspace history/导入、automation、tools                             | 不以共享巨大 state 替代接口；原互斥、序列与生命周期保持                    |

## 提取约束

1. 先确认真实 exports，复用 api、server-core、pi-conversation、pi-transport-client、i18n 与 UI。W4 若使用 workspace-server，不得把 Pi 资源职责带入；不能同时保留两个目录实现。
2. 新包必须有真实消费者或独立运行理由。W2 有多个界面消费者；W3 有无界面核心与呈现隔离；W4 有非 Pi 领域使用需求。src/lib 均含真实能力或辅助，不为目录规则制造 helper。
3. 面板、tab、draft/feedback 属 W3；项目路径、会话归属、固定排序和归档属 W4；文件/Git 服务留原 owner，不共享万能 workspace state。
4. W2/W3 列全 CSS、图标资源和消费者，样式随 DOM owner，继续共享 token 与所属 Shell Portal；不运行 UI 测试。
5. 合同 owner 可以调整，method/event/扩展 ID、资源约定和持久化字段不变。仓内导入同批迁移，稳定协议兼容不能成为永久源码转发的理由。
6. 生命周期由原装配管理：订阅清理、失效代次、延迟 resolver、feedback claim 和 mutation tail 均明确归属；不得为独立性复制状态。

## 顺序建议

- 先冻结 W1 最小合同及各工作流来源/消费者，分别记录实现、类型、测试、资源依赖。
- W2 可独立。W3 先确定 provider/资源/状态所有权；W4 先确定领域事件、旧文档、实例解析及 Pi 转发合同。
- W5/W6 依据 W1/W4 最终边界实施，避免再次依赖旧 WorkspaceStore；不同时变更通信协议或新建 session 实例。
- 最后清旧入口、更新 manifests/lock、双语 README、架构检查与所有消费者。仅修改 imports 不能视为职责拆分完成。

## 验收设计入口

精确非 UI 测试白名单在 speckit-plan 确认，不执行含 UI 的整包 test 代替筛选。

| 工作流 | 静态/类型证据                                                   | 非 UI 证据                                                                      |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| W1     | 禁止实现依赖、最小替身、公开入口闭包                            | 取消、不可用、文件读取与目录协作                                                |
| W2     | 图标无树/控制器，下载无 React，三个场景完成接线，资源和样式完整 | 文件名/图标映射；保存交互仅静态审查，不新增 DOM harness                         |
| W3     | 核心无 React/UI/DOM 实现导入，UI/CSS owner 清楚                 | store/controller、恢复、draft、scope 提升、feedback、dispose                    |
| W4     | 核心无 pi-*，Pi 单独适配，实例装配清楚                          | 旧文档、跨进程锁、排序/归档、事件一次、销毁                                     |
| W5/W6  | 无整个 manager/registry state 参数，复用消息/连接能力           | 重连、历史代次、分支/resume、队列、附件失败/取消、scratch、交互清理、权威实例数 |

收口复用现有 check-workspace-dependencies、check-runtime-host-ownership、check-package-structure 和 refactor-architecture-boundaries 检查，优先扩展现有规则。完成受影响类型、lint 和构建；UI 测试只审不跑。

## 交付状态

- 已完成：94 包基线、证据、问题分级、候选映射、规格和质量审查。
- 未执行：W1–W6 迁移、最终 API 冻结、逐文件迁移清单、tasks 生成、行为/类型/构建验收。
- 后续候选：浏览器/模型/专用 UI 的包内拆分和工具结果预算共享；不在本期顺手修改行为。
