# 来源与消费者映射

所有路径相对仓库根；目标文件已创建并完成迁移。source-inventory.json 保留基线，migration-map.json 记录处置，最终验收见 validation.md。

| 来源                                                                                                                         | 目标                                                                                                  | 消费者 / 验收                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| packages/client/host-contracts/src/rpc.ts                                                                                    | packages/transport/api/src/contracts.ts                                                               | Pi protocol、客户端、Host/server；信封字段不变                                              |
| packages/client/host-client/src/rpc.ts                                                                                       | api/src/client.ts 与 lib/response-envelope.ts；同源 transport 部分留 host-client/src/runtime-fetch.ts | host-client 使用者、Pi transport API、领域客户端；所有调用显式注入，认证/URL 策略保持       |
| packages/host/host-server/src/rpc.ts 的 validator                                                                            | api/src/validation.ts 与 lib/validation-issues.ts                                                     | 所有领域 routes 的 rpcObject 等与推导类型；问题路径/约束不变                                |
| 同文件通用 POST/group/error projector                                                                                        | api/src/server.ts，通用业务错误至 errors.ts                                                           | host-server、pi-server、settings/automation/workspace/local-host-server；预算/信任/状态不变 |
| packages/server/server-core/src/rpc-domain-error.ts                                                                          | api/src/errors.ts                                                                                     | 所有领域错误子类与 projector；品牌与 HMR/legacy 兼容保持                                    |
| host-server/tests/rpc.test.ts、rpc-route-group.test.ts；server-core/tests/rpc-domain-error.test.ts；host-client RPC 相关测试 | api/tests 按公共职责迁移；真实宿主集成测试保留原包                                                    | 断言保留，fixture/导入同步，不为通过检查删除覆盖                                            |

保留 owner：Pi transport 的领域 facade/错误适配、Pi protocol 的业务 DTO、各 server routes 的 service 注入/handler、runtime-node 的 listen/auth/warmup、Host connection/http/websocket、扩展 SDK 的 api 目录。

同步全部 manifest/exports、pnpm-lock.yaml、公开 README 与构建依赖扫描根。新包需要合法真实 src/lib/双语 README/tsconfig；不新增 UI 文案或空词典。

## 实施补充

逐文件处置见 [migration-map.json](migration-map.json)，覆盖 source-inventory.json 的 103 项。客户端默认调用集中在 services-client/src/errors.ts 的 callServiceRpc 与 pi-transport-client/src/api.ts 的 callPiRpc；两者保留 options/transport 可选的 facade，在内部调用 api/client 时解析并注入必填 transport。文件内容读取继续使用 Host resolver。

readTrustedJsonPost 与 TrustedJsonPostOptions/Result 一并归 api/server，保留非信封 JSON POST 的共享 trust/media-type/UTF-8/body-budget 行为。
