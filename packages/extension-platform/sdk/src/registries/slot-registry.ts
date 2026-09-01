import type { SlotContribution, SlotRegistry, WorkbenchSlot } from "../api/slot";
import { WORKBENCH_SLOTS } from "../api/slot";
import { createDisposable } from "../api/disposable";
import { assertNonEmptyId, emitRegistryChange } from "./registry-utils";

const EMPTY_CONTRIBUTIONS = Object.freeze([]) as readonly SlotContribution[];
const VALID_SLOTS = new Set<WorkbenchSlot>(WORKBENCH_SLOTS);

export class SlotRegistryImpl implements SlotRegistry {
  readonly #bySlot = new Map<WorkbenchSlot, readonly SlotContribution[]>();
  readonly #sequenceByContribution = new WeakMap<object, number>();
  readonly #listeners = new Set<() => void>();
  #sequence = 0;

  register<K extends WorkbenchSlot>(slot: K, contribution: SlotContribution<K>) {
    if (!VALID_SLOTS.has(slot)) {
      throw new Error(`Unknown workbench slot: ${slot}`);
    }
    assertNonEmptyId(contribution.id, "Slot contribution id");

    const current = this.#bySlot.get(slot) ?? EMPTY_CONTRIBUTIONS;
    if (current.some((entry) => entry.id === contribution.id)) {
      throw new Error(`Slot contribution "${contribution.id}" is already registered in "${slot}"`);
    }

    const stored = Object.freeze({
      ...contribution,
      order: contribution.order ?? 0,
    }) as SlotContribution<K>;
    this.#sequenceByContribution.set(stored, this.#sequence++);
    const next = Object.freeze(
      [...current, stored as SlotContribution].sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) ||
          (this.#sequenceByContribution.get(left) ?? 0) -
            (this.#sequenceByContribution.get(right) ?? 0),
      ),
    );

    this.#bySlot.set(slot, next);
    emitRegistryChange(this.#listeners);

    return createDisposable(() => {
      const registered = this.#bySlot.get(slot);
      if (!registered?.includes(stored as SlotContribution)) return;

      const remaining = registered.filter((candidate) => candidate !== stored);
      if (remaining.length === 0) this.#bySlot.delete(slot);
      else this.#bySlot.set(slot, Object.freeze(remaining));
      emitRegistryChange(this.#listeners);
    });
  }

  get<K extends WorkbenchSlot>(slot: K): readonly SlotContribution<K>[] {
    const contributions = this.#bySlot.get(slot);
    if (!contributions) {
      return EMPTY_CONTRIBUTIONS as readonly SlotContribution<K>[];
    }

    return contributions as readonly SlotContribution<K>[];
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}
