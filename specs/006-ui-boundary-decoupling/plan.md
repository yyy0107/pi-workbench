# Implementation Plan: UI 边界解耦

**Branch**: `codex/package-refactor` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

Input: `specs/006-ui-boundary-decoupling/spec.md`。feature ID 为 006-ui-boundary-decoupling，setup-plan 输出的 feature 标识不代表实际 Git 分支。

## Summary

在已经完成能力拆包的当前工作树上，继续切断协议解析、Session 读取、业务装配与样式跨 owner 的依赖。先完成工具呈现、消息块、布局三个跨包边界，再整理 Composer、侧栏和外观设置内部模块，最后收口 CSS 与测试归属。保持 93 个库包，不以新增包数或文件行数作为验收指标。

Spec004/005 与 client 迁移尚未全部提交。HEAD 8ee7ee24 不能还原来源；本期以 source-inventory.json 记录的当前源码为基线，实施前检查漂移。历史 Spec 保持原记录。本次仅产生规划文档，不执行迁移、不提交或推送。

## Technical Context

- Language: TypeScript 7.0.2、React 19.2.8；能力和 helper 均保留 TS/TSX。
- Dependencies: pnpm 11.22.0、Lexical 0.49.0、现有 Extension SDK/Host、Agent Runtime Client、settings、i18n、Opener 与 Shell。保留现有 SDK 版本，不引入新框架。
- Storage: 不新增数据实体或迁移。Session、附件、scroll persistence、settings 与 sidebar 持久化格式不变。
- Target: Web 与 Electron 的共享客户端 UI；不修改 Next.js API 或服务端工具协议。
- Testing: 静态依赖/结构/样式检查、类型检查、构建、白名单纯逻辑测试。用户明确排除全部 UI 测试与 UI 冒烟。
- Performance: 缩小 sidebar 消费面并保持引用/订阅稳定；不承诺未经测量的性能收益，不新增全局状态或重复编辑器实例。
- Scope: 当前 93 个库包、98 个 workspace projects；基线测试文件 636（库包 535）。测试迁移核对来源和断言，不用总数替代验证。

## Constitution Check

| Gate                          | 设计前 / 设计后结论                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| 具体能力 / 包位置             | 通过：使用现有 client 与 Pi owner，目标不新增包                                                 |
| 浅层实际源码 / public exports | 通过：新增模块留 src；纯辅助留 lib；均最多一级子目录，无临时转发终态                            |
| 唯一基础能力 / 无环           | 通过：复用现有 registry、Session、settings、i18n；最终按明确禁止边检查                          |
| 行为兼容                      | 通过设计审查：Provider 范围、ID、并行分组、fallback、事务与资源生命周期列入合同；实施后另行验收 |
| 验证后完成                    | 通过：本期不声称实现完成；下一阶段生成任务并附验证证据                                          |

用户明确“不新增、不执行 UI 测试”的要求覆盖宪章中完整测试/跨宿主冒烟的泛化要求。实施只执行允许的检查和纯逻辑测试，明确记录未验证的渲染行为；不为规划修改宪章。

## Project Structure

```text
specs/006-ui-boundary-decoupling/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── ownership-map.md
├── source-inventory.json
├── quickstart.md
└── contracts/public-boundaries.md
```

实施目录：`packages/client/{ui-tool,ui-message-blocks,ui-conversation-nodes,ui-input-trigger,ui-layout,shell,ui-composer,ui-conversation-list,ui-conversation-messages,ui-conversation,markdown,code-highlighting,ui-theme,ui,ui-selectors}`；工具协议适配留 `packages/pi/pi-ui-toolbox`，产品注册留现有 Pi contributions；公开呈现契约留 `packages/extension-platform/extension-sdk`，必要错误隔离复用 extension-host。

具体来源、目标、消费者和退出条件见 [ownership-map.md](ownership-map.md)。规划阶段未生成任务；后续任务生成阶段已产出 [tasks.md](tasks.md)，实施已完成，36/36 任务与证据见 tasks.md、validation.md。

## 执行阶段与依赖

1. **基线与接口冻结**：复核清单/最近 AGENTS；检查 registry 重复注册和现有 parser 消费者；主 Agent落地呈现契约、消息块 props、Shell header model 与共享 token API。先写明确静态禁止边与验证白名单。
2. **三个 P1 边界**：工具协议与 Pi 呈现、消息块适配、Shell 装配可在共享接口确定后按互不重叠文件并行。必须同批更新消费者/exports/manifest；不得把临时兼容分支当最终结果。
3. **内部模块整理**：Composer 在共享 token 迁移之后拆交互协调；sidebar 拆投影/窄接口/菜单；theme 拆页面/控件。只移动有实际职责的模块。
4. **样式和测试归属**：按最终 DOM owner 移 CSS，核对资源入口与顺序；迁移现有 selector 三项断言，去掉 ui 的反向 dev 依赖。
5. **收口**：静态边界、i18n、类型、相关纯逻辑与构建；核对清单和历史测试去向，删除死导出、旧源码与空目录。完成证据写下一阶段 tasks/validation，不修改本期规划为实施完成。

## Agent 分工

- 主 Agent：共享 SDK/Host 契约、Shell 装配、共享 token 和 CSS 最终归属、注册顺序、manifest/lock、集成及验收。
- Sol：协议适配与工具呈现；完成后可接 Composer 或消息块生命周期拆分，负责复杂错误/异步边界。
- Luna：接口明确后的 theme 内部拆分、selector 既有测试搬迁、独立投影/helper 整理。
- 同时最多两个写入子 Agent；每批明确唯一文件 owner，SDK/Host/manifest 不交叉写。不得通过模型分工跳过主 Agent 审核，也不得运行 UI 测试。

## Complexity Tracking

无需新增架构例外。增加可选呈现字段是为已有真实差异提供接口；不建立新 registry、资源服务或共享“万能 UI”包。协议识别迁移包含既有 read 特殊呈现的组合，不能重复注册同一个工具名。

## 规划工作流记录

已执行 setup-plan；研究与设计完成，无待用户澄清项。仓库不存在 `.specify/extensions.yml`，前后 hooks 均跳过；不存在 update-agent-context.sh，手工向根 AGENTS.md 追加本期上下文。规划后宪章审查通过；文档检查见完成报告。

## 实施完成记录

本计划已实施；最终具体模块落点见 ownership-map.md，源码 hash 变化见 implementation-map.json。保持 93 个库包，51 项精确纯逻辑检查通过、全仓类型/lint/依赖/结构与完整构建通过。既有 UI 测试未执行，现场验证脚本已从允许清单排除；详见 validation.md。
