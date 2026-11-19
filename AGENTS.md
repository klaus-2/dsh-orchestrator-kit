# AGENTS.md

Rules for AI code agents working in this repository (dsh-orchestrator-kit — a DeepSeek Harness plugin).

## Ownership map

| Path | Owner | Notes |
| --- | --- | --- |
| `README.md`, `README.pt-BR.md`, `README.zh-CN.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md` | docs lane | Human-facing docs; keep the three READMEs structurally identical. |
| `package.json`, `index.js`, `client.js`, `cordis.patch.yml` | plugin core | The DSH plugin host + client; changes here require test updates (see below). |
| `scripts/test.mjs` | verification | The only test entry point; CI runs `node scripts/test.mjs`. |
| `craft/agents/*`, `craft/skills/dev-flow/*` | craft bundle | Role cards and the dev-flow skill; the settings panel writes their installed copies' frontmatter, not these sources. |
| `locale/`, `docs/`, `icon.svg` | UI assets | Localized strings, showcase assets, plugin icon. |
| `.github/workflows/*.yml` | CI/CD | `ci.yml` (tests) and `publish.yml` (npm trusted publishing). |

## Definition of done

Before you declare any change ready:

1. Run `node scripts/test.mjs` — read the fresh output in the same turn. **Zero tolerated tokens** is one of its assertions (see below).
2. If you touched `personas`, `routes`, or the plugin's route names, update `scripts/test.mjs` expectations in the same change. The plugin's personas and route surface are not editable without their tests.
3. Re-run `node scripts/test.mjs` after every fix until green.

## Zero machine tokens

This is a public repository: it must stay valid for every user on every machine. Never write into any file:

- provider credentials, API keys or other secrets;
- local usernames or user paths (any path pointing into a user's home directory, Windows or POSIX);
- machine names, session identifiers, or private account handles.

`scripts/test.mjs` fails the suite on forbidden tokens. Do not bypass or weaken that assertion; if a token you need is flagged, the token is the bug, not the check.

## Commits

Conventional Commits only: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `chore: ...`, `refactor: ...`, `test: ...`. No `TODO`/`FIXME` may be left in committed code — implement the definitive solution or escalate with an explicit reason.

## Working rules

- Read a file before editing it; prefer minimal, surgical diffs.
- Docs changes: update all three README languages together, plus `CHANGELOG.md` under `## [Unreleased]`.
- Do not edit installed role-card copies (`~/.agents/agents/`, `$DSH_AGENTS_HOME`) from this repo's tasks — edit the `craft/` sources.
- Never commit or push without an explicit human instruction.
