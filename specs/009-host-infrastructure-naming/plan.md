# 应用基础设施命名与边界实施计划

基线：`aa87792b`。本期以 [spec.md](spec.md) 为准，保留既有 skill 工作区修改与 Spec001–008。

## 目标映射

| 原能力                                                              | 新目录 / 包名                      | 所有权                                             |
| ------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| client/host-contracts                                               | contracts/runtime-contracts        | 连接、宿主能力、控制消息与产物格式合同；无生产依赖 |
| client/host-client                                                  | transport/runtime-transport-client | Runtime HTTP / WebSocket 客户端载体                |
| host/host-server：认证、HTTP、Fetch、proxy                          | transport/runtime-transport-server | Node 传输入口与认证、代理                          |
| host/host-server：api-only、控制会话、child、probe、Windows process | process/application-process        | Runtime/Web 服务进程的启动、就绪和关闭             |
| host/host-server：runtime-artifact、web-artifact                    | build/artifact-reader              | 产物清单、文件树、目标与完整性读取校验             |
| host/host-artifact-policy                                           | build/artifact-policy              | 产品构建与启动采用的原生依赖、资源及来源准入规则   |

原 4 个包变为 6 个包，总库包数 97 → 99。不为历史名称建立转发包。Host 命名的线协议/API 符号保持原名，避免无意义重命名扩大范围。

## 依赖方向

- runtime-transport-client → runtime-contracts。
- runtime-transport-server → runtime-contracts、server-core；不可依赖 process/build 或产品。
- application-process → runtime-contracts、runtime-transport-server；不拥有 Pi 业务图。
- artifact-reader → runtime-contracts；不依赖传输、进程或产品。
- artifact-policy → browser-contracts、terminal-contracts、既有 Next 构建依赖；由应用将策略注入 reader。
- 所有合同保持无生产依赖。通用 RPC 仍使用 transport/api；扩展生命周期仍归 extension-platform/extension-host。

## 实施约束

- 按逐文件清单迁移源代码和测试，再按原公开子路径重新归属入口。
- 跨新边界改为 exports 引用；依赖按实际消费者声明，生产与测试区分。
- application-process/lib 提取既有流式脱敏辅助；artifact-reader/lib 归置现有路径校验辅助，保留错误语义。
- 更新 pnpm workspace、lockfile、构建脚本、静态边界检查、当前导航与中英文 README。
- 历史记录保留原名；新增迁移清单与本期验证记录。

## 验证

参见 [quickstart.md](quickstart.md)。不执行 UI 测试或交互冒烟；检查非 UI HTTP/认证/控制会话/产物/Windows 进程/构建边界和应用组合测试。新增边界检查保证传输和 reader 不反向依赖 process/build 产品策略。
