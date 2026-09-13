# @workbench/ui-terminal

拥有 terminal 能力实现及共置双语词典；消费者只使用公开入口，产品保持原有 bundle 与扩展安装顺序。稳定 ID、命令、持久化格式和安装级生命周期保持兼容。测试位于 tests/。

src 拥有终端界面、服务、契约与扩展装配及共置词典/样式；lib 拥有被界面实际使用的终端记录、状态与尺寸辅助模块。实现统一保留 TS/TSX。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/terminal-surface.tsx` 引用 `lib/terminal-resize-observer.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

既有 bash presentation 负责命令摘要和 terminal 分组元数据，保持原 renderer 与 disclosure controller。
