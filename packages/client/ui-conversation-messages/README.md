# @workbench/ui-conversation-messages

Owns the ordered conversation flow, date grouping, message pairing, layout, viewport compensation, and persisted reading position. `src/` contains the list and scroll contracts; `lib/` contains the consumed row selectors and viewport algorithms. Node rendering is delegated to `@workbench/ui-conversation-nodes`.

The styles entry composes node styles and owns only conversation-list container tokens; dock, message actions and Markdown/code-header styles belong to their components.
