# Ownership and migration map

All paths are repository relative; baseline hashes are in source-inventory.json. Actual added/deleted/changed files will be captured from the final diff. Each owner updates its source, consumers and bilingual README. Root alone edits existing manifests/lock/root checks/apps and shared specs.

| Workflow | Owner | Source → destination                                                                                                                                              | Consumers                                                                               | Gate                                                                          |
| -------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| W1       | Root  | pi-browser BrowserHost → browser-contracts/src/host.ts; file reader → agent-runtime-contracts runtime-capabilities; WorkspaceStore Pick → neutral operation ports | pi-server-ports, Pi browser/session/automation/import composition                       | no implementation-class dependency, narrow fixture type/behavior checks       |
| W2       | Luna  | workspace-files file-type-icon → ui-file-presentation/src/icons; material helper → new lib; file-download → new src/download                                      | attachments, image blocks, ExplorerTree, review/git branch, ui-layout resource provider | independent closures, unchanged maps/resources/save behavior                  |
| W3       | Sol   | workspace-runtime React/provider/DOM/presentation/feedback UI/i18n/CSS → ui-workspace; draft store separated from Hook, headless installation stays runtime       | layout/composer/Shell/Pi UI/workspace features                                          | one core owner, no runtime React/DOM closure, same lifecycle                  |
| W4       | Root  | pi-resources-server workspace-store → workspace-server/src/catalog.ts + lib/catalog-state.ts; neutral DTO → agent-runtime-contracts workspace-catalog             | Pi protocol/workspace protocol/session import/automation/registry                       | old wire/persistence/locking behavior, neutral core, event once/dispose       |
| W5/W6    | Sol   | Pi client manager/session and server registry → same-package focused catalog/history/attachment/interactions/live/scratch modules                                 | existing Pi runtime, session RPC, automation/import/tool composition                    | no full manager/state context, one authoritative state and existing sequences |

W2/W3 coordinate overlapping ui-layout and workspace feature source writes; root waits for source ownership release before updating shared imports. W5/W6 do not edit session-runtime-dependencies.ts, external-session-import-service.ts or pi-automation-service.ts while root updates W1/W4 ports.

## 最终会话职责映射

| 职责               | 唯一实现/状态 owner                                                                                                                          | 保留的装配职责                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 客户端目录         | pi-client/runtime/manager-catalog.ts：快照、排序、固定/归档、代次与创建结果接纳                                                              | manager.ts：RPC/Host 帧顺序、通知、会话实例与安装生命周期                                          |
| 客户端历史         | pi-client/runtime/session-history.ts：序列、规范历史、分页合并、索引、分支与请求代次                                                         | session.ts：连接与消息投影编排，复用 pi-conversation                                               |
| 客户端附件         | pi-client/runtime/session-attachments.ts：上传、准备、读回、丢弃与上传任务                                                                   | session.ts：单一 Composer 状态及提交/销毁时机                                                      |
| 交互请求           | 原 interactive-response-registry.ts 拥有服务端等待请求；客户端 manager 拥有连接范围的 pending 请求和响应匹配                                 | HostedPiSession 使用窄交互操作；继续复用已有交互实现，不新增第二套交互状态                         |
| 活跃 SDK 会话      | pi-session-server/hosted-pi-session.ts；hosted-session-lifecycle.ts 与 session-mutations.ts 管理销毁和互斥                                   | session-registry.ts 提供明确 publisher、通知、模型修订、命令与只读历史/文件操作，不传整个 registry |
| 历史与元数据规则   | pi-session-server/session-projections.ts；session-types.ts 为包内合同                                                                        | 运行与冷历史路径共享原有投影，不复制规则                                                           |
| 进程状态/目录/fork | session-registry-state.ts：原 live/persisted/scratch Maps 与 fork Promise；persisted-session-directory.ts：info/summary/fingerprint 同步变更 | registry 保留启动、目录刷新、导入、fork 和 RPC 装配                                                |
| 临时会话资源       | scratch-session-directory.ts：目录、记录、过期 timer、busy 重试、文件与关机清理                                                              | registry 提供 isBusy/release/invalidateFile 操作                                                   |

原公共 registry 导出保持兼容，文件迁移不修改 RPC、事件、持久化或扩展 ID。HMR 旧闭包的标量访问器仅在接管旧对象时建立；新对象和新实现不使用旧平铺字段。

逐文件来源/结果 SHA-256 见 migration-inventory.json；全部 96 库包最终依赖与源码度量见 dependency-result.json。
