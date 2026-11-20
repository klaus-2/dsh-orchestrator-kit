# Verification delta 4 — workflow r3 fixes + incident recovery (lead edits)

Date: 2026-11-20. Owner: lead.

## Incident (recovery from data loss)

During delta-4 iteration, a regex-based in-place test patch corrupted
scripts/test.mjs and the subsequent `git checkout -- scripts/test.mjs`
(recovery attempt) reverted the file to HEAD, losing the whole Pass-2 T3 work
(+601 test lines). No other file was affected. Recovery: the T3 content was
reconstructed byte-faithfully from the DSH session event store
(~/.dsh/sessions/.../session.v4.jsonl.zstd, decompressed with Node 26
zstdDecompressSync): the writer session's 1 write + 9 edits to test.mjs were
replayed over HEAD content — all 9 applied cleanly (184,437 chars), suite
green 61/61 on the reconstruction. Lesson recorded: never use
`git checkout --` as a spot-revert on a shared file with uncommitted
multi-pass work; the repo had zero staged copies (evidence of why the
git-commit-per-pass rule matters).

## Workflow r3 results (23 agents, re-run after the session restart lost the
first two runs)

8 raw findings → 2 CONFIRMED / 6 refuted + 2 critic gaps. All four are
test-side gaps (product code: contracts lens zero findings with ASAR-level
host-contract verification; security zero; docs zero; errors zero):

1. tests-1 (Important): the localStorage RESTORE path was never exercised —
   the remount assertion passed via the module-level variable, and no test
   pre-seeded storage. Mutant (readStoredLocale reads a wrong key) survived
   the whole suite.
2. tests-2 (Important): makeT (client.js:254-259 — interpolation, en fallback,
   key fallback) is only reachable in override mode and N4 asserted only
   param-less keys. Mutants in the interpolation regex survived.
3. Critic gap 1 (Important): the plugin-effect teardown (dictionary
   unregistration + addLanguage removal) was never tested; the harness
   collected pluginDisposers but never invoked them, and the stub's
   register/addLanguage returned no-op disposers.
4. Critic gap 2 (Minor): only 4 of 72 en values were pinned by literals; N2 is
   a symmetric deep-equal so one-sided edits fail but the render path for
   values was unpinned.

## Fixes (lead edits, scripts/test.mjs only)

- Locale stub register/addLanguage now return REAL disposers (pop
  registrations / faces / languages) — enables teardown testing.
- mountVmClient: `storageMap` option (pre-seeded Map) + exposed
  `runPluginDisposers()`.
- N4 (panel language switch test) extended with three blocks:
  a. RESTORE: fresh module with pre-seeded 'zh' → zh renders, select shows zh.
  b. INTERPOLATION: pt-BR override → 'Padrão (medium)' ({effort} param via
     effort.default) and 'Flash A (flash-a)' ({id} param via option.withId) —
     pins makeT's interpolation + en-fallback chain.
  c. TEARDOWN: runPluginDisposers() → registrations=0, languages=0.
  d. EN-VALUE PIN: default-state render scanned (children + aria-label +
     title props, mirroring the N3 scanTree) against every en dictionary
     value listed in the explicit PANEL_RENDERABLE_KEYS allowlist (46 keys —
     the keys that render in the DEFAULT driven state; the remaining 27 keys
     render in other driven states pinned by N3's coverage backstop, which
     derives required keys from en.json itself).
- Iterations recorded honestly: three intermediate reds (join('
') heredoc
  artifact; card.disabledSuffix concatenation; banner partial/empty keys) —
  each root-caused and fixed before the green sequence.

## Verify (fresh, lead-run)

- node --check scripts/test.mjs exit 0; node-check-delta4.log has 3× exit 0.
- 5 consecutive full-suite runs: 5/5 green, 61 ok / 0 FAIL each
  (test-run-delta4-1..5.log, green-only). No retry masking, no timing
  assertions.

## Delta 5 — review-loop round-1 MINOR fixes (lead edits)

diff-reviewer round 1: **Score 8/10, READY** (0 BLOCKING / 0 IMPORTANT /
2 MINOR / 2 INFO). Both MINORs folded into commit-prep:

1. PANEL_RENDERABLE_KEYS phantom keys ('refresh.label', 'field.disabled',
   'field.disabledAria', 'legend.title', 'meta.title' were not dictionary
   keys) → corrected to the real key names ('refresh', 'disabled.label',
   'disabled.aria' — the latter removed again when the en-value pin revealed
   interpolated values ('Disable {name}') can never appear verbatim; routing
   for interpolated keys stays pinned by the N3 sentinel backstop and
   interpolation itself by the effort.default/option.withId pins). Final set:
   43 real keys, zero phantoms (verified by script against locale/en.json).
2. error.raw branch had no render assertion → new isolated vmRaw drive inside
   the big VM test: route always 500 with detail 'write failed upstream
   trace-id-42'; toggle + save → raw detail renders as data (error.raw path),
   button-enabled pre-checked. (The in-place vm1 insertion was abandoned:
   vm1's state machine at that point left the save button disabled with the
   message cleared — root cause not worth tracing for a branch this small;
   the isolated vm proves the same branch deterministically.)

Evidence: test-run-delta5-1..5.log (5/5 green, 61 ok each),
node-check-delta5.log (3× exit 0).

## Gate status

Adversarial workflow r3 + security lens closed with delta-4; review loop
round 1 closed at 8/10 READY with the two MINORs fixed in delta-5 (no new
review round required per the reviewer). Live-host smoke: BLOCKED documented
(auth gate persists after host restart; manual runbook in live-smoke.md).