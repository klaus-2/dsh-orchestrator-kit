# Run learnings — backlog-60-pass3 (run-conductor)

## Baseline (verified firsthand before Step 0)

- HEAD 60ebd75 (feat(panel): trilingual panel i18n with manual language switch).
  Clean working tree except the untracked pass-3 plan. Suite: exit 0, 61 ok / 0 FAIL.
- client.js 850 lines; scripts/test.mjs 3498 lines / 61 `await test(` labels;
  locale panel keys 72 ×3 (scripted count).
- Anchors confirmed on disk: PANEL_KEYS 2628; FROZEN_PACK_FILES 2703 (UNCHANGED
  this pass — no new shipped files, P2-N5 stays green untouched);
  PANEL_RENDERABLE_KEYS 3109-3119 = 42 entries (mechanically counted; the delta-4
  prose's 43 was off by one — the count is the bug, not the check); P2-N4 pin loop
  3229-3232 (Object.entries + continue — the RW-P3 #3 rework target); scanEnValues
  prop list 3220 ['aria-label','title'] (round-3 extension target: + placeholder);
  P2-N3 scanTree prop list 2890; P2-N5 pack test 3237.
- Plan revision 3 (auditor 145/145 anchors, 3 rounds): round-1 fixed the 23/95-key
  count + pin-loop no-op defect; round-2 added the scanEnValues placeholder
  extension (without it search.placeholder's en-value pin could never pass —
  the frozen 71-ok green gate depends on it).

## Binding lessons carried from Passes 1-2

- Zero-narrative comments in ALL new code/tests; explicit catch fallbacks.
- Realm-safe deepEqual: JSON.parse(JSON.stringify(...)) across vm/host realms
  (Pass 2 I-1a: vm literals have a different %ObjectPrototype%; deepStrictEqual
  fails on prototype identity despite equal content).
- Held-response driving: drain microtasks (await settle(false)) BEFORE invoking
  the resolver (Pass 2 I-1b: the sandbox fetch defers fetchHandler via
  Promise.resolve().then — a synchronous renderCycle does not run it).
- Locale-independent finders when an override/host language is active (Pass 2
  I-1c); P3 tests run in default en unless the test itself switches.
- Suite runs only at wave boundaries; green-only evidence; failure output carries
  absolute tmp paths — never saved to disk.
- Contract defect → STOP + escalate; plan read-only; discoveries go to these notes.
- index.js / package.json / cordis.patch.yml UNTOUCHED; route literals stay 4.

## D3 × existing fetch-count assertions (lead special attention 5 — analyzed)

- P2-N4 (3121-3235) has NO fetch-count assertions; its remount (3152-3153) checks
  language rendering only — D3's catalog skip cannot break it.
- The big VM test's fetch-count assertions are EFFORTS-scoped (uniquePairs count;
  postRefreshEfforts after an explicit refresh). D3 skips only the CATALOG refetch
  on remount (loadTick === 0 && catalogCache !== null); roles always refetch;
  explicit refresh (loadTick > 0) fetches both; efforts effect is untouched.
- Each mountVmClient runs the source in a fresh sandbox → fresh module state →
  catalogCache null → first mount always fetches. Proof at I1: the 61 baseline
  tests (minus RW-P3) must pass unchanged.