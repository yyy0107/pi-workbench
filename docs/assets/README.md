# Image naming

English | [简体中文](./README.zh-CN.md)

Store documentation screenshots and diagrams in this directory; keep logos and brand assets in `brand/`.

## Screenshots

```text
<subject>-v<version>-<language>[-<variant>].<ext>
```

| Part | Rule | Example |
| --- | --- | --- |
| `subject` | Use a short, lowercase English name with hyphens; use the same name across languages. | `home`, `toolbox`, `model-settings` |
| `version` | Use the application version shown in the screenshot, matching that release's root `package.json`. | `0.1.0` |
| `language` | Use lowercase language suffixes: `en` for English and `zh` for Simplified Chinese. | `en`, `zh` |
| `variant` | Optional; add only to distinguish images of the same screen. | `dark`, `light`, `empty` |
| `ext` | Use lowercase extensions; prefer PNG for screenshots and SVG for vector assets. | `png`, `webp`, `svg` |

Provide both English and Simplified Chinese screenshots for localized UI. Match the screen, version,
and variant; use `en` images in the English README and `zh` images in the Chinese README.

```text
home-v0.1.0-en.png
home-v0.1.0-zh.png
toolbox-v0.1.0-en.png
toolbox-v0.1.0-zh.png
model-settings-v0.1.0-en-dark.png
model-settings-v0.1.0-zh-dark.png
```

## Other assets and updates

- Omit the language suffix for images without language-specific content; omit the version for assets unrelated to a release, such as `pi-workbench-architecture.png` or `brand/pi-workbench-spatial-app-icon.svg`.
- Give editable sources the same stem as their exports: `pi-workbench-architecture.excalidraw` and `pi-workbench-architecture.png`.
- Avoid spaces, Chinese characters, timestamps, and names such as `image1`, `final`, or `new` in new filenames.
- Existing images may retain Chinese subject names, such as `首页-v0.1.0-en.png` and `工具箱-v0.1.0-zh.png`. Apply the full convention to new images; update all Markdown and HTML references together when renaming.
