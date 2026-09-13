# 研究与取舍

## 一个公共包，按环境提供入口

Decision：packages/transport/api，@workbench/api/{contracts,errors,client,validation,server}；根入口仅类型。
Rationale：目前通用信封在 host-contracts，调用在 host-client，校验/分发在 host-server，领域错误在 server-core；归属分散且业务 server 因使用 validator 依赖 host-server。
Alternatives：不再开 api-client/api-server/api-contracts 三个包；不把所有业务 API 汇总到一个巨型包，也不把服务端能力放 packages/client。

## transport 注入

Decision：api/client 接收显式 transport；RuntimeConnection URL、Desktop Bearer、同源默认解析仍由 host-client/runtime-fetch 实现，业务适配器将其传给 callRpc。
Rationale：当前 host-client/rpc 默认先解析同源 transport，不能改成直接全局 fetch 而失去 URL 限制。api 若依赖 host-client，同时 host-client 依赖 api，会产生循环。
Alternatives：不增加全局 transport 注册，不要求 React Provider，不在 API 包读取 Desktop token/RuntimeConnection，不保留旧 rpc.ts forwarding。

## 服务端和领域

Decision：通用 POST/validator/route group 迁入 api；Host 信任策略保持 server-core/request-trust，由 server 子入口复用。RpcDomainError 与其测试迁入 api/errors，保留 Symbol.for 品牌和 legacy Pi 品牌识别。
Rationale：server-core 当前只有 rpc-domain-error.ts 定义该能力，没有其它 src 消费它；迁出不要求 server-core 反向依赖 api。不能让 api 反向导入 Pi、settings-server 等业务实现。
Alternatives：不移动领域 handler，不重写错误协议，不顺便拆 Pi 的大 rpc.ts 业务 DTO 文件。

## 范围澄清

本期 API 指网络 RPC 公共能力，不包含 extension-sdk/src/api 的扩展作者契约。Pi connections.ts 的 WebSocket 重连/stream parser、Host runtime-websocket 及 listen/auth 中间件留原 owner；本轮不将不同生命周期的连接强行合并。
