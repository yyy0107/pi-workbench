# Implementation Plan — API / RPC 基础能力提取

**实际分支**：codex/package-refactor；**日期**：2026-09-13；**Spec**：[spec.md](spec.md)。feature ID 是 007-api-rpc-extraction，不另建分支。

## Summary

新增一个 @workbench/api 包（packages/transport/api），集中通用 API/RPC 能力：信封、错误、校验、客户端调用和服务端分发。以 exports 区分运行环境，领域 DTO/业务 handler 与 Host connection 留原 owner。32 项实施任务已完成，结果见 [validation.md](validation.md)。

## Technical Context

TypeScript 7、pnpm 11，保留已有 Fetch/Request/Response、AbortSignal、现有 RPC 编解码与 validator；不引入 tRPC、OpenAPI 生成或新的网络框架。服务 Web/Electron/Runtime；无存储迁移。93 → 94 个库包，增加的是实际公共能力，不是聚合 workspace。源码基线为 Spec006 提交 `383fe578`；实施前核对 source-inventory.json 和后续工作树差异。

## Constitution Check

设计前后检查通过：transport 是领域目录而非包；api 具有真实 src/lib、显式 exports、双语 README 与根 tests；源码最多一级子目录。环境中立入口不导入服务端，生产图无环。单一错误/校验实现、原认证与会话实例保留。不改 Pi SDK、业务协议和宿主 API 路径。用户排除 UI 测试的约束覆盖泛化的跨宿主 UI 冒烟；非 UI 网络/协议检查仍需执行。

## Project Structure

```text
packages/transport/api/
├── package.json
├── README.md
├── README.zh-CN.md
├── src/
│   ├── index.ts                 # 只导出协议类型
│   ├── contracts.ts             # 通用 RPC 信封/issue 类型
│   ├── errors.ts                # 品牌领域错误与业务错误
│   ├── client.ts                # callRpc / RpcClientError / createRpcId
│   ├── validation.ts            # rpcObject 等及推导类型
│   └── server.ts                # POST handler / route-group / error projector
├── lib/
│   ├── response-envelope.ts     # 被 client 实际调用的响应校验
│   └── validation-issues.ts     # 从既有 validator 提取且实际复用的 issue/path helper
└── tests/
```

lib 仅迁入真实使用的辅助，不为了目录而复制函数。构建/tsconfig 沿用仓库源码 exports 约定。纯契约根入口不能 re-export server/client 实现。

## 迁移顺序

1. 基线：列清全部旧 exports/调用点、RPC 测试、响应/信任/预算行为；检查最近 AGENTS。冻结公共合同与新依赖图。
2. 契约、错误、校验器先迁移；host-contracts、server-core 的旧通用入口在消费者切换后删除，不迁入业务 DTO。
3. client 抽离：callRpc 必须得到明确 transport，Host 默认同源解析仍归 host-client/runtime-fetch；所有原隐式调用点改为适配器注入，保持同源校验与认证，不直接以裸 fetch 替代旧 transport。
4. server 抽离：复用 server-core/request-trust；host-server 及各领域 routes 通过 api/server 和 api/validation 使用原行为；真实 server listen/router 装配不迁移。
5. Pi/设置/工作区/automation/local-host 全部消费者切换；测试按 owner 迁移，更新 manifests/lock、双语 README 和边界检查。
6. 精确非 UI 行为验证、lint/类型/依赖/结构/构建，删旧入口与转发，记录完成证据。

## 分工与复杂度

主 Agent负责接口、Host 注入路径、信任策略审查、依赖/exports 与收口；Luna 在接口冻结后做契约/引用/README 搬迁，Sol 处理 validator/server/client 错误和取消边界。同一文件唯一 writer，最多两个并行写入子 Agent。不给新包增加任何 Host 全局 registry 或 transport singleton。

新增一包虽有 client/server 子入口，但属于同一 RPC 协议实现；必须检查子入口传递依赖与浏览器产物，不能仅因目录分开就认为隔离成功。

## 规划结果

[research.md](research.md)、[data-model.md](data-model.md)、[contracts/public-api.md](contracts/public-api.md)、[ownership-map.md](ownership-map.md)、[quickstart.md](quickstart.md) 已生成。无待澄清项。无 extensions.yml 前后 hooks；缺少 update-agent-context.sh，手工追加 AGENTS 上下文。[tasks.md](tasks.md) 的 32 项任务已实施并验证；源码、依赖、入口和文档完成迁移，结果见 [validation.md](validation.md)。
