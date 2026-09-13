# @workbench/pi-conversation-adapter

src owns canonical Pi message contracts, parsing, history/RPC projection, message accumulation, the observable conversation assembler and queue actions. lib provides event conversion, token estimates, usage/timing/statistics helpers; consumers include messages.ts and the Pi client session. Both roots keep TS with at most one subdirectory. No HTTP/WebSocket or SDK session ownership is introduced. Package tests cover parsing/replay/deltas/queues; the assembler + PiSessionManager integration suite stays in pi/client/tests/conversation.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/conversation-node-projection.ts` imports `lib/conversation-events.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
