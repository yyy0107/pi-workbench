# Pi conversation ownership

Keep canonical parsing/projection and assembly in src, consumed supporting algorithms in lib, both in TS with at most one subdirectory. Keep wire IDs and ordering, canonical message identities and delta/snapshot/gap repair semantics. Do not introduce a second runtime/session instance or transport dependency. Consumers use explicit public exports; tests live in tests/.
