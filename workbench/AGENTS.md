# Workbench i18n 规范

- Workbench 核心文案统一放在 `workbench/i18n/<locale>.ts`，内部再以 `chat`、`sidebar`、`panels`、`shell` 子命名空间区分；不要为每个子目录再建词典文件。
- React 组件通过统一 Provider/Hook 读取当前 locale；不要在壳层逐级传递 locale，也不要缓存翻译后的字符串到 Zustand 或模块常量。
- 状态中保存稳定枚举、ID 和原始数据，在渲染时翻译；这样切换语言无需迁移或重建状态。
- 组件的可见文案和对应 `aria-label`/Tooltip 必须表达同一含义，不得出现一处中文、一处英文的混合界面。
- starter prompt 的展示文本和发送文本来自同一条目；历史消息、来源标题和会话标题不翻译，只对缺失标题使用本地化 fallback。
- 日期、相对时间、数量和面板方位使用当前 locale 格式化；稳定 ID、布局枚举和路由保持原值。
- 扩展贡献的 Panel 标题按当前 locale 解析，不把 setup 时的翻译结果存入 Store；Workbench 只翻译面板壳，不翻译扩展内容。
