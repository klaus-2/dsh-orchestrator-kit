# Verification delta — D-5 regression tests N14–N16 (backlog-60-pass1)

Date: 2026-11-19. Lane: test-writer (fix-tests). Write scope: `scripts/test.mjs`
only + this evidence directory. Base: HEAD e4f34b5 + the Pass 1 working diff with
the D-5 redaction fixes F1–F4 already landed in index.js.

## New tests (exact labels; inserted after N13, before the yaml-ok test)

- N14 `redaction: adversarial secret shapes are fully redacted and linear`
- N15 `request and frontmatter caps enforce UTF-8 bytes at the exact boundary`
- N16 `no-op save honors CRLF cards and the depth cap boundary`

Green arithmetic: 52 ok (I1/I2 final state) + 3 new tests = **55 ok**, 0 FAIL.
No existing assertion was changed or weakened; the only edit is the insertion of
the three new test blocks.

## Coverage summary

- N14 (unit, dynamic import of `redactText`): JSON-form `{"api_key"|"token"|
  "password":"<32-hex>"}` fully redacted; credential URL with `@` inside the
  password consumed to the LAST `@` (no tail); double- and single-quoted
  multi-word secrets consumed whole with closing quote preserved; AIza query key
  redacted with host/path intact; colon-run input `'a://' + ':'.repeat(60000)`
  completes and returns a string (NO stopwatch assertion — linearity is proven
  by the red-side evidence below); frozen N4 expectations preserved; idempotence
  for every new shape.
- N15 (HTTP, withMockHost): astral body (60000 astral chars, 240048 bytes) → 413
  before disk (bytes + mtime unchanged); BMP body (30000 three-byte chars:
  30048 UTF-16 units < cap, 90048 bytes > cap) → 413 — the byte-vs-unit
  discriminator; ASCII body of EXACTLY 65536 bytes → not 413 (reaches card
  lookup, 404 for the absent card); 65537 bytes → 413; frontmatter block of
  EXACTLY 65536 bytes with multibyte filler (32795 units) → listable (lenient
  GET) and a real write (disabled-key removal) answers 200, not cap-rejected;
  65537-byte multibyte block → invalid[] entry + POST 400 with the cap message,
  disk byte-identical. Exact-byte fixtures built by measuring
  `Buffer.byteLength` and trimming padding.
- N16 (HTTP + parser): canonical CRLF card, identical POST → 200
  `unchanged:true`, role deep-equals the GET summary, bytes identical, mtime
  unchanged (baseline pinned 60 s in the past as state setup), no lock file;
  depth boundary pinned firsthand: 21 nested collections (visit path length 24)
  accepted by strict parse and POST (200), 22 nested collections (path 25)
  refused with `nesting is too deep` (400), disk byte-identical.

## Boundary probe (temp script, OS temp, deleted)

A probe against the real index.js confirmed before writing the tests: depth
levels 19/20/21 accept, 22/23/24 reject (`frontmatter nesting is too deep`);
CRLF canonical round-trip byte-identical; exact/over frontmatter blocks measure
65536/65537 bytes at 32795/32796 units; disabled:false write shrinks the block
to 65521 bytes and passes strict; bodies measure 65536/65537 (ASCII),
30048 units/90048 bytes (BMP), 120048 units/240048 bytes (astral); all N14
shapes redact idempotently; colon-run completes in 1 ms on the fixed code.

## Red proofs (temp mutants in OS temp; all artifacts deleted afterwards)

Commands: `node <os-tmp>/red-harness.mjs` (harness imports a pre-fix module and
mutant copies of the CURRENT index.js; bare imports rebased to the repo's
node_modules entry files; each mutation anchor verified to occur exactly once).
Harness exit 0; per-check verdicts below are the recorded assertions.

### N14 — pre-fix redactText (frozen plan 3.3 regexes, pre-F1/F2/F3)

7 FAIL / 5 pass / 1 evidence. Failing shapes (verbatim, token-clean):

- `{"api_key":"0123456789abcdef0123456789abcdef"}` → unchanged (hex leaks);
  same for `"token"` and `"password"` JSON keys.
- `https://svcuser:Sup3r@Secret@api.example.invalid/v1` →
  `https://[redacted]@Secret@api.example.invalid/v1` (credential tail leaks).
- `password="correct horse battery staple"` →
  `password="[redacted] horse battery staple"` (trailing words leak);
  single-quoted variant leaks the same tail.
- AIza query-key URL → key survives unchanged.
- Frozen shapes (simple cred URL, `api_key=fixturevalue123`, Authorization
  header, sk- shape, plain URL interior) all still pass on the pre-fix code —
  the failures are exactly the amended shapes.
- Linearity evidence (measurement, NOT a suite assertion): pre-fix
  `redactText('a://' + ':'.repeat(60000))` took **6641 ms** (quadratic
  backtracking); the fixed code completed the same input in **1 ms** (probe).

### N15 — cap mutant: both `Buffer.byteLength(x,'utf8')` sites → `x.length`

3 FAIL / 4 pass / 1 evidence.

- BMP body (units under cap, bytes over): expected 413, mutant answered **503**
  (body admitted past the cap, reached fail-closed catalog validation).
- 65537-byte multibyte frontmatter: expected invalid[] entry, mutant listed it
  in roles (`roles=["planner","wide","wide-over"]`); expected POST 400 cap,
  mutant answered **200** (wrote it).
- Astral body 413, exact-65536 body 404, 65537 ASCII body 413, exact-cap
  frontmatter listable: pass on the mutant too (these pin the boundary, the
  multibyte shapes carry the red).
- Diagnostic: string-body Request exposes `content-length: null` — the
  post-read cap branch is the one exercised (matches decision D-1).

### N16 — no-op mutant: `next === text` → `next === text && !text.includes('\r')`

2 FAIL / 1 pass. CRLF identical POST: `unchanged` expected true, got
**undefined**; mtime expected unchanged, got bumped (write path taken).
Status 200 passes on both (a write also answers 200 — the unchanged flag and
mtime carry the red).

### N16 — depth mutant: `path.length > FRONTMATTER_MAX_PATH` → `path.length > 10`

2 FAIL / 1 pass. Strict parser rejects the 21-level card
(`frontmatter nesting is too deep`); 21-level POST expected 200, got **400**.
22-level POST still 400 (pass).

## Green + anti-flake (this lane, fresh runs)

- `node --check scripts/test.mjs` → exit 0 (also index.js, client.js → exit 0;
  see `node-check-delta.log`).
- `node scripts/test.mjs` → exit 0, **55 ok / 0 FAIL**, final line
  `ALL TESTS PASSED`; the three new labels each report `ok`.
- Anti-flake: **5 consecutive full-suite runs, 5/5 green**, zero retry masking.
  Logs: `test-run-delta-1.log` … `test-run-delta-5.log` (green output only;
  each log: 55 `ok` lines, 0 `FAIL` lines, final line `ALL TESTS PASSED`).

## Hygiene

All new fixtures are token-clean; secret/home shapes are assembled via
split-literal joins at runtime (repo convention). Red-proof summaries above
carry no absolute paths; failure logs were never saved (green logs only).
Temp probe/mutant artifacts were deleted after the runs.