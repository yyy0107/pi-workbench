# Feature Specification: Client 归属与 Shell 组件拆分

**Feature ID**: `002-client-components-refactor`

**Working Branch**: `codex/package-refactor`

**Created**: 2026-09-12

**Status**: Implemented — T001–T024 完成；UI 测试按用户约束不执行

**Input**: 承接 Spec 001 已完成的重构，将 packages/workbench 并入已有 packages/client，参考用户提供的 client/ui-* 目录继续拆出组件。本轮独立放入 specs/002，不修改 001 的需求和完成记录。

## Scope and Dependencies

前置为 [Spec 001](../001-workbench-package-refactor/spec.md) 的现有 69 包结构；遵循 constitution 3.1.0。保留 TS/TSX、两级领域/能力包根、src 真实能力源码、lib 内部辅助源码及两者最多一级子目录约束。

## User Scenarios & Testing

### User Story 1 — 在 Client 领域定位能力 (P1)

开发者从 packages/client 找到现有 workbench 六包，原包名仍可解析。

**Independent Test**：检查 workspace 包清单与 frozen-lockfile 安装，确认六包新根、原 name 和公开入口均正确。

### User Story 2 — 独立维护组件能力 (P1)

开发者在 ui-sidebar、ui-panels、ui-layout 维护侧栏、面板和框架，在现有 Extension Host 维护命令面板。Shell 负责应用安装和聚合。

**Independent Test**：通过源码、类型与依赖检查确认新能力包不导入 Shell；生产依赖无环，既有测试文件与迁移来源逐项对应，不执行 UI 测试。

### User Story 3 — 用户行为保持兼容 (P1)

用户继续使用侧栏、面板、终端与快捷键；双语、外观、持久化和安装隔离保持兼容。

**Acceptance Scenarios**（行为兼容目标；本轮仅静态审查 UI 相关实现，不执行 UI 场景测试）：

1. 排序、固定、重命名与归档后刷新，原有状态恢复行为不变。
2. 隐藏右工作区不销毁底部终端，面板缩放/关闭/恢复保持兼容。
3. 两个安装不抢占快捷键、Portal 或服务订阅；卸载一套不影响另一套。
4. 切换 en-US/zh-CN 无缺键，主题、全局颜色、密度与圆角在各迁移区域生效。

## Functional Requirements

- **FR-001**：将 workbench 下 shell、pi-product、host-client、services-client、host-contracts、desktop-contracts 迁到 client 同名目录；保留已有 client 包及六个原 package name。
- **FR-002**：侧栏、面板、布局分别归 client/ui-sidebar、ui-panels、ui-layout；CommandPaletteHost 归现有 Extension Host；Shell 保留应用安装、适配和聚合。
- **FR-003**：词典、样式、测试随能力迁移；能力包使用唯一共享 i18n API，不导入 Shell 聚合词典。双语键和插值一致，最终回退 en-US。
- **FR-004**：复用已存在的 UI、appearance、settings、conversation、composer、workspace、Pi 能力；不为参考中尚无实现的功能创建空包，不机械迁移其他领域。
- **FR-005**：维持两级包根、浅层 TS/TSX src/lib 和真实职责；tests 位于所属包，辅助模块有真实消费者。
- **FR-006**：跨包只使用显式 exports 和 workspace:*，生产依赖无环；同步所有消费者后删除迁出组件的旧转发入口，保留 Shell 应用和统一样式入口。
- **FR-007**：保留扩展 ID/顺序、快捷键、持久化键、协议、Provider/服务实例和销毁作用域；无数据迁移。
- **FR-008**：同步工作区、锁文件、构建/资源路径、Tailwind、检查器及当前文档；按实际使用清理依赖，不覆盖用户修改。
- **FR-009**：本 Spec 拥有独立任务与验收记录；保留 Spec 001 原内容，历史完成证据不能替代本轮验证。

- **FR-010**：本轮不新增、不运行 UI 测试，包括组件渲染/交互、DOM 快照、视觉回归、浏览器/Electron UI 自动化及手工交互冒烟。既有 UI 测试文件随能力保留迁移，可修正路径，不删除；UI 仅做代码、类型、词典和样式归属静态检查。非 UI 逻辑测试、lint、包边界检查和构建继续执行；会间接触发 UI 测试的聚合命令须拆开或明确筛选。
- **FR-011**：多 Agent 重构按能力包或完整能力边界派发，子 Agent 使用 `gpt-5.6-luna` 与 `gpt-5.6-sol`。边界清晰的独立能力迁移优先 luna，跨包契约、生命周期、依赖环和集成调整优先 sol；依赖未满足的能力不并行。同一能力的源码、辅助、词典、样式及既有测试路径由同一 owner 负责。

## Success Criteria

- **SC-001**：活跃 packages/workbench 包数为零；六包均位于 client 且原 name 不变；活跃代码/配置无失效旧路径。
- **SC-002**：三项组件能力具有独立公开入口、词典和测试，Shell 无其组件副本；跨包内部引用、生产循环及能力回引 Shell 均为零。
- **SC-003**：迁移前后的测试逐项对应，所有受影响包与直接消费者检查通过。
- **SC-004**：本轮 lint、typecheck、结构/依赖检查、相关非 UI 测试及构建通过；UI 行为兼容目标通过代码审查确认，不要求 UI 测试或交互冒烟。
- **SC-005**：本 Spec 所有实现任务均有本轮约定范围内的验证证据；UI 测试记录为“按用户约束不执行”，不冒充通过，也不作为未完成阻塞。

## Edge Cases and Assumptions

- client 是目录分类；host/desktop contracts 仍环境中立，不能因此依赖浏览器实现。
- 侧栏 i18n 和辅助模块须成组迁移，避免 Shell → sidebar → Shell 循环。
- TerminalDrawer 是底部 PanelDock 包装，保持面板所有权，不让终端 UI 反向依赖宿主。
- 历史文档/快照中的旧路径不做盲目替换；可执行路径必须逐项更新。
- 包数预计 72，仅用于清单核对；不作为验收或继续拆包的理由。

## Key Entities

包迁移、组件所有权、翻译/样式所有权及验证证据，详见 [data-model.md](data-model.md)。没有新增业务实体或持久化格式。
