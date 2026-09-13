# packages 架构审查

日期：2026-09-13。基线提交：`f95cc7379a42e30e9a1b03aa149e45d1f4c0af2b`。本文件记录源码事实与设计判断，不是重构完成报告。

## 范围与方法

扫描全部 `packages/*/*/package.json`、公开入口和生产依赖，统计各包 `src/lib` 源码，复核 Spec 006/007、项目宪法与 extend-workbench-ui 约定，深入读取下述热点及调用方。完整清单、统计口径和 21 个关键来源的哈希见 [audit-baseline.json](audit-baseline.json)。未逐行审计全部源码，未作全量行为证明。

- 94 个库包、11 个领域、598 条库包间生产依赖边。
- 1,328 个 `src/lib` 源码文件、183,661 物理行；包含 TS/JS 各模块形式及声明，不含测试、包根脚本、CSS 和资源。行数只是定位线索。
- client 42 包、pi 19 包、workspace 9 包，其他领域共 24 包。
- 依赖包括 dependencies、optionalDependencies、peerDependencies 中的库包；不含应用和开发依赖。类型引用构成的契约耦合不等同于运行时加载或产物体积。
- `pnpm check:workspace-dependencies` 通过，包含生产图无环、公开入口与 runtime/host 归属检查。
- `pnpm check:package-structure` 通过：94 libraries、538 test files、0 tracked migration violations。

现有规则通过并不意味着职责和复用边界都理想。当前主要问题已从目录混杂转为：公共接口仍从具体实现推导，部分通用能力依附产品领域，少数核心对象集中协调太多状态。

## 发现与处理决定

| 编号 | 优先级         | 问题                               | 决定                       |
| ---- | -------------- | ---------------------------------- | -------------------------- |
| F1   | P1             | 共享端口引用具体服务和适配器       | 本期收窄契约               |
| F2   | P1             | 文件基础呈现归在复合文件功能中     | 本期抽取共享能力           |
| F3   | P1             | 工作区状态、React 绑定和呈现同包   | 本期分开核心与 UI          |
| F4   | P1             | 通用项目会话目录归在 Pi 资源服务   | 本期分离领域与协议适配     |
| F5   | P1             | Pi 会话核心彼此了解大量内部职责    | 本期先包内拆分与窄接口协作 |
| F6   | P2             | 浏览器、模型服务和 Pi 界面文件集中 | 后续包内拆分候选           |
| F7   | P2             | 契约与协议聚合范围偏大             | 按本期实际需求局部整理     |
| F8   | P1（后续修正） | 工具结果缺少统一最终文本预算       | 单列行为修正，不夹带到迁移 |

## F1：端口依附具体实现的类型形状

**证据**：[host-bindings.ts](../../packages/pi/pi-server-ports/src/host-bindings.ts:5) 从 pi-browser 引入 BrowserHost，并用 `Pick<WorkspaceFileService, "readFile">` 表达读取。BrowserHost 定义在 [pi-browser/index.ts](../../packages/pi/pi-browser/src/index.ts:14)，同入口负责工具注册并导入 standalone resolver；[standalone-host.ts](../../packages/pi/pi-browser/src/standalone-host.ts:8) 引入 BrowserManager。pi-server-ports 的 manifest 因此依赖 pi-browser 和 workspace-server。

[session-runtime-dependencies.ts](../../packages/pi/pi-session-server/src/session-runtime-dependencies.ts:9)、external-session-import-service 和 pi-automation-service 也从 WorkspaceStore 实现类提取 removeSession、create/attachSession、list/attachSession。

**影响**：消费者的能力约定跟随实现类变化，替换提供者需要依附实现方定义的形状。上述引用主要为类型，不能据此声称 Node 实现已进入浏览器产物。

**建议**：浏览器最小命令合同归现有 browser-contracts；文件和目录操作复用所属领域合同或消费方窄端口。实现满足合同，Pi 装配注入原实例。不要将整个服务复制成接口，也不要把一切塞进 pi-server-ports。

**退出条件**：ports 不再依赖 pi-browser/workspace-server 实现包；指定会话消费者不从 WorkspaceStore 类推导类型；分别验证类型图与运行时闭包。

## F2：文件图标和保存的复用入口偏重

**证据**：[composer-attachments.tsx](../../packages/client/ui-attachment/src/composer-attachments.tsx:24) 仅为 FileTypeIcon 引入 workspace-files/tree；[tree/index.ts](../../packages/workspace/workspace-files/src/tree/index.ts:1) 同时导出 ExplorerTree、树模型和图标。[file-type-icon.tsx](../../packages/workspace/workspace-files/src/tree/file-type-icon.tsx:5) 通过 useWorkbenchAssets 获取 Shell context 的资源地址。

[image.tsx](../../packages/client/ui-message-blocks/src/image.tsx:30) 从 workspace-files/download 复用 downloadBlob。[file-download.ts](../../packages/workspace/workspace-files/src/file-download.ts:1) 自身只依赖浏览器平台对象，已经具有较好的子入口隔离。workspace-files 整包还承担工作区打开、偏好、Markdown、文件树和本地应用集成。

**影响**：图标聚合入口与资源注入增加独立使用前提；下载子入口没有同等的传递加载问题，不能将整包依赖算作下载的实际成本。两类基础能力仍受复合功能包的所有权和发布边界约束。

**建议**：提取文件名/图标映射、图标呈现、资源访问与下载/另存为。树、文件版本冲突、打开应用和工作区集成留原 owner。候选 ui-file-presentation 通过独立 icons/download 入口服务真实消费者，资源地址显式传入或使用既有轻量合同，Shell 适配留装配方。

**退出条件**：附件、文件树和消息图片共用唯一相应实现；独立图标入口不达 ExplorerTree、工作区控制器或 Shell 安装实现；下载无 React；保存的用户激活时机、取消与清理保持。资源和样式只作静态审查。

## F3：工作区状态与呈现同属 runtime

**证据**：workspace-runtime 有 43 个 TS/TSX 文件、4,960 行，15 个库包直接依赖。[index.ts](../../packages/workspace/workspace-runtime/src/index.ts:1) 导出 store、controller、selector、布局宽度和 DOM resize helper；[react.ts](../../packages/workspace/workspace-runtime/src/react.ts:1) 导出 provider、context、surface host，另有 presentation 和 CSS 入口。workspace-draft-store.ts 将草稿 store 与依赖 context 的 Hook 放在一起。

**已有优点**：workspace-controller 已注入 persistence port 和 validator，主要操作并不要求 React。不能将问题描述为“现有状态完全不能无界面使用”。问题在包级职责混合和入口隔离缺乏明确长期约束。

**建议**：保留控制器、状态、纯选择器、持久化合同、草稿和反馈事务作为无界面核心；React 绑定、tabs、surface host、resize DOM 和 CSS 交 UI owner。拆开 store 与 Hook；不把 F4 的项目会话目录并入面板运行时。

**退出条件**：核心运行时闭包无 React、UI、Shell 安装及 DOM 操作；无害的扩展元数据类型引用另行评估。仍是原来一个 store，scope 提升、反馈 claim、持久化和销毁规则不变。

## F4：项目会话目录归属 Pi 资源领域

**证据**：[workspace-store.ts](../../packages/pi/pi-resources-server/src/workspace-store.ts:1) 共 1,072 行，管理项目、排序、固定、归档、会话移动和旧数据迁移。其类型来自 pi-protocol/rpc，并接受 PiStreamPublisher.publishHost；已有 subscribe，同时在内部直接发布 Pi host 事件。消费者包括 workspace protocol、session import、automation、session registry 和 Pi server workspace registry。

**影响**：目录规则不需要技能/扩展资源加载，但复用时依赖整个 Pi 资源领域和消息协议。非 Pi 使用者难以独立使用。现有 server-core 已有原子写、跨进程锁和 settings 文档机制，无需再次抽取持久化框架。

**建议**：工作区目录、存储和领域事件交独立工作域 owner；Pi 的 DTO、会话数据来源、host event 投影与安装解析留 Pi。保留原路径、settings section 和旧数据迁移，保留延迟 resolver 的热替换语义。目录中的会话元数据作为工作区关系处理，不建第二个会话事实源。

**退出条件**：核心零 pi-* 依赖；原 RPC、响应、host 事件和存储兼容；事件只转发一次，销毁后不转发。

## F5：会话管理的包内耦合仍重

**证据**：[session-registry.ts](../../packages/pi/pi-session-server/src/session-registry.ts:295) 共 5,062 行；同一工厂闭包协调命令解析、live host、模型服务、scratch、fork、目录扫描、历史、分支/resume、队列和 review。虽然已有多个辅助模块，状态仍集中在该闭包。

客户端 [manager.ts](../../packages/pi/pi-client/src/runtime/manager.ts:244) 共 2,157 行，持有连接、目录、工作区、交互、模型失效、settings、资源版本及 sessions；[session.ts](../../packages/pi/pi-client/src/runtime/session.ts:437) 共 3,008 行，直接持有整个 PiSessionManager，调用 transport、连接、目录、模型和 feedback，自己同时处理附件、历史、分支、流式消息和队列。

**影响**：这是包内职责交织，不是生产包依赖环。唯一 owner 对一致性有价值，但整个 manager 成为依赖导致修改和验证涉及太多状态。分文件后继续传整个 manager 并不能解耦。

**建议**：优先在 pi-client/pi-session-server 内分清目录、运行、历史恢复、附件生命周期和交互协调，提供必要操作和只读快照。纯消息投影继续 pi-conversation，连接继续 pi-transport-client。Pi 状态机不应泛化到公共 runtime。

**退出条件**：单会话不再依赖整个 manager 类型；不传整个 registry state 或万能 context；目录验证不初始化附件/输入状态；generation、序列、互斥、队列、反馈事务和销毁有非 UI 兼容证据。

## 后续候选

### F6：大服务和专用界面

- browser-server/src/index.ts：2,959 行，BrowserManager 集中连接/tab、授权与控制权、页面执行、snapshot、下载/上传、密码导入。可在原包内拆 snapshot、下载目录和交互执行器，连接代次、权限和控制权保留唯一协调者。没有证据要求多个新 browser 包。
- pi-model-server/src/model-service.ts：2,296 行，混合提供者配置/登录、目录发现、context window 和图像输入验证。先包内分配置凭据、登录流程和目录发现，不旁路认证或请求观察。
- model-config-settings-item.tsx（2,169 行）、context-trace-detail.tsx（2,103 行）、toolbox-capability-surface.tsx（1,644 行）是 Pi UI 内部拆分候选。目前只确认规模与职责集中，未证明需要通用表单或诊断框架，不纳入本期强制提取。

### F7：契约聚合

pi-protocol/rpc.ts（2,050 行）聚合工作区、模型、资源、历史和 trace，其中部分已引用底层领域类型，并非重复定义。agent-runtime-client 有 36 个库包消费者，同时提供纯 capabilities/environment 子入口和 React 根入口。仅在 F1/F4 实际触及处整理 owner 和子入口，不全面重拆协议，不建立另一套 runtime-contracts。

### F8：工具输出预算缺少共同边界

pi-browser/src/index.ts 的结果分支直接将任意 result 序列化到 text，截图分支也直接序列化 metadata，没有最终 truncateHead/truncateTail 或结果预算检查。这里只确认缺少最终防线，未实际执行超限请求，不能声称已发生上下文溢出。

pi-tools/src/workbench-settings.ts 的 settingsToolResult 已有 SDK 截断检查、有效 JSON 摘要、受保护文件和已提交 revision 保留，可作为后续共享来源。enhanced-search.ts 显式放宽行限制也需专项复核。共享辅助只覆盖最终文本预算、完整内容获取和文件生命周期，业务筛选/脱敏留原工具；不复制 Pi 私有实现，不把遗漏内容放到 details。

该修正会改变超限输出形状，需验证多字节、多行、长单行、文件权限、写入失败/取消及完整内容可取，因此单列高优先级后续工作。

## 合理关系应保留

- Shell 的 45 条内部生产依赖主要是静态安装、样式与装配；[builtin-extensions.ts](../../packages/client/shell/src/extensions/builtin-extensions.ts:40) 已分语义组，符合 extend-workbench-ui 约定，不为降低数字建立新的聚合空壳。
- pi-product、pi-contributions、pi-server 是产品或服务端装配层，不能只按依赖数判错。
- api 已分 contracts/errors/client/validation/server，不重复构建 RPC、validator 和错误框架。
- server-core/file-persistence 已共享锁与原子写；不再建立通用 repository 框架。
- extension-sdk/host、i18n、ui、selectors/disclosure/resize 已有清晰复用，应继续使用。基础包的高扇入通常是预期效果。
- host-artifact-policy 是既有 CJS 构建策略能力，不能因只统计 TS 而误判为空包；本次总量已含 CJS。

## 验证限制

本轮完成源码/manifest/入口审查、依赖与结构检查、规格静态校验。没有运行行为测试、UI、Browser/Electron 冒烟、全仓类型检查或构建。规格中的兼容验收属于后续实施要求，不能引用 Spec007 的历史通过结果当作本期通过。
