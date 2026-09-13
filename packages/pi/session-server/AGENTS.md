# Pi sessions

Keep behavior, queue ordering, serialization and durable formats unchanged. Retain one session registry implementation per server module generation and its original process state/HMR retention. Inject publisher/host/resource/tool dependencies; never import StreamHub or root server. Services receive concrete registry callbacks through existing Dependencies interfaces. src holds business/session lifecycle and contracts, lib consumed auxiliary projections/parsers; TS only, one subdirectory maximum. Tests stay in tests.
