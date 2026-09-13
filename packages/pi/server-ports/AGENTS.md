# Pi server ports

Keep shared server contracts in src and consumed auxiliary logic in lib, both TS with shallow roots. Do not own a session registry, global Host bindings, StreamHub implementation or browser wire data here. Use the installed public Pi SDK types, public workspace exports and exact workspace:* dependencies. Preserve existing fallback behavior; tests live in tests/.
