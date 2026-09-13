# @workbench/ui-composer

Owns the rich input editor and its document, history, token, markdown, submission, and composer surface code. Attachment UI and command-trigger/parameter capabilities are separate owners; `@workbench/ui-conversation` assembles the conversation surface and `@workbench/ui-message-blocks` renders the stateless composer document content inside messages.

`src/` contains the editor, submission flow, contracts, dictionaries, and styles. `lib/` contains consumed editor helpers such as input history, markdown detection, panel styles, and Pi compatibility. Tests remain in `tests/`; source and helpers stay TypeScript or TSX with at most one subdirectory.

Consumers use the public `./document`, `./directives`, `./tokens`, `./panels`, `./i18n`, and CSS exports. They pass attachment, command, and submission callbacks across capability boundaries and must not create a second editor state or import another capability's private source.

Editor plugins, suggestions, mentions, command parameters, attachment restoration and submission are separate source modules with the original editor and Session lifecycle. Shared token presentation is imported from ui-input-trigger/tokens.
