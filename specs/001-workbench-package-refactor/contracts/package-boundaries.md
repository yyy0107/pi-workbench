# 包边界合同

## 模块接口

跨包通过 package.json exports 明确的根/语义子入口，声明 workspace:*。src 为能力实现、契约、组件及装配，lib 为内部辅助源码（统一使用 TS/TSX），TypeScript 公开入口（既有 CommonJS 构建工具除外）从 src 导出。不公开 src/lib 通配，不通过 relative/alias/new URL 获取另一包业务源码。包内最多两层父目录。src 与 lib 的源码依赖均使用 production fields，测试使用 devDependencies；源码内测试在过渡期也按测试分类。

## 前端接口

I18n runtime 的基础支持列表继续来自 contracts/locale；每个能力持有双语 bundle 与 typed factory。基础 Provider controlled，产品装配注入 locale/保存行为与全部 bundles。UI props 传入业务行为，FileLink 不反向拉入具体 File Surface。Markdown 的链接组件/打开行为通过渲染接口传入；代码块内容归 code-highlighting。公共 Context 不导入 Shell visual frame。

## Pi 接口

复用 PiResourceMutationCoordinatorDependencies、SkillServiceDependencies、ExtensionServiceDependencies、InstalledPackageServiceDependencies、CommandServiceDependencies、WorkspaceSessionCatalogPort；调用者明确提供依赖，不从业务包导入默认 session registry。

模型服务在组装请求选项时通过 getRequestObserver(sessionId) 查找窄观测端口，保留既有查找时序；端口接受 bodyBytes、contentEncoding 并返回可选完成回调(status,error)。Host binding types、extension UI context、stream publisher 为服务端契约；具体 binding/StreamHub 单一实例留装配所有者。SDK 对象不进入 browser/wire types。

## 兼容要求

沿用公开 DTO、RPC 方法、事件 envelope、扩展/Command ID、设置键与数据格式。扩展顺序由 pi-product 一处维护。UI dictionaries 键参数一致，runtime/appearance 保留原安装作用域。任何接口调整同时修改全部仓内调用者和相关行为测试。

## 包内源码职责

src 允许有导出索引，但必须包含实际能力实现或契约。UI/服务/生命周期与词典样式随能力归 src；lib 仅支持这些实现，不按“未导出”机械分层。辅助模块无运行时反向依赖 src 的业务实例；确有类型需求可通过 type-only import 引用本包契约。不要跨 src/lib 复制类型或状态。

README 必须给出本包的 src 职责、lib 辅助模块及至少一个实际消费者；检查器能识别全转导出的空壳，但职责归属仍须在迁移审查中逐项核对。能力与辅助实现保留 TS/TSX，受相同类型、生产依赖、目录深度和测试规则约束。

资源装配由 pi/server/src/resource-composition.ts 选择原默认会话、协调器与缓存，workspace-store 单独注入延迟读取的 publisher，避免注册表的构造循环。内置工具由 pi/server/src/tool-composition.ts 注入 WorkbenchToolDependencies；PiToolContextTrace 只描述观测方法，不拥有注册表。上下文捕获辅助实现统一归 server-ports/lib/trace-capture.ts，工具和实际 trace 复用同一实现。纯 Composer 模型输入格式归 pi/shared/composer-prompt。
