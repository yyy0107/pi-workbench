# Extension i18n 规范

- 内置扩展文案统一放在 `extensions/i18n/<locale>.ts`，内部按扩展 ID 分子命名空间；不要为每个小扩展单独创建词典文件。
- `extension.id`、command ID、panel ID、renderer 名和状态枚举是稳定协议，不翻译；扩展名、command/panel 标题、描述、分类、控件和错误提示需要翻译。
- Extension `setup()` 不得冻结当前语言的字符串。向 registry 注册可延迟解析的消息描述或稳定 message key，由 Host 在渲染时按当前 locale 求值。
- 扩展共用术语放在 `extensions.shared`，平台术语仍由平台命名空间负责；共用 UI 控件由调用方传入已翻译 label。
- 终端输出、代码、文件路径、模型/provider 名、token 原始数值和用户输入保持原样；外围按钮、状态、单位和说明使用扩展词典及 locale-aware 格式化。
- 新增扩展时必须同时补齐 `en-US`、`zh-CN` 对应子命名空间，并覆盖可见文案、Tooltip、空状态、错误和无障碍文本。
