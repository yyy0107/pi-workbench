# Implementation Plan: 包职责收敛与可复用能力边界

**Branch**: `codex/package-refactor` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

## Summary

实施 W1–W6：收窄实现依赖端口，抽取文件呈现，隔离工作区 UI，迁移中立项目目录，分解 Pi 客户端/服务端会话协调。已有技能文件修改保持。新增两个有实际消费者的 UI 包，目标 96 库包；工作区目录和合同复用既有包。浏览器/模型大文件与工具预算修正不在本期。

## Technical Context

**Language/Version**: 现有 strict TypeScript/TSX，TypeScript 7.0.2；保持既有 CJS 构建工具。

**Primary Dependencies**: React 19.2.8、Zustand、现有 Workbench 包、Pi SDK 0.85.1、pnpm 11.22.0；不升级依赖或构建系统。

**Storage**: 保留 workbench-settings.json workspaces section 与 legacy workspaces.json，现有原子写/跨进程锁；保留会话 JSONL、workspace UI persistence 和安装资源。

**Testing**: 精确 node:test 非 UI 白名单、现有 TypeScript loader、类型/AST/结构/依赖规则；UI 测试不新增、不运行。

**Target Platform**: Web、Electron renderer 与独立 Runtime；服务端 Node 环境。

**Project Type**: pnpm monorepo 公共能力迁移。

**Performance Goals**: 不新增权威状态、连接或资源实例；保留原请求/事件序列与订阅模型，不宣称未测量的性能提升。

**Constraints**: src/lib 实际能力且浅层，稳定 ID/协议/持久化/安装顺序不变；业务文案若变化必须双语；无 UI 交互冒烟。

**Scale/Scope**: 94 包基线，598 条内部生产依赖；新增 ui-file-presentation、ui-workspace；W1/W4/W5/W6 优先复用原包。

## Constitution Check

- 领域与能力：两个新 UI 包均有现存消费者；目录服务落现有 workspace-server，合同落现有 contracts owner。
- 显式接口：通过 exports 与精确 workspace 依赖，源码与辅助不超过一级子目录，不建转发空壳。
- 所有权：一个工作区 store/会话 registry/连接；Pi 消息与服务实例不进入通用 UI。
- 兼容：原文档、事件、身份、错误和生命周期受非 UI 回归保护；旧源码入口随消费者同步删除。
- 验证：任务仅有证据后勾选；用户排除 UI 测试优先于一般冒烟条款。

设计前后均通过，无需宪法例外。SDK 版本已核对。暂无 extensions.yml hooks；缺少 update-agent-context.sh 时以本次说明更新根 AGENTS 上下文。

## Project Structure

```text
specs/008-package-reuse-boundaries/
  spec.md / architecture-review.md / extraction-map.md / audit-baseline.json
  plan.md / research.md / data-model.md / ownership-map.md / quickstart.md
  source-inventory.json / migration-inventory.json / dependency-result.json
  contracts/public-boundaries.md / non-ui-tests.json / tasks.md / validation.md
packages/client/ui-file-presentation/    # icons/download + consumed helpers
packages/client/ui-workspace/            # React/DOM/CSS workspace presentation
packages/workspace/workspace-runtime/    # headless surface state/feedback
packages/server/workspace-server/        # catalog implementation alongside files/git
packages/agent-runtime/agent-runtime-contracts/src/workspace-catalog.ts
packages/contracts/browser-contracts/src/host.ts
packages/pi/pi-client/src/runtime/       # focused client coordination
packages/pi/pi-session-server/src/       # focused server coordination
```

## Execution and ownership

Root owns shared contracts, catalog/Pi adaptation, manifests/lock, root checks, specs and integration. Luna owns W2; Sol owns W3; Sol owns W5/W6. Each source file has one writer; agents coordinate overlapping import migrations before edits. Agents may create their new package manifest but existing manifests/root scripts/apps changes go through root. Detailed source/consumer ownership is frozen before implementation.

Stages: baseline/contracts → independent W2/W3 and W1/W4 → W5/W6 with fixed collaborator contracts → removal/README/checker updates → exact tests, types, dependencies, structure, lint, builds → source inventory and completion evidence.

## Complexity Tracking

No justified principle violations. Two UI packages are cohesive owners with actual consumers. Catalog contract is a subentry, not a new empty contract package. Session components remain in current Pi packages; narrow dependencies must change actual coupling, not merely filenames.

## Workbench 项目约定

依照宪法、最近 AGENTS、extend-workbench-ui、ui-styling 与 pi-coding-agent-sdk 执行。能力在 src，辅助在 lib；保留 TS/TSX 和源码 exports。所有任务有前置、来源/目标、消费者和退出条件。公开 API、资源、样式、测试归属、双语 README、manifests 与 lock 同批收口。
