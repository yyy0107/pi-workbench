# @workbench/ui-resize

Owns the shared Workbench resize capability: collapsible and proportional sizing hooks, the accessible resize handle, spring and snap calculations, resize observation, and proportional panel styles. `src` contains the public React integration and CSS; `lib` contains the consumed framework-independent calculations and observer helper.

The package preserves the existing pointer, keyboard, reduced-motion, observer, animation, and cleanup behavior. Callers provide visible and accessible labels; this package owns no product copy or translation bundle.
