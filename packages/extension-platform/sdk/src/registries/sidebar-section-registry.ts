import { createDisposable } from "../api/disposable";
import type { SidebarSectionDefinition, SidebarSectionRegistry } from "../api/sidebar-section";
import { assertNonEmptyId, emitRegistryChange } from "./registry-utils";

const EMPTY_SECTIONS = Object.freeze([]) as readonly SidebarSectionDefinition[];

interface OrderedSection {
  readonly sequence: number;
  readonly value: SidebarSectionDefinition;
}

function validateLocalizableText(value: SidebarSectionDefinition["title"], label: string): void {
  if (typeof value === "string" && value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export class SidebarSectionRegistryImpl implements SidebarSectionRegistry {
  readonly #definitions = new Map<string, OrderedSection>();
  readonly #listeners = new Set<() => void>();
  #sequence = 0;
  #snapshot = EMPTY_SECTIONS;

  register(definition: SidebarSectionDefinition) {
    assertNonEmptyId(definition.id, "Sidebar section id");
    if (this.#definitions.has(definition.id)) {
      throw new Error(`Sidebar section "${definition.id}" is already registered`);
    }
    validateLocalizableText(definition.title, `Sidebar section "${definition.id}" title`);
    if (definition.search) {
      validateLocalizableText(
        definition.search.label,
        `Sidebar section "${definition.id}" search label`,
      );
      validateLocalizableText(
        definition.search.placeholder,
        `Sidebar section "${definition.id}" search placeholder`,
      );
    }

    const mainViewKinds = definition.mainViewKinds
      ? Object.freeze([...definition.mainViewKinds])
      : undefined;
    if (mainViewKinds?.some((kind) => kind.trim().length === 0)) {
      throw new Error(`Sidebar section "${definition.id}" has an empty Main View kind`);
    }
    if (mainViewKinds && new Set(mainViewKinds).size !== mainViewKinds.length) {
      throw new Error(`Sidebar section "${definition.id}" has duplicate Main View kinds`);
    }

    const stored = Object.freeze({
      ...definition,
      ...(mainViewKinds ? { mainViewKinds } : {}),
      ...(definition.search ? { search: Object.freeze({ ...definition.search }) } : {}),
    });
    const entry = Object.freeze({ sequence: this.#sequence++, value: stored });
    this.#definitions.set(definition.id, entry);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#definitions.get(definition.id) !== entry) return;
      this.#definitions.delete(definition.id);
      this.#updateSnapshot();
    });
  }

  get(sectionId: string): SidebarSectionDefinition | undefined {
    return this.#definitions.get(sectionId)?.value;
  }

  getAll(): readonly SidebarSectionDefinition[] {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #updateSnapshot(): void {
    this.#snapshot =
      this.#definitions.size === 0
        ? EMPTY_SECTIONS
        : Object.freeze(
            Array.from(this.#definitions.values())
              .sort(
                (left, right) =>
                  (left.value.order ?? 0) - (right.value.order ?? 0) ||
                  left.sequence - right.sequence,
              )
              .map(({ value }) => value),
          );
    emitRegistryChange(this.#listeners);
  }
}
