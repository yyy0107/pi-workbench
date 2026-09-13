# @workbench/ui-conversation-nodes

Owns conversation node selection and presentation, the message and steered-turn contexts, message actions and parts, completed-turn presentation, and the message-presentation extension. `src/` contains the public React capability and `lib/` contains the consumed presentation policies and pure helpers. It consumes message blocks through their public package and does not depend on the message-list owner.

Node adapters own Session-to-view projection and command document parsing. The ./styles.css entry owns message actions and user-message entrance animation.
