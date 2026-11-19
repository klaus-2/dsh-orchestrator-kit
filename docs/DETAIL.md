# Orchestrator kit — plugin detail

`dsh-orchestrator-kit` adds an "Orchestrator" section to DeepSeek Harness
Settings: it routes each role of the 20-role Craft dev-flow pipeline to a
provider, model and reasoning effort, editing the role cards the harness
reads when dispatching `subagent_role` agents.

## Where the settings live

Roles are read from `<agents home>/agents/*.md`: `<agents home>` is the
`DSH_AGENTS_HOME` environment variable when set, otherwise `~/.agents`
(`index.js` `agentsRootOf`). The panel edits these *installed* copies; the
`craft/` sources are never written at runtime.

## The panel

Roles are listed from the agents directory, grouped into the three pipeline
phases and sorted by role id:

- **Discovery & Advisory** — repo-scout, docs-scout, media-analyst, arch-advisor
- **Planning & Execution** — scope-analyst, planner, plan-auditor, run-conductor, implementer, debugger
- **Verification, QA & Docs** — diff-reviewer, test-auditor, test-writer, browser-qa, error-auditor, security-auditor, perf-auditor, debt-auditor, docs-sync, tech-writer

Any role card outside these twenty appears under an "Other" group; cards
that fail to parse are skipped with a warning instead of breaking the list.

Each row offers four controls and one action:

- **Disabled** — toggle. `true` writes `disabled: true` into the
  frontmatter; turning it back on removes the key.
- **Provider** — select over the live model catalog (GET `.catalog`).
- **Model** — select, filtered to the chosen provider's models.
- **Reasoning effort** — select, lazily loaded per provider+model pair from
  GET `.efforts`; "Automático (padrão do modelo)" clears the field so the
  model default applies.
- **Save** — writes one role's draft via POST `.route`; effective on the
  next turn or next dispatch.

Resetting a role ("Padrão do chat (herdar)") sends a null route: the panel
removes `provider` and `reasoning_effort`, sets `model: inherit`, and
clears `disabled: false` back to no key. Cards ship as `model: inherit`
with no `provider`, so a fresh install inherits the chat route for every
role until you configure one.

## HTTP surface

All routes live on the plugin connection namespace
`/api/dsh-orchestrator-kit.*`:

- `GET /roles` — sorted parsed role cards (id, name, description, route,
  reasoning effort, disabled, mtime). Missing agents directory returns an
  empty list; unreadable directory returns 500.
- `GET /catalog` — live provider/model groups from the harness LLM service,
  plus availability, degraded and failed-provider flags.
- `GET /efforts?provider=&model=` — reasoning efforts for one route:
  empty parameters → 400; resolver unavailable → 503; unknown route → 409;
  timeout → 504; invalid model metadata → 502.
- `POST /route` — body `{id, provider?, model?, disabled?, reasoningEffort?,
  expectedMtimeMs?}`; validation is fail-closed: invalid JSON or field
  shapes → 400; unknown role id → 404; route reset with a reasoning effort
  → 400; provider/model not in the live catalog → 409; unsupported
  reasoning effort for that route → 409; catalog or resolver unavailable
  → 503 and nothing is written.

## Safe writes

1. The role id must match the entry-name grammar and its path is proven to
   stay inside the agents directory; any symlink/junction segment is
   rejected before and after writing.
2. `expectedMtimeMs` (sent by the panel) is compared against the on-disk
   file; a mismatch returns 409 "role card changed on disk; refresh before
   saving". The check repeats under the file lock (TOCTOU guard), again
   returning 409 on drift.
3. The new frontmatter is rendered and the rewritten card is re-parsed;
   only then is the file written atomically (`writeFileAtomic` from
   `@deepseek-ai/dsh-atomic-write`, mode 0644, directory 0700) while
   holding `withFileLock` on the target.
4. After the write, the file is read back and re-parsed; the response
   carries the fresh card and mtime, which the panel stores as the new
   baseline for the next save.

Frontmatter edits are surgical: a UTF-8 BOM is stripped, the card's
dominant EOL is preserved, YAML comments and unknown keys survive, and the
Markdown body is copied byte-for-byte. A route change clears a stale
`reasoning_effort` unless the same request sets a new one.

## What it does not do

The plugin never writes outside the agents directory and never hardcodes
provider names; unsaved drafts stay local to the panel until Save.
