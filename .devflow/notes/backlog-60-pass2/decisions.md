# Run decisions — backlog-60-pass2 (run-conductor)

## Wave plan (per approved plan §4/5; plan-auditor OKAY ~110/111 anchors)

- Step 0 (solo): T3 {scripts/test.mjs} — harness extension (3.5) + RW1 (3.6) +
  P2-N1..N5 (3.8/3.9). RED gate: 61 tests, 5 FAIL / 56 ok (P2-N1..N4 + RW1 static
  label). P2-N5 is a GREEN-at-HEAD guard: if red → STOP + escalate (frozen pack
  list wrong). Conductor pre-verified the pack list 69/69 against the plan.
- Wave 1 (parallel, disjoint): T1={client.js} | T2={locale/en.json,
  locale/pt-BR.json, locale/zh.json} | T4={README.md, README.pt-BR.md,
  README.zh-CN.md, CHANGELOG.md}. No suite runs mid-wave.
- Reconciliation: line-audit vs frozen contracts; PANEL_DICTS ↔ JSON panel
  byte-sync (N2 is the arbiter; contract-wins per I1); phase-id rekeying
  consistency (PHASE_TONE/tab ids/groupRoles/activeTab); harness back-compat
  (big VM test, N12, N17 pass UNCHANGED, en values byte-exact).
- Wave 2 (solo): I1 → 61 ok ALL TESTS PASSED + node --check ×3; I2 → 5× green +
  evidence under .devflow/evidence/backlog-60-pass2/ + verification.md.
- Stop after I2 + completion packet. Lead owns adversarial workflow, review loop,
  LIVE-HOST SMOKE (C8), docs reconciliation, git-commit. No commit/push from run.

## Dispatch decisions

- Fresh lanes per task (p2- prefix): Pass 2 contracts supersede Pass 1 anchors;
  the plan is the single source of truth (workers have zero interview history).
  Role-card bodies passed verbatim as prompt prefix (chat-only; installed-cards
  path never written into any repo file).
- Auditor courtesy correction folded into the T3 brief: token constants at
  scripts/test.mjs:118-136 (array 121-136), used BY NAME in P2-N5.
- Zero-narrative-comment discipline propagated verbatim into every brief.

## T3 frozen-surface interpretations (conductor-approved, non-deviating)

- D-1: plan 3.5's frozen mountVmClient return exposes localeState/storage but not
  the localeStub; 3.8 N4 says "stub.setLocale('zh')". Resolution: N4 drives the
  host switch through the exposed localeState exactly as the frozen setLocale does
  (active = id; revision += 1; notify a COPY of the listeners set). Byte-equivalent
  semantics; frozen return shape stays exhaustive.
- D-2: 3.8 N2 requires plugin.inject deepEqual but the frozen return does not
  expose plugin. Resolution: N2 captures the module in a minimal probe vm context
  (window.__ModuleLoader__ + localStorage stub + trivial React stub; apply never
  invoked) and deep-equals the spread inject array. mountVmClient's require assert
  stays byte-identical; the probe reads the REAL module declaration.
- D-3: 3.9 FROZEN_PACK_FILES is listed in npm's case-INSENSITIVE order, not JS
  default .sort() order. Resolution: N5 embeds the list verbatim in plan order and
  sorts BOTH observed and embedded lists with the same default comparator before
  deepEqual (exact 69-entry set equality). entryCount/filename assertions unchanged.
  Conductor's own pre-check used case-insensitive Sort-Object on both sides (69/69).

## Final state (I1 + I2 complete)

- I1 run 1: 58 ok / 3 FAIL — three test-side plumbing bugs (I-1), steered to T3,
  fixed in one pass, fix sites conductor-verified. No implementation drift, no
  contract defect, no weakened assertion.
- I1 final: exit 0, 61 ok / 0 FAIL, ALL TESTS PASSED; node --check ×3 exit 0.
- I2: green runs 5/5; each log 61 ok + ALL TESTS PASSED; 0 FAIL lines / 0 tmp
  markers; node-check.log three exit 0 lines; verification.md written (red→green
  trail, RW1 before/after, D-1..D-3, I-1 cycle, lead placeholders); 15-file token
  scan (docs + evidence + notes) exit 0.
- Final working diff: 9 files, +1296/−105 (client.js 566→850; test.mjs 2761→3416;
  locale +74×3 pure additions; docs +32/−2). index.js/package.json/cordis.patch.yml
  UNTOUCHED. No commit/push/review-corps/live-smoke (lead-owned).