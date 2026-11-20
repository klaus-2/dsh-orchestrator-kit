# Verification — backlog-60-pass1 (Server Trust Hardening)

Date: 2026-11-19. Owner: run-conductor (execution); lead owns the final gates
(adversarial verification workflow, diff-reviewer review loop, security-auditor
gate, delivery via the git-commit skill at ~/.agents/skills/git-commit).

Plan: `.devflow/plans/backlog-60-pass1.md` (plan-auditor verdict OKAY; plan file
read-only during execution). Master contracts: `.devflow/plans/backlog-60-master.md`
sections 2, 5, 6, 10. Run notes: `.devflow/notes/backlog-60-pass1/` (learnings,
decisions D-1..D-4, issues I-1..I-4, problems P-1).

## Canonical commands

- Full suite: `node scripts/test.mjs` → exit 0, final line `ALL TESTS PASSED`.
- Syntax: `node --check index.js`, `node --check client.js`,
  `node --check scripts/test.mjs` → all exit 0 (see node-check.log).
- Anti-flake: 5 consecutive full-suite runs, logs test-run-1.log … test-run-5.log
  (green runs only; failure output carries absolute tmp paths and is never saved).

## Red → green transition

1. HEAD baseline (before any edit): 39 ok / 0 FAIL, exit 0.
2. T3 tests-first (12 frozen tests, plan 3.8): RED gate exit 1, 41 ok / 10 FAIL,
   final line `10 TEST(S) FAILED`, deterministic across two conductor-verified runs.
   The 10 frozen FAIL labels:
   - strict frontmatter: parseRoleCard strict mode rejects anchors, aliases, explicit tags, deep nesting and oversized blocks; lenient mode unchanged
   - HTTP API: GET .roles surfaces parse-failed cards in invalid[] with redacted errors and keeps valid roles sorted
   - HTTP API: POST .route refuses anchored, aliased, tagged, deep or oversized frontmatter with 400 before any write
   - redactText: credential URLs, authorization headers, key assignments, key shapes and home paths become markers; codes and plain URLs survive
   - HTTP API: catalog failures and unreadable-directory errors redact secrets and home paths in bodies and logs
   - HTTP API: POST .route enforces the 65536-byte body cap and rejects unknown fields
   - HTTP API: POST .route identical payload answers unchanged:true without a write; stale expectedMtimeMs still 409 first
   - HTTP API: a held writer lock yields 503 lock-timeout with a relative lock name and is never auto-recovered
   - HTTP API: Server-Timing on roles/catalog/route success carries durations only
   - client.js: unchanged notice, invalid-card warning banner and server-timing legend line render through the VM harness
   Guards green at HEAD: N8 (simultaneous POST serialization) and N11 (40-card listing).
3. Wave 1 (T1 index.js / T2 client.js / T4 docs, disjoint scopes) reconciled
   line-by-line against frozen contracts 3.1–3.7; file-scoped gates green
   (route literals 4+4, failsafe absent, `String\(error` sweep = 1 helper match,
   all console.warn sites redaction-wrapped, README trilingual parity
   {levels:[1,2,2,2,2,2,2,2,2,2,2], fences:3, rows:34}, doc token scan exit 0).
4. I1 run 1: 50 ok / 1 FAIL — the protected HEAD TOCTOU test failed because the
   frozen no-op branch answered 200 unchanged without the lock, letting an external
   edit during the validation window escape the in-lock mtime re-check. Recorded as
   contract defect P-1; escalated; lead approved amendment D-4 (no-op branch re-stat
   before answering unchanged; mtime drift → 409; still no lock, no write; C7's
   user-named behavior preserved exactly).
5. Lead-added regression test N13 landed and its RED state was conductor-verified
   against the pre-amendment branch: exit 1, 50 ok / 2 FAIL (the HEAD TOCTOU label
   plus `no-op save detects an external edit during the validation window`),
   deterministic across two runs; N13's first failure is its 409 assertion.
6. Amendment landed (index.js no-op branch only, +17 lines); I1 re-run:
   **52 ok / 0 FAIL, exit 0, `ALL TESTS PASSED`** (count deviation 51 → 52 is
   lead-approved per D-4: 12 frozen tests + N13).

## Anti-flake gate (I2)

`green runs: 5/5` — five consecutive full-suite runs, each exit 0, each log's final
line `ALL TESTS PASSED`, each log exactly 52 `ok` lines (test-run-1.log …
test-run-5.log). No retry masking; the only deliberate slow path is N9's ~2s real
lock-deadline wait (deterministic). No timing-based assertions anywhere.

## node --check

index.js exit 0; client.js exit 0; scripts/test.mjs exit 0 (node-check.log).

## New tests (13)

N1–N12: the frozen labels listed above (plan 3.8), covering the strict-gate matrix,
GET invalid[] surfacing + redaction idempotence, POST strict gate with disk
integrity, redactText unit matrix, end-to-end redaction in bodies and logs, body cap
(including the content-length header pre-check branch) + field allowlist, no-op
ordering (stale-409-first, fail-closed validation still applies), concurrent-POST
serialization, busy-lock 503 + no auto-recovery, Server-Timing shape, 40-card
bounded-read listing, and the client unchanged-notice / invalid-banner /
timing-legend VM rendering.
N13 (lead-added, D-4): `no-op save detects an external edit during the validation
window` — true no-op POST with a mid-validation external edit → 409, edit preserved,
no lock acquired or orphaned, no unchanged:true.

## Amendment trail (P-1 / D-4)

- Defect: frozen no-op block (plan 3.6) + protected HEAD TOCTOU test cannot coexist
  as literally written (no-lock no-op answer bypasses the in-lock mtime re-check).
- Lead decision: correctness refinement within C7's intent; no user gate needed;
  residual stat→response race acceptable because no write occurs (no lost-update
  hazard; response reports read-time state).
- Fix: re-stat via lstatNoSymlink inside the no-op branch immediately before
  answering unchanged; drift → 409 'role card changed on disk; refresh before
  saving'; re-stat error mapping mirrors the existing read block (404/400/redacted
  500). No lock, no write; unchanged response keeps read-time mtime.
- Proof: N13 red against the pre-amendment branch (2 FAIL / 50 ok), green after
  (52 ok); the protected HEAD TOCTOU test is the second failing-mode proof.

## Known risks / notes for the final gates

- Anchored/tagged/deep cards stay listed but every write returns 400 until the
  frontmatter is cleaned (intended, documented in READMEs/CHANGELOG).
- No-op responses carry read-time mtime (documented); the validation-window drift
  case now conflicts correctly (D-4).
- I-4 watch item: N6's header pre-check case relies on undici keeping a manually set
  content-length on Request (verified on Node 26; CI matrix is Node 22/24 — behavior
  stable across undici 6/7; documented fallback is a request-like stub with real
  Headers and a read counter).
- I-2 note: real-fs-error redaction on machines whose tmpdir is an 8.3 short path
  rides the generic Windows home pattern; both redaction layers are kept.

## Final-gate record (lead fills at delivery)

- Adversarial verification workflow: 39 agents (6 review lenses, dual refutation
  per finding + third for security, completeness critic). 14 raw findings →
  **5 confirmed** (contracts-1, tests-1, docs-1, docs-2, docs-3), **9 refuted**,
  **1 critic gap** (no-op FAQ catalog clause). All 5 confirmed + the critic gap
  FIXED in the D-5 delta. Two refuted findings (perf-maintain-1 ReDoS,
  security-1/2/4 leak shapes) were OVERRIDDEN by lead firsthand probes
  (6919ms blocking measured; JSON/@-URL/quoted/AIza leaks reproduced) and fixed
  under D-5 — cards are untrusted same-user input, so the "harmless" scope
  refutation did not hold. Security gate (pre-delta): PASS WITH FINDINGS (8 LOW);
  items 1-3+7 fixed under D-5, items 4/5/6/8 deferred with rationale in D-5.
- D-5 delta verification: see verification-delta.md (N14-N16, 52→55 tests,
  mutant red-proofs, 5/5 anti-flake delta runs, ReDoS 6919ms→2.3ms).
- Review loop scores (diff-reviewer, gate >= 8/10): round 1 = 7/10 CHANGES
  REQUESTED (1 IMPORTANT authorization-form gap + 3 MINOR hygiene); all fixed
  under D-6 (verification-delta3.md); round 2 = **9/10 READY** (0 BLOCKING /
  0 IMPORTANT / 0 MINOR / 3 INFO safe-direction tradeoffs; INFO-3 wording nit
  amended in decisions.md D-6 F1).
- Security gate verdict (security-auditor): pre-delta PASS WITH FINDINGS (8 LOW);
  delta re-review BLOCK (scheme-prefix quadratic HIGH + escaped-quote LOW) →
  lead remediation (verification-delta2.md) → closing verdict **PASS** (attack
  replay 4079ms→99.4ms, 17 adversarial shapes linear, frozen expectations
  byte-exact); delta3 (D-6 authorization forms) confirmation: **PASS holds**
  (11 adversarial constructions ≤19.3ms; residual slash-base64 combined-form
  tail documented as best-effort tradeoff toward path preservation).
- Delivery commit: the commit carrying this evidence file (git-commit skill,
  Conventional Commits, no push); hash recorded in git log.