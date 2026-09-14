# @workbench/remote-control-contracts

[English](README.md) · [包目录](../../README.md) · [Spec014](../../../specs/014-direct-paired-access/plan.md)

Workbench 手机远程控制窄能力面的版本化 JSON 安全合同。本包负责无账号直连配对和 challenge 元数据、手机—电脑加密载荷形状、严格 codec、协议预算、游标与稳定错误；不依赖 React、Pi RPC、Runtime transport 或服务端实现。

当前直连拓扑由 Spec014 跟踪；Spec013 只作为已被替代的实施历史保留。直连产品代码使用 `@workbench/remote-control-contracts/protocol`、`/codecs`、`/direct-crypto` 与 `/direct-pairing`；根入口和 `/pairing` 提供共享业务及配对形状。`/crypto` 与 `/legacy-codecs` 仅兼容已被替代的 Spec013 wire，手机端和直连网关的生产依赖图不得导入它们。

## 范围

v1 闭合命令联合只包含会话创建、纯文本发送、停止、重命名、设置置顶、归档和普通问题回答。不存在终端、文件、浏览器、Git、附件、任意工具调用、工具审批、扩展、工具箱、自动化、模型/Provider 设置、归档恢复/删除、原始 Runtime/Pi RPC 或 catch-all method 入口。只读对话联合另行携带用户可见的助手文本、规范化工具调用参数和原始文本工具输出；这些数据不能作为命令重新执行。

主要限制为：Socket 认证 16 KiB、密封 envelope 256 KiB、命令明文 128 KiB、发送文本 64 KiB、投影助手文本 96 KiB、工具参数 64 KiB、文本工具输出 128 KiB、标题 512 bytes、ID 128 ASCII bytes、错误 details 4 KiB、旧版活动摘要 2 KiB、会话页 192 KiB/100 项、历史页 192 KiB/50 项、实时 delta 16 KiB、JSON 深度 16。限制统一按 UTF-8 bytes 计算，并覆盖完整结构化值；投影消息和工具转录会显式报告截断。

直连接入点是受限的 `{kind, host, port}`，只表达私有局域网或 Tailscale 可达性。Socket URL 由直连网关/客户端 owner 派生，固定使用 `/remote/v1/direct`，不带凭据或 query。扫码/手动配对、新鲜签名 challenge、设备授权 revision 与直连 envelope header 都不包含账号、OAuth/OIDC、Relay、ticket 或 bearer token 字段。

`/direct-crypto` 已通过 E2EE 安全门，使用 P-256、HKDF-SHA256 与 AES-256-GCM 实现 RFC 9180 authenticated mode；`/direct-pairing` 负责规范化直连配对/Socket 认证 transcript 与六位安全码派生。每个直连 envelope 可见 header 都作为 AAD 验证；过期、方向、设备/电脑身份与接收方 key rotation 由边界 owner 检查。

## 归属与生命周期

本包只拥有 wire compatibility，不拥有进程、Socket、数据库、UI、账号、Tailscale 控制面或凭据生命周期。调用方必须在信任边界解析不可信值，不得添加开放式 `method`/`payload` 结构。游标使用 decimal uint64 string。无账号直连产品只在前台活动，不承诺中央推送。

Replay 由电脑端 owner 保留至多 10,000 个事件、10 MiB、15 分钟；快照分块至多 50 个会话和 192 KiB。Socket owner 将待发送字节限制为 1 MiB，并将持续十秒的背压视为慢消费者。这些策略由各自 owner 实现，本包只拥有共享形状和基础预算。

## 验证

```bash
pnpm --filter @workbench/remote-control-contracts typecheck
pnpm --filter @workbench/remote-control-contracts test
```
