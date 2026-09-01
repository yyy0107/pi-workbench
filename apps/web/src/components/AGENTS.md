# 通用组件 i18n 规范

- 本目录只保留 Web-owned 产品组合 wrapper；通用 UI、elements 和图标由
  `packages/workbench/shell/src/` 拥有并保持 locale 无关，不在这里复制第二份实现。
- 组件通过 `children`、`label`、`description`、`placeholder`、`aria-label` 等 props 接收已翻译文案；不要把翻译键作为通用组件 API。
- 通用组件不得内置用户可见的英文或中文默认值。确需默认无障碍文案时，暴露必填 label/labels prop，由调用方提供。
- 不在组件内部拼接句子。涉及数量、状态或实体名的完整文案由调用方翻译后传入。
- 布局优先使用 `start`/`end`、`ms`/`me` 等逻辑方向；具有语义方向的图标和动画在 RTL 下必须镜像或由调用方选择。
- Story、示例和测试可以使用固定文案，但必须清楚标为 fixture，不能被生产组件当作回退翻译。

## Assistant UI

- Assistant UI 的共享实现与词典由 `packages/workbench/shell/src/assistant-ui/` 拥有；Web wrapper 只注入
  已安装 bundle 或产品能力，不从 package source 深导入。
- 用户消息、assistant 输出、reasoning、Markdown、代码、附件名和工具原始输入/输出保持原样，只翻译外围控件、状态、错误和无障碍文案。
- 数量使用复数规则；模型/provider 名保持原值。语言切换后历史消息不重写，但控件与状态标签必须重新渲染。
