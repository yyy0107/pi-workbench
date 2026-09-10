# AGENTS.md

## 包管理：pnpm（不要用 npm/yarn）

本项目使用 **pnpm** 作为包管理器。

- 安装依赖：`pnpm install`
- 新增依赖：`pnpm add <package>`（生产）/ `pnpm add -D <package>`（开发）
- 移除依赖：`pnpm remove <package>`
- 升级依赖：`pnpm update`
- 检查过期：`pnpm outdated`

禁止使用 `npm install` / `npm i` / `yarn`，避免生成 `package-lock.json` 破坏锁文件一致性（锁文件为 `pnpm-lock.yaml`）。

## i18n 总则

- 国际化规范按组件边界拆分；修改文件时，继续读取离它最近的 `AGENTS.md`，不要把各组件细则回填到根文件。
- 语言标识统一使用 BCP 47。基础语言为 `en-US` 和 `zh-CN`，`en-US` 是默认及最终回退语言；支持列表只能在共享 i18n 配置中维护一次。
- 新增或修改的用户可见文案必须同时提供两种基础语言，包括正文、按钮、占位符、Tooltip、空状态、错误信息以及 `aria-label`、`title` 等无障碍文案。
- 翻译键使用稳定的语义路径（如 `chat.composer.send`），不得把英文原文当键；变量使用命名插值，复数、日期、时间、数字和相对时间交给 i18n/`Intl` 处理，不得字符串拼接或写死 locale。
- 词典与所属组件共置于其 `i18n/` 目录并按 locale 分文件；共享层只负责 locale 配置、词典注册和运行时 API，不建立包含所有产品文案的巨型词典。
- 使用项目统一的 i18n API。若基础设施尚未提供，先补共享能力，不得在组件内自建翻译 Hook、全局单例或第二套回退逻辑。
- 不翻译稳定 ID、路由、文件路径、命令输入、代码、日志、用户内容、模型输出或工具原始结果；品牌名和第三方专有名词仅在产品明确提供译名时翻译。
- 每个 locale 的键和插值参数必须保持一致；缺失翻译在开发/测试中应失败或明确告警，生产环境按请求语言 → `en-US` 回退，不能直接显示键名。

## UI 样式归属与复用

- 新建或修改 UI 组件前，必须先检查 `packages/workbench/shell/src/ui/` 中的共享组件和 `packages/workbench/shell/src/styles.css` 公共入口及其导入的语义 token 和区域样式；复用优先级为：共享组件及其 variant → Tailwind 语义类 → 所属作用域的现有 CSS token → 新增局部样式。不得在业务组件中复制已有基础组件或交互状态样式。
- 新组件必须接入全局外观系统。颜色使用 `bg-background`、`bg-muted`、`text-foreground`、`text-muted-foreground`、`border-border` 等语义类；控件高度、圆角、图标、输入框、下拉框、开关和交互状态使用 `--button-*`、`--control-*`、`--icon-*`、`--input-control-*`、`--dropdown-control-*`、`--switch-*` 等现有 token。若已有对应 token，禁止改用固定的 `px`、任意 Tailwind 尺寸、十六进制/RGB 颜色或独立圆角值覆盖它。
- 下拉选择器必须复用 `packages/workbench/shell/src/ui/` 中对应的共享组件和既有布局：工作区或项目选择统一使用 `WorkspaceSelector`，通用富下拉优先使用 `SelectorDropdown`、`DropdownMenu` 及其共享选项组件。不得在业务组件中直接使用原生 `<select>`、用 `components/ui/Select` 替代已有富下拉，或自行复制触发器、弹层、搜索、选中态等样式。仅当现有全局组件无法表达且产品明确需要原生选择语义时，才允许使用 `components/ui/Select`，并应在代码附近说明原因。
- 全局规范放全局，区域公共规范放区域，共享组件复用基础能力。主题基础和滚动条属于全局；标题栏、状态栏高度及布局动画参数属于 `[data-workbench-shell]`；侧栏行高、间距、图标和拖放规则只属于侧栏；对话、Composer 和渲染器规则与组件共置并限定作用域。跨组件复用不等于需要放到 `:root`。
- 区域 token 从现有主题、密度、圆角和共享控件 token 派生；在消费作用域重新计算派生值，确保外观设置能够生效。共享图标按钮通过 `--button-icon-size`、`--button-icon-frame-size` 接收局部尺寸，不通过页面根节点的 SVG/按钮后代选择器或重复 `!important` 强行覆盖。
- Web 和 Electron 统一导入 `@workbench/shell/styles.css`；应用全局 CSS 只管理宿主字体、Tailwind 来源等宿主职责。区域弹层继续使用所属 Shell 的 Portal 容器，并在弹层实际 DOM 上声明必要的区域标记；不要移动到被裁剪的侧栏内或用 JavaScript 复制计算样式。
- 实现完成后必须静态检查新增 class/style，确认组件能随浅色/深色主题、全局颜色、控件密度和圆角配置变化；无具体渲染不确定性时按验证策略仅做代码检查，不为此机械启动 Browser 或完整测试。

## Agent 工具输出规范

- 在工具实现处控制输出，先按任务筛选字段、范围或分页；默认返回摘要，更新返回受影响字段和保存状态，避免整份配置、窗口状态、提示词或重复快照进入上下文。列举可用能力应使用 schema/文档，不以完整状态读取代替。
- Pi 自定义工具必须主动复用 `@earendil-works/pi-coding-agent` 的公开 `truncateHead` / `truncateTail` 与默认限制（50 KiB UTF-8 字节、2,000 行，先到者生效）。`registerTool` 不会自动截断所有输出；上下文压缩也不能替代工具输出预算。不得为此修改 Pi / pi-ai 源码或深层导入私有实现。
- 预算覆盖一次结果的所有文本块及附加提示，不能只限制单个字段或使用 JavaScript 字符数代替字节数。进度、错误和 `details` 也应有界；不得把被省略的大内容换个字段重复返回、写入会话或日志。已有内置工具覆盖的截断、分页和文件读取能力直接复用，不再加平行框架。
- 超限时返回明确的截断标记、必要摘要及完整内容获取方式。优先提供原始资源的分页/定位；需要卸载时，将经过相同筛选和脱敏的完整结果保存到受权限保护的临时文件，返回路径和分段/按字段读取提示。结构化结果必须保持有效 JSON，不返回半截 JSON；超长单行需提供字段提取或字符串切片方式。
- 不泄露凭据、背景图原始数据或无关配置。临时文件不得放进仓库或在工具返回时立即删除；失败/取消的写入应清理残留。设置等操作已经提交后，输出落盘失败必须明确保留已保存状态和 revision，避免让模型重复执行写操作。
- 对新增或修改的非平凡输出处理运行最小相关行为测试：正常结果、超限结果、完整内容可获取；涉及字节/行限制时覆盖多字节文本和多行，涉及落盘时覆盖长单行、权限及写入失败/取消。无需为纯文档或简单 schema 上限修改启动 Browser 或运行全套测试。

## 常用命令

```bash
pnpm dev          # 默认构建并启动非热更新的 Web + Runtime；追加 -- --hot 开启热更新
pnpm build        # 依次委托 Runtime、Web 与 Electron app 构建/组合 artifacts
pnpm start        # 根 orchestrator 以生产模式启动独立 Web + Runtime
pnpm lint         # oxlint + oxfmt --check
pnpm lint:fix     # oxlint --fix && oxfmt
pnpm format       # oxfmt --check
pnpm format:fix   # oxfmt
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
