# Extension Platform i18n 规范

- 平台 API 必须把稳定标识与展示文案分开；registry 中的 `id`/枚举不本地化，title、description、category 等接受可延迟解析的消息描述或等价类型。
- Host 是扩展元数据的翻译边界：按当前 locale 解析文案并在语言变化时重新渲染；不要让 Service/Registry 调用 React Hook。
- 公共消息描述必须包含命名空间、语义 key 和类型安全参数；不得接受把整句英文当 key 的快捷写法。
- 平台自身的命令面板、扩展错误边界、缺省 Panel/Renderer 文案使用 `platform.extensions` 词典，扩展内容仍由扩展命名空间负责。
- 不在 `setup()` 时读取一次 locale 并保存翻译结果；snapshot 应保存稳定描述，避免语言切换要求重新激活扩展。
- 修改扩展文案契约时同步更新类型、Host、内置扩展示例和 `docs/extensions.md`，并验证两种基础语言。
