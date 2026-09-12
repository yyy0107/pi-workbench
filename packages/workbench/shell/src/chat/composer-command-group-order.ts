import type { WorkbenchComposerSuggestionGroup } from "./workbench-composer-view";

const COMPOSER_SUGGESTION_GROUP_ORDER: Readonly<Record<WorkbenchComposerSuggestionGroup, number>> =
  {
    builtin: 0,
    skill: 1,
    extension: 2,
    prompt: 3,
    workbench: 4,
  };

interface ComposerSuggestionWithGroup {
  readonly group: WorkbenchComposerSuggestionGroup;
}

/** Keep the command menu grouped while placing Skills immediately after built-ins. */
export function sortComposerSuggestions<T extends ComposerSuggestionWithGroup>(
  suggestions: readonly T[],
): T[] {
  return suggestions
    .map((suggestion, index) => ({ suggestion, index }))
    .sort(
      (left, right) =>
        COMPOSER_SUGGESTION_GROUP_ORDER[left.suggestion.group] -
          COMPOSER_SUGGESTION_GROUP_ORDER[right.suggestion.group] || left.index - right.index,
    )
    .map(({ suggestion }) => suggestion);
}
