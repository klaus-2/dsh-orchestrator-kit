# Contributing

Thanks for helping improve dsh-orchestrator-kit. This is a small plugin — keep contributions small and direct.

## Commits

**Conventional Commits is mandatory.** Every commit must follow:

```
type(scope): subject
```

Allowed types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`. Use a scope when it is obvious (`feat(client)`, `docs(readme)`, `fix(routes)`).

## Tests

Before you claim anything works:

```bash
npm install
node scripts/test.mjs
```

Run `node scripts/test.mjs` **three times** and require three green runs — this project has had flaky-adjacent failures before, and a single pass proves nothing. CI runs the same script.

The native coverage gate needs two separate external directories (one for V8 data, one for the report run) and is run from the repository root:

```bash
NODE_V8_COVERAGE=$(node -p "require('node:os').tmpdir()")/dsh-coverage node scripts/test.mjs
NODE_V8_COVERAGE=$(node -p "require('node:os').tmpdir()")/dsh-coverage-report node scripts/test.mjs --coverage-report --coverage-dir=$(node -p "require('node:os').tmpdir()")/dsh-coverage
```

Both coverage directories MUST stay OUTSIDE the checkout: the hygiene walker scans the repo tree, and the absolute npm URLs embedded in V8 JSON would fail it. The second command writes to its own directory so the report run cannot double the emitted entries. Clear the data directory before a fresh measurement — V8 keeps uniquely named JSON files, so reusing a directory merges stale ranges with the current run.

## Sanitization

The CI pipeline blocks commits containing machine-specific tokens and private identifiers. Before committing, check your diff for **none** of these:

- provider/credential tokens or API keys of any kind
- local usernames and machine-specific paths (anything pointing into a user's home directory, on any OS)
- internal machine names, hostnames or session identifiers
- private account handles or e-mail addresses

Anything that exists only on your machine must never reach the repository — the project must stay valid for all users.

## Terminology

Role, phase, route, dispatch, profile and the other pipeline terms are defined in [docs/glossary.md](docs/glossary.md).

## Release notes per release

`release-notes.json` at the repository root feeds the panel's What's-new dialog. Every release must update it as part of the release work:

1. Write short plain-text notes (a few lines, no links) for all three languages: `en`, `pt-BR` and `zh`.
2. Bump the top-level `version` to the version being released — the shipped notes only reach the panel when that version matches the running package version.
3. Run `node scripts/test.mjs` and keep it green: the file ships in the npm tarball and is part of its frozen file contract.

## Pull requests

- Keep PRs small: one concern per PR, ideally under ~300 changed lines.
- Update docs (README / CHANGELOG `Unreleased`) when behavior or public interfaces change.
- No `TODO` or `FIXME` left behind — implement the definitive change now or explain it in the PR description.

## Reporting bugs

Open an issue with: DSH version, Node version, the role and route involved, and the exact error status (409/503) or log excerpt. Do not include tokens or personal paths in logs — see Sanitization.

## Security

Do not open public issues for security vulnerabilities. Follow [SECURITY.md](SECURITY.md) and report privately.
