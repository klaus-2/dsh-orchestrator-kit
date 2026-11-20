# Problems log — backlog-60-pass1

## P-1 (I1, contract defect — ESCALATED to lead; awaiting decision)

- Symptom: first I1 full-suite run = 50 ok / 1 FAIL, exit 1. Failing label:
  `HTTP API: POST .route decoupled disabled, validation, effort 400/409/503, expectedMtimeMs 409 and TOCTOU 409`
  (the EXISTING HEAD test, protected by plan section 2 "every existing test stays
  green without weakening its assertions"). Assertion: scripts/test.mjs:781
  `assert.equal(raceRes.status, 409)` → actual 200.
- Root cause (traced firsthand): the test's race POST sends `reasoningEffort:'high'`
  on a card that ALREADY has `reasoning_effort: high` (written by the preceding
  `saved` POST). The rendered next text === read-time text, so the FROZEN no-op
  branch (plan 3.6; implemented verbatim at index.js:698-700) answers
  200 unchanged:true WITHOUT acquiring the lock. The external edit performed by the
  test's TOCTOU hook DURING effort validation (mtime bumped +2000) is therefore never
  caught by the in-lock mtime re-check. At HEAD the same POST acquired the lock and
  the in-lock re-check returned 409.
- Why this is a CONTRACT defect, not an implementation/test deviation: T1 implemented
  plan 3.6 verbatim (conductor line-audit confirmed); the test is an untouched HEAD
  test. The frozen no-op block + master C7 ("no lock acquired, no write") cannot
  coexist with the protected TOCTOU test as literally written. The plan's own
  Must-Have (existing tests green, no weakening) wins; I1 rule: contract defect →
  STOP + escalate to lead with recorded rationale before any contract change.
- Proposed minimal amendment (preserves EVERY C7 clause): inside the no-op branch,
  before answering unchanged, re-stat the card (lstatNoSymlink) and compare
  `freshInfo.mtimeMs !== info.mtimeMs` → if changed, return 409 with the existing
  pre-check message 'role card changed on disk; refresh before saving'. Re-stat error
  mapping mirrors the existing read block (ENOENT → 404, statusCode 400 → 400,
  else redacted warn + 500). Still NO lock acquired, NO write; unchanged response
  still carries read-time mtime (N7 deep-equal preserved).
- Impact analysis: existing TOCTOU case 1 → 409 + disk preserved (green); TOCTOU
  case 2 (omitted expectedMtimeMs) is NOT a no-op (external card has effort low, POST
  renders high) → lock path → 409 unchanged; N7/N10 true no-ops (no external edit)
  → fresh mtime equals read mtime → unchanged:true (green); N8 racers are real
  changes → unaffected. Docs already claim "a card that changed on disk still
  returns 409" for no-op saves (README FAQ) — the amendment makes that true for the
  validation window too; no docs change needed. Closes the no-op TOCTOU window the
  lead's security gate explicitly lists.
- Status: lead APPROVED the amendment (D-4, strict scope + lead-added N13 regression
  test). N13 landed (scripts/test.mjs:1501-1546) and its RED state was conductor-
  verified against the pre-amendment branch: exit 1, 50 ok / 2 FAIL (HEAD TOCTOU +
  N13 labels), deterministic; N13's first failure is the 409 assertion (200 !== 409).
  Amendment dispatched to the implementer lane (index.js only). 3-Strike counter: 0
  (contract gate, not failed repair attempts).