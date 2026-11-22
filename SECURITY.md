# Security Policy

## Reporting a vulnerability

Do **not** open a public issue or disclosure. Report vulnerabilities privately:

- **Contact:** `security@` **[maintainer: fill in]** — a placeholder so no invented address can be mistaken for a real one; the maintainer owns this line and must fill it before the first public release.
- Include: affected version (`dsh-orchestrator-kit` version), DSH version, the route or file involved, and a minimal reproduction.
- You will get an acknowledgment first and a fix-or-verdict afterwards; keep the report confidential until a fix is published.

## Scope

What is in scope:

- The local HTTP routes (`roles`, `catalog`, `efforts`, `events`, `diagnostics`, `update`, `route`) — validation bypass, unexpected writes, or missing fail-closed responses (409/503, the update route's 502, and the read-only 403).
- The role-card frontmatter writer — race conditions, partial writes, or corruption of files in `$DSH_AGENTS_HOME` / `~/.agents/agents`.
- The change log (`.orchestrator-audit.jsonl`) and the `events` reader — secret leakage, absolute-path leakage, or writes outside the card-write critical section.
- The settings page — injection into role routing values displayed or saved.
- The craft install script — path escape, overwrite of existing files, or backup creation.

What is **not** in scope:

- Remote code execution or anything else of that class — the kit has no remote-execution surface: it serves local HTTP routes, writes frontmatter, and its only outbound traffic is the update check — read-only GETs to the GitHub releases API and the npm registry, with no credentials and no write traffic; installing an update is delegated to the host plugin manager and never downloads or runs anything through this plugin's own code. Reports claiming otherwise will be assessed as misconfigurations of the host harness.
- Vulnerabilities in DeepSeek Harness itself, in providers, or in user machines — report those to their respective maintainers.
- Social engineering of users.

Hardening baseline (reports should account for these): route-save request bodies are capped at 65536 bytes at the plugin level (413 beyond the cap, before any disk read) and restricted to known fields (unknown fields return 400). Server logs and HTTP error bodies redact known secret shapes to `[redacted]` and user-home path prefixes to `[home]`, preserving error codes and surrounding context; keyword coverage is best-effort, not exhaustive. Role, catalog and effort data fields in successful responses are never redacted; error text carried inside a success envelope (the roles listing's `invalid[].error`) is redacted like any error, and the same redaction applies to the `events` and `diagnostics` error paths.

Read-only mode and the 403-before-read guarantee: setting `DSH_ORCHESTRATOR_READONLY` to `1` (or `true`, case-insensitive) makes the route writer answer every save with `403` (`code: 'readonly'`) at the very top of the handler — before the request body is read, before validation and before any filesystem access — so a read-only server performs no work for save attempts. The flag is checked on every request, but it is read from the process environment: set it before starting the harness — changing the shell after startup does not reach a running process. The roles bootstrap carries the same flag so the panel can mirror it (disabling every mutating control), but the mirror is convenience only: the server `403` is the authoritative gate, and the panel never claims a write succeeded when the server would refuse it. The update check is a read: it runs regardless of the flag, and the install action is a client-side mutation of the host's plugin manager, outside this flag's server scope — the flag gates the card-write route only.

Change log hardening: the audit file `.orchestrator-audit.jsonl` lives beside the role cards and stores, per record, a timestamp, the role id, the previous/next route values and the origin — role ids and route values only. It never stores secrets, absolute paths or card contents; paths in related log output are relative to the agents root. The append runs inside the same file-lock critical section as the card write and is best-effort by design: an audit-write failure is logged (redacted) and never fails or rolls back the save. The `events` route serves at most the last 50 records, counts malformed lines as `skipped`, answers an empty list when the file does not exist, and returns a redacted 500 only for a genuine read failure; the change log grows unbounded by design and an operator may trim it manually.

Lock policy (inherited by the change log): card writes and their audit append share one `<card>.md.lock` critical section, so the audit adds no second lock. The plugin never removes lock files automatically; an orphaned lock still requires manual operator removal.

Craft install script containment: `scripts/install-craft.js` copies bundle files only under the agents root resolved by the plugin's own root resolution (honoring `$DSH_AGENTS_HOME`) — role cards into `<root>/agents` and the dev-flow skill tree into `<root>/skills/dev-flow` — verifies every target stays under that root before writing, filters source ids through the same entry-name validation as the writer, always skips files that already exist (no overwrite mode), and never creates backups. It prints agent-root-relative paths only, and a held writer lock produces the documented retry/operator guidance with exit code 1 — it never retries on its own and never removes locks.

## Response targets

- First acknowledgment: within **7 days**.
- Fix or verdict: within **30 days** of a confirmed report.

## Known limitations

- **Post-write concurrency window (local same-user processes).** The route writer checks the card's mtime before and inside the file lock, and writes atomically via temp-file rename. mtime is not guaranteed to change on every filesystem across renames, so a process running as the same user that rewrites the card immediately after the save — without touching mtime — is not detected. Same-user processes already own the directory, so this is an application-integrity limitation, not a privilege boundary; report exploitability beyond that if you find it.
- **Operator-only orphan-lock recovery.** Card writes are serialized by a `<card>.md.lock` file beside the card, with a bounded wait. When another writer holds the lock, the save fails with a retryable 503 (`lock-timeout`) naming the relative lock file. The plugin never removes lock files automatically: if a lock is orphaned because its owner crashed, an operator must delete it manually. This is deliberate — automatic removal could break mutual exclusion for a live writer.

## Note for maintainers

The `security@` contact above is intentionally a placeholder (`[maintainer: fill in]`) rather than a guessed address. This is a deliberate human-maintenance field, not technical debt: publishing a wrong e-mail would silently drop reports. Fill it in before the repository receives public traffic.
