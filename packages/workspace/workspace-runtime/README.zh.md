# 工作区运行时

负责工作区 Surface 的无界面控制器、状态、草稿、反馈、持久化与客户端目录选择投影。根入口提供状态合同和安装实例，`/persistence` 提供设置持久化桥接，`/directory-store` 提供客户端目录选择投影。React、DOM、呈现、翻译和样式归 `@workbench/ui-workspace`。

注册表、打开器、校验器和持久化端口都是固定安装输入。一个安装实例只拥有一个 controller、状态 store、反馈 store 和延迟创建的草稿 store。文件、浏览器、终端等具体 Surface 继续由扩展注册表提供；既有 ID、关闭、重试、释放和持久化规则保持不变。

包内分工：`src/` 放无界面能力实现与契约，`lib/` 只保留旧持久化键，`tests/` 放非 UI 行为测试。核心不依赖 React、DOM、extension-host、Shell context 或 UI 实现。
