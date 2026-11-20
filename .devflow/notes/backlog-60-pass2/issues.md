# Open issues — backlog-60-pass2

- I-1 (I1 run 1, TEST-SIDE, steered to p2-t3-test-writer): 58 ok / 3 FAIL.
  (a) P2-N2 face comparisons use assert.deepEqual (strict) across vm/host realms —
  prototype mismatch despite identical content (conductor's independent probe proved
  registered faces byte-equal to JSON panels, 72 keys × en/pt-BR/pt/zh). Fix:
  realm-normalize both sides (JSON round-trip) before deepEqual; same for the
  addLanguage record comparison (vm-realm object).
  (b) P2-N3 M1 save action calls holdRoute() before the fetch-handler microtask has
  run (no await between onClick and the resolver call) → TypeError. Fix: drain
  microtasks (settle(false) idiom) before invoking the resolver; keep the
  renderCycle-during-await semantics for save.busy.
  (c) P2-N4 languageSelectOf hardcodes the EN aria-label 'Panel language'; after the
  pt-BR override the aria-label is correctly translated → finder undefined. Fix:
  locale-independent finder (current dictionary's locale.aria value or structural
  match on the language option values).
  All three are latent test-plumbing bugs downstream of the HEAD red failure points
  (red gate stayed valid); implementation proven correct by 58 green tests + the
  conductor byte-sync probe. Contract-wins: fix the test side, never weaken.
  CLOSED: T3 landed realmNormalize (JSON round-trip) on the vm-side operands,
  settle(false) microtask drain before the held-save resolver, and a
  locale-parameterized select finder (+3 aria-translation assertions). Conductor
  verified the fix sites line-by-line and re-ran I1: 61 ok / 0 FAIL / exit 0.
- I-2 (T4 discovery, informational): the plan's parity snippet run via pwsh suffers
  backtick-escaping (/^```/gm degrades to /^`/gm, counting backtick-initial lines:
  fences:3). HEAD baseline measured identically, so the gate is consistent; T4 also
  verified TRUE fence parity with an escape-proof regex (fences:2 identical ×3).
  Both interpretations green; no action.