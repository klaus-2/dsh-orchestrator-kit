# Run learnings — backlog-60-pass1 (run-conductor)

## Baseline (verified firsthand before Step 0)

- HEAD commit: e4f34b5 (docs: describe tabbed panel layout and log the redesign).
- Working tree at start: only `.gitignore` modified; `.devflow/` and `.ignore` untracked.
  index.js / client.js / scripts/test.mjs are at HEAD state.
- `node scripts/test.mjs` at HEAD: exit 0, `ALL TESTS PASSED`, exactly 39 `ok` lines, 0 FAIL.
- Node runtime: v26.12.1. Canonical command: `node scripts/test.mjs`.
- index.js: 687 lines, 23 `console.warn` sites, 17 `String(error…)`-family error-body sites,
  4 route literals. client.js: 548 lines, 4 route literals. scripts/test.mjs: 1872 lines, 39 tests.

## Auditor simulation notes — verified against HEAD source

1. T1 redaction: the plan's 3.3 site list omits 6 `String(error.message)` sites at
   index.js:540, 552, 624, 640, 658, 669 (confirmed by grep). All must convert to
   `safeErrorText(error)`; the sweep `String\(error` must end with exactly 1 match
   (the helper definition). The :664 `writeOutcome.error` passthrough is safe only
   after :640/:658 (and :642/:651/:660) convert.
2. N7 fixture: scripts/test.mjs:682 uses camelCase `reasoningEffort: medium` — that form
   does NOT round-trip byte-identically under a reasoningEffort POST (applyCardSettings
   normalizes to `reasoning_effort`). N7's fixture must use the canonical plain-scalar
   `reasoning_effort: high` form (plan 3.8/N7 intent wins over the :682 style reference).
3. N10 headers: `withMockHost` (test.mjs:175-211) exposes `{ call, routes }`; `call()`
   returns only `{status,data}`. Header assertions must use the `routes` map with a raw
   `new Request(...)` (existing pattern at test.mjs:542) to read `response.headers`.

## Insertion anchors (verified)

- N1–N11: after the POST test block (ends line 943), before the yaml-ok test (line 945).
- N12: after the big client VM test (ends line 1652), before the codemapScript const (1654).
- Hoist target for `source`: top constants area, right after NS/EXAMPLE_* (line 36).
- `WIN_HOME_TOKEN`/`POSIX_HOME_TOKEN` constants: test.mjs:117-118. Token list: 116-134.
  Backup-suffix literal: 135-136 (content ban 1853-1854, only .gitignore exempt).
- Hygiene scan (1846-1860) covers EVERY disk file except .git/node_modules — including
  .devflow/ notes and evidence. Every file written this run must be token-clean.
- Suite summary: 1871-1872 (`ALL TESTS PASSED` / `N TEST(S) FAILED`, exit 0/1).

## Harness facts that bind workers

- VM sandbox globals ONLY: window, fetch, encodeURIComponent, JSON, Map, Set, Array,
  Object, Promise, Number, String, Symbol, Error. React stub: createElement/useState/
  useEffect only. Regex literals and String.matchAll work in the sandbox.
- withMockHost: tmp-home pattern = mkdtempSync + DSH_AGENTS_HOME override + rmSync.
- GREEN stdout is token-clean; FAILURE output carries absolute tmp paths — never write
  failure output to any repo file.