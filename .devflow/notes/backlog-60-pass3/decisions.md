# Run decisions — backlog-60-pass3 (run-conductor)

## Wave plan (per approved plan §4/5, revision 3; plan-auditor OKAY 145/145)

- Step 0 (solo): T3 {scripts/test.mjs} — harness windowListeners extension (3.9)
  + RW-P3 #1/#2/#3 reworks + P3-N1..N10. RED gate: 71 total, 12 FAIL / 59 ok;
  FAIL set {P3-N1..N8, P3-N10, P2-N1, P2-N3, P2-N4}; P3-N9 green-at-HEAD guard.
  Count differs → STOP + escalate (frozen rule).
- Wave 1 (parallel, disjoint): T1={client.js} | T2={locale/en.json,
  locale/pt-BR.json, locale/zh.json} | T4={README.md, README.pt-BR.md,
  README.zh-CN.md, CHANGELOG.md}. No suite runs mid-wave.
- Reconciliation: line-audit vs frozen contracts 3.1-3.10; runCardLoop VERBATIM
  (Pass 4 reuses it); 95-key dictionaries byte-exact ×3 + PANEL_DICTS mirror;
  mtime-keyed draft store semantics; D3 skip vs fetch-count assertions (learnings).
- Wave 2 (solo): I1 → 71 ok ALL TESTS PASSED + node --check ×3; I2 → 5× green +
  evidence under .devflow/evidence/backlog-60-pass3/ + verification.md.
- Stop after I2 + completion packet. Lead owns adversarial workflow, review loop,
  live-smoke (consolidated-blocked record precedent), docs reconciliation,
  git-commit. No commit/push from this run.

## Dispatch decisions

- Fresh lanes per task (p3- prefix); the plan (revision 3) is the single source of
  truth; role-card bodies passed verbatim as prompt prefix (chat-only; the
  installed-cards path never written into any repo file).
- Lead's 5 special-attention items propagated into the briefs: runCardLoop
  verbatim; draft-store mtime semantics + remount-discard/undo-409 pins; undo
  payload = pre-save summary + post-save mtime; prefs reuse the locale storage
  pattern; D3 × fetch-count compatibility verified at reconciliation/I1.
- Zero-narrative-comment discipline + Pass-2 I-1 lessons (realm normalization,
  microtask drain, locale-independent finders) propagated verbatim.
## D-1 — T3 contract notes accepted (lead)

Red gate verified independently: 71 total, 12 FAIL / 59 ok, exact §8 label
set, 2x deterministic. Two T3 contract notes ACCEPTED as derived from the
plan's own computations (no plan edit needed):
(1) empty.noMatch gate = visibleCount === 0 && unfilteredCount > 0 (the
literal visibleSections.length === 0 branch cannot fire under filters);
(2) beforeunload registers unconditionally with dirty evaluated at event
time; P3-N1 pins the exactly-one guard + handler swap + preventDefault-only-
while-dirty. P3-N1 asserts remount init via renderCycle before settle
(init observable at first render; the load effect overwrites on settle) and
external-edit discard via a settled intermediate mount.
