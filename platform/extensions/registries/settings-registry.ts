import { createDisposable } from "../api/disposable";
import type {
  SettingsItemDefinition,
  SettingsRegistry,
  SettingsSectionDefinition,
} from "../api/settings";
import { assertNonEmptyId, emitRegistryChange } from "./registry-utils";

const EMPTY_SECTIONS = Object.freeze([]) as readonly SettingsSectionDefinition[];
const EMPTY_ITEMS = Object.freeze([]) as readonly SettingsItemDefinition[];

interface OrderedValue<T> {
  readonly sequence: number;
  readonly value: T;
}

function byOrder<T extends { order?: number }>(left: OrderedValue<T>, right: OrderedValue<T>) {
  return (left.value.order ?? 0) - (right.value.order ?? 0) || left.sequence - right.sequence;
}

export class SettingsRegistryImpl implements SettingsRegistry {
  readonly #sections = new Map<string, OrderedValue<SettingsSectionDefinition>>();
  readonly #items = new Map<string, OrderedValue<SettingsItemDefinition>>();
  readonly #listeners = new Set<() => void>();
  #sequence = 0;
  #sectionSnapshot = EMPTY_SECTIONS;
  #itemSnapshot = EMPTY_ITEMS;

  registerSection(section: SettingsSectionDefinition) {
    assertNonEmptyId(section.id, "Settings section id");
    if (this.#sections.has(section.id)) {
      throw new Error(`Settings section "${section.id}" is already registered`);
    }
    if (typeof section.title === "string" && section.title.trim().length === 0) {
      throw new Error(`Settings section "${section.id}" has an empty title`);
    }
    if (section.group) {
      assertNonEmptyId(section.group.id, "Settings section group id");
      if (typeof section.group.title === "string" && section.group.title.trim().length === 0) {
        throw new Error(`Settings section group "${section.group.id}" has an empty title`);
      }
    }

    const stored = Object.freeze({
      ...section,
      group: section.group ? Object.freeze({ ...section.group }) : undefined,
    });
    const entry = Object.freeze({ sequence: this.#sequence++, value: stored });
    this.#sections.set(section.id, entry);
    this.#updateSnapshots();

    return createDisposable(() => {
      if (this.#sections.get(section.id) !== entry) return;
      this.#sections.delete(section.id);
      this.#updateSnapshots();
    });
  }

  registerItem(item: SettingsItemDefinition) {
    assertNonEmptyId(item.sectionId, "Settings item section id");
    assertNonEmptyId(item.id, "Settings item id");
    const key = `${item.sectionId}\u0000${item.id}`;
    if (this.#items.has(key)) {
      throw new Error(`Settings item "${item.id}" is already registered in "${item.sectionId}"`);
    }

    const stored = Object.freeze({ ...item });
    const entry = Object.freeze({ sequence: this.#sequence++, value: stored });
    this.#items.set(key, entry);
    this.#updateSnapshots();

    return createDisposable(() => {
      if (this.#items.get(key) !== entry) return;
      this.#items.delete(key);
      this.#updateSnapshots();
    });
  }

  readonly getSections = (): readonly SettingsSectionDefinition[] => this.#sectionSnapshot;

  readonly getItems = (): readonly SettingsItemDefinition[] => this.#itemSnapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #updateSnapshots(): void {
    this.#sectionSnapshot = Object.freeze(
      Array.from(this.#sections.values())
        .sort(byOrder)
        .map(({ value }) => value),
    );
    this.#itemSnapshot = Object.freeze(
      Array.from(this.#items.values())
        .sort(byOrder)
        .map(({ value }) => value),
    );
    emitRegistryChange(this.#listeners);
  }
}
