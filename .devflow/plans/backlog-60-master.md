# Backlog-60 Master Plan — dsh-orchestrator-kit

> **Execution:** this plan is executed pass-by-pass by `run-conductor` under the
> lead, only after a `plan-auditor` `OKAY` verdict on the master plan AND on the
> executable plan of the pass being started. Pass 1's executable plan is
> `.devflow/plans/backlog-60-pass1.md`. Passes 2–5 get their own executable plans
> (planner re-invoked just-in-time) before any implementation starts; the contracts
> frozen here bind those plans.

**Goal:** implement every viable item of the user's 60-item backlog
(`.devflow/notes/backlog-60.md`) as five ordered, individually shippable vertical
slices, rejecting low-value items only with the documented rationale below.

**Architecture:** the plugin is a DSH server module (`index.js`, 4 fetch routes)
plus a web settings panel (`client.js`, React via the host module loader), verified
by one custom test entry point (`scripts/test.mjs`). Every pass changes behavior,
its tests, harness capabilities, affected static-test expectations and docs in the
SAME commit. No horizontal passes.

**Tech Stack:** Node >= 22 (ESM), `yaml` 2.9.x (`parseDocument`/`visit`),
`@deepseek-ai/dsh-atomic-write` (`withFileLock`/`writeFileAtomic`), React via host
seed, `node:vm` test harness, GitHub Actions CI (Node 22/24) + npm trusted publishing.

---

## 1. Context & Objectives

- Public npm package / DSH plugin: an Orchestrator preset plus a Settings panel that
  routes provider/model/reasoning-effort per role card. Repo rules: `AGENTS.md`
  (ownership map, definition of done, zero machine tokens, Conventional Commits).
- Fixed user decisions (not re-openable by workers):
  1. Implement everything viable in ordered passes.
  2. Panel i18n en/pt-BR/zh with a manual switch REPLACES the English-only test
     policy (the pt-BR ban at scripts/test.mjs:1161-1162 is reworked in Pass 2,
     not before).
  3. One commit per pass, created exclusively by executing the `git-commit` skill
     (`~/.agents/skills/git-commit`); NO push.
  4. Low-value items are rejected ONLY with documented rationale (section 6).
- Discovery evidence (read before executing any pass): `.devflow/maps/codemap.md`,
  `.devflow/notes/harness-semantics.md`, `.devflow/notes/backlog-60.md`.
- The insight bundle behind this plan survived a 5-member, 3-round adversarial
  debate plus live probes; its converged decisions are frozen in sections 4–6.
  Workers do not re-derive them; they verify anchors they cite.

## 2. Must Have / Must NOT Have (global, every pass)

Must have:
- Every commit is a shippable VERTICAL slice: implementation + its tests + harness
  capabilities + affected static-test reworks + docs together (AGENTS.md
  definition-of-done; the route-surface test scripts/test.mjs:1101-1107 is a
  same-change update obligation, not a veto).
- Canonical verification green with fresh output read in the same turn:
  `node scripts/test.mjs` → exit 0, final line `ALL TESTS PASSED`.
- Anti-flake gate for behavioral slices: 5 consecutive full-suite runs, all green,
  logs under `.devflow/evidence/backlog-60-pass<N>/`.
- `node --check` on every shipped JS file touched (the suite also asserts this:
  scripts/test.mjs:1166-1171).
- Zero machine tokens in EVERY disk file (the hygiene test scans the whole repo
  including ignored `.devflow/` dirs: scripts/test.mjs:140-152,1846-1860). Plans,
  drafts, evidence logs included. Repo-relative paths only; the skills dir is
  referenced as `~/.agents/skills/<name>`.
- Visibility rule: every change valid for ALL users on all machines; user- or
  machine-specific behavior auto-detected or explicitly configurable, never hardcoded.
- Tests and verification logs versioned WITH the change (same commit); evidence
  under `.devflow/evidence/` (tracked).

Must NOT have:
- No TODO/FIXME deferrals; definitive solution or explicit escalation to the human.
- No server cache of any kind (contract C3 below).
- No orphan-lock auto-recovery (contract C5).
- No `schema:'failsafe'` anywhere (live-proven broken: stringifies booleans on read,
  `doc.toString()` throws on write).
- No new runtime dependencies without justification recorded in the pass plan
  (c8 in Pass 5 is a devDependency — allowed, pack contract asserts specific
  package.json fields, not devDeps absence: scripts/test.mjs:1109-1146).
- No edits to installed role-card copies (`~/.agents/agents/`, `$DSH_AGENTS_HOME`);
  craft sources live in `craft/`.
- No weakening of existing assertions to make a change pass; the token is the bug,
  not the check (AGENTS.md).
- No bare `git commit`; no push; no commit without the `git-commit` skill.
- No absolute user-profile paths, usernames, machine names or vendor tokens in any
  file; never spell the backup-suffix literal (BAK_LITERAL, scripts/test.mjs:135)
  in any file except `.gitignore` — refer to it as "the backup-suffix literal".
- No timing-based test assertions (flaky); concurrency is proven by outcomes and
  structure, never by stopwatch.

## 3. Item disposition matrix (all 60 items)

Legend: P1..P5 = implemented in that pass; DONE = already implemented at HEAD
(re-verified by the suite every pass); REJ = rejected with rationale (section 6);
COND = conditional decision recorded when its trigger fires.

| # | Item (condensed) | Disposition | Where / rationale anchor |
| --- | --- | --- | --- |
| 1 | Compress read responses | REJ | host gzip middleware already active (R-01) |
| 2 | Skip identical save | P1 | C7 no-op contract |
| 3 | mtime index | REJ | C3 no server cache (R-02) |
| 4 | Frontmatter-only reads | REJ | C3 (R-02); bounded parallel reads serve scale instead |
| 5 | Catalog prewarm | REJ | C3 (R-02); prewarm races service registration |
| 6 | npm pack smoke + tarball token scan | P2 | C14: lands in the FIRST commit changing the packed file list (Pass 2 locale files) |
| 7 | Craft bundle consistency | DONE | scripts/test.mjs:1780-1844 |
| 8 | Locale key parity | P2 | C8: parity WITH the first dictionary; English-only half superseded by user decision |
| 9 | Panel DOM tests | P3 | via extended VM harness (linkedom REJ, R-13); grid/badges/filter/arrow-keys already covered at scripts/test.mjs:1181-1652; 503-state coverage completes with Pass 3 error actions |
| 10 | Frontmatter round-trip | DONE | scripts/test.mjs:290-465 |
| 11 | Deterministic catalog stub | DONE | scripts/test.mjs:516-674,676-943 |
| 12 | Concurrency tests | P1 | simultaneous POST + busy lock + stale mtime (TOCTOU already at scripts/test.mjs:767-792) |
| 13 | Coverage thresholds | P5 | C13: NODE_V8_COVERAGE + own-source parser (NO c8 devDependency — R-20); external coverage dirs, 70% statements / 60% functions |
| 14 | docs/glossary.md | P5 | C22; referenced from CONTRIBUTING |
| 15 | Relative-link/anchor CI check | P5 | C14: in-runner (~10 lines), no external URLs, no separate flaky step |
| 16 | scripts/docs-parity.mjs | P5 | C14: named file ships, IMPORTED by test.mjs, runs with the suite |
| 17 | docs/recipes.md | P5 | C22; 3 budget configs, generic examples only |
| 18 | docs/role-card.md | P5 | C22; every frontmatter field + before/after |
| 19 | docs/architecture.md | P5 | C22; atomic-write sequence diagram |
| 20 | docs/troubleshooting.md | P5 | C22; failure table incl. busy lock (C5); Pass 1 carries the lock guidance in the README FAQ meanwhile |
| 21 | docs/api.md | P5 | C22; routes reference, generic curl examples |
| 22 | No injectable HTML | DONE | zero innerHTML/eval at HEAD; markup/quotes fixture tests re-run in EVERY pass adding rendering (C15) |
| 23 | Secret redaction | P1 | C4 |
| 24 | Read-only mode | P4 | C19: env flag server 403 + UI read-only via bootstrap field |
| 25 | Audit trail | P4 | C20: inside-lock best-effort append + events route + panel section |
| 26 | Body limit + unknown fields + rate limit | P1 (cap + allowlist) / REJ (rate limit) | C6; single-user owner-auth panel (R-03) |
| 27 | Strict YAML frontmatter | P1 | C2 |
| 28 | Path confinement + symlink blocking | DONE | index.js:24-93; scripts/test.mjs:825-837 |
| 29 | CSRF protection | REJ | host signed-cookie + owner principal + trust fences (R-04) |
| 30 | Server-Timing + legend | P1 | C9: durations only |
| 31 | POST returns updated role, no re-GET | DONE | index.js:682; client.js:314-320 |
| 32 | Bounded parallel card reads | P1 | C10 |
| 33 | Mount only active-tab cards | DONE | client.js:458,526-531 (filter renders active section) |
| 34 | ETag/304 | REJ | loopback + no-store + no host 304 support (R-05) |
| 35 | Efforts focus-preload | REJ | already prefetched for all active pairs at load (R-06) |
| 36 | Efforts memoize/single-flight | DONE (client) / REJ (server) | client.js:26-28,219-274; server half violates C3 (R-02) |
| 37 | Server catalog TTL cache | REJ | C3 (R-02) |
| 38 | Panel i18n en/pt-BR/zh + manual switch | P2 | C8 |
| 39 | Accessible save confirmation | P3 | aria-live + temporary highlight |
| 40 | Remember tab + prefs | P2 (language override seam) + P3 (tab/legend/density) | C11: module-level + best-effort localStorage, same-session semantics documented |
| 41 | Compact density mode | P3 | one-line-per-role list, same selects + badge |
| 42 | Role description per card | DONE | client.js:362 |
| 43 | Save errors with corrective action | P3 | 409-retry = re-GET then re-apply draft, never stale-mtime resend; lock-timeout gets retry guidance (C5) |
| 44 | Installed-cards diagnostics | P4 | C21: read-only on-demand GET route; restore-from-craft REJ (R-14) |
| 45 | Craft install script | P4 | C18: minimal Node copy, skip-existing, NO backups, withFileLock per card |
| 46 | Unsaved-changes indicator | P3 | C10 draft policy: mtime-keyed hoisting; dirty covers ALL sections; Ctrl+S focused card |
| 47 | Undo last save | P3 | C9 undo: reverse POST of pre-save summary, post-save mtime, 409 = correct conflict |
| 48 | Routing profiles export/import | P4 | C9: TWO-PHASE validate-all dry run before ANY write; version field; refresh-then-apply |
| 49 | Batch apply per phase | P4 | C9: client loop over single-card POST, per-card expectedMtimeMs mandatory |
| 50 | Role search field | P3 | name/description fragment + active tab |
| 51 | Accessible top summary | P3 | aria-live counts updated after each save |
| 52 | Quick status filter | P3 | routed/inherit/disabled combined with tabs |
| 53 | Effective inherited route hint | P3 | one-line catalog.default hint on inherit cards (D4 scope) |
| 54 | Unavailable-model hint | DONE | client.js:385,402,424 |
| 55 | Role sorting selector | P3 | name / routed-first / inherits-first |
| 56 | Per-category counters | P3 | per-tab STATUS breakdown (totals already at client.js:477-480,518) |
| 57 | Session-changed highlight | P3 | discreet seal; session change-log NEVER persisted (C9) |
| 58 | Performance budget in CI | P5 | size budget kept; timing benchmark REJ (R-16); client.js byte assert set AFTER UX surfaces land (C14) |
| 59 | content-visibility grid | P3 | contain-intrinsic-size reserved height |
| 60 | On-demand panel module | P4 COND | C17: decide when the size tripwire fires after Pass 4 surfaces; record either way |

Already-implemented items (7, 10, 11, 22, 28, 31, 33, 36-client, 42, 54) carry no
new work; the suite re-verifies them every pass. Items 22/28 additionally get their
fixture tests re-run in every pass that adds rendering or path handling.

## 4. Slice table (ordered passes)

Each pass = ONE commit via the `git-commit` skill, no push. Each pass starts only
after its own executable plan passes `plan-auditor` `OKAY`.

| Pass | Scope | Items | Frozen contracts | Pass-specific gates |
| --- | --- | --- | --- | --- |
| 1 | Server trust hardening | 2, 12, 23, 26(cap+allowlist), 27, 30, 32 + C5 lock error + C2 GET parse-error surfacing | C1–C10, C15 | security gate (security-auditor on the diff); adversarial workflow with security lens; anti-flake 5x; plan: `.devflow/plans/backlog-60-pass1.md` |
| 2 | i18n seam (atomic big-bang) | 38, 8, 40(language override), 6 | C8, C11, C14 | first dictionary + VM-harness t/locale stubs + static-test reworks (SAVE_NOTICE literal 1156, pt-BR ban 1161-1162 → locale-key parity + STRUCTURAL t-usage gate) + pack assertion/tarball token scan ALL in this one commit; one documented live-host smoke (browser-qa, evidence logged); anti-flake 5x |
| 3 | Save-safety & UX | 9(503-state), 39, 40(prefs), 41, 43, 46, 47, 50, 51, 52, 53, 55, 56, 57, 59 + D3 remount catalog-cache skip | C9(undo), C10(drafts), C11, C15 | XSS fixture tests re-run (new rendering); live-host smoke; anti-flake 5x |
| 4 | Multi-card & admin surfaces | 49, 48, 25, 44, 45, 24 + 60 conditional | C9(batch/import), C17, C18, C19, C20, C21 | security gate (new write surfaces + readonly + audit); concurrency tests for audit+card window and installer races; live-host smoke; size tripwire evaluated → chunking decision recorded; anti-flake 5x |
| 5 | Test-infra, docs & CI | 13, 58, 14–21 + READMEs trilingual final + CHANGELOG consolidation + CONTRIBUTING glossary link | C13, C14, C22 | own-source coverage thresholds (70% statements / 60% functions) + CI step mirrored into publish.yml SAME commit; docs-parity.mjs + relative-link check imported by test.mjs; client.js byte-size assert set; anti-flake 5x |

Sequencing rationale: Pass 1 hardens the trust boundary everything else writes
through, independent of UI. Pass 2 lands the i18n seam BEFORE the UI-heavy passes so
every new surface ships translated from birth (retrofitting strings across Passes
3–4 would double the work and break the parity gate). Pass 3 builds save-safety and
UX on the hardened server + translated seam. Pass 4 composes multi-card flows from
Pass 3's single-card safety primitives. Pass 5 closes infra/docs once the shipped
file list and UI surfaces are stable (coverage thresholds and size budgets measured
against the final shape).

Just-in-time planning rule: before Passes 2, 3, 4, 5 start, the lead re-invokes
planner with this master + the then-current repo state to produce
`.devflow/plans/backlog-60-pass<N>.md` (same structure as Pass 1's plan), then
plan-auditor gates it. Contracts in section 5 are frozen inputs to those plans;
changing one requires a recorded rationale + lead approval (and a user gate when a
user-named capability is affected).

## 5. Cross-pass contract register (frozen)

C1 — Vertical slices. Implementation + tests + harness + affected static tests +
docs in one commit. Every new shipped file updates, in the SAME commit: the files
deepEqual (scripts/test.mjs:1127-1139), the node --check array (1167) and the
LF/BOM array (1174). Module extraction only when a second real consumer survives,
in its OWN commit; helpers stay in index.js with re-exports if extracted (the
route-surface test regex-scans index.js SOURCE). No preemptive audit.js/cards.js.

C2 — Strict YAML (Pass 1). Rejection-only via `visit()` under the DEFAULT core
schema: reject nodes with `node.anchor`, Alias nodes, or explicit `node.tag`.
`hasAnchor` is NOT a public yaml export; `schema:'failsafe'` is banned (live-proven
broken). Byte cap before parse; `toJS({maxAliasCount:0})` as alias defense.
`parseFrontmatterDocument` (index.js:108) is shared by GET listing, POST pre-check,
applyCardSettings and post-write validation — strictness is an EXPLICIT parse-mode
parameter, never a global change. POST write gate strict; GET lenient BUT surfaces
per-card parse errors in the `.roles` payload (`invalid` array) instead of silent
skip. Exact signatures/messages: Pass 1 plan section 3.

C3 — No server cache. No TTL, prewarm, read-through snapshot or server
single-flight. Rationale: fail-closed POST gate staleness (index.js:576-584),
degraded catalog is HTTP 200 ok:true (442-449), external writers exist, no llm
change event, prewarm races service registration (`inject:['connection']`,
index.js:8). The client already caches (client.js:26-28). The ONLY sanctioned
cache refinement is Pass 3's client remount policy (D3): skip catalog refetch when
a fresh module-level cache exists, keep roles refetch.

C4 — Redaction (Pass 1). Secrets (API keys/tokens/authorization headers/credential
URLs) AND user-home paths become markers in logs AND HTTP error bodies; error
class/code and actionable context survive. Success payloads are not redacted.
Redaction and concurrent-POST tests are designed together. Exact patterns/markers:
Pass 1 plan section 3.

C5 — Orphan lock (Pass 1 error; policy forever). `withFileLock` is a cross-process
lockfile with a 2s deadline and NO stale recovery by design
(node_modules/@deepseek-ai/dsh-atomic-write/lib/index.js:57-95). NEVER auto-recover.
Lock-timeout maps to a distinct actionable error: HTTP 503, `code:'lock-timeout'`,
relative lockfile name + retry hint + operator-removal documentation. The
troubleshooting row (item 20) carries the same guidance; Pass 1 ships it in the
README FAQ, Pass 5 moves it into docs/troubleshooting.md.

C6 — Request limits (Pass 1). Host body cap is 300MiB default; the plugin enforces
65536 bytes on POST `.route`, aborting before disk reads, and rejects unknown POST
fields (allowlist: id, provider, model, disabled, reasoningEffort, expectedMtimeMs).
The rate-limit/429 half of item 26 is rejected (R-03).

C7 — No-op save (Pass 1). Stale expectedMtimeMs → 409 BEFORE the identity check.
When the rendered next text === current text: respond ok with the role summary +
`unchanged:true`, no lock acquired, no write. Client success path handles the flag
(distinct notice). Exact shape: Pass 1 plan section 3.

C8 — i18n seam (Pass 2, atomic). Stable phase ids (`discovery`, `planning`,
`verification`, `other`) + key/label split BEFORE translation (English titles are
structural keys today: PHASE_TONE client.js:19-24, tab ids 453-458, groupRoles
121-141). FIRST i18n commit carries ALL of: dictionary registration via
`ctx.locale.register` (inject `'locale'`), VM-harness ctx.locale/t stubs + relaxed
react-only require (scripts/test.mjs:1224), SAVE_NOTICE literal rework (1156),
pt-BR ban rework (1161-1162) → replaced by locale-key parity + a STRUCTURAL t-usage
gate (every UI string through t; NOT a regex literal scan — blacklist patterns
false-positive on structural constants client.js:7-17). Host synthesizes `t` from
`locale:NS` (already declared client.js:543). Manual override: module-level +
best-effort localStorage; harness language (`ctx.locale`) is the default source of
truth. One documented live-host smoke check per i18n-affecting pass (browser-qa,
evidence logged). Locale files: `locale/en.json`, `locale/pt-BR.json`,
`locale/zh.json` gain panel dictionaries alongside the existing meta keys; the
host reads only meta.* from them (harness-semantics Q3) — panel dictionaries are
consumed by the client registration, not the host.

C9 — Multi-card flows (Passes 3–4). Batch/import/undo = client loops over the
existing single-card POST. Per-card expectedMtimeMs MANDATORY (index.js:629 opt-in
design); alive/mountToken guard around the loop; per-card result reporting;
continue-and-report on 409; cancel affordance; abort-on-first-503 (lock-timeout is
a 503 → aborts, correct). NEVER "atomic" framing. Profile import TWO-PHASE:
validate-all dry run before ANY write (item 48 verbatim); strip mtimeMs +
refresh-then-apply (never silent last-writer-wins); `version` field (public format
contract). Undo = reverse POST of the pre-save summary (client holds role+base at
save time, client.js:288-319) with post-save mtime; module-level snapshot map keyed
by id+baseMtime; undo 409 = correct conflict detection with a clear message.
Session change-log NEVER persisted. Server batch/profile routes rejected (R-08,
R-09).

C10 — Draft policy (Pass 3). EXACTLY ONE policy, tested: mtime-keyed hoisting —
`{baseMtimeMs, draft}` kept on remount ONLY when the server mtime matches, else
discarded. Dirty indicator covers ALL sections (default 'all' tab renders all
cards, client.js:156,458,526-531). 409-retry action = re-GET then re-apply draft,
never a stale-mtime resend.

C11 — Prefs (Passes 2–3). Module-level page-scoped state + best-effort localStorage
satisfies "restore on reopen" (same-session) regardless of Desktop port churn
(`--port 0` hardcoded; cross-restart churn is code-reading inference — documented
as same-session semantics, no durability claim beyond evidence). NO prefs file in
the agents root (domain pollution + orphan-lock inheritance + containment guards
scoped to agents/ only). NO configForms plumbing for cosmetics.

C12 — Shipped-file discipline. See C1. Additionally: installer source cannot spell
the backup-suffix literal (repo-wide content ban, scripts/test.mjs:1853-1854 — use
literal-splitting like the test itself if the concept must be named). Hygiene scan
is REPO-ONLY; runtime files under DSH_AGENTS_HOME are never scanned; the tmp-home
test pattern exists (scripts/test.mjs:476,941: DSH_AGENTS_HOME override + rmSync).

C13 — Coverage (Pass 5). NODE_V8_COVERAGE is runner-agnostic (live-proven);
built-in summary/thresholds are node:test-only → c8 devDependency for
report+thresholds over index.js+client.js. CI step mirrored into publish.yml in the
SAME commit. Runner migration rejected (R-15).

C14 — Tripwires. client.js byte-size assert in-runner, set AFTER UX surfaces land
(Pass 5, measured against the then-current size with headroom, adjustable only by
explicit commit). README structural parity via `scripts/docs-parity.mjs` IMPORTED
by test.mjs (named file ships, runs with the suite, no separate CI step). Parity
compares STRUCTURE — heading level sequence, table shape/row counts, fenced-block
counts — never translated prose: heading text and mermaid labels legitimately
differ across languages (verified at HEAD: levels/fences/rows identical, text
translated). The exact comparison semantics freeze in the Pass 5 plan; until then,
passes touching READMEs run the structural self-check from the Pass 1 plan (T4).
Relative-only link/anchor check in-runner (~10 lines, no external URLs, no flake).
Locale parity WITH the first dictionary (Pass 2). Exact npm-pack assertion +
tarball token scan lands in the FIRST commit changing the packed file list (Pass 2
locale files).

C15 — XSS baseline. Zero innerHTML/eval at HEAD; injectable-HTML tests with
markup/quotes strings (item 22) re-run in EVERY pass adding rendering.

C16 — Module extraction. See C1 (second real consumer, own commit, arrays updated,
handlers stay in index.js).

C17 — Chunking (item 60, conditional). Mechanism-after-decision: trigger = the size
tripwire fires when a surviving new surface is proposed (evaluated at end of Pass
4) → ONE `require.async('client.<name>.js')` chunk (self-registering protocol,
filesystem sibling of client.js; native import() NOT supported — harness-semantics
Q2). ALL client.js-only scanners extended to siblings in the SAME slice;
missing-chunk error fallback designed (explicit error + retry) or the chunk does
not ship. Decision recorded either way in the Pass 4 evidence.

C18 — Installer (Pass 4, item 45). Survives the visibility rule (deleting it leaves
no supported craft/ → DSH_AGENTS_HOME path). Minimal Node copy script under
`scripts/`, skip-existing default, NO backups (backup-suffix literal banned),
imports existing exported helpers (index.js:687) + withFileLock per card,
actionable CLI lock errors (C5), tmp-home tests.

C19 — Readonly (Pass 4, item 24 verbatim). SERVER enforcement: env flag
`DSH_ORCHESTRATOR_READONLY=1` → POST 403 + UI read-only mode with disabled controls
+ notice. Env-var route avoids the bundle-config test conflict (cordis.patch.yml:4
`config:{}` + scripts/test.mjs:955). Server→client channel mandatory (client injects
only ['slots'], client.js:536): a bootstrap field on the GET `.roles` response
envelope (e.g. `readOnly:true`), NOT smeared into card data. Client-only toggle does
NOT satisfy the named request.

C20 — Audit trail (Pass 4, item 25). Append-only file beside cards (agents dir);
append INSIDE the same withFileLock critical section AFTER the successful card
write; best-effort (audit failure logged, NEVER rolls back the card write —
semantics documented). Records: timestamp, role id, previous/new route summary,
origin marker; NEVER secrets, NEVER absolute paths (relative only). Inherits the
2s/orphan-lock policy (C5 error applies). Growth documented (append-only, no
rotation). GET events route + panel collapsible recent-events section. The session
change-log (C9) is the client-side complement, not a replacement. Exact filename
and record schema freeze in the Pass 4 plan.

C21 — Diagnostics (Pass 4, item 44). Dedicated READ-ONLY GET route, computed ON
DEMAND (never hot-path): missing roles (craft/ 20 vs installed), invalid
frontmatter, saved routes outside the live catalog, body-only drift vs craft/
sources (frontmatter legitimately diverges — mirror rule scripts/test.mjs:262).
craft/ resolved fs-relative to index.js (shipped via the files whitelist; the
exports map does NOT expose craft/; zero import.meta/craft references today — new
code). Degrade gracefully when craft/ is missing (null/unknown, never 500). Panel
section. NO restore-from-craft write action (R-14).

C22 — Docs. User-named docs/ files ALL ship (glossary 14, recipes 17, role-card 18,
architecture 19, troubleshooting 20, api 21). READMEs carry user-facing sections;
trilingual structural parity enforced by the C14 tripwire from Pass 5 (manual
parity self-check in every earlier pass that touches READMEs). Glossary referenced
from CONTRIBUTING. CHANGELOG under [Unreleased]. Zero machine tokens; generic
examples only (no invented credentials/models).

D3 — Client remount catalog-cache policy (Pass 3): client.js:159-163 re-fires
roles+catalog every remount despite catalogCache; cold catalog costs up to
10s/provider. Skip catalog refetch when a fresh cache exists, keep roles refetch.
The one perf candidate with a named latency path; everything else perf-shaped was
rejected (section 6).

D4 — Scope corrections: item 56 = per-tab STATUS breakdown (totals already exist);
item 53 = one-line effective-route hint (catalog.default) on inherit cards; items
42/54 already done.

D5 — Server-Timing (30) + bounded parallel reads (32) implement in Pass 1 (cheap,
user-named, no correctness hazard; parallel reads serve arbitrary card counts;
Server-Timing values = durations only, no user data/paths).

## 6. Rejection register (documented rationale — the ONLY sanctioned rejections)

Means-level rejections (capability preserved elsewhere or host-provided). Any
worker proposing to re-add one of these must first overturn the cited evidence.

| ID | Rejected mechanism (item) | Rationale |
| --- | --- | --- |
| R-01 | Plugin-level compression (1) | Host gzip middleware already compresses (threshold 1024, level 1) and strips/rewrites conflicting headers; a second compression layer is redundant and conflicts (harness-semantics Q1d). |
| R-02 | Server caches: mtime index (3), frontmatter-only reads (4), prewarm (5), TTL (37), server single-flight (36-server) | C3: fail-closed POST gate would validate against stale data; degraded catalog is a valid 200 state; external writers exist; no llm change event; prewarm races service registration. Invalidation complexity exceeds gain for small files; arbitrary-card-count scale is served by bounded parallel reads (32). Client already caches. |
| R-03 | Rate-limit 429 half of item 26 | Single-user owner-auth panel behind host signed-cookie + trust fences; no multi-tenant threat model; adds state and failure modes for no named user value. Cap + allowlist (the other halves) DO ship. |
| R-04 | Plugin CSRF token (29) | Host enforces HMAC-signed SameSite=Strict cookies, owner principal on exact routes, Host/Origin/Sec-Fetch-Site fences on every request (harness-semantics Q1a/b). A plugin token would be redundant theater. |
| R-05 | ETag/If-None-Match/304 (34) | Loopback + no-store responses; host does not handle conditional requests for plugin routes; gzip makes strong ETags byte-inaccurate (harness-semantics Q1d). |
| R-06 | Efforts focus/hover preload (35) | Efforts for ALL active routed pairs are already prefetched at load (client.js:219-274); focus-preload adds requests without removing any wait. |
| R-07 | Pass-0 global contract freeze | HTTP contract is already test-frozen (route surface + payload assertions); the locale schema freezes in the first i18n commit where it is exercised. A separate freeze pass would be a horizontal slice (illegal under C1). |
| R-08 | Server batch route | Object-only body guard (index.js:492) + exact-4 route contract; no all-or-nothing requirement exists; a client loop over the single-card POST preserves per-card conflict detection for free (C9). |
| R-09 | Server profile-validation route | Two-phase client dry run over existing GET/POST achieves validate-all-before-any-write without a new route (C9). |
| R-10 | Client store rewrite | mountToken/alive guards work and are tested (scripts/test.mjs:1575-1592); keep the pattern, hoist only mtime-keyed drafts (C10). |
| R-11 | Prefs file in agents root | Domain pollution (agents dir is role-card domain), inherits orphan-lock semantics, containment guards are scoped to agents/ only (C11). |
| R-12 | Regex literal scan for i18n completeness | Blacklist patterns false-positive on structural constants (client.js:7-17); replaced by the structural t-usage gate (C8). |
| R-13 | linkedom for DOM tests (9 means) | The existing VM harness already renders and asserts the tree; extending it (~15 lines) avoids a new devDependency and a second rendering model. Item 9's capability ships via the harness. |
| R-14 | Restore-from-craft write action (44 extension) | Destructive overwrite of user-edited cards; not user-named; diagnostics stay read-only (C21). |
| R-15 | Coverage runner migration (13 means) | NODE_V8_COVERAGE is runner-agnostic (live-proven: 37 entries from a plain script); c8 devDep provides report+thresholds without migrating the custom runner (C13). |
| R-16 | CI timing benchmark (58 half) | Stopwatch assertions on shared CI runners are flaky; the size-budget half of item 58 ships instead. |
| R-17 | `schema:'failsafe'` for strict YAML | Live-proven: stringifies booleans on read AND `doc.toString()` throws "Tag not resolved for Boolean value" on write — breaks the round-trip writer. Rejection-only visit() under the core schema instead (C2). |
| R-18 | Orphan-lock auto-recovery | File age cannot prove the owner stopped; auto-removal breaks the cross-process protocol for other DSH writers (library doc: "orphan recovery is an operator action"). Actionable error instead (C5). |
| R-19 | "Atomic" batch/import framing | Per-card conflict detection is the design; all-or-nothing across 20 files is not achievable with the lock protocol and not user-named (C9). |
| R-20 | `c8` devDependency for the coverage gate (13) | A dependency only to read JSON the runtime already emits. `NODE_V8_COVERAGE` is runner-agnostic (R-15) and the entries carry per-range counts, so the suite aggregates them itself: zero new dependencies, machine-independent denominator (own sources only), and the gate stays inside the custom runner instead of adding a second reporter (C13). |

Host-provided items: 1 (R-01), 29 (R-04). User-named capabilities are never
silently deleted: every rejection above either preserves the capability in a
cheaper defensible form or cites the host layer that already provides it.

## 7. Dependency graph & parallel-wave rules

```
plan-auditor OKAY (master + pass1)
        │
        ▼
Pass 1 (server trust) ──► Pass 2 (i18n seam) ──► Pass 3 (UX/save-safety) ──► Pass 4 (multi-card/admin) ──► Pass 5 (infra/docs/CI)
        │                        │                        │                          │
        │                        │                        │                          └─ size tripwire → chunking decision (60) recorded
        │                        │                        └─ undo/draft primitives consumed by Pass 4 loops
        │                        └─ dictionaries + t-gate consumed by every later UI string
        └─ strict gate/redaction/limits/lock error consumed by every later write path
```

Within each pass: 100% disjoint write scopes per parallel task; at most 4 lanes;
tests may be a separate task but ride the SAME commit; suite runs happen at wave
boundaries (single owner), never while another lane is mid-edit on a file the suite
imports or scans. The lead/run-conductor reviews the final consolidated diff.
Pass 1's concrete wave layout: `.devflow/plans/backlog-60-pass1.md` section 5.

## 8. Gate sequence (every pass, in order)

1. Executable pass plan exists; `plan-auditor` verdict `OKAY` (REJECT → planner
   revises; no execution before OKAY).
2. Execution per the pass plan's waves (disjoint scopes, frozen contracts).
3. Integration: `node scripts/test.mjs` exit 0, `ALL TESTS PASSED`, fresh output
   read in-turn; `node --check` on touched shipped JS.
4. TEST VERIFICATION GATE: existing suites discovered and run; missing behavior
   covered by NEW tests written via the matching test skill (test-writer); tests
   fail the known failure modes, not merely pass; re-run until green; results
   logged under `.devflow/evidence/backlog-60-pass<N>/` and versioned in the commit.
5. Anti-flake: 5 consecutive full-suite runs green (behavioral slices); logs kept.
6. Adversarial verification workflow (code-touching passes) with the task-type lens
   set; security lens added on Passes 1 and 4 regardless of type, third verifier
   for security findings; confirmed findings become the fix list.
7. Review loop: diff-reviewer scores the work product 1-10; fix Critical/Important;
   minimum 2 loops, maximum 4, quality gate >= 8/10 (single-pass clean-exit circuit
   breaker per dev-flow). Re-run steps 3–5 after fixes.
8. Security gate on Passes 1 and 4: security-auditor focused diff review (trust
   boundary, redaction completeness, strict-gate bypasses, limits, lock protocol,
   readonly enforcement, audit integrity).
9. Live-host smoke on i18n-affecting passes (2, 3, 4): browser-qa against the real
   panel, one documented check per pass, evidence logged (screenshots/notes
   token-clean).
10. Docs reconciliation: READMEs trilingual parity (manual self-check until the
    Pass 5 tripwire), CHANGELOG [Unreleased], affected docs/ files; docs-sync or
    tech-writer when behavior/setup/public interfaces changed.
11. Delivery: ONE commit via the `git-commit` skill (it owns diff analysis, comment
    sweep, whitespace, formatter/lint/tests, staging, Conventional Commits message).
    NO push. Update `.devflow/runs/backlog-60/progress.md` (token-clean).
12. Consolidated report to the human: what shipped, verification commands + results,
    remaining risks, decisions only the human can make.

## 9. Risk register (bundle-converged mitigations)

| ID | Risk | Mitigation (contract) |
| --- | --- | --- |
| R1 | Strict-mode leakage across the shared parser | explicit mode param + GET-lenient/POST-strict/post-write-consistency tests (C2; Pass 1 N1–N3) |
| R2 | Redaction over-strips diagnostics | markers preserve error class/code; tests assert no-leak AND actionable message (C4; Pass 1 N4/N5) |
| R3 | i18n first-commit big-bang | single atomic commit; VM mounts pass before string extraction completes; live smoke same pass (C8) |
| R4 | Audit append extends the lock critical section | best-effort, logged failure, never rollback; 2s deadline inherited; concurrency tests cover the window (C20/C5) |
| R5 | Chunk gate-free zone | all scanners extended to siblings same slice + missing-chunk fallback (C17) |
| R6 | Profile import partial application cross-machine | two-phase dry run + per-card report + refresh-then-apply (C9) |
| R7 | Draft hoisting stale-mtime 409 loop | mtime-keyed retention discards on mismatch; remount-discard + undo-after-external-edit tests (C10) |
| R8 | Installer races panel saves | withFileLock per card + actionable CLI errors + tmp-home tests (C18/C12) |
| R9 | CI gate drift ci.yml ↔ publish.yml | every new CI step mirrored same commit (C13/C14) |
| R10 | Desktop port-churn inference | prefs documented as same-session; no durability claim beyond evidence (C11) |

## 10. Evidence & token rules (binding for every artifact)

- Evidence root: `.devflow/evidence/backlog-60-pass<N>/` (tracked). Per pass:
  `test-run-1.log` … `test-run-5.log` (green runs only — failure stack traces carry
  absolute tmp paths), `node-check.log`, `verification.md` (commands, exit codes,
  new-test list, red→green transition, review scores, smoke notes).
- Every artifact token-clean: no usernames, no user-profile paths (Windows or
  POSIX), no machine names, no vendor tokens, no backup-suffix literal, no old
  plugin identity. Test fixtures that need such shapes build them via split-literal
  joins at runtime (pattern: scripts/test.mjs:116-138) — never as contiguous text
  on disk.
- Plans/drafts use repo-relative paths; the skills dir is `~/.agents/skills/<name>`.
- The hygiene test scans ALL disk files including ignored `.devflow/` subdirs —
  scratch and logs are not exempt.

## 11. Open decisions (human gates, when reached)

- Chunking (60): decided at end of Pass 4 against the size tripwire; recorded either
  way. No user gate needed unless the tripwire fires AND the chunk design would
  change a user-named behavior.
- SECURITY.md contact placeholder: maintainer-owned field, unchanged by this backlog.
- Any proposal to overturn a section 6 rejection or a section 5 contract goes to the
  lead → user gate with the cited evidence; workers never decide it silently.