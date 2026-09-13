# 公共接口合同

本合同已实现；公开入口与环境边界通过静态、类型和构建验证，见 ../validation.md。

| 入口                         | 内容                                                                       | 允许依赖                                                            |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| @workbench/api 或 /contracts | 信封与 issue/error 协议类型                                                | 环境中立类型，不加载 server                                         |
| /errors                      | 领域品牌错误、业务错误与构造                                               | 环境中立，不读 process/Host/Pi                                      |
| /validation                  | 既有 rpcString/object/array/optional/refine 等和类型推导                   | contracts/errors 与内部纯 helper                                    |
| /client                      | callRpc、RpcClientError、createRpcId、RpcTransport                         | contracts/errors；禁止 Node/server-core/host-client/Pi              |
| /server                      | createRpcPostHandler、handleRpcPost、route group/dispatch、error projector | validation/errors 与 server-core/request-trust；不依赖业务 handlers |

## 客户端

`RpcTransport = (path: string, init?: RequestInit) => Promise<Response>` 使用结构类型；callRpc 的 options 必须包含 transport，rpcId/signal 仍可选。所有既有客户端 facade 公共签名保持，它们内部显式注入 transport。现有 resolveRuntimeFetch 移至 host-client/runtime-fetch 的真实实现入口，保留原默认同源策略；外层 RuntimeFetch 与 RpcTransport 结构兼容，不复制状态。

禁止 api/client 直接读取 RuntimeConnection、accessToken 或注册全局 transport。旧 host-client/rpc exports 删除前必须更新全部调用点，包括无 options 的调用；不能以可选裸 fetch 默认值掩盖遗漏。

## 服务端

保留原 `/api/<method>`、method 精确匹配、HTTP 状态、bad-request issue 结构、请求大小上限、领域单独预算、可信 Host/Origin 校验与 loopback 限制。认证仍在既有宿主中间件执行；不得因搬迁重排 trust/auth/body parse/handler 的顺序。

原 API 无需返回值时的 undefined 序列化、错误 details、signal 传播和未知错误遮蔽均原样保留。保留领域错误两个既有 Symbol.for 品牌识别；不扩大安全可公开错误范围。

## 终态禁止边

api 根/client/validation/errors 不得传递导入 Node、server-core、Host 或 Pi；api/server 不导入 host-server/领域 server；server-core 不反向依赖 api。领域 routes 不再从 host-server/rpc 引入通用 validator/handler。旧 host-contracts/rpc、host-client/rpc、host-server/rpc、server-core/rpc-domain-error 入口与实现删除，全仓无内部深层导入或 forwarding。

服务端入口同时提供 `readTrustedJsonPost` 与 `TrustedJsonPostOptions` / `TrustedJsonPostResult`，用于既有非信封 JSON POST；不新增路由或第二套信任策略。
