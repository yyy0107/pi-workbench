# @workbench/ui-conversation

Owns the top-level conversation route and session assembly: `WorkbenchConversation`, `WorkbenchThread`, the empty state, conversation title, session wiring, and the final composition of the public conversation capability packages. Message lists, node presentation, message blocks, composer editing, and sidebar navigation remain in their dedicated owners.

`src/` contains the route/session components, empty state, title helper, local dictionary, and styles. `lib/` contains the consumed `workbench-thread-timing` helper. Public consumers use the root, `./title`, `./i18n`, and `./styles.css` exports; feature owners are composed through their public contracts.

The package preserves session identity, route synchronization, installation order, and resource disposal. It must not import private source from the composer, conversation-list, conversation-messages, conversation-nodes, or message-blocks packages.

Composer dock animation is local to conversation-dock.css, alongside the DOM that owns the dock.
