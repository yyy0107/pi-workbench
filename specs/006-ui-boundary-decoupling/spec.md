# Spec 006 — UI 边界解耦

状态：Implemented；36/36 任务完成，验证见 validation.md。实际分支：codex/package-refactor。基线：Spec005 完成且会话 UI 已统一归 client 的未提交工作树；HEAD 8ee7ee24 不能单独还原本期来源。

## 用户需求

用户要求基于 UI 高耦合审查构建整改计划。覆盖工具协议适配、消息块 Session 绑定、布局业务装配、Composer 交互集中、跨包样式、侧栏宽 Context，以及外观设置内部拆分和测试归属清理。先规划，不迁移生产源码。

## User Stories

- US1 / P1：增加或调整工具展示只修改所属适配/贡献；通用 ui-tool 不解析 edit/write 原始结果或构造 workspace-file 专属 payload。
- US2 / P1：消息块可以接收显式内容/状态/动作展示；Session、命令注册、附件读取与 retry 决策留在上层会话适配。
- US3 / P1：布局组件接受明确的业务区域和外层装配；会话菜单与滚动持久化由 Shell 安装，不再由 ui-layout 直接依赖会话包。
- US4 / P2：Composer 与 sidebar 的交互协调拆为明确模块和窄接口，保持原唯一状态和事务。
- US5 / P2：组件样式由实际 owner 提供，消息流 CSS 不再为 Markdown、代码标题栏、消息操作和 Composer dock 定义独占规则。
- US6 / P2：外观设置按页面/控件/提交协调分离；selector 测试回归所属包，去掉基础 ui 的测试反向依赖。

## Requirements

- 所有前端 UI 能力仍在 packages/client；优先在现有 owner 内调整，本期不预设新增 workspace 包，目标库包数保持 93。
- 不建立新 registry/Context/store/事件总线来搬运旧状态；复用现有 Renderer/ToolPresentation、Opener、Slots、Session 和 settings。
- src/lib 均为实际 TS/TSX，最多一级子目录；业务组件不能整包下沉 lib。公共跨包引用只用 exports。
- 保持扩展/slot/renderer/settings ID、安装/清理顺序、Provider 范围、引用稳定性、错误行为与持久化格式。
- 不改 Pi SDK 或服务端工具实现，不改工具输入/输出协议；纯前端适配归已有 Pi/UI/workspace owner。
- 国际化键/插值/词典注册唯一；CSS主题/密度/圆角/Portal/层叠保持，不以移动 CSS 改视觉。
- 不新增或执行 UI/DOM/fake DOM/Hook 渲染/视觉/交互/Browser/Electron 冒烟测试；既有测试保留、迁移或修 fixture。允许精确纯逻辑与静态、lint/typecheck/build。
- 多 Agent 按能力使用 Luna/Sol；主 Agent统一共享契约、注册、词典/CSS、manifest/lock 和验收。不提交/推送。

## Success Criteria

生产图无环只是基础门槛；必须以明确的禁止依赖、状态所有权、已迁出的协议分支/业务装配/选择器和实际消费者验收，不能以文件缩短或新增包数判定成功。
每项行为风险有静态核对或允许的纯逻辑证据。UI 排除项不标记为通过。详见 contracts、quickstart 与 tasks.md；任务已实施验收，UI 排除项与构建警告见 validation.md。
