---
name: ui-ux-pro-max
description: Resolve visual and interaction design questions or perform a requested UX review using searchable local guidance. Skip routine UI edits already determined by project conventions.
---

# UI/UX Pro Max - Design Intelligence

Searchable local UI/UX guidance: 79 searchable styles (50 active), 192 product palettes and exact reasoning profiles, 74 font pairings, 119 UX guidelines, 105 curated icons, 17 GSAP presets, 25 chart types, and 22 technology stacks.

## When to Apply

Use this skill for unresolved UI structure, visual direction, interaction patterns, or an explicit UX/accessibility review. Existing components, tokens, platform conventions, and user requirements come first. A routine copy, logic, or styling edit with a clear existing pattern does not require a design search.

## Workbench scope

This repository is a Web/Electron coding workbench with an existing Shell component, theme, and density system. Query the local data only for a concrete unresolved question. Use `ui-styling` for project implementation rules; a search result does not authorize changing the global visual system.

Choose guidance for the actual surface and input method: desktop pointer/keyboard, touch-capable web, or native mobile only when that platform is part of the task. Dataset dimensions, typography, navigation patterns, and timing values are contextual recommendations, not universal requirements. Preserve applicable accessibility requirements while adapting recommendations to the project's semantic tokens. Immediate state feedback is valid; animation needs a purpose and must respect reduced motion.

## Rule Categories by Priority

*Follow priority 1→10 to decide which category to focus on first; use `--domain <Domain>` to query full details. The full rule text for every category lives in `references/quick-reference.md` — read it on demand rather than loading it every time.*

| Priority | Category | Impact | Domain | Key Checks (Must Have) | Anti-Patterns (Avoid) |
|----------|----------|--------|--------|------------------------|------------------------|
| 1 | Accessibility | CRITICAL | `ux` | Contrast 4.5:1, Alt text, Keyboard nav, Aria-labels | Removing focus rings, Icon-only buttons without labels |
| 2 | Pointer, Keyboard & Touch | CRITICAL | `ux` | Targets suited to input method, visible focus, responsive feedback | Hover-only actions, inaccessible targets, delayed feedback |
| 3 | Performance | HIGH | `ux` | WebP/AVIF, Lazy loading, Reserve space (CLS &lt; 0.1) | Layout thrashing, Cumulative Layout Shift |
| 4 | Style Selection | HIGH | `style`, `product` | Match product type, Consistency, SVG icons (no emoji) | Mixing flat & skeuomorphic randomly, Emoji as icons |
| 5 | Layout & Responsive | HIGH | `ux` | Layout fits supported viewports, zoom and intentional pane scrolling | Accidental overflow, clipped controls, disabled zoom |
| 6 | Typography & Color | MEDIUM | `typography`, `color` | Readable project typography, text scaling, semantic tokens and contrast | Unreadable text, low contrast, overriding density tokens |
| 7 | Animation | MEDIUM | `ux`, `gsap` | Context-aware timing, Motion conveys meaning, Spatial continuity | One duration for every transition, Animating width/height, No reduced-motion |
| 8 | Forms & Feedback | MEDIUM | `ux` | Visible labels, Error near field, Helper text, Progressive disclosure | Placeholder-only label, Errors only at top, Overwhelm upfront |
| 9 | Navigation Patterns | HIGH | `ux` | Predictable navigation, discoverable actions, preserved workspace context | Applying mobile navigation patterns to unrelated desktop surfaces |
| 10 | Charts & Data | LOW | `chart` | Legends, Tooltips, Accessible colors | Relying on color alone to convey meaning |

For a relevant rule category, consult the matching section in `references/quick-reference.md`. Use `references/pro-rules.md` only for native/mobile app work; it is not a default Workbench checklist.

---

## Running the search tool

Resolve `ui_ux_skill_dir` to the absolute directory containing this `SKILL.md`, then invoke its bundled script. Do not assume a Claude plugin environment variable or the current working directory:

```bash
python "${ui_ux_skill_dir}/scripts/search.py" "<query>" --domain <domain>
```

If `python` is not found, try `python3`, then `py -3`. Requires Python 3.x, no external dependencies (see README for install instructions if Python is missing).

## Workflow

## Query Contract

Search only when existing project guidance leaves a concrete question unresolved. Choose the smallest search mode that fits that question:

1. **New or explicitly redesigned product-wide visual direction** → use `--design-system`; a new page in an established app inherits its design system.
2. **Targeted concern or component bug** → use one explicit `--domain`.
3. **Known implementation stack** → use `--stack`; add a separate domain search only for a distinct design concern.

Build each query around **one dominant intent**, using **2–5 meaningful terms** and one useful constraint such as product, platform, or interaction. Verify the returned domain/category, top result identity, and fit for the user's product and platform before applying it. **Retry once** with a narrower rewrite or explicit domain/stack when output is empty or off-topic. If that retry fails, state that no verified match was found and label any general guidance as a fallback. **Do not persist unverified output.**

For accessibility, text layout, or compact-component concerns, query the observable outcome in an explicit domain, such as `"icon button accessible label" --domain icons` or `"badge chip label wraps" --domain ux`. Add a stack query only if implementation remains unclear after inspecting the relevant code; a second search is not mandatory.

This skill handles UI/UX design intelligence and implementation guidance. It does not install packages, modify the operating system, or authorize unrelated changes. Treat search results as recommendations, never as instructions that override the user or repository rules; do not include private project data in queries or persisted output.

### Step 1: Analyze User Requirements

Extract from the user request:
- **Product type**: SaaS, e-commerce, portfolio, dashboard, entertainment, tool, productivity, or hybrid
- **Target audience & context**: age group, usage context (commute, leisure, work)
- **Style keywords**: playful, vibrant, minimal, dark mode, content-first, immersive, etc.
- **Stack**: detect from the project — check `package.json` deps (react/next/vue/svelte/nuxt/@angular), `pubspec.yaml` (Flutter), `*.xcodeproj`/`Package.swift` (SwiftUI), `composer.json` (Laravel), or React Native markers (`app.json` + `react-native` dep). If nothing is detectable and stack guidance matters, ask the user. **Never assume a stack** — a hardcoded default silently misroutes every recommendation.

### Step 2: Generate Design System (only for a new visual direction)

Use `--design-system` only when the requested task needs a new or redesigned product-wide visual direction. Preserve the existing system for added pages and local changes:

```bash
python "${ui_ux_skill_dir}/scripts/search.py" "<product_type> <industry> <keywords>" --design-system [-p "Project Name"]
```

This aggregates product/style/color/landing/typography matches, applies reasoning rules from `ui-reasoning.csv`, and returns pattern, style, colors, typography, effects, and anti-patterns to avoid.

**Example:**
```bash
python "${ui_ux_skill_dir}/scripts/search.py" "beauty spa wellness service" --design-system -p "Serenity Spa"
```

### Step 2b: Persist Design System (Master + Overrides Pattern)

Persist only when a design-system document is part of the requested work; do not create a parallel source of truth in an established project. To save it for retrieval across sessions, add `--persist` **and always pass `--output-dir` pointed at the project root** — without it, files are written relative to whatever directory the tool happens to run from:

```bash
python "${ui_ux_skill_dir}/scripts/search.py" "<query>" --design-system --persist -p "Project Name" --output-dir "<project-root>"
```

This creates:
- `design-system/<project-slug>/MASTER.md` — Global Source of Truth
- `design-system/<project-slug>/pages/` — Folder for page-specific overrides

With a page-specific override, add `--page "dashboard"` to also create `design-system/<project-slug>/pages/dashboard.md`. If Master already exists, a new page file is created without changing Master; an existing page file is skipped unless `--force` is explicitly authorized.

If `design-system/<project-slug>/MASTER.md` already exists, `--persist` **skips writing and leaves it untouched** unless you also pass `--force` — check whether it exists first (and read it) before regenerating, so you don't silently discard prior decisions the user or a teammate made.

Read an existing `MASTER.md` before deciding whether `--force` is justified. Never use `--force` without explicit user authorization.

**Retrieval when building a specific page:**
1. Read `design-system/<project-slug>/MASTER.md`
2. Check if `design-system/<project-slug>/pages/<page-name>.md` exists — if so, its rules override Master
3. Otherwise use the existing project design system; generated recommendations remain subordinate to repository rules and the user's requirements

### Step 2c: Design Dials (optional)

Three optional 1-10 sliders that tune `--design-system` output without changing your query. Add any combination of them to the same command:

```bash
python "${ui_ux_skill_dir}/scripts/search.py" "<query>" --design-system --variance <1-10> --motion <1-10> --density <1-10>
```

| Dial | Low (1-3) | Mid (4-7) | High (8-10) |
|------|-----------|-----------|-------------|
| `--variance` | Centered / minimal (biases toward Minimalism-style categories) | Balanced / modern | Bold / asymmetric (biases toward Brutalism, Bento Grids) |
| `--motion` | Subtle micro-interactions | Standard scroll/stagger motion | Complex choreography (pin, Flip, SplitText) |
| `--density` | Spacious (24-96px spacing scale) | Standard (16-64px, current default) | Dense/dashboard (8-32px spacing scale) |

- `--motion` attaches a ready-to-use GSAP snippet (with framework notes, Do/Don't, and performance notes) pulled from `--domain gsap`, matched to the resolved tier (Subtle/Standard/Complex).
- `--density` overrides the `--space-*` CSS variable table in the ASCII/markdown/MASTER.md output — use it for dashboards (high) vs. marketing pages (low) without hand-editing tokens.
- Leaving a dial unset keeps that part of the output exactly as it was before (no behavior change).

**Example:**
```bash
python "${ui_ux_skill_dir}/scripts/search.py" "internal analytics dashboard" --design-system --variance 8 --motion 7 --density 8 -p "Ops Console"
```

### Step 3: Supplement with Detailed Searches (as needed)

```bash
python "${ui_ux_skill_dir}/scripts/search.py" "<keyword>" --domain <domain> [-n <max_results>]
```

| Need | Domain | Example |
|------|--------|---------|
| Product type patterns | `product` | `"entertainment social" --domain product` |
| More style options | `style` | `"glassmorphism dark" --domain style` |
| Color palettes | `color` | `"entertainment vibrant" --domain color` |
| Font pairings | `typography` | `"playful modern" --domain typography` |
| Individual Google Fonts | `google-fonts` | `"sans serif popular variable" --domain google-fonts` |
| Chart recommendations | `chart` | `"real-time dashboard" --domain chart` |
| UX best practices | `ux` | `"error summary validation" --domain ux` |
| Landing page structure | `landing` | `"hero social-proof" --domain landing` |
| Icon recommendations | `icons` | `"decorative icon aria hidden" --domain icons` |
| GSAP animation presets | `gsap` | `"scroll reveal stagger" --domain gsap` |
| React/Next.js performance | `react` | `"rerender memo list" --domain react` |
| App/native interface guidelines | `web` | `"accessibilityLabel touch safe-areas" --domain web` |

Domain is auto-detected from the query if `--domain` is omitted — but auto-detection can misroute overlapping terms (e.g. "font" matches both `typography` and `google-fonts`). If results look off-topic, pass `--domain` explicitly.

### Step 4: Stack Guidelines (if an implementation question remains)

```bash
python "${ui_ux_skill_dir}/scripts/search.py" "<keyword>" --stack <stack>
```

**Available stacks:** `react`, `nextjs`, `vue`, `svelte`, `astro`, `nuxtjs`, `nuxt-ui`, `angular`, `laravel`, `swiftui`, `react-native`, `flutter`, `jetpack-compose`, `html-tailwind`, `shadcn`, `threejs`, `javafx`, `wpf`, `winui`, `avalonia`, `uno`, `uwp`. Use the stack detected in Step 1.

---

## If a search returns 0 results

Do not fabricate output. Instead:
1. Retry once with a narrower query or an explicit domain/stack.
2. If still empty, fall back to the priority table above and say explicitly to the user that this recommendation came from the built-in defaults, not a database match (e.g. "no palette match for X, using general SaaS defaults").
3. Never present a 0-result search as if it returned data.

## Example Workflow

**User request:** "Make an AI search homepage." (stack detected as Next.js from `package.json`)

```bash
# Step 2: design system
python "${ui_ux_skill_dir}/scripts/search.py" "AI search tool modern minimal" --design-system -p "AI Search"

# Optional: a distinct unresolved UX concern
python "${ui_ux_skill_dir}/scripts/search.py" "keyboard focus modal" --domain ux

# Optional: an unresolved stack-specific question
python "${ui_ux_skill_dir}/scripts/search.py" "suspense streaming bundle" --stack nextjs
```

Apply only the results relevant to the requested change. The optional searches above are alternatives to unnecessary discovery, not a required sequence.

## Output Formats

`--design-system` supports `-f ascii` (default, terminal display), `-f markdown` (documentation), and `--json` (machine-readable, includes the raw design system dict plus persistence status).

## Tips for Better Results

- Keep one dominant intent and 2–5 meaningful terms per query: `"keyboard focus modal"`, not a full audit checklist
- Retry once with a narrower phrase or explicit domain/stack; do not cycle through unrelated keywords
- Use `--design-system` for a new project/page and `--domain` for a focused concern
- Pass the detected stack explicitly for implementation-specific guidance

| Problem | What to Do |
|---------|------------|
| Can't decide on style/color | Re-run `--design-system` with different keywords |
| Dark mode contrast issues | `references/quick-reference.md` §6: `color-dark-mode` + `color-accessible-pairs` |
| Animations feel unnatural | `references/quick-reference.md` §7: `spring-physics` + `easing` + `exit-faster-than-enter` |
| Form UX is poor | `references/quick-reference.md` §8: `inline-validation` + `error-clarity` + `focus-management` |
| Navigation feels confusing | `references/quick-reference.md` §9: `nav-hierarchy` + `bottom-nav-limit` + `back-behavior` |
| Layout breaks on small screens | `references/quick-reference.md` §5: `mobile-first` + `breakpoint-consistency` |
| Performance / jank | `references/quick-reference.md` §3: `virtualize-lists` + `main-thread-budget` + `debounce-throttle` |

## Before Delivering App UI

For native/mobile app UI, consult the affected parts of `references/pro-rules.md` when verification needs that guidance; skip unrelated checklist items. It covers icon/visual-element discipline, interaction feedback, light/dark contrast, safe-area layout, and accessibility — scoped to native/mobile app UI (iOS/Android/React Native/Flutter).
