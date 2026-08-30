# `@workbench/attachment-understanding-contracts`

Workbench 拥有的附件理解领域 contracts。包内包含 OCR adapter 声明格式、PaddleOCR 遗留默认值，以及图片和文档识别的 JSON-safe 状态机协议。

## Public entries

- `@workbench/attachment-understanding-contracts`
- `@workbench/attachment-understanding-contracts/ocr-adapter`
- `@workbench/attachment-understanding-contracts/paddleocr-models`
- `@workbench/attachment-understanding-contracts/state-machine`

本包不得依赖 React、Next.js、assistant-ui、Node 运行时 API、Pi 或具体 OCR provider 实现。调用方应直接
使用本包的显式 subpath。
