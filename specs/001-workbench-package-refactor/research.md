# Research: 拆包事实与决策

## 基线

当前已有 34 个库包和 4 个应用。最大的包为 Shell、Pi server、Pi contributions、Pi client。原文本扫描发现约 391 处超两层相对引用；正式基线采用语法解析。Spec Kit 0.12.5.dev0 初始化到临时目录后合并，已有技能和 AGENTS 保留。实施开始时 Git 工作区干净。

## 目录与构建

决定：只调整过深的包根，保留合规领域/能力结构，src 限一级。理由：参考目录的 219 个包均采用领域/能力，用户明确约束 src 深度。测试根 tests/ 必须同时更新 runner 和依赖检查；旧实现只扫描 src/test。Runtime artifact、Tailwind @source、架构测试存在硬编码路径，必须同步处理。

## 前端循环

决定：settings 移除 settings-main-view re-export；i18n 不导入 messages.ts 聚合字典，Provider 不直接导入设置；UI FileLink 行为归文件能力；highlighter 不引用 chat。理由：这些反向依赖会在直接移动目录时形成包循环。保留 bundle factory，实现逐能力迁移；不增加第二套翻译 hook 或全局 singleton。

## Pi 循环

决定：transport 的 api/connections/client-transport 为先行闭包；session-message-accumulator 属于纯 conversation 投影。resources 已有 Dependencies 接口，去掉默认 registry 导入，由 server composition 注入。模型 wrapper 的 Trace 依赖改成观测回调；Host binding types 与 publisher 契约下沉到 server-ports，StreamHub 本体留 server。

理由：保证单个 resource mutation coordinator 的 user/project lock、等待全部 reload 后删除资源、唯一 paired WS generation 和既有 runtime作用域。Pi SDK 0.85.1 root API 已验证；不需要私有导入或升级。

## 备选取舍

未采用顶层全平铺、全仓路径 alias、包内大量转发或每目录一个空包。这些不能同时实现领域归属、src 浅层和可检查依赖。默认复用现有测试/构建工具，增加开发依赖 oxc-parser 的公开 AST API 准确分析模块（已安装的 TypeScript 7 不再暴露旧版 compiler API），避免正则把 fixture 字符串误认为 import。

## R-2026-09-12：src/lib 源码分工（历史，已由下一条修订）

用户确认 lib 承载手写内部源码，src 承载公开入口和装配。此确认取代旧的“业务源码只能在 src”限制；对两处执行相同浅目录、依赖和引用检查。lib 仍由现有类型检查、测试加载器和 app bundler 处理，不引入新的库构建流水线。已完成迁移由 T053 回查，保留原行为测试证据并对新路径再次验证。

## R-2026-09-12：以实际能力源码替代 src 转导出壳（JS 建议已由下一条撤回）

核查用户指定的 DeepSeek Harness `packages/llm/llm-pi-ai` 和 `packages/todo/tool-todo`：前者 src/index.ts 有注册装配，src/adapter.ts 有适配器实现；后者 src/index.ts 有工具定义、配置、校验与注册，src/client.ts/types.ts 有客户端逻辑和契约。两包 package.json 的运行入口为 lib/index.js、类型入口为 lib/types/*.d.ts，tsconfig 的 rootDir=src、outDir=lib/types；lib 内还有 tsbuildinfo。其 lib 是构建产物，并非手写 JS 辅助目录。

采用参考中“src 放真实业务能力、按职责平铺”的原则。用户此前明确选择 lib 为内部源码，故保持该已确认含义，将其收窄为辅助模块；不把参考中的发布流水线、src 通配 exports 或 workspace:^ 一并复制。当前 src 全转导出是机械迁移的不足，需重审 19 个已迁移包，而非仅改文档。

用户新增“lib 有些可以用 JS 就用 JS”：简单纯函数、集合/文本处理等优先使用 ESM JS+JSDoc/checkJs。复杂协议/SDK 类型、泛型状态和 React 组件保留 TS/TSX；不盲目去类型、不用扩展名代替职责划分。继续使用现有 app bundling，所有源码同等纳入检查。

JS 类型检查采用 TypeScript 官方支持的 [allowJs/checkJs](https://www.typescriptlang.org/tsconfig/checkJs.html) 与 [JSDoc 类型信息](https://www.typescriptlang.org/docs/handbook/declaration-files/dts-from-js.html)。源码 exports 的消费者也会检查依赖源码，因此在共享 tsconfig.base 启用 allowJs 供消费者推导类型，JS 所属包启用 checkJs 并包含所有 JS 文件；不扩大未迁移 CommonJS 包的本轮范围，其检查覆盖在 T048 收口。

## R-2026-09-12：用户最终要求保留 TypeScript

用户明确“还是保留 ts 不要 js”。当前有效决策为 src 放真实能力源码、lib 放内部辅助，二者保留 TS/TSX。撤回先前试行的 4 个 JS helper、JSDoc 转换与新增 allowJs/checkJs/include 配置；语言选择不再作为迁移任务。以上 JS 调研只留作历史，不能作为后续实施指令。既有 CommonJS 构建工具不在本轮语言改写范围。
