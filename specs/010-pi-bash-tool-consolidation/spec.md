# Feature Specification: 合并 Pi 自定义 bash 工具

**Feature Branch**: `codex/package-refactor`

**Created**: 2026-09-13

**Status**: Accepted

**Input**: 用户确认将仅提供自定义 bash 工具的 pi-runtime-terminal 合并到 pi-runtime-tools，使工具归属容易查找。

## User Scenarios & Testing

### User Story 1 - 在工具包中找到 bash (Priority: P1)

维护者通过工具包文档找到自定义 bash 的实现与使用入口，无需寻找另一个终端运行时包。

**Why this priority**: 当前包名与实际工具职责不符，增加查找成本。

**Independent Test**: 检查导航、公开入口与实际消费方。

**Acceptance Scenarios**:

1. **Given** 维护者需要修改 bash 工具，**When** 阅读工具包说明，**Then** 能找到唯一的工具实现、辅助逻辑和测试。
2. **Given** 应用需要安装 bash，**When** 引用工具包的 bash 入口，**Then** 能使用原有工厂和参数，不再依赖独立终端适配包。

### User Story 2 - 保持终端与工具行为 (Priority: P1)

用户继续使用同一终端会话执行工具命令，命令限制、输入归属、取消与超时保持原行为。

**Why this priority**: 目录整理不能改变工具执行与会话隔离。

**Independent Test**: 原 bash 行为测试、覆盖选择测试、类型和 Runtime 构建。

**Acceptance Scenarios**:

1. **Given** bash 收到命令和输入声明，**When** 执行，**Then** 继续交给已有终端会话管理器。
2. **Given** 消费者只引用工具包其他入口，**When** 解析依赖，**Then** 不因根入口聚合而额外载入 bash 模块。

### Edge Cases

- 同名 bash 覆盖仍通过已存在的宿主绑定注入，不注册第二套工具或扩展。
- 终端原生依赖声明随工具实现迁移，但 PTY 实现仍由通用终端包拥有。
- 当前未提交的 Spec009 保留；历史规格与迁移记录不改写。

## Requirements

### Functional Requirements

- **FR-001**: bash 工具、辅助逻辑和原测试必须合并到现有工具包，删除空的原包。
- **FR-002**: 所有当前消费者、文档和锁文件必须使用新的明确入口。
- **FR-003**: 工具名称、来源标识、参数、输出截断、取消、超时和共享会话注入保持兼容。
- **FR-004**: 通用终端层保持不依赖 Pi；工具包根入口不增加 bash 聚合导出。
- **FR-005**: 相关类型、非界面测试、包边界及 Runtime 构建必须通过。

## Success Criteria

### Measurable Outcomes

- **SC-001**: bash 工具只有一份实现和一个公开使用入口，所有当前导航均指向它。
- **SC-002**: 全部既有 bash 行为测试通过，相关应用成功构建。
- **SC-003**: 工作区减少一个没有独立产品用途的包，现有终端与 Agent 行为保持兼容。

## Assumptions

- 基于 Spec009 已完成但未提交的工作区继续；既有 skill 修改保持原样。
- 不执行 UI/DOM/Hook 渲染测试或界面冒烟，不升级 SDK，不提交或推送。

## Workbench 项目约定

遵循项目宪章和 AGENTS.md，使用 pnpm、显式子路径、浅层 src/lib 和包根 tests；迁移后验证再记录完成。
