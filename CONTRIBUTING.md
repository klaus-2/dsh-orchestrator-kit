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

## Sanitization

The CI pipeline blocks commits containing machine-specific tokens and private identifiers. Before committing, check your diff for **none** of these:

- provider/credential tokens or API keys of any kind
- local usernames and machine-specific paths (anything pointing into a user's home directory, on any OS)
- internal machine names, hostnames or session identifiers
- private account handles or e-mail addresses

Anything that exists only on your machine must never reach the repository — the project must stay valid for all users.

## Pull requests

- Keep PRs small: one concern per PR, ideally under ~300 changed lines.
- Update docs (README / CHANGELOG `Unreleased`) when behavior or public interfaces change.
- No `TODO` or `FIXME` left behind — implement the definitive change now or explain it in the PR description.

## Reporting bugs

Open an issue with: DSH version, Node version, the role and route involved, and the exact error status (409/503) or log excerpt. Do not include tokens or personal paths in logs — see Sanitization.

## Security

Do not open public issues for security vulnerabilities. Follow [SECURITY.md](SECURITY.md) and report privately.
