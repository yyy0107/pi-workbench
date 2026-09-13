# @workbench/conversation

Conversation rendering, scrolling, message actions, queues, interactive requests, side chats and archive management. src contains components, contracts, extension assembly, dictionaries and styles; lib contains the typed projection, layout and policy helpers used by those components. All implementation remains TS/TSX and tests live in tests/. Stable extension IDs and installation order are preserved.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/archived-chats/archived-chats-settings-item.tsx` imports `lib/archived-chats/archived-chat-group-a11y.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
