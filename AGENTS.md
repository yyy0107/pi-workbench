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

## UI 全局样式复用

- 新建或修改 UI 组件前，必须先检查 `components/ui/` 中的共享组件和 `app/globals.css` 中的全局语义 token；复用优先级为：共享组件及其 variant → Tailwind 语义类 → 现有 CSS token → 新增局部样式。不得在业务组件中复制已有基础组件或交互状态样式。
- 新组件必须接入全局外观系统。颜色使用 `bg-background`、`bg-muted`、`text-foreground`、`text-muted-foreground`、`border-border` 等语义类；控件高度、圆角、图标、输入框、下拉框、开关和交互状态使用 `--button-*`、`--control-*`、`--icon-*`、`--input-control-*`、`--dropdown-control-*`、`--switch-*` 等现有 token。若已有对应 token，禁止改用固定的 `px`、任意 Tailwind 尺寸、十六进制/RGB 颜色或独立圆角值覆盖它。
- 下拉选择器必须复用 `components/ui/` 中对应的全局组件和既有布局：工作区或项目选择统一使用 `WorkspaceSelector`，通用富下拉优先使用 `SelectorDropdown`、`DropdownMenu` 及其共享选项组件。不得在业务组件中直接使用原生 `<select>`、用 `components/ui/Select` 替代已有富下拉，或自行复制触发器、弹层、搜索、选中态等样式。仅当现有全局组件无法表达且产品明确需要原生选择语义时，才允许使用 `components/ui/Select`，并应在代码附近说明原因。
- 只有确属功能私有、不会随主题、暗色模式、密度或圆角设置变化的布局值才允许保留局部常量。若某种视觉语义会跨组件复用或需要响应外观设置，应先扩展 `app/globals.css` 的语义 token 或 `components/ui/` 的共享 variant，再在业务组件中引用，不得创建第二套设计变量。
- 实现完成后必须静态检查新增 class/style，确认组件能随浅色/深色主题、全局颜色、控件密度和圆角配置变化；无具体渲染不确定性时按验证策略仅做代码检查，不为此机械启动 Browser 或完整测试。

## 常用命令

```bash
pnpm dev          # 启动开发服务器（next dev --turbopack）
pnpm build        # 生产构建
pnpm start        # 启动生产服务器
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
