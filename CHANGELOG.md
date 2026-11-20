# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- First-release link convention: no prior tag exists, so there is nothing to
     diff [0.1.0] against. [Unreleased] therefore compares HEAD, and [0.1.0]
     points at the v0.1.0 tree. After the next tagged release, switch to the
     standard compare form (compare/v0.1.0...v0.2.0). -->

## [Unreleased]

### Added

- `Server-Timing` header on successful responses when a timing metric was measured — roles reads, catalog reads, route validation and writes (durations only); an unchanged save with no route validation carries no header. A panel legend line shows the last load timings.
- Invalid-card surfacing: the roles listing reports parse-failed cards in an `invalid` list with redacted errors, and the panel shows a warning banner naming the cards that cannot be edited until their frontmatter is fixed.
- Unchanged-save indicator: a save identical to the card's current settings answers `unchanged: true` without acquiring a lock or writing, and the panel shows an "Already up to date" notice.
- Panel i18n in English, Português (BR) and 简体中文: a header select switches the panel between Auto (host language), English, Português (BR) and 简体中文, defaulting to the harness language. The override is panel-scoped and remembered for the browser session (best-effort `localStorage`; it may not survive a Desktop app restart). While the plugin is active, `pt-BR` becomes a selectable harness language (removed on deactivation), and generic `pt` resolves to the pt-BR dictionary.
- Locale parity and sync tests: the three `locale/*.json` files must carry identical panel key sets against a frozen 72-key schema, and the dictionaries embedded in `client.js` must deep-equal the JSON `panel` sections.
- Structural t-usage gate: a sentinel-bind render matrix proves every panel string flows through the locale system and all 72 dictionary keys are exercised.
- `npm pack` guard: the dry-run file list must match a frozen 69-entry contract, and every file extracted from a real tarball is scanned for forbidden tokens.
- View controls on the settings panel: a search box (role name or description), a status filter (All statuses / Routed / Inherits chat / Disabled), a sort select (by name, routed first, inherits first — applied within each section) and a density select (cards or compact one-line rows). All compose AND-style with the phase tabs, and a filtered-out view shows a distinct no-match state. Each tab shows its routed / inherit / disabled breakdown in saved state.
- Unsaved-changes protection: editing a card marks it unsaved (amber border and an " (unsaved)" name suffix), leaving the page with dirty drafts triggers the browser's leave confirmation, Ctrl+S / Cmd+S saves the focused card, and unsaved drafts survive section remounts via mtime-keyed hoisting — kept only while the card's server mtime still matches the stored base, discarded when an external edit changed the card. The plain Refresh button still resets drafts.
- Undo last save: every successful save offers a per-card Undo that restores the pre-save settings; one level per card, session-only, never persisted. The undo request carries the recorded post-save `mtimeMs`, so a card changed on disk in between answers `409` with the conflict message.
- Corrective actions on save errors: a `409` conflict message gains a "Reload saved state, keep edits" action that re-reads the saved state and reapplies the draft without ever resending the stale `mtimeMs`; a `409` on a save that set a reasoning effort adds a hint pointing at the effort select. The 503 lock-timeout response keeps its server-provided guidance.
- Accessible save feedback: a shared polite live region announces the last save or undo outcome, the header counts act as a polite live region, and a saved card keeps a green border until the next change (cleared by interaction, not timers).
- Effective-route hint on inherit cards (shows the chat-default provider / model when the harness catalog exposes one) and `content-visibility` space reservation on comfortable grid cards.
- Same-session panel prefs: tab choice, legend state and density persist through best-effort `localStorage` with the same semantics as the language override; search and sort are transient.

### Changed

- Redesigned the settings panel: responsive card grid, a segmented phase filter (All roles / three Craft phases / Other) with keyboard-navigable tabs, a collapsible legend explaining every setting, per-role status badges (Routed / Inherits chat / Disabled), header summary counts, and per-field help text. Contrast and narrow-layout overflow fixed; theme tokens used throughout.
- Strict frontmatter write gate: anchors, aliases and custom YAML tags are refused on writes, with a 65536-byte frontmatter cap and a nesting limit. Anchored, tagged or deeply nested cards stay listed but read-only (writes return 400) until cleaned; aliased or oversized cards fail the listing parse and appear only in the invalid-card warning banner.
- Route-save request limits: bodies above 65536 bytes are rejected with 413 before any disk read, and only known fields are accepted (unknown fields return 400).
- Role-card listing now uses bounded parallel reads (8 workers); the sorted response order is unchanged.
- A held writer lock now returns an actionable 503 error (`code: 'lock-timeout'`) naming the relative lock file with retry and operator guidance, instead of a generic 500; lock files are never removed automatically.
- Panel strings (labels, badges, notices, banners, legend, empty states) resolve through the locale system and re-translate live on language switch; role, catalog and effort names and counts remain untranslated data. Phase tabs and sections are keyed by stable ids (`discovery` / `planning` / `verification` / `other`); rendered English text is unchanged.
- The English-only test policy is replaced by trilingual parity: locale key parity, registered-dictionary sync and the structural t-usage gate (user decision).
- Remounting the settings panel skips the catalog refetch while a cached catalog exists (roles always refetch; an explicit refresh always refetches both).

### Security

- Secrets and user-home paths are redacted to `[redacted]` and `[home]` markers in server logs and HTTP error bodies; error codes and context are preserved. Data fields in successful responses are never redacted; error text inside a success envelope (`invalid[].error`) is redacted like any error.

## [0.1.0] - 2026-11-18

### Added

- Settings control panel **Settings → Orchestrator**: the 20 pipeline roles grouped in the three Craft phases, with per-role Disabled toggle, Provider, Model, lazily loaded Reasoning effort and Save.
- Fail-closed validated HTTP routes: `GET /api/dsh-orchestrator-kit.roles`, `.catalog` and `.efforts`, plus `POST /api/dsh-orchestrator-kit.route` — unknown role, model or effort returns 409; unavailable catalog returns 503.
- Atomic locked writes of role-card frontmatter: file lock, TOCTOU guard, post-write revalidation and expected-`mtimeMs` concurrency check.
- Orchestrator preset persona with the 20-role dev-flow pipeline included.
- Craft bundle: 20 role cards, the dev-flow skill and 9 playbooks, copyable to `~/.agents/agents` and `~/.agents/skills/dev-flow`.
- CI workflow and trusted-publishing release workflow.
- Animated showcase (`docs/showcase.svg`).

[Unreleased]: https://github.com/klaus-2/dsh-orchestrator-kit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/klaus-2/dsh-orchestrator-kit/tree/v0.1.0
