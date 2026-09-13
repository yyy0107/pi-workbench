# @workbench/ui-message-blocks

Owns reusable conversation block renderers: text, file, image, source, tool/data blocks, command responses, errors, streaming text, terminal output, and conversation separators. The package also owns the stateless composer document content renderer used inside message blocks; the node-aware wrapper remains with conversation nodes.

`src/` contains the renderers, contracts, styles, and public exports. `lib/` contains consumed block data helpers. The package exposes each renderer through a public subpath and keeps the existing runtime props, identifiers, and i18n keys stable.

Message views accept projected documents, attachment readers and retry state/actions. Session and command registry lookup belong to ui-conversation-nodes. Import ./styles.css for owned image, token and message styles.
