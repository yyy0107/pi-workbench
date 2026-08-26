import type { ContextTraceDetailState } from "./context-trace-detail";

export const CONTEXT_TRACE_DETAIL_CACHE_LIMIT = 12;

export function cacheContextTraceDetail(
  current: ReadonlyMap<string, ContextTraceDetailState>,
  traceId: string,
  detail: ContextTraceDetailState,
): ReadonlyMap<string, ContextTraceDetailState> {
  const next = new Map(current);
  next.delete(traceId);
  next.set(traceId, detail);
  while (next.size > CONTEXT_TRACE_DETAIL_CACHE_LIMIT) {
    const oldestTraceId = next.keys().next().value;
    if (typeof oldestTraceId !== "string") break;
    next.delete(oldestTraceId);
  }
  return next;
}
