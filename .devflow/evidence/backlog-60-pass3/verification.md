# Verification — backlog-60-pass3 (Save-Safety & UX)

Date: 2026-11-20. Owner: lead (conductor role after the run-conductor lane
failed post-T3-dispatch; per-task lanes dispatched individually).

Plan: `.devflow/plans/backlog-60-pass3.md` revision 3 (plan-auditor OKAY after
3 audit rounds: round-1 REJECT — 23/95 dictionary count + P2-N4 pin-loop no-op;
round-2 REJECT — missing scanEnValues placeholder extension; round-3 fixes
prescribed by the auditor, human-authorized third round via the circuit
breaker, mechanically verified). Master contracts C1/C8/C9/C10/C11/C15.

## Red → green transition

1. HEAD baseline 60ebd75: 61 ok / 0 FAIL (auditor + lead reproduced).
2. T3 (p3-t3 lane) red gate: exit 1, **71 total, 12 FAIL / 59 ok**, `12 TEST(S) FAILED`,
   2× deterministic; FAIL set exactly {P2-N1, P2-N3, P2-N4, P3-N1..N8, P3-N10};
   P3-N9 green at HEAD as predicted (503-state guard). Lead verified
   independently. scripts/test.mjs +795/−13 (harness windowListeners
   extension additive; RW-P3 #1 PANEL_KEYS+23, #2 scanTree+placeholder +
   computed breakdown allowlist, #3 pin-loop allowlist iteration +
   scanEnValues placeholder).
3. Wave 1 (T1 client.js ∥ T2 locale ×3 ∥ T4 docs ×4, disjoint):
   - T2: 23 frozen keys appended programmatically from the plan's §3.8 JSON
     fences (parsed, not retyped); 95 keys ×3; meta byte-preserved; P2-N1
     green after T2.
   - T4: docs ×4 (controls row, save-protection paragraph, prefs sentence,
     2 FAQs, CHANGELOG 7 Added + 1 Changed); parity + token scans green.
   - T1: §3.1-§3.7 + §3.10 implemented; suite 69 ok / 2 FAIL — BOTH fails
     were T3-side frozen-test deviations (STOP rule exercised, contract wins).
4. Lead reconciliation (I1): verified both defects against the code and plan,
   then fixed test-side per the contract-wins rule:
   - P2-N3 breakdown allowlist: extended with COMPUTED entries
     (gateBreakdownText([]) = 0/0/0; [g0,g0,g2] = 2/1/0; [g0,g2] = 1/1/0;
     [g0,g1,disabled g2] = 1/0/2; [disabled g1, disabled g2] = 0/0/2) —
     zero hardcoded literals, every entry derived from the fixture objects;
     observed-runtime iteration until the scanned trees were fully covered
     (each added entry was a live failing raw string first).
   - Big-VM phase-tab expectation aligned to the frozen §3.6 sortRoles
     (name-alphabetical at null rank; P3-N5 pins the same semantics) —
     contract alignment, not weakening (later assertions in that test are
     order-independent).
   Recorded as D-2 (this file section); decisions.md D-1 holds the accepted
   T3 contract notes (noMatch gate via visibleCount/unfilteredCount;
   beforeunload unconditional registration).
5. I1 FINAL: `node scripts/test.mjs` → **exit 0, 71 ok / 0 FAIL,
   ALL TESTS PASSED**; node --check ×3 exit 0 (node-check.log).

## Anti-flake gate (I2)

5 consecutive full-suite runs: 5/5 green, 61→71 ok each, final line
ALL TESTS PASSED (test-run-1..5.log, green-only). No retry masking; no
timing assertions.

## New tests (10 + 3 reworks)

P3-N1 draft hoisting/dirty seal/Ctrl+S/warn; N2 undo lifecycle; N3 error
actions; N4 aria-live + highlight + summary; N5 view controls composition +
per-tab breakdown; N6 compact density + content-visibility + inherit hint;
N7 prefs persistence/degradation; N8 (per plan §3.8 label table); N9 503-state
guard (green at HEAD); N10 pass-3 static markers. RW-P3: PANEL_KEYS+23,
P2-N3 placeholder+computed breakdown allowlist, P2-N4 allowlist-iteration
pin loop + placeholder scanner.

## Amendment trail (I1 reconciliation)

The two T3-side deviations and their lead fixes are recorded here (see
Amendment trail section below) — frozen-test corrections, both proven
against the plan's own frozen contracts (§3.6 sortRoles; P3-N5's own
0/0/0 pin).

## Final-gate record

- Adversarial verification workflow: 21 agents, 7 raw findings → **3 confirmed**
  (Critical draft-loss on remount; focusedCardId render-scope; compact undo
  untested) + **2 critic gaps** (undo effortHint, undo aria-live) + 4 refuted.
  All five fixed in verification-delta.md. Security lens: zero findings.
- Review loop (diff-reviewer): round 1 = 8/10 CHANGES REQUESTED (1 IMPORTANT:
  F1 — the draft-preservation fix also preserved on plain Refresh, against
  frozen C10) → fixed with the `loadTick === 0` gate + P3-N8 failing-mode test
  → round 2 = **9/10 READY** (0 BLOCKING / 0 IMPORTANT / 2 MINOR advisory /
  3 INFO). Five consecutive post-fix green runs: test-run-delta2-1..5.log.
- Live-host smoke: consolidated-blocked (auth gate persists; manual runbook in
  backlog-60-pass2/live-smoke.md). Pass 3 added no new i18n mechanism — only
  dictionary keys through the shipped seam.
- Delivery commit: the commit carrying this evidence file (git-commit skill,
  Conventional Commits, no push); hash recorded in git log.