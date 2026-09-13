# 数据与所有权

不新增持久化实体或协议版本。

| 类型/状态                                            | 最终归属                     | 不变量                                                |
| ---------------------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| ClientRequest / ServerResponse / RpcIssue / RpcError | api/contracts                | type/rpcId/method/payload/result 字段与 JSON 语义保持 |
| RpcClientError                                       | api/client                   | code/status/details/message 保持，rpcId 关联校验保持  |
| RpcDomainError / RpcBusinessError                    | api/errors                   | 品牌识别、公开错误白名单与未知异常遮蔽保持            |
| RpcValidator / optional/object 推导                  | api/validation               | required/optional/nullable、issue path 和细化规则保持 |
| RpcHandlerContext / RpcRouteGroup                    | api/server                   | request/signal/方法匹配与分发次序保持                 |
| RuntimeConnection / runtime fetch                    | host-contracts / host-client | 安装级连接身份、URL 限制与 Bearer 头覆盖保持          |
| Pi/Settings/Workspace method payload/value           | 现有领域 contracts/protocol  | 不从公共 API 包依赖业务包，不更改 DTO                 |

请求仍由调用者创建 rpcId、传递取消信号，服务端校验/分发/投影，客户端验证响应关联后返回 value 或抛 RpcClientError。业务状态与连接销毁顺序不变。
