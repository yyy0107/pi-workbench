# 图片命名规范

[English](./README.md) | 简体中文

本目录存放文档截图与示意图，Logo 和品牌素材放在 `brand/` 中。

## 界面截图

```text
<subject>-v<version>-<language>[-<variant>].<ext>
```

| 字段 | 规则 | 示例 |
| --- | --- | --- |
| `subject` | 使用简短的小写英文名称，单词以连字符分隔；中英文图片使用相同名称。 | `home`、`toolbox`、`model-settings` |
| `version` | 使用截图对应的应用版本，与该版本根目录 `package.json` 一致。 | `0.1.0` |
| `language` | 语言后缀统一使用小写：英文为 `en`，简体中文为 `zh`。 | `en`、`zh` |
| `variant` | 可选，仅在需要区分同一页面的不同图片时添加。 | `dark`、`light`、`empty` |
| `ext` | 扩展名使用小写；截图优先 PNG，矢量素材优先 SVG。 | `png`、`webp`、`svg` |

包含界面文案的截图同时提供英文和简体中文版本，保持页面、版本和变体一致。
英文 README 引用 `en` 图片，中文 README 引用 `zh` 图片。

```text
home-v0.1.0-en.png
home-v0.1.0-zh.png
toolbox-v0.1.0-en.png
toolbox-v0.1.0-zh.png
model-settings-v0.1.0-en-dark.png
model-settings-v0.1.0-zh-dark.png
```

## 其他素材与更新

- 无语言相关内容的图片省略语言后缀；与发布版本无关的素材省略版本号，例如 `pi-workbench-architecture.png`、`brand/pi-workbench-spatial-app-icon.svg`。
- 可编辑源文件与导出图片使用相同主文件名，例如 `pi-workbench-architecture.excalidraw` 与 `pi-workbench-architecture.png`。
- 新文件名避免空格、中文、时间戳，以及 `image1`、`final`、`new` 等模糊名称。
- 现有图片可保留中文页面名称，例如 `首页-v0.1.0-en.png`、`工具箱-v0.1.0-zh.png`；新增图片遵循完整规范，重命名时同步更新所有 Markdown 和 HTML 引用。
