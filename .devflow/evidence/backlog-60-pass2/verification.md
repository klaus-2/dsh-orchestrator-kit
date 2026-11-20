# Verification — backlog-60-pass2 (i18n Seam)

Date: 2026-11-19. Owner: run-conductor (execution); lead owns the final gates
(adversarial verification workflow, diff-reviewer review loop, LIVE-HOST SMOKE per
C8, docs reconciliation, delivery via the git-commit skill at
~/.agents/skills/git-commit).

Plan: `.devflow/plans/backlog-60-pass2.md` (plan-auditor OKAY; plan file read-only
during execution). Master contracts C1/C8/C11/C14/C15 binding. Run notes:
`.devflow/notes/backlog-60-pass2/` (learnings, decisions D-1..D-3, issues I-1/I-2).
Baseline: HEAD fe4e508, suite 56 ok; pack dry-run 69 entries (conductor-verified
against the frozen list 69/69 before T3).

## Canonical commands

- Full suite: `node scripts/test.mjs` → exit 0, final line `ALL TESTS PASSED`.
- Syntax: `node --check index.js`, `node --check client.js`,
  `node --check scripts/test.mjs` → all exit 0 (node-check.log).
- Anti-flake: 5 consecutive full-suite runs, logs test-run-1.log … test-run-5.log
  (green runs only; failure output carries absolute tmp paths and is never saved).

## Red → green transition

1. HEAD baseline: 56 ok / 0 FAIL, exit 0.
2. T3 tests-first (harness extension 3.5 + RW1 rework 3.6 + P2-N1..N5): RED gate
   exit 1, **56 ok / 5 FAIL**, final line `5 TEST(S) FAILED`, deterministic across
   three conductor-verified runs. The 5 FAIL labels:
   - client.js static contract: phase grouping, save flow markers, and no old-name leftovers (RW1 rework-fail: phase-id includes absent at HEAD)
   - locale parity: en/pt-BR/zh panel key sets identical, values non-empty, frozen 72-key schema, meta preserved
   - locale registration: embedded dictionaries sync with locale JSON panel sections; pt mirrors pt-BR; addLanguage pt-BR; inject slots+locale
   - i18n structural gate: every panel string renders through t (sentinel bind) and all 72 keys are covered across driven states
   - panel language switch: override renders pt-BR/zh from dictionaries, Auto follows host, best-effort localStorage persists and restores, storage failure degrades to host language
   P2-N5 (npm pack guard) GREEN at HEAD as designed; the other 55 existing tests
   stayed green (harness backward compatible; require assert byte-identical).
3. Wave 1 (T1 client.js / T2 locale/*.json / T4 docs, disjoint scopes) reconciled
   line-by-line against frozen contracts 3.2/3.3/3.4; conductor vm probe proved
   registered PANEL_DICTS faces byte-equal to the JSON panel sections (72 keys ×
   en/pt-BR/pt/zh); locale files byte-identical to the plan 3.3 blocks; README
   trilingual parity preserved ({levels:[1,2×10], fences:3, rows:34} plan-snippet
   form; true-fence form fences:2 also identical ×3); doc token scans exit 0.
4. I1 run 1: 58 ok / 3 FAIL — three TEST-SIDE plumbing bugs in the new tests
   (issue I-1), NOT implementation drift: (a) P2-N2 deepEqual across vm/host realms
   (prototype mismatch despite identical content), (b) P2-N3 held-save resolver
   called before the fetch microtask drained, (c) P2-N4 select finder hardcoded the
   EN aria-label while the override correctly translates it. Contract-wins: the
   test side was fixed (realm normalization; settle(false) microtask drain;
   locale-parameterized finder + three added aria-translation assertions). No
   assertion weakened; no implementation change.
5. I1 final: **61 ok / 0 FAIL, exit 0, `ALL TESTS PASSED`** (56 existing incl. the
   reworked RW1 + 5 new). node --check ×3 exit 0.

## Anti-flake gate (I2)

`green runs: 5/5` — five consecutive full-suite runs, each exit 0, each log's final
line `ALL TESTS PASSED`, each log exactly 61 `ok` lines; 0 FAIL lines and 0 tmp-path
markers in the logs. P2-N5's npm pack + tar extraction (~5-10s per run) is the only
deliberate slow path (deterministic). No timing-based assertions anywhere.

## node --check

index.js exit 0; client.js exit 0; scripts/test.mjs exit 0 (node-check.log).
index.js / package.json / cordis.patch.yml UNTOUCHED this pass (verified by scope
audit); the package-contract test stayed green UNTOUCHED.

## New tests (5) + rework (1)

- P2-N1 locale parity: 3-JSON key sets identical + frozen 72-key schema + non-empty
  values + meta preserved + en byte-equality anchors.
- P2-N2 locale registration: inject ['slots','locale']; exactly 4 faces
  en/pt-BR/pt/zh deep-equal to the JSON panels (realm-normalized); pt mirrors pt-BR;
  addLanguage pt-BR record; addLanguageThrows degradation variant.
- P2-N3 i18n structural gate: sentinel-bind render matrix (M1 + actions, M1b
  timing, M2 effort states, M3 empties, M4 banners); exact fixture-data allowlist
  over every text child + aria-label/title prop; observed sentinel keys ⊇ the
  72-key list read from locale/en.json; nav label through bind.
- P2-N4 panel language switch: pt-BR/zh overrides render real dictionary values;
  Auto follows host (stub active switch); localStorage persistence + same-vm
  remount restore; Auto clears storage; storage-throw degradation + in-memory
  switch; select aria-label translates with the active language.
- P2-N5 npm pack guard (green at HEAD): dry-run filename/entryCount 69 + frozen
  file set; real pack to an OS tmp dir + tar extraction + per-file forbidden-token
  scan (constants by name) + packed package.json identity; no tarball in the repo.
- RW1 static contract rework (3.6, user-approved policy change): REMOVED the
  phase-title literal includes ×4, 'Refresh' include, SAVE_NOTICE literal include,
  PT_BR_WORD_RE ban; KEPT byte-identical expectedMtimeMs/efforts-route/mount-marker/
  spawn_teammate/old-name/failsafe assertions; ADDED structural includes
  (id: 'discovery'/'planning'/'verification'/'other', locale: NS,
  inject: ['slots', 'locale']). Replacements: N3 render gate + N1/N2 parity +
  N12's unchanged SAVE_NOTICE render assertion. LF/BOM array gained the 3 locale
  files (additive, green at HEAD).

## Conductor-approved frozen-surface interpretations (decisions.md D-1..D-3)

- D-1: N4 drives the host switch through the exposed localeState (byte-equivalent
  to the frozen setLocale semantics; frozen return shape stays exhaustive).
- D-2: N2 reads plugin.inject via a minimal probe vm (frozen mountVmClient return
  unchanged; require assert byte-identical).
- D-3: N5 sorts both the observed and embedded frozen pack lists with the same
  default comparator (the plan list is in npm's case-insensitive order; the guard
  is exact 69-entry set equality).

## Known risks / notes for the final gates

- Embedded-dictionary duplication (locale JSON ↔ client.js PANEL_DICTS) is
  enforced by N1/N2 every run; editing rule documented in the READMEs (JSON first,
  mirror verbatim).
- Banner/notice messages store {key,params} and re-translate live on switch;
  'error.raw' is a structural marker for raw diagnostic data (allowlisted as data).
- addLanguage('pt-BR') is a host-wide side effect while the plugin is active
  (disposer removes it on deactivation; occupied-id tolerated) — documented.
- localStorage override is same-session best-effort (Desktop origin-port churn);
  no durability claim (C11/R10).
- client.js grew 566 → 850 lines (~12 KB embedded dictionaries) — measure for the
  Pass 5 size budget (C14).
- I-2 note: the plan's README-parity snippet run via pwsh degrades the fence regex
  through backtick-escaping (fences:3 counts backtick-initial lines); the HEAD
  baseline was measured identically and T4 additionally verified true fence parity
  (fences:2) with an escape-proof regex — both forms identical across the three
  READMEs.

## Final-gate record (lead fills at delivery)

- Adversarial verification workflow: r3 (23 agents; two earlier runs lost to a
  session restart and a model switch): 8 raw findings → **2 confirmed** (both
  test-side: localStorage restore path + makeT interpolation never exercised)
  + **2 critic gaps** (plugin-disposal teardown untested; en-value render pin)
  + **6 refuted**. All four fixed in delta-4 (verification-delta4.md). Product
  code: zero findings across contracts/errors/tests/security/perf/docs lenses
  (contracts verified against the live ASAR host sources).
- Review loop (diff-reviewer): round 1 = **8/10 READY** (0 BLOCKING /
  0 IMPORTANT / 2 MINOR / 2 INFO); both MINORs fixed in delta-5
  (verification-delta4.md §Delta 5: phantom allowlist keys corrected to 43
  real keys; error.raw branch pinned via an isolated vm drive); no new review
  round required per the reviewer.
- Live-host smoke record (C8): **BLOCKED, documented** — the agent browser
  has no signed harness session (401 + interstitial; blocker persists across
  the host restart, which resolved blocker 2). Manual runbook with the exact
  6 steps in live-smoke.md; nothing faked. VM-harness semantics proven by the
  61-test suite + 5× anti-flake.
- Delivery commit: the commit carrying this evidence file (git-commit skill,
  Conventional Commits, no push); hash recorded in git log.