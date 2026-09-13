# @workbench/pi-toolbox-ui

Owns Skills, Extensions, Packages and prompt management, skill-reading presentation and the Pi resource file backend/openers. Internal helpers normalize drafts, targets, update feedback and skill-reading projections.

src owns real capability implementation/contracts and colocated bilingual dictionaries/styles. lib owns consumed internal helpers. Both keep TS/TSX with at most one subdirectory. Preserve client instances, extension IDs/order and disposal. Use public exports; tests live in tests/.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/toolbox-capability-surface.tsx` imports `lib/package-update-feedback.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
