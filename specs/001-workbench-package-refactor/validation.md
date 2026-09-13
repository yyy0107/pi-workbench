# 最终验收记录

本记录对应 constitution 3.1.0 与用户最终要求：能力和内部辅助源码保留 TS/TSX；src 放真实能力、契约与装配，lib 放实际使用的内部辅助。任务状态只由 tasks.md 维护。

## 结构与所有权

- 69 个库包，均位于 `packages/<domain>/<capability>`，src/lib 各最多一级子目录。
- 1,100 个 src 文件、172 个 lib 文件，库包发现 534 个测试文件；两个源码目录均有实际内容。
- 严格结构、跨包内部引用、超两层向上模块引用、生产依赖环均为零；迁移基线文件已删除。
- 全部包有中英文 README、显式 exports 与对应测试；没有公开通配入口。workspace 依赖必须是 `workspace:*`。
- [package-inventory.json](package-inventory.json) 的全部记录与当前文件系统核对通过；[helper-consumers.json](helper-consumers.json) 给出每个辅助模块的实际引用，未引用辅助模块为零。README 给出职责及实际消费者示例。
- 结构检查拒绝新增 JS 能力实现；既有 CommonJS artifact 工具与宿主探测工具按原用途维护。原生 Node 使用的 TS 入口采用显式 `.ts` 引用，类型体系仍为 strict/noEmit。

## 命令与结果

| 验证                                                         | 结果                                                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                 | 通过 lint、结构/依赖、全部应用及包 typecheck、根/应用/包测试。2,996 tests，2,989 pass，0 fail，7 条件 skip                                           |
| `pnpm build`                                                 | 通过 Runtime、Web standalone、Desktop renderer 静态导出与 Electron Runtime 产物组合                                                                  |
| `pnpm --filter @workbench/runtime-node run smoke:native`     | Node 24.16.0/Linux x64；PTY 启动/交互/终止、tree-sitter 与 Bash 原生加载通过                                                                         |
| `pnpm --filter @workbench/desktop-electron run smoke:native` | Electron 43.4.1 对应 Node 24.18.1、ABI 148 的精确目标与原生依赖验证通过                                                                              |
| `pnpm --filter @workbench/web run smoke:standalone`          | 原始 standalone 入口 HTTP 200，SSR HTML 63,154 bytes；SWC helpers/tslib 在独立产物内解析                                                             |
| `pnpm --filter @workbench/desktop-electron run pack`         | staged API-only Runtime、实际打包窗口、渲染进程身份/CORS、RPC、Pi 双 WebSocket、PTY、标题栏、Runtime 重启、进程清理及预算通过；无 artifact-only 跳过 |
| Chrome 提示词高亮测试                                        | 单独启用 `PI_PROMPT_HIGHLIGHT_BROWSER=/usr/bin/google-chrome`，跨语法 span/中文 emoji、主题切换、预览替换、输入更新和卸载清理通过                    |
| Web 样式作用域脚本                                           | Chrome 实际页面中两安装实例隔离、区域控件 token、Portal 各圆角档位、滚动条颜色和 resize 动画通过                                                     |
| Spec Kit prerequisites                                       | 正确返回 `specs/001-workbench-package-refactor`，包含 requirements/plan/tasks 所需文档                                                               |

常规套件的 7 项条件跳过包含 5 项 Desktop 条件检查、1 项 Windows 进程 census 与 1 项 opt-in Chrome 高亮。Chrome 项已经单独补跑；Windows 安装器/注册表/进程等条件验证不作为当前 Linux 宿主上的执行结果。构建仍有现有 CSS Highlight 语法解析警告，实际 Chrome Highlight 行为已验证。

完整命令日志保留于本机 `/tmp/workbench-refactor-tools/`：`final-check-sixth.log`、`final-build-complete.log`、`final-native-node.log`、`final-native-electron.log`、`final-web-standalone.log`、`final-desktop-pack-complete.log`、`final-highlight-browser-fixed.log`、`final-web-style.log`。此记录保存结论，恢复工作不依赖临时日志。

## 跨能力覆盖

| 关注点           | 实際验证依据                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 会话/协议/实例   | session-server/server、client、transport-client 和 conversation 行为测试，涵盖历史恢复、创建幂等、generation/reconnect/replay/watermark、取消、队列、交互与销毁；Runtime 实际 RPC/WS 冒烟  |
| Composer/消息    | Composer 文档、指令、附件、历史、提交和 Conversation 渲染/滚动/队列测试；打包 renderer 的 Shell/Composer 水合检查                                                                          |
| 文件/Git/工作区  | workspace runtime/files/file-view/explorer/review/git-branch 测试；Web 隔离状态添加真实临时工作区，创建会话后按路由恢复                                                                    |
| 浏览器/终端      | 浏览器服务的真实 Chrome 表单/导航/观察/取消测试；Web UI 中终端执行本机输出标记，内嵌浏览器打开本机 HTTP 页面；Node/Electron 真实 PTY 冒烟                                                  |
| i18n/外观/Portal | 各包双语键与参数检查，产品 bundle/安装隔离测试；Web 实际语言中英切换并重载恢复、主题切换、代码预览与 Portal 语言菜单；样式作用域与原生 Highlight 测试                                      |
| Pi 配置/资源     | model-server、resources-server、tools、session-server 及 server 集成测试；资源在 bundle 重定位/prune 后安装并被真实 SDK ResourceLoader 加载，工具 ID/顺序、信任、锁、重载和 Trace 实例保持 |

Web 手工冒烟使用 `/tmp/workbench-refactor-smoke/` 的隔离 Agent/工作区/浏览器状态，创建了 `refactor-smoke-session`，通过 `/c/refactor-smoke-session` 恢复并确认语言偏好生效。浏览器/终端只访问本机夹具，没有付费模型请求。冒烟启动的 Web/Runtime、Chrome 与本机夹具服务器均已清理。

## 修复和兼容依据

最终验证修正了仍读取旧路径的架构/资源测试，以及已有测试中落后的生命周期版本、扩展清单、Highlight 数量和样式档位断言。扩展 `workbench.usage-statistics`、`workbench.skill-reading` 和 Runtime 生命周期版本 7 已存在于重构前代码；产品顺序和生命周期没有为使断言通过而改变。样式守卫使用现有 `--chat-icon-size`、共享图标档位和控件覆盖变量，验证目标仍为区域及安装隔离。

## 收敛结论

Spec Kit converge 对照实际代码完成核对：12 条 FR、7 条 SC、4 组用户场景、8 项架构决策和 5 条 constitution 原则；missing、partial、contradicts、unrequested 均为零，无需追加任务。69 包 manifest/源码/测试清单无漂移，172 个 lib 模块均有实际消费者；55 个任务编号唯一且已全部验证完成。

收敛阶段保持 tasks.md 字节不变，随后由实施流程记录 T051 完成。最终重新生成的 Desktop/Electron 产物也通过 `run pack` 执行冒烟与预算检查。源码和规范的最终格式/lint 检查通过，隔离 Web/Chrome/夹具端口无残留监听。
