# Pi resource services

Keep actual resource service/persistence/contracts in src, consumed supporting algorithms in lib, both TS with shallow roots. Reuse existing Dependencies types and require the server composition to select sessions, scoped resource contexts, tools and publishers. Do not import session registry, stream hub, Host binding globals or tool factories. Preserve the shared coordinator, scope locking, all-session reload ordering and post-reload cleanup. SDK-owned resources and credentials retain their owner. Tests live in tests/.
