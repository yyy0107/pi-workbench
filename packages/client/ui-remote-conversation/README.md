# @workbench/ui-remote-conversation

Owns the DOM conversation surface used by the native remote-control product. It composes the same Workbench message pair, Markdown, user-message, tool-call, disclosure, and semantic-token primitives used by the desktop conversation area. The Expo application embeds this surface through a local DOM Component; it does not maintain a second React Native message renderer.

The package accepts only the closed `RemoteConversationItemV1` projection. It has no Runtime, Pi RPC, Shell, toolbox, terminal, file, browser-control, extension-registration, model, or provider capability. Mutating actions remain native-owned and travel through the existing encrypted remote-control protocol.

`src/` owns the DOM surface, localized copy, styles, and public exports. `lib/` owns the pure projection-to-transcript model used by the surface.
