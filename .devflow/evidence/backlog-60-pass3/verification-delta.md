# Verification delta — Pass 3 workflow fixes (lead edits)

Date: 2026-11-20. Owner: lead.

## Adversarial workflow (21 agents)

7 raw findings → **3 confirmed / 4 refuted + 2 critic gaps**. Product-code
findings: one Critical (docs-1) + two Important test-gap findings; refuted:
the stale-focusedCardId "wrong save" scenario (refuter 1 proved the panel-root
keydown cannot fire after body focus; lead independently verified the code
matches the frozen §3.4 mechanism), retryAfterConflict race, AND-composition
mutant, and the "same counting basis" FAQ variant (the FAQ replacement below
addresses the underlying discrepancy). Critic gaps: undo 409 effort hint;
undo outcomes not driven through the shared aria-live region.

## Fixes (all lead edits, full context held)

- docs-1 (Critical, confirmed by VM probe): client.js:604 had
  `setDrafts(Object.fromEntries(list.map(role => [role.id, normalizeDraft(role)])))`
  unconditionally on every roles refresh, overwriting the mtime-keyed draft
  hoisted by the useState init (545-556) once the fetch settled — drafts were
  silently lost on section remount, the opposite of the documented contract.
  Fix: the refresh map now preserves each hoisted draft whose store key still
  matches the fresh server mtime; only unmatched roles get normalizeDraft.
  (First iteration returned a bare draft instead of an [id, value] pair —
  caught by 15 VM test failures, root-caused and corrected before green.)
- tests-1 (confirmed): focusedCardId was declared inside OrchestratorSettings
  (reset on every render), contradicting the frozen §3.4 "createSettings
  scope" — after a draft edit, Ctrl+S preventDefault fired but no save ran.
  Fix: moved `let focusedCardId = null;` into createSettings (one closure per
  factory, survives renders) — P3-N1's edit→Ctrl+S mutant now fails without
  the fix, preserved by the existing test.
- tests-2 (confirmed): compact rows had the undoButton in code (client.js:1073)
  but no positive test asserted it — P3-N6 only checked undo ABSENCE with no
  snapshot. Fix: N6 now saves from compact mode, asserts the Undo button
  appears in the one-line row, clicks it and asserts the undo notice.
- critic gap 1: undo 409 omitted the effortHint attached by the save path;
  fix at client.js:878-879 mirrors the save-path params (effortHint when the
  reverse payload carried reasoningEffort) + N2 assertion.
- critic gap 2: N2 now asserts the failed undo is announced in the shared
  aria-live region (previously only save outcomes were pinned).
- docs-2: FAQ "same counting basis as the header summary" was false —
  breakdownOf uses mutually exclusive classes while header counts overlap.
  All three READMEs now state the real semantics (mutually exclusive per-tab
  numbers summing to the tab count; header routed/disabled may overlap).

## Verify (fresh, lead-run)

- node --check index.js/client.js/scripts/test.mjs → all exit 0
  (node-check-delta.log).
- 5 consecutive full-suite runs: 5/5 green, 71 ok / 0 FAIL each
  (test-run-delta-1..5.log, green-only). No retry masking, no timing assertions.
- Security lens re-green: N17 (markup/quotes text rendering) and P2-N5
  (npm pack token scan) pass in every run; route-literal count still 4; no
  new globals; context/event handlers cleanup tested.

## Gate status

Adversarial workflow closed (all 5 surviving findings fixed; 4 refuted stood
with evidence). Review loop round 1 (diff-reviewer) pending. Live-smoke stays
consolidated-blocked (auth gate; manual runbook in backlog-60-pass2).

## Review-loop round-1 FIX (F1, IMPORTANT)

The reviewer found that the draft-preservation fix (docs-1) also preserved
drafts on the plain Refresh button, contradicting the frozen C10 contract
(drafts reset on Refresh; only remount + the 409 action preserve). Fix:
client.js:604-611 now gates the preservation lookup on `loadTick === 0`
(first mount only); explicit Refresh (loadTick > 0) always applies
normalizeDraft. P3-N8 extended: marks zeta-custom dirty, asserts the seal,
clicks Refresh, and asserts the checkbox returns to saved state with the seal
cleared. node --check ×2 exit 0; suite 71 ok; 5 consecutive green runs
(test-run-delta2-1..5.log). F2-F6 advisory (no action this pass).
