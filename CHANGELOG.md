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

### Changed

- Redesigned the settings panel: responsive card grid, a segmented phase filter (All roles / three Craft phases / Other) with keyboard-navigable tabs, a collapsible legend explaining every setting, per-role status badges (Routed / Inherits chat / Disabled), header summary counts, and per-field help text. Contrast and narrow-layout overflow fixed; theme tokens used throughout.
- Strict frontmatter write gate: anchors, aliases and custom YAML tags are refused on writes, with a 65536-byte frontmatter cap and a nesting limit. Anchored, tagged or deeply nested cards stay listed but read-only (writes return 400) until cleaned; aliased or oversized cards fail the listing parse and appear only in the invalid-card warning banner.
- Route-save request limits: bodies above 65536 bytes are rejected with 413 before any disk read, and only known fields are accepted (unknown fields return 400).
- Role-card listing now uses bounded parallel reads (8 workers); the sorted response order is unchanged.
- A held writer lock now returns an actionable 503 error (`code: 'lock-timeout'`) naming the relative lock file with retry and operator guidance, instead of a generic 500; lock files are never removed automatically.

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
