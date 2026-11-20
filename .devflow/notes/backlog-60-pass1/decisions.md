# Run decisions — backlog-60-pass1 (run-conductor)

## Wave plan (per approved plan section 4/5; plan-auditor verdict OKAY)

- Step 0 (solo): T3 tests-first → RED gate: exactly 10 FAIL (N1–N7, N9, N10, N12) / 41 ok.
- Wave 1 (parallel, disjoint): T1={index.js} | T2={client.js} | T4={README.md,
  README.pt-BR.md, README.zh-CN.md, CHANGELOG.md, SECURITY.md}. No suite runs mid-wave.
- Reconciliation after Wave 1: conductor reads every touched file, cross-checks frozen
  contracts (plan section 3), zero scope bleed, then gates.
- Wave 2 (solo): I1 integration → GREEN 51 ok; I2 anti-flake 5× + evidence under
  .devflow/evidence/backlog-60-pass1/ (green logs only).
- Stop after I2 + completion packet. Lead owns adversarial workflow, review loop,
  security gate, git-commit. No commit/push/review-corps from this run.

## Frozen-contract authority

- The plan file `.devflow/plans/backlog-60-pass1.md` is read-only for this run; live
  discoveries go to these notes. A worker finding a contract defect STOPS and reports;
  never silently deviates. Contract changes require lead escalation with rationale.
- Master register bindings: C1 vertical slice, C2 strict parse modes, C3 no server cache,
  C4 redaction, C5 no orphan-lock auto-recovery, C6 cap+allowlist, C7 no-op ordering,
  C9/D5 Server-Timing durations only, C10 bounded reads (8), C15 XSS baseline.

## Dispatch decisions

- subagent_role is unavailable in this session: specialists are dispatched via subagent
  with the installed dev-flow role-card body passed verbatim as prompt prefix (chat-only;
  the installed-cards path is never written into any repo file).
- T3 → test-writer; T1/T2 → implementer (two separate lanes); T4 → tech-writer;
  I1 fixes (if any) → debugger or implementer under conductor reconciliation; I2 → conductor.
- Auditor notes 1–3 (see learnings.md) are folded into the T1/T3 briefs explicitly.

## Step 0 outcome (conductor-verified)

- T3 red gate VERIFIED FIRSTHAND: node --check exit 0; suite exit 1, 41 ok / 10 FAIL,
  final line `10 TEST(S) FAILED`; the 10 FAIL labels equal the frozen set (N1–N7, N9,
  N10, N12) exactly; guards N8/N11 green. Scope: scripts/test.mjs only (+737/−132).
- T3 code audit: hoist is a pure move (source const at line 38; harness at module scope
  before the big VM test); exactly one existing-assertion addition (failsafe absence,
  line 1703); N7 fixture uses canonical snake_case `reasoning_effort: high`; N10 uses
  routes + raw Request; N12 owns its handler/fixture. All 12 tests contract-faithful.

## Conductor decisions (recorded rationale)

- D-1: N6 content-length PRE-CHECK branch coverage. T3 discovery: Node 26 string-body
  Requests expose no content-length, so the post-read cap branch is the one exercised.
  The plan allows "add more, never fewer": T3 steered to append ONE header-driven 413
  case to N6 (raw Request if the manual header survives undici, else a request-like
  stub with real Headers + read counter proving short-circuit before body read).
  Frozen red label set unchanged (N6 already fails at HEAD on its first assertion).
- D-2: index.js:676 post-write parse mode. Plan 3.2 lists 616 explicitly strict and
  section 1 classifies BOTH 616 and 676 as post-write validation; master C2 freezes
  "POST write gate strict". Decision: 676 parses `{ strict: true }` too. Behaviorally
  identical for all reachable inputs (applyCardSettings already parses strict, so the
  written text cannot carry anchors/aliases/tags), and it keeps the write path
  uniformly strict. T1 brief states this explicitly.
- D-3: T3's N8 fixture starts at unlisted `flash-start` with baseline mtime pinned 60s
  in the past (state setup, not a timing assertion): both racers are real changes, so
  the no-op branch cannot short-circuit the race into [200,200]. Accepted as frozen.

## I1 contract-defect amendment (LEAD-APPROVED)

- D-4 (lead decision, recorded rationale = problems.md P-1 + lead message): the frozen
  no-op block (plan 3.6 / master C7) breaks the protected HEAD TOCTOU test — a true
  no-op POST answers 200 unchanged without the lock, so an external edit landing
  DURING the validation window escapes the in-lock mtime re-check (I1 run 1:
  50 ok / 1 FAIL at scripts/test.mjs:781). Lead judgment: C7's user-named behavior is
  preserved exactly; the amendment only restores correct conflict detection within
  the contract's intent; no user gate needed; residual stat→response race acceptable
  because no write occurs (no lost-update hazard; response reports read-time state).
  APPROVED SCOPE (strict): (1) ~10-line amendment in the no-op branch ONLY — re-stat
  via lstatNoSymlink immediately before answering unchanged (after catalog/effort
  validation, covering the whole window); freshInfo.mtimeMs !== info.mtimeMs → 409
  'role card changed on disk; refresh before saving'; re-stat error mapping mirrors
  the existing read block (ENOENT→404, statusCode 400→400, else redacted warn+500);
  still NO lock, NO write; unchanged response keeps read-time mtime. (2) ONE new
  lead-added regression test N13, exact label
  `no-op save detects an external edit during the validation window` (test-writer,
  scripts/test.mjs only): true no-op POST + hook inside resolveModelInfo bumping the
  card mtime mid-validation → 409 AND external edit preserved on disk AND no lock
  file created. (3) Green arithmetic 51 → 52 ok (12+1 new tests) — count deviation
  from plan 3.8 is lead-approved; the plan file stays read-only. (4) N13 red state
  captured against the PRE-amendment no-op branch before the fix lands (conductor
  sequencing: N13 first, red capture, then the fix — keeps suite runs at wave
  boundaries). verification.md carries the amendment trail.
- Execution note: lanes reused (t3-test-writer for N13, t1-server-implementer for the
  amendment) — both retain full file context; disjoint write scopes; sequential
  dispatch so the N13 red run sees the pre-amendment index.js.

## Final state (I1 + I2 complete)

- N13 red verified firsthand: exit 1, 50 ok / 2 FAIL (HEAD TOCTOU + N13), 2×.
- Amendment reconciled: index.js:698-717, +17 lines confined to the no-op block
  (+192/−83 total); all file-scoped gates re-run green (25/25 warns treated).
- I1 final: exit 0, 52 ok / 0 FAIL, ALL TESTS PASSED; node --check ×3 exit 0.
- I2: green runs 5/5; each log 52 ok + ALL TESTS PASSED; 0 FAIL lines / 0 tmp
  markers in logs; node-check.log three exit 0 lines; verification.md written with
  the amendment trail and lead placeholders; 16-file token scan (docs + evidence +
  notes) exit 0.
- Final working diff: 9 files, +1071/−223 (incl. the PRE-EXISTING .gitignore −1;
  this run's lanes: 8 files, +1071/−222). No commit/push/review-corps (lead-owned).
## D-5 — Lead-approved redaction amendment (post-workflow + security gate)

Workflow: 39 agents, 14 raw findings -> 5 confirmed (contracts-1, tests-1,
docs-1, docs-2, docs-3), 9 refuted, 1 critic gap (no-op FAQ catalog clause).
Security gate: PASS WITH FINDINGS (8 LOW). Lead firsthand probes override two
refuted votes with concrete evidence (trust model: cards are UNTRUSTED same-user
input; a crafted card stalls the shared host):
- ReDoS CONFIRMED: redactText('a://'+':'.repeat(60000)) = 6919ms blocking
  (perf-maintain-1, refuted by scope vote — overridden by lead probe).
- JSON-form key leak CONFIRMED: {"api_key":"..."} passes unchanged (security-1).
- @-in-password URL tail leak CONFIRMED (security-4 / gate item 1).
- Quoted multi-word secret partial leak CONFIRMED (tests-3 / gate item 2).
- AIza query-key leak CONFIRMED (security-2).
Amendment scope (frozen plan 3.3 regexes are lead-amended, recorded here):
F1 credential-URL pattern -> single greedy class [^\s/'"]*@ (linear, last-@);
F2 key-assignment patterns accept optional quote AFTER keyword + quoted-value
alternatives ("[^"]*"|'[^']*'|unquoted) preserving closing quotes;
F3 token shapes += AIza[A-Za-z0-9_-]{20,};
F4 lock-timeout 503 body wrapped in redactText (env-mutation edge, gate item 7);
F5 tests: N14 redaction shapes, N15 multibyte+exact-boundary caps, N16 CRLF
no-op + depth boundary pins;
F6 docs: Server-Timing claim qualified (contracts-1/docs-2), strict-gate
visibility split corrected (docs-1), SECURITY exemption scoped to data fields
+ "known secret shapes" (docs-3 + gate item 3), no-op FAQ catalog clause
scoped to route saves (critic gap) — all trilingual + CHANGELOG.
Deferred (recorded, non-blocking): GET symlink channel consistency (gate 5),
whole-file stat-size pre-guard (gate 6/security-3 — same-user limitation),
requester-echo consistency (gate 8), YAML excerpt first-line-only (gate 4).

## D-6 — Lead-approved authorization redaction + delivery hygiene (review round 1)

Review loop round 1: diff-reviewer Score 7/10, CHANGES REQUESTED — 1 IMPORTANT
(authorization pattern misses JSON-quoted and quoted-multi-word forms, the same
class D-5 F2 fixed for assignment keywords; demonstrated probes: JSON Basic
credential unchanged, quoted multi-word unchanged), 3 MINOR (evidence references
gitignored notes; C15 markup fixture absent; delta2 amendment unrecorded).
Lead fixes (full context held, deepwork lead-remediation):
F1 index.js: AUTH_PREFIX shared source (optional quote after keyword, bearer/
   basic non-capturing) + three patterns: quoted-double/quoted-single with
   disjoint escape alternatives, then unquoted fallback consuming RFC 6750
   token words plus space-separated continuation words; continuation words
   cannot start a POSIX path (charset excludes separators) or a Windows drive
   (lookahead), preserving the path clause in error prose for the home markers
   (final design after two rejected iterations — see verification-delta3.md).
F2 N14 extended: JSON Basic/Bearer, quoted multi-word, unquoted multi-word,
   idempotence; frozen SYNTHETIC_AUTH_HEADER expectation byte-exact.
F3 N17 added (C15/item-22 obligation): VM fixture renders markup/quotes in role
   name/description, invalid id/error, catalog + effort names as literal text
   children; asserts zero dangerouslySetInnerHTML/innerHTML props. Suite 55→56.
F4 MINOR-1: notes/ un-ignored in .devflow/.gitignore (trail ships with evidence;
   hygiene already scans and passes it); root .ignore deleted (redundant now
   that .devflow is tracked; nested ignore covers transient dirs).
F5 MINOR-3: this entry records the delta2 amendment trail retroactively:
   bounded scheme {0,31} + escape alternatives + N14 dot-run/escaped/compound
   pins were lead edits under the security-gate BLOCK (verification-delta2.md);
   security-auditor closing verdict PASS (attack replay 4079ms→99.4ms).
