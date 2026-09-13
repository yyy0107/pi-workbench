# 原有包的源码分工复核

业务、服务生命周期、公开契约与装配保留 src；下表逐项移出已有辅助实现，少量重复初始化/绑定合并复用。lib 均有实际消费者。既有构建检查 CommonJS 仅按原用途移动文件系统辅助，不新增 JS 或转换 TS。

| 包                                     | 复核来源（迁移前）                          | 内部辅助                               | 职责依据                                           |
| -------------------------------------- | ------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| `packages/agent-runtime/runtime`       | `src/notifier.ts`                           | `lib/notifier.ts`                      | `Observable 通知订阅`                              |
| `packages/extension-platform/sdk`      | `src/registries/registry-utils.ts`          | `lib/registry-utils.ts`                | `Registry 公共校验`                                |
| `packages/host/artifact-policy`        | `src/filesystem.cjs`                        | `lib/filesystem.cjs`                   | `既有 CommonJS 构建检查的文件系统辅助，语言保持`   |
| `packages/host/server`                 | `src/runtime-transport-auth.ts`             | `lib/runtime-transport-auth.ts`        | `Runtime 认证帧和请求头辅助`                       |
| `packages/pi/client`                   | `src/runtime/fork-title.ts`                 | `lib/fork-title.ts`                    | `分叉标题解析`                                     |
| `packages/pi/shared`                   | `src/prompt-template.ts`                    | `lib/prompt-template.ts`               | `模板参数解析`                                     |
| `packages/server/browser`              | `src/pointer-motion.ts`                     | `lib/pointer-motion.ts`                | `指针移动数学计算`                                 |
| `packages/server/core`                 | `src/child-process-environment.ts`          | `lib/child-process-environment.ts`     | `子进程环境派生`                                   |
| `packages/server/local-host`           | `src/local-apps/process.ts`                 | `lib/process.ts`                       | `系统进程执行辅助`                                 |
| `packages/terminal/client`             | `src/terminal-socket-url.ts`                | `lib/terminal-socket-url.ts`           | `终端连接 URL 编码`                                |
| `packages/terminal/server`             | `src/terminal-transcript-projector.ts`      | `lib/terminal-transcript-projector.ts` | `VT 转录解析`                                      |
| `packages/workbench/host-contracts`    | `src/control-ndjson.ts`                     | `lib/control-ndjson.ts`                | `多控制协议复用的 NDJSON 编解码`                   |
| `packages/workbench/shell`             | `src/sidebar/thread-sort.ts`                | `lib/thread-sort.ts`                   | `侧栏排序算法`                                     |
| `packages/agent-runtime/client`        | `src/conversation/presentation-metadata.ts` | `lib/metadata-values.ts`               | `呈现元数据标量读取`                               |
| `packages/agent-runtime/contracts`     | `src/message-metadata.ts`                   | `lib/metadata-values.ts`               | `消息元数据标量读取`                               |
| `packages/agent-runtime/testkit`       | `src/runtime/fake-agent-runtime.ts`         | `lib/mutable-observable.ts`            | `测试 Observable 支撑`                             |
| `packages/contracts/automation`        | `src/index.ts`                              | `lib/validation.ts`                    | `自动化持久化值形状检查`                           |
| `packages/contracts/browser`           | `src/index.ts`                              | `lib/validation.ts`                    | `浏览器协议原子验证`                               |
| `packages/contracts/core`              | `src/composer/request.ts`                   | `lib/validation.ts`                    | `Composer 文档形状检查`                            |
| `packages/extension-platform/host`     | `src/services/main-view-service.ts`         | `lib/breadcrumbs.ts`                   | `不可变面包屑快照`                                 |
| `packages/pi/browser`                  | `src/script.ts`                             | `lib/script-worker.ts`                 | `既有 Worker 程序常量；脚本业务留 src`             |
| `packages/pi/protocol`                 | `src/stream.ts`                             | `lib/stream-validation.ts`             | `流协议原子验证`                                   |
| `packages/pi/server`                   | `src/transport/compaction-rpc-validator.ts` | `lib/compaction-rpc-validator.ts`      | `组合型 RPC 子 schema`                             |
| `packages/server/automation`           | `src/repository.ts`                         | `lib/values.ts`                        | `持久化值及错误读取`                               |
| `packages/server/settings`             | `src/service.ts`                            | `lib/values.ts`                        | `配置原子值验证`                                   |
| `packages/server/workspace`            | `src/local-files.ts`                        | `lib/file-projection.ts`               | `去除 Workspace 身份的文件投影`                    |
| `packages/terminal/contracts`          | `src/index.ts`                              | `lib/frame-validation.ts`              | `终端帧原子验证`                                   |
| `packages/terminal/pi-tool`            | `src/index.ts`                              | `lib/command-options.ts`               | `命令前缀和超时解析`                               |
| `packages/workbench/desktop-contracts` | `src/title-bar.ts`                          | `lib/title-bar-validation.ts`          | `桥接载荷颜色和键验证`                             |
| `packages/workbench/host-client`       | `src/runtime-fetch.ts`                      | `lib/runtime-url.ts`                   | `Runtime 同源 URL 验证`                            |
| `packages/workbench/pi-product`        | `src/running-indicator-defaults.tsx`        | `lib/thinking-orb-renderer.tsx`        | `产品默认目录使用的第三方渲染适配工厂`             |
| `packages/workbench/services-client`   | `src/file-content.ts`                       | `lib/file-text.ts`                     | `文件文本解码与长度解析`                           |
| `packages/agent-runtime/server`        | `src/{commands,execution,threads}.ts`       | `lib/agent-server-error.ts`            | `三种领域错误的重复初始化；公开异常身份与属性保持` |
| `packages/pi/contributions`            | `src/i18n/index.ts`                         | `lib/i18n-runtime.ts`                  | `消除 Hook 和程序化调用的重复运行时绑定`           |

表中来源记录提取前的位置，完整当前源码位置见 [package-inventory.json](package-inventory.json)。公开辅助入口保留显式导出，已无消费者的私有转发文件删除。
