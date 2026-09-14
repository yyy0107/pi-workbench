# @workbench/pi-runtime-remote-control

[English](README.md) · [包目录](../../README.md) · [Spec014](../../../specs/014-direct-paired-access/plan.md)

在 Electron 主进程安全运行的适配器，将刻意收窄的手机直连协议映射到现有、仅 loopback 可达的 Pi Runtime。本包通过注入端口负责手机安全的会话/对话投影、穷尽命令映射、按设备持久化的操作身份、replay/snapshot 状态及认证后的 HPKE 帧处理；不拥有网络监听器，也不导入 Electron 或 Pi 私有服务端模块。

## 公开能力与生命周期

根入口聚合明确的 `/conversation-projection`、`/command-adapter`、`/operation-ledger`、`/operation-service`、`/runtime-monitor`、`/projection`、`/session-catalog`、`/snapshot-service`、`/frame-processor`、`/direct-frame-processor`、`/sqlite-ledger` 与 `/workspace-projection` 入口。消费者必须使用这些公开入口，不得 deep import 包内部。

Electron 主进程为当前 loopback Runtime generation 创建一个处理器。Runtime 被替换时会释放旧 generation，并建立新的投影 epoch。内嵌直连网关先认证已配对手机，再只把密封直连 envelope 与当前本地授权传给 `direct-frame-processor`。每次读写都会在本机 effect 前后重新检查电脑、设备、授权 revision、action scope 与撤销状态。

直连帧处理器使用 P-256、HKDF-SHA256 和 AES-256-GCM 打开与密封 RFC 9180 authenticated-mode HPKE envelope。它只处理封闭的目录/历史/状态/恢复请求，通过持久 ledger 执行 allowlist 命令联合，并为单个已授权手机加密每个结果/事件。Runtime monitor 只消费公开 Pi connection/stream API，并投影有界的手机安全状态；它不产生推送通知。

Operation ledger 在调用 Pi 前记录 canonical command digest 与固定 domain identity。相同重试回放结果，同一 operation ID 对应不同内容会被拒绝。已完成记录保留七天且至少保留最近 10,000 条；未完成记录不因容量而清理。Replay ring 至多保留 10,000 个事件、10 MiB、15 分钟；snapshot 每块最多 50 个会话/192 KiB，并使用 1,000 事件/1 MiB 并发缓冲。

只通过公开 Pi RPC 映射会话列表/读取/创建、纯文本发送、停止、重命名、置顶、归档，以及回答已存在的普通问题。只读投影会保留每条用户可见的助手文本，并携带有界、不可交互的工具调用参数和原始文本工具输出；超出上限的 UTF-8 内容只保留前缀并显式标记。隐藏 thinking、二进制/图片结果、结果 details、Provider 异常、未知 Host 事件和审批载荷仍会排除。工具箱、终端/文件/浏览器控制、任意工具调用/RPC、敏感审批、模型/Provider 设置、扩展、取消归档与删除均不存在。本包也不依赖 Workbench 账号、OAuth/OIDC、中央服务、公共发现、通知 Provider 或 Tailscale API。

## 验证

```bash
pnpm --filter @workbench/pi-runtime-remote-control typecheck
pnpm --filter @workbench/pi-runtime-remote-control test
```
