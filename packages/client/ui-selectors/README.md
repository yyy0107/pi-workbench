# @workbench/ui-selectors

Owns the shared searchable, animated, and workspace selector controls. Labels and validation copy
are supplied by callers; the package does not create a second translation bundle. Selector popup
content uses the installing Workbench portal supplied by the base UI package.

`lib/selector-dropdown-metrics.ts` contains the transition metric helpers consumed by the animated
selector hook. The existing selector behavior and public component types remain unchanged.

SearchableSelector foundation assertions are owned here; they are retained but excluded from execution under the current no-UI-tests constraint.
