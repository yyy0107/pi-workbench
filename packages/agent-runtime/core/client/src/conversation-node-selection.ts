import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";
import type { HostObservable } from "@workbench/agent-runtime-core";

/** A derived subscription, not a second owner of conversation state. */
export function createConversationNodeSelection<T>(
  sources: readonly HostObservable<ConversationNode | undefined>[],
  select: (node: ConversationNode) => T,
  isEqual: (previous: T, next: T) => boolean = Object.is,
): HostObservable<readonly T[]> {
  const cache = new Map<number, { node: ConversationNode; value: T }>();
  let current: readonly T[] = Object.freeze([]);
  return {
    subscribe(listener) {
      const unsubscribers = sources.map((source) => source.subscribe(listener));
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
    getSnapshot() {
      let next: T[] | undefined;
      let index = 0;
      // Pull every source so updates between render and subscribe cannot be missed. Unchanged
      // node identities bypass selection; an unchanged result does not allocate a new array.
      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        const node = sources[sourceIndex]!.getSnapshot();
        if (!node) {
          cache.delete(sourceIndex);
          continue;
        }
        let cached = cache.get(sourceIndex);
        if (cached?.node !== node) {
          const value = select(node);
          cached = { node, value: cached && isEqual(cached.value, value) ? cached.value : value };
          cache.set(sourceIndex, cached);
        }
        if (!next && (index >= current.length || !Object.is(current[index], cached.value))) {
          next = current.slice(0, index);
        }
        next?.push(cached.value);
        index++;
      }
      if (next || index !== current.length)
        current = Object.freeze(next ?? current.slice(0, index));
      return current;
    },
  };
}
