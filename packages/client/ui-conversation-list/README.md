# @workbench/ui-conversation-list

Owns the sidebar conversation catalog: workspace grouping, navigation, pinning, order persistence, moves and menus. The original workspace sidebar extension is installed by Shell. Generic primitives and pointer drag sessions come from ui-sidebar. src contains the capability; lib/thread-sort.ts is consumed by sidebar-projection; tests are preserved at package root. Dictionaries are colocated in src/i18n.

sidebar-context requires explicit selectors over sidebar-contracts; the controller owns runtime orchestration, lib/sidebar-projection builds view data, and move menus are separate from the single store.
