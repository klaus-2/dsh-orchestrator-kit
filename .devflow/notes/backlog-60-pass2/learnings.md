# Run learnings — backlog-60-pass2 (run-conductor)

## Baseline (verified firsthand before Step 0)

- HEAD fe4e508 (feat: harden role-card writes with strict YAML, redaction and limits).
  Working tree clean except the untracked pass-2 plan. Suite: exit 0, 56 ok / 0 FAIL,
  ALL TESTS PASSED.
- npm pack --dry-run --json: entryCount 69, filename dsh-orchestrator-kit-0.1.0.tgz;
  sorted path list MATCHES the plan's FROZEN_PACK_FILES 69/69 (conductor pre-check —
  P2-N5 guard should be green at HEAD).
- README parity at HEAD: {levels:[1,2,2,2,2,2,2,2,2,2,2], fences:3, rows:34}.
- Auditor courtesy correction CONFIRMED on disk: token constants block is
  scripts/test.mjs:118-136 (ADMIN_TOKEN 118, WIN_HOME_TOKEN 119, POSIX_HOME_TOKEN
  120, FORBIDDEN_TOKENS array 121-136, BAK_LITERAL 137, BAK_SUFFIX_RE 138,
  OLD_PLUGIN_NAME 139, OLD_PLUGIN_SCOPE 140). Plan §1.1's "116-134" cite is stale;
  P2-N5 uses the constants BY NAME.
- All plan §1.1 anchors verified: client.js 566 lines (PHASE_SECTIONS 13-17
  title-keyed, PHASE_TONE 19-24, caches 26-29, string constants 31-34, statusTone
  49-53, groupRoles 131-151, phaseOf 153, load effect 169-233, save 304-346,
  renderCard 353-462, header 489-503, banners 504-513, legend 514-524, tabs
  469-473 + tablist 525-536, empty states 538-543, section render 544-549,
  registration 553-564 with inject ['slots'] 554).
- scripts/test.mjs 2761 lines / 56 tests: package contract 1904-1941 (UNTOUCHED
  this pass), static contract 1943-1960 (RW1 target), node --check array
  1962-1967, LF/BOM array 1969-1975, mountVmClient 1977-2104 (require assert
  2017, plugin.apply ctx 2034-2045), collectText 2106, findNodes 2113, big VM
  test 2121-2446, N12 2448-2513 (SAVE_NOTICE render assertion 2511), N17 XSS
  2515-2541, codemap const 2543, hygiene/rename/summary at the tail.
- locale/{en,pt-BR,zh}.json: meta-only today; metas byte-match the plan's frozen
  meta blocks (T2 keeps them verbatim).

## Binding lessons carried from Pass 1

- Zero-narrative comments in ALL new code/tests (the delivery sweep deleted 105
  comments in Pass 1). Catch blocks: explicit fallback returns, never empty.
- Suite runs only at wave boundaries; green-only evidence; failure output carries
  absolute tmp paths — never saved to disk.
- Contract defect → STOP + escalate to lead; plan file read-only; live discoveries
  go to these notes.
- index.js / package.json / cordis.patch.yml UNTOUCHED this pass.