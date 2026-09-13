# 已迁移包的源码职责复核

按 constitution 3.1.0：src 承载真实能力，lib 为内部辅助，统一 TS/TSX。以下列举实际源码依赖；完整文件移动在 source-role-migrations.json，语言试行已撤回。

| 包                                      | 内部辅助示例                       | 实际消费者示例                        |
| --------------------------------------- | ---------------------------------- | ------------------------------------- |
| `@workbench/ui-testkit`                 | `lib/minimal-dom.ts`               | `src/react-dom-environment.ts`        |
| `@workbench/settings-runtime`           | `lib/dispose-resources.ts`         | `src/index.tsx`                       |
| `@workbench/i18n`                       | `lib/catalog-tree.ts`              | `src/runtime.ts`                      |
| `@workbench/ui`                         | `lib/clipboard.ts`                 | `src/clipboard.ts`                    |
| `@workbench/appearance`                 | `lib/legacy-preferences.ts`        | `src/appearance-preferences.ts`       |
| `@workbench/shell-context`              | `lib/workbench-shell-owner.ts`     | `src/dom.tsx`                         |
| `@workbench/code-highlighting`          | `lib/code-highlight-policy.ts`     | `src/markdown-code-block.tsx`         |
| `@workbench/markdown`                   | `lib/markdown-normalize.ts`        | `src/markdown-text.tsx`               |
| `@workbench/settings-ui`                | `lib/i18n.ts`                      | `src/i18n.ts`                         |
| `@workbench/workspace-runtime`          | `lib/workspace-tab-layout.ts`      | `src/presentation/workspace-tabs.tsx` |
| `@workbench/workspace-files`            | `lib/file-classification.ts`       | `src/file-classification.ts`          |
| `@workbench/workspace-file-view`        | `lib/file-breadcrumb-model.ts`     | `src/file-breadcrumb-tree.tsx`        |
| `@workbench/workspace-explorer`         | `lib/explorer-runtime-policy.ts`   | `src/explorer-runtime-bridge.tsx`     |
| `@workbench/workspace-directory-picker` | `lib/project-trust-dialog-copy.ts` | `src/directory-picker-button.tsx`     |
| `@workbench/workspace-artifact`         | `lib/artifact-storage-key.ts`      | `src/artifact-preview-service.ts`     |
| `@workbench/workspace-review`           | `lib/review-options.ts`            | `src/review-diff-hunk.tsx`            |
| `@workbench/workspace-git-branch`       | `lib/git-graph-layout.ts`          | `src/git-graph-dialog.tsx`            |
| `@workbench/workspace-browser`          | `lib/browser-files.ts`             | `src/browser-downloads-dialog.tsx`    |
| `@workbench/composer`                   | `lib/agent-command.ts`             | `src/agent-command.ts`                |
