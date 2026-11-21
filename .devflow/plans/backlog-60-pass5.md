# Backlog-60 Pass 5 — Test Infrastructure & Documentation (executable plan)

> **Execution:** `run-conductor` executes this plan task-by-task after a
> `plan-auditor` `OKAY` verdict. Workers have ZERO interview history: everything
> needed is in this file. Master context: `.devflow/plans/backlog-60-master.md`
> (C1, C8, C12, C13, C14, C15, C16, C22 bind this pass). Repo rules: `AGENTS.md`.
> Pass-4 trail: `.devflow/plans/backlog-60-pass4.md` (rev 2, auditor OKAY),
> `.devflow/evidence/backlog-60-pass4/verification.md` + `item60-decision.md`,
> review-loop 8/10 READY after 4 rounds, two adversarial workflows, security gate.

**Goal:** ship the final verification and documentation slice as ONE atomic
commit — native V8 coverage with a hand-rolled reporter and thresholds, the
versioned client.js byte budget, six durable docs files, an in-runner relative
link/anchor checker, `scripts/docs-parity.mjs`, CI step mirroring into BOTH
workflows, trilingual README/CHANGELOG/CONTRIBUTING reconciliation — all in the
SAME commit. `index.js` and `client.js` are assertion targets ONLY and MUST stay
byte-identical (no source change is needed for any gate; if one appears, STOP
and escalate to the lead).

**Architecture:** all new logic lives in `scripts/test.mjs` (coverage parser,
byte budget, link checker) and `scripts/docs-parity.mjs` (README structural
check, imported by test.mjs). Coverage uses `NODE_V8_COVERAGE` (runner-agnostic,
live-proven this turn) and a small parser over the emitted JSON's
`functions[].ranges[].count` — NO new dependency: `c8` is absent from
`node_modules` and adding it would require a lockfile/network install, so the
parser is the deterministic choice (C13 permits either). CI gains ONE coverage
gate step in each workflow, mirrored exactly (C22).

**Tech Stack:** unchanged runtime — Node >= 22, `yaml`, React via host seed,
`node:vm`; dev-only: `node:fs`, `node:path`, `node:url`, `node:child_process`
(already imported in test.mjs, lines 1-19). NO new devDependency; NO new runtime
dependency; NO package.json `dependencies`/`exports`/`files` change (the six new
docs files are auto-included by the already-whitelisted `docs/` entry at
package.json:42; the two scripts by `scripts/` at package.json:45). The only
possible package.json delta is adding a `scripts.coverage` convenience entry —
FROZEN DECISION: do NOT add it (CI calls `node scripts/test.mjs` with the env
set; the package-contract test at test.mjs:1937 pins `scripts.test` and stays
untouched; zero package.json edits this pass).

**Backlog items covered:** 13 (native coverage + thresholds + CI/publish),
58 (client.js size budget, versioned ceiling 102,400 set by Pass 4's explicit
decision), 14 (docs/glossary.md), 15 (CI link/anchor checker), 16
(scripts/docs-parity.mjs), 17 (docs/recipes.md), 18 (docs/role-card.md),
19 (docs/architecture.md), 20 (docs/troubleshooting.md), 21 (docs/api.md),
plus README×3 final reconciliation, CHANGELOG consolidation, CONTRIBUTING
glossary link.

**Baseline (verified fresh this planning turn, mechanically):** HEAD `5bba782`,
clean tree; `node scripts/test.mjs` → 78 ok / 0 FAIL (78 `await test(` labels,
script-counted); index.js **957 lines / 44,640 bytes**; client.js **1744 lines /
100,055 bytes** (the brief's 99,914 was the Pass-4 I1 measurement; current disk
value is authoritative — headroom to 102,400 = **2,345 bytes**); scripts/test.mjs
5191 lines; locale **122 keys ×3**; FROZEN_PACK_FILES **70** (docs/: DETAIL.md,
preview.svg, showcase.svg; scripts/: install-craft.js, test.mjs); READMEs
**194 lines / 13 headings / 4 fences each** (all three identical); docs/ holds
exactly 3 files; `scripts/docs-parity.mjs` absent; `c8` absent; Node v26.12.1;
ci.yml 34 lines / publish.yml 34 lines. V8 coverage probe: suite green with
`NODE_V8_COVERAGE` set, 20 JSON files / **3,661 total V8 entries** (108 = the
entry count of ONE representative file, not the directory), own-source entries
found across the files, schema
`{ url, functions:[{ functionName, ranges:[{startOffset,endOffset,count}],
isBlockCoverage }] }`.

**Pass-5 arithmetic (frozen; §8):** baseline 78 + **6 new tests** = **84 green**;
red gate **9 FAIL / 75 ok** (84 total): the 6 new tests plus THREE additive
reworks — pack 70→76 (RW-P5-1), node --check 4→5 and LF/BOM 9→10 (RW-P5-2) —
all red at HEAD for the documented reasons in §3.10; pack 70 + 6 docs files =
**76**; client ceiling 102,400 (100 × 1024) with measured 100,055 and 2,345
headroom; coverage floor **70% statements / 60% functions** (frozen in 3.2);
real-probe own-source coverage 87.2% functions / 84.7% statements with the
corrected filter.

---

## 1. Context (read before touching anything)

### 1.1 Current anchors (re-verified on disk at 5bba782 this turn)

scripts/test.mjs (5191 lines, 78 tests):
- imports 1-19 (assert, child_process `spawnSync`, fs Sync APIs incl. `statSync`
  at 12, os `homedir,tmpdir`, path, url `fileURLToPath,pathToFileURL`, vm
  `createContext,runInContext`, yaml `parseDocument`, index.js exported helpers
  20-28); `packageDir` 32; `PKG` 33; `NS` 35; `FORBIDDEN_TOKENS` 123+;
  `BAK_LITERAL` 139; `repoFiles` 144; `failures` 158; `test()` 160;
  `withMockHost` 179; route-surface test 1898-1904 (regex
  `(roles|catalog|efforts|route|events|diagnostics)`, count **6**, deepEqual
  1903); package-contract test 1906-1943 (exports deepEqual 1917-1923, files
  deepEqual 1924-1936, `PKG.scripts.test` 1937, dependencies 1941-1942);
  static contract 1945-1963 (`shouldCancel` 1955, readonly 1956, no failsafe
  1962); node --check array 1965-1970 (**4** entries: index.js, client.js,
  test.mjs, install-craft.js); LF/BOM array 1972-1978 (**9** entries:
  package.json, cordis.patch.yml, index.js, client.js, test.mjs, install-craft.js,
  locale ×3); mountVmClient 1980+; shared helpers 2194-2206; P2-N1 locale
  parity test label **2854** (the 2824-2846 region is the FROZEN PANEL_KEYS
  array entries, not a test); P2-N2 label 2878; P2-N3 sentinel 2902-3210;
  P2-N4 3223-3339; P3/P4 tests 3341-4930; npm-pack test 4930-4977
  (`entryCount` 4935, FROZEN deepEqual 4936/4956, `tar --force-local` 4943 —
  do not change); codemap 4975-5097; craft tests 5099-5127; hygiene
  5165-5179; rename 5181-5188; summary/exit 5190-5191.
- FROZEN_PACK_FILES array: **70** entries; docs/ currently DETAIL.md,
  preview.svg, showcase.svg; scripts/ currently install-craft.js, test.mjs.

index.js (957 lines): route literals **6** (`.roles`, `.catalog`, `.efforts`,
`.route`, `.events`, `.diagnostics`); export block at the tail. MUST stay
byte-identical this pass.

client.js (1744 lines / **100,055 bytes**): MUST stay byte-identical.

README.md / README.pt-BR.md / README.zh-CN.md: **194 lines / 13 headings /
4 fences (2 code blocks) each**, structurally identical (verified by script;
a final newline makes a naive `split('\n').length` report 195 — the audited
line count is 194);
13 headings include `## Configure per role` (54), `## Batch apply, profiles,
change log and diagnostics` (86), `## Install the craft bundle with the script`
(93), `## The 20 roles` (103), `## FAQ` (140), `## Contributing` (184),
`## Security` (188), `## License` (192). Six routes are ALREADY documented from
Pass 4 — verify parity, do NOT churn text.

CHANGELOG.md (68 lines): `## [Unreleased]` 12; `### Added` 14 carrying passes
1-4 bullets; `### Changed` around 32; `### Fixed` around 42; link refs 67-68.
CONTRIBUTING.md (49 lines): `## Tests` 15, `## Pull requests` 37,
`## Security` 47 — the glossary link goes in a new `## Terminology` section.

docs/: DETAIL.md (98 bytes, referenced by locale meta.detail), preview.svg
(5,074 bytes), showcase.svg (25,991 bytes) — the six new .md files are NEW.

.github/workflows/ci.yml (34 lines): matrix Node 22/24, steps checkout,
setup-node, npm ci, test run 1, test run 2 anti-flake, verify pack whitelist.
.github/workflows/publish.yml (34 lines): Node '24', registry-url,
package-manager-cache false, npm ci, test suite, verify pack whitelist, npm
publish. Coverage step must be added to BOTH at the equivalent position.

### 1.2 Prior-pass lessons that bind this pass

- Zero-narrative comments; explicit catch fallbacks; plan read-only during
  execution; discoveries to `.devflow/notes/backlog-60-pass5/`; contract
  defects STOP + escalate.
- The audit rounds on plans 3/4 were ALL arithmetic/anchor drift: every number
  in this plan was precomputed and mechanically probed BEFORE the first draft
  (see §9 self-review); no value is quoted from memory of an earlier revision.
- Pass-4 I1 discipline: frozen-test deviations are contract-wins test-side
  fixes recorded in the evidence Amendment-trail; assertions are never weakened.
- Q6: localStorage same-session; coverage/budget are CI gates, never shipped
  runtime behavior.

### 1.3 Harness semantics that bind this pass

- `NODE_V8_COVERAGE` is emitted per Node process (the test runner spawns npm
  pack and installer subprocesses — 20 JSON files / 3,661 total entries
  observed); the parser aggregates ALL files in the DATA directory and selects
  own sources by URL→filesystem resolution: `fileURLToPath(entry.url)`,
  containment under `packageDir`, exclusion of `node_modules`, and EXACT
  relative paths `index.js` / `scripts/test.mjs` (client.js stays excluded —
  vm-evaluated). A basename-suffix predicate is REJECTED (263 false matches).
  The report process writes to a DIFFERENT emit directory so it cannot double
  the data (C13 live-proven this turn; §3.1/§3.2).
- The hygiene test scans ALL disk files including `.devflow/` — plan, notes,
  evidence, new docs and the parser fixture strings must be token-clean.
- The pack test's `tar --force-local` is environment-specific and already
  frozen — do not touch it. Adding six `docs/*.md` files grows the pack by
  exactly six (docs/ whitelisted, no nested dirs).

## 2. Must Have / Must NOT Have (Pass 5)

Must have:
- ONE atomic commit (C1): scripts/test.mjs + scripts/docs-parity.mjs (NEW) +
  docs ×6 (NEW) + README×3 + CHANGELOG + CONTRIBUTING + ci.yml + publish.yml
  together. NO index.js/client.js/package.json/locale edits.
- Coverage reporter = hand-rolled parser over V8 JSON (no c8, no new deps);
  thresholds 70% statements / 60% functions; CI-only gate mirrored into BOTH
  workflows (C13/C22); locally runnable via env var.
- client.js byte budget: measured via statSync in-suite, ceiling 102,400
  (100 KiB), headroom policy frozen (3.3).
- Six docs files with the specified content anchors (3.5); every relative link
  and heading anchor resolvable by the in-runner checker (3.4).
- README structural parity verified by the imported docs-parity module; the
  three READMEs stay at 194 lines / 13 headings / 4 fences unless the final
  reconciliation changes all three identically (then the parity test uses the
  SHARED shape, never hardcoded 194/13/4).
- FROZEN_PACK_FILES 70 → **76** with the six new docs paths (additive rework,
  mechanically verified).
- Anti-flake 5×; evidence under `.devflow/evidence/backlog-60-pass5/`;
  green logs only; token-clean everywhere.
- Tests + verification logs ride the same commit.

Must NOT have:
- No source behavior change (index.js/client.js byte-identical); no new POST
  route; no new runtime/dev dependency; no package.json change at all.
- No separate CI step for docs-parity (imported into test.mjs); every CI step
  that exists must be mirrored into publish.yml (C22).
- No external network fetch in the link checker (relative links/anchors only,
  no flake); no absolute/tmp/user paths in fixtures or evidence.
- No machine tokens, no backup-suffix literal, no old plugin identity.
- No push; commit only via the git-commit skill.

## 3. Contract Freeze (binds ALL tasks; frozen BEFORE parallel work)

### 3.1 V8 coverage runner invocation (CI-only gate, C13)

CI step (both workflows), exact shape — TWO run lines, BOTH directories OUTSIDE
the checkout:

```yaml
- name: Coverage gate
  run: |
    NODE_V8_COVERAGE=${{ runner.temp }}/dsh-coverage node scripts/test.mjs
    NODE_V8_COVERAGE=${{ runner.temp }}/dsh-coverage-report node scripts/test.mjs --coverage-report --coverage-dir=${{ runner.temp }}/dsh-coverage
```

Local equivalent (documented in CONTRIBUTING): same two commands with
`<os.tmpdir()>` substituted for `${{ runner.temp }}`:

```bash
NODE_V8_COVERAGE=$(node -p "require('node:os').tmpdir()")/dsh-coverage node scripts/test.mjs
NODE_V8_COVERAGE=$(node -p "require('node:os').tmpdir()")/dsh-coverage-report node scripts/test.mjs --coverage-report --coverage-dir=$(node -p "require('node:os').tmpdir()")/dsh-coverage
```

BOTH directories MUST be outside the checkout. Reason (binding, C13 + C12):
`repoFiles()` ignores only `.git`/`node_modules`, so coverage JSONs written
inside the tree are scanned by the hygiene test; V8 embeds absolute URLs of
global npm modules (including a machine-specific user path) that match
FORBIDDEN_TOKENS → cmd1 exits 1 with `FAIL repo hygiene` and the gate can NEVER
be green. The user explicitly CHOSE the external-directory alternative — the
walker is NOT weakened (no RW-P5-3). The two processes use DIFFERENT external
dirs so the report process cannot double the emitter entries (round-3 defect);
the parser reads its data root ONLY from `--coverage-dir=<external data dir>`.
Both workflow steps are byte-identical. The report run MUST be the same
`scripts/test.mjs` entry point (one source of truth), with `--coverage-report`
(skips the normal test matrix, runs only parser+thresholds) and
`--coverage-dir=<dir>` (external data root). NO new script file besides
docs-parity.mjs; NO package.json script entry.

MANDATORY preflight (executed this revision, numbers in §9): on clean external
dirs, run cmd1 then cmd2 exactly as above with `<os.tmpdir()>`. Results: cmd1
exit **0** (hygiene green — 0 coverage JSONs inside the checkout), emits 20 JSON
files into the external data dir; cmd2 exit **0**, emits 20 into its own external
dir and leaves the data dir at 20; the parser over the external data dir yields
3,661 entries, 263 old-suffix false matches, 2 own-source slots → **87.2%
functions / 84.7% statements**. Absolute `count` totals vary slightly between
runs (2033–2034 statement ranges) because spawned subprocesses contribute a
varying number of ranges; the PERCENTAGES are stable — freeze the floors and
percentages, never the absolute totals.

Root rules: in REPORT mode the data root comes ONLY from `--coverage-dir=<dir>`
(the report process's own `NODE_V8_COVERAGE` points at a DIFFERENT external
directory — never read it); in EMIT mode the env is the caller's external output
directory. Report mode WITHOUT `--coverage-dir` exits 1 with "coverage root is
missing — pass --coverage-dir=<dir>" — the env is NOT offered as an alternative
in report mode, and a report with only `NODE_V8_COVERAGE` is explicitly REJECTED
(P5-N2). NODE_V8_COVERAGE is never set by test.mjs itself. Guard: `coverageRoot`
must be a non-empty string; the external path is used verbatim (relative paths
resolve against cwd, but CI/local always pass an absolute tmp path). The parser
NEVER writes.

### 3.2 Coverage parser + thresholds (hand-rolled, deterministic)

Module scope in test.mjs (after the imports, before the test registry):

```js
import { readdirSync as covReaddir } from 'node:fs';   // extend the EXISTING line 3-14 import instead — no second import statement

const coverageDirArg = process.argv.find((arg) => arg.startsWith('--coverage-dir='));
const isReport = process.argv.includes('--coverage-report');
const coverageRoot = coverageDirArg
  ? coverageDirArg.slice('--coverage-dir='.length)
  : (isReport ? null : process.env.NODE_V8_COVERAGE);
if (isReport && !coverageDirArg) {
  console.error('coverage root is missing — pass --coverage-dir=<dir>');
  process.exit(1);
}

function collectCoverage(root) {
  const files = covReaddir(root).filter((name) => name.endsWith('.json'));
  const merged = new Map();
  for (const name of files) {
    const doc = JSON.parse(readFileSync(path.join(root, name), 'utf8'));
    for (const entry of doc.result ?? []) {
      if (typeof entry.url !== 'string' || !entry.url.startsWith('file://')) continue;
      let absolute;
      try {
        absolute = fileURLToPath(entry.url);
      } catch {
        continue;
      }
      if (!absolute.startsWith(packageDir + path.sep)) continue;
      if (absolute.includes(`node_modules${path.sep}`)) continue;
      const rel = path.relative(packageDir, absolute).split(path.sep).join('/');
      if (rel !== 'index.js' && rel !== 'scripts/test.mjs') continue;
      const slot = merged.get(rel) ?? { functions: 0, covered: 0, statements: 0, statementsCovered: 0 };
      for (const fn of entry.functions ?? []) {
        slot.functions += 1;
        if ((fn.ranges ?? []).some((range) => range.count > 0)) slot.covered += 1;
        for (const range of fn.ranges ?? []) {
          slot.statements += 1;
          if (range.count > 0) slot.statementsCovered += 1;
        }
      }
      merged.set(rel, slot);
    }
  }
  return merged;
}
```

The filter is URL→filesystem resolution, NOT a basename suffix: `fileURLToPath`
(already imported, test.mjs:17) + `packageDir` containment + explicit
`node_modules` exclusion + exact relative paths `index.js` / `scripts/test.mjs`.
The earlier suffix predicate (`['index.js','client.js','test.mjs'].some((own) =>
key.endsWith(own))`) matched **263** V8 entries of which 246 were node_modules
(`lib/index.js`, `dist/index.js`, `commonjs/index.js`, npm-internal `client.js`)
— a machine-dependent denominator that drove the gate ALWAYS RED (51.0%
functions / 54.9% statements on the real probe). The frozen filter matches
exactly **7** own-source entries across the 20 JSON files. Machine-independent
denominator: only files under `packageDir` and outside `node_modules`, keyed by
the repo-relative path; no drive letter, user home, or npm cache path can enter
the ratio. Simulated on the real 20-file probe (this turn): `index.js` 88/188
functions + 439/618 statements; `scripts/test.mjs` 710/727 functions +
1282/1415 statements → **87.2% functions (798/915) / 84.7% statements
(1721/2033)** — both floors pass with margin.

Thresholds (frozen numbers): `STATEMENT_FLOOR = 0.70`, `FUNCTION_FLOOR = 0.60`;
both computed over the merged own-source slots; the report prints
`statements: <n>/<total> (<pct>%)`, `functions: <n>/<total> (<pct>%)` then
`COVERAGE OK` or `COVERAGE FAILED: <reason>`. Report mode exits 0 only when
BOTH floors pass AND at least one own-source slot exists (guards against an
empty coverage dir). Note: `client.js` is vm-evaluated from a source string, so
it may have NO V8 entry — freeze: client.js is EXCLUDED from the threshold
denominator when absent (documented in the report as `client.js: vm-evaluated —
no V8 entry`); thresholds apply to index.js + test.mjs entries. This is the
honest, deterministic reading of "native coverage" for a vm-evaluated bundle.

### 3.3 client.js byte budget (item 58, versioned ceiling)

In-suite assertion (normal run, not report mode):

```js
const CLIENT_BYTE_CEILING = 102400;
await test('client.js byte budget: the shipped panel stays under the versioned 100 KiB ceiling', () => {
  const size = statSync(path.join(packageDir, 'client.js')).size;
  assert.ok(size <= CLIENT_BYTE_CEILING, `client.js is ${size} bytes; ceiling is ${CLIENT_BYTE_CEILING} (100 KiB) — bump the versioned ceiling by explicit commit or split a chunk (C17)`);
});
```

Frozen policy: measured baseline 100,055 bytes (HEAD 5bba782), headroom 2,345
bytes. Any future increase past 102,400 requires (a) an explicit commit that
raises the versioned constant with the measured number and rationale, or
(b) the C17 chunking path (one require.async chunk + sibling scanners + missing
-chunk fallback). The budget assertion NEVER self-adjusts. `statSync` is
already imported in test.mjs (`statSync` at line 12).

### 3.4 Link/anchor checker (item 15, in-runner, relative only)

New test in test.mjs (P5-N5), pure functions (no network):

```js
function checkLinks(markdownFiles) {
  const findings = [];
  const anchorsOf = (text) => new Set(
    [...text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)].map((m) =>
      m[1].toLowerCase().replace(/[^\w\u00C0-\uFFFF -]/g, '').trim().replace(/\s+/g, '-')));
  for (const file of markdownFiles) {
    const text = readFileSync(file, 'utf8');
    const dir = path.dirname(file);
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (target === '' || /^[a-z]+:\/\//i.test(target) || target.startsWith('//')) continue; // same-file anchor or absolute URL: skip (no external flake)
      const resolved = path.resolve(dir, decodeURIComponent(target));
      if (!resolved.startsWith(packageDir + path.sep)) {
        findings.push(`${path.relative(packageDir, file)}: link escapes the repo: ${target}`);
        continue;
      }
      if (!existsSync(resolved)) {
        findings.push(`${path.relative(packageDir, file)}: missing file: ${target}`);
        continue;
      }
      const hash = match[1].split('#')[1];
      if (hash && resolved.endsWith('.md') && !anchorsOf(readFileSync(resolved, 'utf8')).has(hash.toLowerCase())) {
        findings.push(`${path.relative(packageDir, file)}: missing anchor #${hash} in ${target}`);
      }
    }
  }
  return findings;
}
```

Scanned set: README×3, CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, AGENTS.md,
craft/README.md, docs/*.md (the six new ones + DETAIL.md). No `.github/` YAML,
no locale JSON, no SVG. Findings array MUST be empty; the test prints the count
checked. `packageDir` is already module scope (test.mjs:30). External URLs and
`mailto:` are skipped by design (no network, no flake, C22-safe).

### 3.5 Six durable docs files (items 14, 17-21)

All new under `docs/`, LF/no BOM, token-clean, no machine paths (repo-relative
and `~/.agents` only where the repo already uses it):

1. **docs/glossary.md** — en headings + pt-BR/zh term tables for: role, phase,
   harness catalog, reasoning effort, inherit, route, dispatch, batch, profile,
   audit trail, readonly, content-visibility, expectedMtimeMs. Each term:
   English term, pt-BR term, zh-CN term, one-line definition (no invented
   credentials/models). Referenced by CONTRIBUTING's new `## Terminology`.
2. **docs/recipes.md** — 3 budget recipes: economical (most roles inherit, pin
   only `arch-advisor`/`planner` to a cheap routed model), balanced (pin the
   4 advisory/planning roles), max-quality (pin all 20). Each: a commented YAML
   snippet using the shipped frontmatter keys (`provider`, `model`,
   `reasoning_effort`, `disabled`) and a per-phase cost rationale. NO invented
   provider/model ids — use the fixture-neutral placeholders `example-hub/
   flash-a` style only in commented examples.
3. **docs/role-card.md** — frontmatter reference: required `name`,
   `description`; optional provider/model pair (inherit reset), reasoning_effort
   (snake canonical, camel alias, conflict rule), disabled; strict-mode bans
   (anchors/aliases/custom tags/deep nesting), 65536-byte cap, CRLF/BOM behavior
   and byte-identical body outside routing keys.
4. **docs/architecture.md** — the atomic-write sequence: validate → path
   containment (realpath/symlink guards) → expectedMtimeMs gate → withFileLock
   → writeFileAtomic → read-back/post-write validation → best-effort audit
   append inside the SAME lock → 200; no-op/unchanged and 409/503 branches;
   the six-route surface table and the owner-auth trust fence (host-level).
5. **docs/troubleshooting.md** — failure table: 400 unknown field / strict YAML,
   409 route/catalog/effort/stale-mtime, 503 lock-timeout/catalog unavailable,
   invalid[] cards, readonly 403, profile validate rejection, installer lock
   guidance, V8 coverage gate failure, byte-budget overflow. Each row:
   symptom, cause, corrective action (no auto lock removal).
6. **docs/api.md** — SIX routes (roles/catalog/efforts/route/events/diagnostics):
   methods, query/body fields, status codes, envelope shapes (including
   `readOnly` on roles), event record schema, diagnostics report fields.
   Matches index.js 5bba782 exactly; no new route invented.

### 3.6 scripts/docs-parity.mjs (item 16, imported not separate CI step)

New ESM module exporting `checkDocsParity(files)` → array of finding strings:
- compares the THREE READMEs' heading list (`^#{1,3} ` lines, text only),
  table-row counts (`/^\|/` lines per table), and fenced-code block count
  (` ``` ` occurrences / 2) — all three must be identical;
- returns `[]` on parity, otherwise `README.pt-BR.md: headings differ ...`;
- no CLI side effects on import (CI calls it only through test.mjs);
- no network, no file writes. test.mjs imports it via `pathToFileURL` +
  dynamic `import()` (pattern already used for codemap.mjs at test.mjs:4975+),
  asserts `typeof checkDocsParity === 'function'`, calls it on the three
  READMEs, asserts `[]`. If the final reconciliation changes the READMEs, the
  parity check uses the SHARED shape (never hardcoded 194/13/4).

### 3.7 README/CHANGELOG/CONTRIBUTING final reconciliation

- README×3: verify the six routes and Pass-4 features are documented; keep
  structural parity (13 headings / 4 fences baseline — only change if all three
  change identically); add a short "Verification" line in `## Contributing`
  (184) pointing at the coverage/byte gates and docs/ contents. No new i18n
  mechanism; no dictionary keys (locale 122 stays).
- CHANGELOG `[Unreleased]`: KEEP passes 1-4 bullets verbatim; add under
  `### Added` — native coverage gate with thresholds, client.js byte budget,
  six reference docs, docs-parity + link/anchor checks; under `### Changed` —
  CI/publish workflows gained the mirrored coverage gate.
- CONTRIBUTING: new `## Terminology` section with a relative link
  `[docs/glossary.md](docs/glossary.md)`; `## Tests` (15) gains the two coverage
  commands from 3.1 VERBATIM, including `$(node -p
  "require('node:os').tmpdir()")` for BOTH output dirs — documented warning:
  coverage dirs MUST be outside the checkout or the hygiene test fails on
  absolute npm URLs in the V8 JSON; sanitization/PR rules unchanged.

### 3.8 CI step mirroring (C22)

ci.yml: add the 3.1 `Coverage gate` step AFTER "Test suite (run 2, anti-flake)"
and BEFORE "Verify pack whitelist" (mirrors the order in both files).
publish.yml: add the SAME step AFTER "Test suite" and BEFORE "Verify pack
whitelist". Both steps byte-identical (name + the exact 2-line `run:` block from
3.1: cmd1 emits into `${{ runner.temp }}/dsh-coverage`, cmd2 emits into
`${{ runner.temp }}/dsh-coverage-report` and reads the external data dir via
`--coverage-dir=${{ runner.temp }}/dsh-coverage` — DIFFERENT dirs, BOTH OUTSIDE
the checkout);
no other workflow change; checkout/setup-node SHAs untouched. Publish keeps
`npm publish` last.

### 3.9 Harness reworks (additive only)

NO harness extension is required (the parser is normal Node; V8 coverage is
env-driven). Existing-test edits in test.mjs:

- **RW-P5-1 pack contract:** FROZEN_PACK_FILES gains the six docs paths
  (`docs/api.md`, `docs/architecture.md`, `docs/glossary.md`,
  `docs/recipes.md`, `docs/role-card.md`, `docs/troubleshooting.md`) → **76**
  entries; `entryCount` 70 → 76; the test label becomes `npm pack: dry-run file
  list matches the frozen 76-entry contract and packed content passes the
  forbidden-token scan`. RED at HEAD (live pack 69 at planning; 70 at HEAD —
  both < 76). Mechanically verified: 70 + 6 = 76, docs/ whitelisted, flat.
- **RW-P5-2 node --check / LF-BOM arrays:** NO change needed — the new
  docs-parity.mjs is under scripts/ but is it shipped and node --check?
  FROZEN DECISION: add `'scripts/docs-parity.mjs'` to the node --check array
  (4 → 5 entries) and to the LF/BOM array (9 → 10 entries). RED at HEAD (file
  absent → spawnSync failure / readFileSync throw). Both arrays are additive.

### 3.10 Red/green arithmetic (frozen; §8)

Baseline 78; new tests **6** (P5-N1…P5-N6, §3.12) → **84 total**.
Red at HEAD: 6 new + 3 rework-affected existing labels (pack RW-P5-1,
node --check RW-P5-2a, LF/BOM RW-P5-2b) = **9 FAIL / 75 ok**, final
`9 TEST(S) FAILED`, exit 1. Green after implementation: **84 ok**.
Pack 70 → 76; route surface stays 6/6; locale 122 (no new keys); README parity
shape unchanged unless all three change together; byte budget 100,055 ≤ 102,400.

### 3.11 Item 60 tie-in

Pass 4 raised the ceiling from 98,304 to 102,400 by explicit commit (no chunk).
Pass 5 freezes the enforceable assertion at 102,400 with the measured 100,055
and 2,345 headroom; no chunk ships; the C17 mechanism stays dormant. Recorded in
verification.md with the exact numbers.

### 3.12 New test labels + minimum assertions (P5-N1…N6)

1. `native V8 coverage: the hand-rolled reporter aggregates NODE_V8_COVERAGE JSON and enforces 70% statements / 60% functions on own sources` — P5-N1:
   with a synthetic coverage dir fixture (tmp), assert 2 JSON files merged,
   ranges counted, the URL→filesystem filter resolving only `index.js` +
   `scripts/test.mjs` under packageDir and outside node_modules (a fixture
   entry `file:///…/node_modules/lib/index.js` plus a `client.js` vm entry must
   be EXCLUDED — the real 20-file emit dir has 3,661 total V8 entries, of which
   the frozen suffix filter matched 263 and the corrected filter matches 2
   own-source slots; the FULL two-command sequence was re-simulated this
   revision: emit 20 files, report-run 20 files in a DIFFERENT dir, emitter
   unchanged at 20 → 87.2% functions / 84.7% statements), floors pass → report
   mode exit 0 + `COVERAGE OK` line.
2. `coverage gate fails closed: empty directory, missing coverage root and below-floor ratios each fail with the specified message` — P5-N2: three
   drives → exit 1 with exact messages: empty data dir → `no coverage entries`;
   missing `--coverage-dir` (WITH or WITHOUT `NODE_V8_COVERAGE`) → "coverage root
   is missing — pass --coverage-dir=<dir>"; below-floor ratios → `COVERAGE
   FAILED: …`. A report process with only its own `NODE_V8_COVERAGE` but no
   `--coverage-dir` is REJECTED (never reads the report runner's emit dir).
   Both fixture dirs are under os.tmpdir() (outside the checkout) so cmd1's
   hygiene drive stays green — the preflight proved cmd1 exit 0 with 0 coverage
   JSONs inside the checkout.
3. `client.js byte budget: measured size stays under the versioned 102400-byte ceiling with no self-adjustment` — P5-N3: at HEAD 100,055 ≤ 102,400 passes;
   a fixture that inflates the constant is NOT allowed (assert the literal
   102400 appears once in test.mjs); a fixture measuring 102,401 fails.
4. `docs-parity.mjs: three READMEs share headings, table rows and fenced blocks; importing has no side effects` — P5-N4: real READMEs → [];
   a tmp copy with one heading changed → finding string; import side-effect
   check (no file writes on import).
5. `docs links and anchors: every relative markdown link resolves in-repo with no external fetch` — P5-N5: real docs set → [];
   fixture with missing file, escaping path and bad anchor → 3 findings;
   external URL ignored (no fetch).
6. `pass-5 docs and static markers: six reference docs carry their sections and CI mirrors the coverage gate` — P5-N6: six docs exist, LF/no-BOM, each required heading/term present (computed from frozen anchors in 3.5); ci.yml and publish.yml each contain the byte-identical 2-command `run:` block from 3.1 (both paths under `${{ runner.temp }}`, OUTSIDE the checkout, `--coverage-dir=${{ runner.temp }}/dsh-coverage` on the report command, NO shared export); byte budget constant present.

## 4. Per-task contracts

Wave layout (shared checkout; suite runs ONLY at wave boundaries; ONE commit):

```
Step 0 (solo): T3 tests ── red evidence (9 FAIL / 75 ok, 84 total)
Wave 1 (∥):    T1 test.mjs gates | T2 docs-parity.mjs | T3 docs ×6 | T4 README×3+CHANGELOG+CONTRIBUTING | T5 CI×2
Wave 2 (solo): I1 integration green (84 ok) → I2 anti-flake 5× + evidence
Wave 3 (lead): security/diff review + review loop + live smoke + git-commit
```

Write scopes disjoint: **T1-test={scripts/test.mjs}**,
**T2-parity={scripts/docs-parity.mjs}**,
**T3-docs={docs/api.md, docs/architecture.md, docs/glossary.md, docs/recipes.md,
docs/role-card.md, docs/troubleshooting.md}**,
**T4-docs={README.md, README.pt-BR.md, README.zh-CN.md, CHANGELOG.md,
CONTRIBUTING.md}**, **T5-ci={.github/workflows/ci.yml,
.github/workflows/publish.yml}**, **I2={.devflow/evidence/backlog-60-pass5/}**.
index.js/client.js/package.json/locale are NOBODY's write scope this pass.

---

### T1-test — Gates in scripts/test.mjs (Step 0 solo + Wave 1 if fixes needed)

**Parallelizable:** Step 0 alone. **Write scope:** `scripts/test.mjs` ONLY.
**References:** 3.1-3.4, 3.9, 3.10, 3.12, 1.1.

**What to do:** Step 0 adds RW-P5-1 (pack 76), RW-P5-2 (arrays 5/10), P5-N1…N6
with the exact labels and the coverage parser/report mode (3.2) and byte budget
(3.3); run the red gate. Wave 1 (after T2/T3/T4/T5 land) fixes any test-side
deviation contract-wins. No source edits.

**Verify:** `node --check scripts/test.mjs` → 0; red gate `9 TEST(S) FAILED` /
75 ok with exactly §8's FAIL set; green gate 84 ok / `ALL TESTS PASSED`.

### T2-parity — scripts/docs-parity.mjs (Wave 1, parallel)

**Write scope:** `scripts/docs-parity.mjs` ONLY. Implements 3.6 exactly; no
import side effects; export named `checkDocsParity`.

**Verify:** `node --check scripts/docs-parity.mjs` → 0; a one-line node import
probe prints `[]` on the current three READMEs; no repo file modified.

### T3-docs — six reference files (Wave 1, parallel)

**Write scope:** the six new `docs/*.md` ONLY. Implements 3.5; LF/no BOM;
token-clean; six-route api.md matches index.js; no secrets/paths.

**Verify:** six files exist; LF/no-BOM scan exit 0; each frozen heading/term
from 3.5 present (script over files); link checker (T1's P5-N5) green after integration.

### T4-docs — README×3, CHANGELOG, CONTRIBUTING (Wave 1, parallel)

**Write scope:** those five files ONLY. Implements 3.7; README structural parity
preserved (or all three changed identically); CHANGELOG keeps passes 1-4;
CONTRIBUTING glossary link + coverage commands.

**Verify:** parity probe → 194/13/4 ×3 (or the new shared shape ×3); token scan
exit 0; link checker green.

### T5-ci — workflows (Wave 1, parallel)

**Write scope:** ci.yml + publish.yml ONLY. Implements 3.8; the coverage step
byte-identical in both; no other change.

**Verify:** diff shows only the added step in each file; both step blocks
deep-equal by script; SHAs of checkout/setup-node unchanged.

### I1/I2 — Integration + evidence (Wave 2/3)

I1: run full suite (84 ok), node --check ×5 (add docs-parity.mjs), pack dry-run
probe 76 entries, coverage probe end-to-end (env set → report mode → `COVERAGE
OK`), workflow step equality. I2: 5 consecutive green runs under
`.devflow/evidence/backlog-60-pass5/`, verification.md with red→green trail,
item-60 numbers, no false grep claims (the Pass-4 lesson).

## 5. Verification strategy (summary)

- Canonical: `node scripts/test.mjs` → 84 ok / `ALL TESTS PASSED`; red gate
  9 FAIL / 75 ok (84 total); coverage report mode → `COVERAGE OK`.
- Anti-flake 5×; node --check ×5; pack 76; routes 6/6 unchanged; locale 122
  unchanged; client.js byte-identical at 100,055 with budget 102,400.
- No timing assertions; no external network; no machine tokens (hygiene test
  scans all disk files including .devflow/ and the six new docs).

## 6. Post-parallel & final gates (lead-owned)

1. Adversarial verification workflow (docs/coverage/CI lens; no new write
   surface → security lens optional, but the byte-budget + coverage gates are
   checked for fail-closed behavior).
2. Review loop: diff-reviewer 1-10, min 2 loops max 4, gate >= 8/10.
3. Live-host smoke: consolidated-blocked note (auth gate precedent, manual
   runbook in backlog-60-pass2/live-smoke.md) — Pass 5 adds no UI mechanism.
4. Docs reconciliation: api.md six routes vs index.js; glossary links resolve;
   CHANGELOG keeps passes 1-4; CONTRIBUTING coverage commands match 3.1.
5. TEST VERIFICATION GATE audit: red proofs captured; evidence token-clean.
6. Delivery: ONE atomic commit via the git-commit skill (Conventional Commits,
   zero-narrative sweep, no push); suggested `test: add coverage gates and
   reference docs (backlog-60 pass 5)` — skill owns final wording.
7. Update `.devflow/runs/backlog-60/progress.md`; final report: what shipped,
   commands+results, measured sizes, review scores, smoke note, and the note
   that all 60 backlog items are now delivered or documented-rejected.

## 7. Known behavior changes (for docs accuracy & review)

1. CI and publish workflows gain a coverage gate (no runtime change).
2. `client.js` is guarded by a versioned 102,400-byte ceiling; bumping it needs
   an explicit commit or the C17 chunk path (none shipped).
3. Six reference docs join `docs/` and ship in the tarball (pack 70 → 76).
4. A docs-parity + relative link/anchor check runs inside the existing test
   suite; no separate CI step; no external fetching.
5. CONTRIBUTING points to the glossary and the coverage commands.

## 8. Frozen test names + red/green arithmetic (against the 78-test baseline)

New tests (6): the exact labels of 3.12 (P5-N1…P5-N6) — all RED at HEAD.
Reworks (3 existing labels, additive): RW-P5-1 pack (`npm pack: … 76-entry …`)
RED because live pack is 70 < 76; RW-P5-2a `node --check passes on the shipped
files` RED because scripts/docs-parity.mjs is absent; RW-P5-2b `all shipped
files exist with UTF-8 no BOM and pure LF` RED for the same reason. P2-N2's
`4` counts locale faces (unchanged); no other existing test is touched.

**Red gate (Step 0, HEAD sources): 84 total, 9 FAIL / 75 ok**, final line
`9 TEST(S) FAILED`, exit 1. 9 + 75 = 84 ✓. Green: **84 ok**, `ALL TESTS
PASSED`, exit 0. Pack 70+6=76 ✓. Ceiling 102,400 = 100×1024 ✓; measured
100,055 ≤ 102,400 with 2,345 headroom ✓. Coverage floors 70%/60% ✓.

## 9. Self-review (planner — mechanically verified, counts first)

- **Precomputed before the first draft (script over HEAD 5bba782):** 78 test
  labels; index.js 957 lines / 44,640 bytes; client.js 1744 lines / **100,055
  bytes** (the brief's 99,914 was Pass-4 I1 — current disk is authoritative);
  ceiling 102,400 with 2,345 headroom; test.mjs 5191 lines / 78 tests;
  FROZEN_PACK_FILES 70 (docs/: 3, scripts/: 2); READMEs 194 lines / 13 headings /
  4 fences ×3; locale 122 ×3; docs/ 3 files; docs-parity absent; c8 absent;
  ci/publish 34 lines; V8 coverage probe: 20 JSON files / **3,661 total V8
  entries** (the earlier "108" was ONE file's entry count — corrected after the
  auditor's simulation), own-source schema `functions[].ranges[].count`, URLs
  `file:///...`. Every number in this plan derives from these probes — no value
  quoted from a prior revision.
- **Revision-2 auditor fixes (all four, mechanically re-probed this turn):**
  (1) the frozen suffix filter matched 263 V8 entries (246 node_modules) and
  produced a machine-dependent 51.0%/54.9% gate — ALWAYS RED; §3.2 now resolves
  URLs via fileURLToPath, requires `packageDir` containment and excludes
  node_modules, matching only `index.js` + `scripts/test.mjs` → 2 own-source
  slots; simulated real-probe coverage **87.2% functions (798/915) / 84.7%
  statements (1721/2033)**, floor comfortably met; P5-N1 fixture and §9 probe
  text updated to 3,661. (2) the inline `NODE_V8_COVERAGE=.coverage` assignment
  reached only the first CI command — §3.1 was corrected to export before both
  commands, but the auditor's round-3 simulation proved DOUBLE INSTRUMENTATION:
  the report process also wrote into `.coverage`, doubling entries → 48.6%/49.9%
   (or 52.9%/52.8%) ALWAYS RED. Revision 3 separated the dirs IN-tree; the
   auditor round-4 simulation proved a THIRD always-red cause: the hygiene
   walker (`repoFiles()` — ignores only `.git`/`node_modules`) scanned the
   in-tree V8 JSONs whose absolute npm URLs include a machine user path that
   matches FORBIDDEN_TOKENS → cmd1 `FAIL repo hygiene`. The USER explicitly
   chose the external-directory alternative (the walker is NOT weakened — no
   RW-P5-3). Final contract (revision 4): BOTH dirs under `${{ runner.temp }}`
   (CI) / `os.tmpdir()` (local), report reads data only via `--coverage-dir=`,
   fail-closed rejects a report with env only, P5-N6 asserts the byte-identical
   mirrored external-path block.
  (3) the header red count 6 FAIL / 78 ok and the "NO existing-test
  rework" phrase were false — corrected to **9 FAIL / 75 ok** with the three
  additive reworks, aligned in header/wave/T3/I1/§8. (4) ten stale §1.1 anchors
  replaced with measured line numbers (packageDir 32, PKG 33, NS 35,
  FORBIDDEN_TOKENS 123+, BAK_LITERAL 139, repoFiles 144, failures 158, test()
  160, withMockHost 179, P2-N1 label 2854, P2-N2 label 2878, statSync 12);
  READMEs corrected to 194 lines; probe dir to 3,661 entries. The freshness
  promise is truthful — every listed value was probed in this revision.
- **Revision-3 human-authorized round:** the auditor's double-instrumentation
  simulation was reproduced exactly: a CLEAN two-command sequence with
  IN-tree dirs proved separation alone was insufficient (round 4 below).
  §1.3's residual "normalized URL suffix" wording was replaced by the §3.2
  URL→filesystem containment contract. Revision-3 edits confined to §3.1,
  §3.2, §3.8, §3.12 (P5-N1/N2/N6), §1.3 and this self-review.
- **Revision-4 human-authorized round (FINAL):** the auditor's hygiene finding
  was reproduced EXACTLY on this turn with the externally-sited dirs. Preflight
  on a clean checkout (only this plan file untracked): cmd1
  `NODE_V8_COVERAGE=<os.tmpdir()>/dsh-coverage node scripts/test.mjs` →
  **exit 0**, `ok repo hygiene: no backup artifacts and zero machine tokens in
  any repo file`, 20 JSON files in the EXTERNAL data dir, **0 coverage JSONs
  inside the checkout**; cmd2
  `NODE_V8_COVERAGE=<os.tmpdir()>/dsh-coverage-report node scripts/test.mjs
  --coverage-report --coverage-dir=<os.tmpdir()>/dsh-coverage` → **exit 0**,
  `ALL TESTS PASSED`, 20 JSON in its own external dir, data dir unchanged at
  20. Parser over the external data dir: 3,661 total V8 entries, 263
  old-suffix false matches, 2 own-source slots → **87.2% functions (798/915)
  / 84.7% statements (1723/2034)** — both floors pass, no duplication, no
  hygiene failure. The absolute statement total varies 2033↔2034 between
  runs (spawned subprocess ranges); percentages are frozen, totals are not.
  The walker was NOT weakened (no RW-P5-3) — the user chose the external
  alternative. Fail-closed message aligned to "pass --coverage-dir=<dir>"
  only; §3.2's snippet now includes the explicit guard rejecting report mode
  with env alone. CONTRIBUTING documents the local external-dir commands.
- **Arithmetic (mechanically checked):** 78+6=84 total; 6 new + 3 rework = 9
  FAIL; 9+75=84 ✓; green 84 ✓; 70+6=76 ✓; 100×1024=102,400 ✓;
  102,400−100,055=2,345 ✓; 122 keys unchanged (no new UI strings) ✓; routes
  6/6 unchanged ✓.
- **Scope discipline:** index.js/client.js/package.json/locale are untouched —
  the byte budget and coverage gates are assertions only; no source change was
  needed, so no escalation to lead. If execution discovers one, STOP + escalate
  (binding constraint honored).
- **CI mirroring:** the exact same coverage step in ci.yml and publish.yml; no
  separate docs-parity step (imported into test.mjs); C22 satisfied.
- **Waves disjoint:** T1 {test.mjs} | T2 {docs-parity.mjs} | T3 {docs ×6} |
  T4 {README×3 + CHANGELOG + CONTRIBUTING} | T5 {CI ×2} → I1/I2 → lead gates;
  no write-scope overlap; suite runs only at boundaries.
- **Every task has runnable Verify with observable output**; red gate carries
  the STOP rule; I2 records the item-60 numbers truthfully (Pass-4 lesson:
  no false grep claims).
- **Not implemented:** application sources untouched; only this plan file was
  written (plus a scratch probe in `.devflow/drafts/`, removed before delivery).
