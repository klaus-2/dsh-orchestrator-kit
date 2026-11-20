# Security Policy

## Reporting a vulnerability

Do **not** open a public issue or disclosure. Report vulnerabilities privately:

- **Contact:** `security@` **[maintainer: fill in]** — a placeholder so no invented address can be mistaken for a real one; the maintainer owns this line and must fill it before the first public release.
- Include: affected version (`dsh-orchestrator-kit` version), DSH version, the route or file involved, and a minimal reproduction.
- You will get an acknowledgment first and a fix-or-verdict afterwards; keep the report confidential until a fix is published.

## Scope

What is in scope:

- The four local HTTP routes (`roles`, `catalog`, `efforts`, `route`) — validation bypass, unexpected writes, or missing fail-closed responses (409/503).
- The role-card frontmatter writer — race conditions, partial writes, or corruption of files in `$DSH_AGENTS_HOME` / `~/.agents/agents`.
- The settings page — injection into role routing values displayed or saved.

What is **not** in scope:

- Remote code execution or anything else of that class — the kit has no remote-execution surface: it serves local HTTP routes only and writes frontmatter. Reports claiming otherwise will be assessed as misconfigurations of the host harness.
- Vulnerabilities in DeepSeek Harness itself, in providers, or in user machines — report those to their respective maintainers.
- Social engineering of users.

Hardening baseline (reports should account for these): route-save request bodies are capped at 65536 bytes at the plugin level (413 beyond the cap, before any disk read) and restricted to known fields (unknown fields return 400). Server logs and HTTP error bodies redact known secret shapes to `[redacted]` and user-home path prefixes to `[home]`, preserving error codes and surrounding context; keyword coverage is best-effort, not exhaustive. Role, catalog and effort data fields in successful responses are never redacted; error text carried inside a success envelope (the roles listing's `invalid[].error`) is redacted like any error.

## Response targets

- First acknowledgment: within **7 days**.
- Fix or verdict: within **30 days** of a confirmed report.

## Known limitations

- **Post-write concurrency window (local same-user processes).** The route writer checks the card's mtime before and inside the file lock, and writes atomically via temp-file rename. mtime is not guaranteed to change on every filesystem across renames, so a process running as the same user that rewrites the card immediately after the save — without touching mtime — is not detected. Same-user processes already own the directory, so this is an application-integrity limitation, not a privilege boundary; report exploitability beyond that if you find it.
- **Operator-only orphan-lock recovery.** Card writes are serialized by a `<card>.md.lock` file beside the card, with a bounded wait. When another writer holds the lock, the save fails with a retryable 503 (`lock-timeout`) naming the relative lock file. The plugin never removes lock files automatically: if a lock is orphaned because its owner crashed, an operator must delete it manually. This is deliberate — automatic removal could break mutual exclusion for a live writer.

## Note for maintainers

The `security@` contact above is intentionally a placeholder (`[maintainer: fill in]`) rather than a guessed address. This is a deliberate human-maintenance field, not technical debt: publishing a wrong e-mail would silently drop reports. Fill it in before the repository receives public traffic.
