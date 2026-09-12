# Workbench Theme and Appearance

Use this reference when a change affects theme mappings, control variants, or appearance settings. Workbench already owns its theme; do not add a second theme provider or import a standalone palette from a generic component example.

## Trace the changed value

Start at the affected component and its semantic class or CSS variable. Follow its definition through `packages/workbench/shell/src/styles.css` and the imported owning stylesheet. Inspect `packages/workbench/shell/src/extensions/builtin/appearance/` only when settings or appearance-derived values are involved.

Keep semantic colors in the existing theme layer. Controls consume the shared button/input/dropdown/switch state and size tokens; regional layout values derive from those tokens in the region's scope. A primitive/base value change affects its consumers, a semantic mapping changes its role, and a component override should stay within that component's ownership. Choose the narrowest layer that expresses the requested behavior.

Theme, global color, density, and radius settings must continue to influence the changed UI. Shared components already encode interaction states; extend their variants when the need is shared rather than duplicating hover/focus/disabled styles at each call site.

## Overlay scope

Use the owning Shell Portal container. If regional styles apply to an overlay, preserve the necessary region marker on its actual DOM. Do not move a popup into a clipped ancestor or copy computed theme values with JavaScript.

## Verification

Trace the changed token's consumers and review the supported theme/appearance settings relevant to the change. Check rendering only when code inspection leaves a concrete uncertainty; check affected states in each applicable theme rather than assuming one proves another. Do not expand a component fix into a palette redesign.
