# Pi transport ownership

Keep RPC and WebSocket lifecycle/transport contracts in src; parsing and validation helpers in lib. Keep TS, shallow roots, public exports and installation-specific transport instances. Preserve paired generation buffering, idle/reconnect timers, watermarks and gap repair. Do not move the message accumulator into this package. Tests live in tests/.
