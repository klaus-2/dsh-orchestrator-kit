# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- First-release link convention: no prior tag exists, so there is nothing to
     diff [0.1.0] against. [Unreleased] therefore compares HEAD, and [0.1.0]
     points at the v0.1.0 tree. After the next tagged release, switch to the
     standard compare form (compare/v0.1.0...v0.2.0). -->

## [Unreleased]

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
