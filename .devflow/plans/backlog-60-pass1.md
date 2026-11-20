# Backlog-60 Pass 1 — Server Trust Hardening (executable plan)

> **Execution:** `run-conductor` executes this plan task-by-task after a
> `plan-auditor` `OKAY` verdict. Workers have ZERO interview history: everything
> needed is in this file. Master context: `.devflow/plans/backlog-60-master.md`
> (contracts C1–C22, rejection register). Repo rules: `AGENTS.md`.

**Goal:** harden the plugin's server trust boundary — strict YAML write gate,
secret/home-path redaction, request limits, actionable busy-lock error, no-op save
skip, parse-error surfacing, Server-Timing, bounded parallel reads — plus the
concurrency tests that prove them, the minimal client handling, and the docs, all
in ONE shippable commit.

**Architecture:** `index.js` (server, 4 fetch routes) gains parse modes, redaction
helpers, limits and timing; `client.js` (panel) gains unchanged-save handling, an
invalid-card banner and a timing legend line; `scripts/test.mjs` gains 12 tests;
READMEs ×3 + CHANGELOG + SECURITY document the new behavior. No new files ship, no
new routes, no config changes, no new dependencies.

**Tech Stack:** Node >= 22 ESM, `yaml` (`parseDocument` + `visit`),
`@deepseek-ai/dsh-atomic-write`, React via host seed, `node:vm` harness, pwsh 7.

**Backlog items covered:** 2 (no-op save), 12 (concurrency tests), 23 (redaction),
26-partial (body cap + unknown-field allowlist; rate-limit rejected R-03), 27
(strict YAML), 30 (Server-Timing + legend), 32 (bounded parallel reads), plus the
C5 orphan-lock actionable error and C2 GET parse-error surfacing.

---

## 1. Context (read before touching anything)

- The plugin writes role-card frontmatter under `<agents root>/agents/`, where the
  agents root is `$DSH_AGENTS_HOME` or the OS-home `.agents` dir (index.js:14-18).
  The panel is the only intended writer, but external editors exist; the host
  buffers request bodies up to 300MiB and passes response headers through verbatim
  (`.devflow/notes/harness-semantics.md` Q1).
- `withFileLock` (node_modules/@deepseek-ai/dsh-atomic-write/lib/index.js:57-95) is
  a cross-process `wx` lockfile with a 2000ms deadline and NO stale recovery:
  on timeout it throws `Error('atomic-write: timed out waiting for the writer lock
  at <absolute lockPath>')` — no `.code`. Orphan recovery is an operator action;
  the plugin must NEVER remove a lock it did not create.
- `parseFrontmatterDocument` (index.js:108-120) is shared by GET listing (via
  `parseRoleCard`, index.js:425), the POST pre-check (index.js:563),
  `applyCardSettings` (index.js:172) and post-write validation (index.js:616,676).
  Strictness MUST be an explicit parameter — a global change would break GET
  listing of existing cards.
- The yaml package (2.9.x) has no parse-time size/depth limits and no option to
  disable anchors/aliases. `visit(doc, visitors)` is public API
  (node_modules/yaml/dist/visit.js): for a Document it visits `contents` with
  `path=[doc]`; a `Node` visitor covers Map/Seq/Scalar (Alias defaults to Node
  unless overridden); explicit tags appear in `node.tag`, anchors in `node.anchor`;
  `toJS({maxAliasCount:0})` makes alias resolution throw. `schema:'failsafe'` is
  BANNED (live-proven: stringifies booleans on read, throws on write).
- Test harness facts that bind this pass (scripts/test.mjs):
  - Hygiene scans EVERY disk file (140-152, 1846-1860) for the forbidden machine
    tokens (116-134, built via split literals) and the backup-suffix literal
    (135-136; content ban 1853-1854, only `.gitignore` exempt). Plans, drafts and
    evidence logs are scanned too.
  - Route-surface test (1101-1107) counts literal `/api/dsh-orchestrator-kit.*`
    occurrences in index.js AND client.js SOURCE: exactly 4 each, sets equal.
    This pass adds ZERO new route literals to either file.
  - Static client contract (1148-1164): SAVE_NOTICE literal (1156), phase titles,
    mount marker, pt-BR word ban (1161-1162) all stay untouched this pass.
  - node --check array (1166-1171) and LF/BOM array (1173-1179) already cover
    index.js/client.js/scripts/test.mjs; no shipped file is added, arrays unchanged.
  - VM sandbox (1195-1216) exposes ONLY: window, fetch, encodeURIComponent, JSON,
    Map, Set, Array, Object, Promise, Number, String, Symbol, Error. React stub
    supports ONLY createElement/useState/useEffect (1223-1240). Client changes
    must not need any other global or hook. Regex literals and String.matchAll
    work in the sandbox.
  - `withMockHost` (175-211) calls registered fetch fns directly (no HTTP server);
    tmp-home pattern: mkdtempSync + DSH_AGENTS_HOME override + rmSync (476, 941).
  - `mountVmClient`, `collectText`, `findNodes` and the `source` read are LOCAL to
    the big client VM test (1182-1326). N12 needs them: T3 hoists them to module
    scope (behavior-preserving move; the existing test's assertions stay
    byte-identical). The vm2/vm3 pattern (1513-1592) shows how a test mounts its
    own fetch handler.
  - Suite output: `ok <label>` per pass, `FAIL <label>` + error per failure, final
    line `ALL TESTS PASSED` / `N TEST(S) FAILED`, exit 0/1 (156-165, 1871-1872).
    GREEN stdout is token-clean; FAILURE output carries absolute tmp paths —
    never commit failure logs.
  - HEAD has 39 tests. This pass adds 12 → 51.

## 2. Must Have / Must NOT Have (Pass 1)

Must have:
- All behavior changes below land WITH their tests and docs in one commit (C1).
- Frozen contracts (section 3) implemented EXACTLY: signatures, constant values,
  message strings, response shapes, header format, test names. A worker who finds
  a contract defect stops and reports to the lead — never silently deviates.
- Every existing test stays green without weakening its assertions. The only
  existing-test edit allowed: appending the failsafe-absence assertion to the
  static contract test (section 4, T3).
- Evidence under `.devflow/evidence/backlog-60-pass1/` (green logs only).

Must NOT have:
- No new routes; no new occurrence of the literal `/api/dsh-orchestrator-kit.`
  prefix in index.js or client.js (comments included).
- No new index.js exports except `redactText`. No new runtime dependencies.
- No changes to package.json, cordis.patch.yml, craft/, locale/, docs/ assets,
  .github/ this pass. No config fields (the `config:{}` assertion, test.mjs:955,
  stays green untouched).
- No server cache; no failsafe schema; no orphan-lock auto-recovery; no redaction
  of success payloads; no timing-based test assertions.
- No client globals outside the sandbox list; no hooks beyond useState/useEffect;
  no localStorage; no innerHTML/eval; new UI strings English only (pt-BR ban stays
  until Pass 2).
- No machine tokens anywhere: fixtures needing home-path/secret shapes build them
  via split-literal joins at runtime (pattern: test.mjs:116-138). Never spell the
  backup-suffix literal, the admin username token, home-prefix tokens, vendor
  tokens, or the old plugin identity in any file.
- No edits to installed role cards; test fixtures live in tmp homes only.

## 3. Contract Freeze (shared — binds ALL tasks; frozen BEFORE parallel work)

### 3.1 New server constants (index.js, near line 10)

```js
const FRONTMATTER_MAX_BYTES = 65536;
const FRONTMATTER_MAX_PATH = 24;
const MAX_ROUTE_BODY_BYTES = 65536;
const CARD_READ_CONCURRENCY = 8;
const ROUTE_BODY_FIELDS = new Set(['id', 'provider', 'model', 'disabled', 'reasoningEffort', 'expectedMtimeMs']);
const LOCK_TIMEOUT_PREFIX = 'atomic-write: timed out waiting for the writer lock';
```

Import change (index.js:5): `import { parseDocument, visit } from 'yaml';`
`Buffer` and `performance` are Node globals — no further imports.

### 3.2 Parse modes (C2)

```js
function parseFrontmatterDocument(text, basename = 'role card', { strict = false } = {}) {
  if (typeof text !== 'string') throw new TypeError('card text must be a string');
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const match = FRONTMATTER.exec(body);
  if (match === null) throw new Error(`${basename}: no frontmatter block; role cards start with a --- block`);
  if (Buffer.byteLength(match[1], 'utf8') > FRONTMATTER_MAX_BYTES) {
    throw new Error(`${basename}: frontmatter exceeds the ${FRONTMATTER_MAX_BYTES}-byte limit`);
  }
  const doc = parseDocument(match[1]);
  if (doc.errors.length > 0) throw new Error(`${basename}: frontmatter is not valid YAML: ${doc.errors[0].message ?? String(doc.errors[0])}`);
  if (strict) {
    visit(doc, {
      Alias() { throw new Error(`${basename}: frontmatter aliases are not allowed`); },
      Node(key, node, path) {
        if (node.anchor) throw new Error(`${basename}: frontmatter anchors are not allowed`);
        if (node.tag) throw new Error(`${basename}: frontmatter custom tags are not allowed`);
        if (path.length > FRONTMATTER_MAX_PATH) throw new Error(`${basename}: frontmatter nesting is too deep`);
      }
    });
  }
  const meta = doc.toJS({ maxAliasCount: 0 });
  if (doc.contents !== null && (meta === null || typeof meta !== 'object' || Array.isArray(meta))) {
    throw new Error(`${basename}: frontmatter must be a YAML object`);
  }
  return { body, match, doc, meta: meta ?? {} };
}
```

- `parseRoleCard(text, basename = 'role card', options = {})` forwards `options`
  to `parseFrontmatterDocument`; everything else in it unchanged.
- `applyCardSettings` (index.js:172) parses with `{ strict: true }` ALWAYS (it is
  the write path; `applyRouteToCard` inherits this).
- POST pre-check (index.js:563): `parseFrontmatterDocument(text, \`${id}.md\`, { strict: true })`;
  the conditional `parseRoleCard` (565): `parseRoleCard(text, \`${id}.md\`, { strict: true })`.
- Post-write validation (index.js:616): `parseRoleCard(next, \`${id}.md\`, { strict: true })`.
- GET listing (index.js:425): `parseRoleCard(text, entry.name)` — LENIENT default.
- Depth semantics: `path.length` counts ancestors incl. the Document; a flat
  card's scalars sit at path length 3; the cap 24 allows ~10 nested collections.
  A 25-level nested flow sequence exceeds it; yaml's own composition guard
  (RESOURCE_EXHAUSTION) catches pathological depth before visit runs.
- Lenient mode still defends aliases via `toJS({maxAliasCount:0})` (throws →
  surfaced per-card, never expanded). Anchors/explicit tags remain listable in
  lenient mode; the write gate refuses them.

### 3.3 Redaction (C4)

New exported pure function + internal helper (place before `parseFrontmatterDocument`):

```js
const SECRET_REDACTIONS = [
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+(?::[^\s/@'"]*)?@/gi, '$1[redacted]@'],
  [/\b(authorization\s*[:=]\s*)(?:bearer\s+|basic\s+)?[^\s,;'"]+/gi, '$1[redacted]'],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]'],
  [/\b((?:api[-_]?key|apikey|access[-_]?token|auth[-_]?token|refresh[-_]?token|token|secret|password|passwd|client[-_]?secret)\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[redacted]'],
  [/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g, '[redacted]'],
  [/(?<=^|[\s'"(=,;/])[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/'"\s:;,)]+/gi, '[home]'],
  [/(?<=^|[\s'"(=,;])\/(?:home|Users)\/[^/'"\s:;,)]+/gi, '[home]']
];

function redactText(text) {
  let out = String(text);
  const home = homedir();
  if (home && home !== path.sep) out = out.split(home).join('[home]');
  for (const [pattern, replacement] of SECRET_REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

function safeErrorText(error) {
  return redactText(String(error?.message ?? error));
}
```

- Markers: `[redacted]` (secrets), `[home]` (user-profile prefix; the rest of the
  path survives so diagnostics stay actionable). Error codes (EACCES, ENOTDIR…)
  and context prefixes survive because only the matched substrings are replaced.
- The literal `homedir()` replacement runs FIRST (covers non-standard homes);
  the generic patterns cover synthetic/other-user paths. The POSIX lookbehind
  excludes URL interiors (`https://host/home/...` is NOT redacted); the Windows
  lookbehind allows `/` so `file://` drive paths are covered.
- Application rule (EVERY site, no exceptions):
  - Every `console.warn` in index.js: template strings wrapped in `redactText(...)`;
    error-object arguments replaced by `safeErrorText(error)`. Full site inventory
    (HEAD lines): 266, 270, 275, 292, 309, 317, 333, 338, 348, 357, 388, 403, 412,
    421, 428, 541, 553, 625, 641, 650, 659, 670, 679. (266/270/275/338/348 have no
    error object — just wrap the template, which interpolates provider/model.)
  - Every HTTP error body built from an error: `String(error?.message ?? error)`
    and `String(error.message)` → `safeErrorText(error)`;
    `String(result.error?.message ?? result.error)` → `safeErrorText(result.error)`
    (efforts 471/474/477/479; POST 597/599). Sites: 404, 471, 474, 477, 479, 542,
    554, 568, 597, 599, 618, 626, 642, 651, 660, 671, 680. The `writeOutcome.error`
    passthrough (664) is already safe because 642/651/660 build with safeErrorText.
  - New `invalid[].error` values: `safeErrorText(error)`.
  - Unknown-field names echoed in the 400 body: `redactText(String(unknown))`.
  - SUCCESS payloads (role summaries, catalog, efforts) are NOT redacted.
- Export list (index.js:687) gains exactly `redactText`:
  `export { name, inject, apply, agentsRootOf, isEntryName, cardPathOf, parseRoleCard, applyRouteToCard, applyCardSettings, redactText };`

### 3.4 GET .roles — invalid surfacing + bounded parallel reads + timing (C2/C10/D5)

Response envelope becomes `{ ok: true, roles: RoleSummary[], invalid: [{ id, error }] }`
— `invalid` ALWAYS present (empty array when none), sorted by id; `roles` sorted by
id as today. Parse failures go to `invalid` (redacted error) AND keep the existing
console.warn; fs-unreadable cards and invalid entry names keep today's warn+skip
behavior (they are not parse errors). ENOENT on the agents dir returns
`{ ok: true, roles: [], invalid: [] }` (with timing). Implementation shape:

```js
fetch: async () => {
  const started = performance.now();
  let entries;
  try {
    entries = await readdir(cardsDir(), { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return json({ ok: true, roles: [], invalid: [] }, 200, [['reads', performance.now() - started]]);
    console.warn(redactText(`${name}: the roles directory is unreadable:`), safeErrorText(error));
    return json({ ok: false, error: `the roles directory is unreadable: ${safeErrorText(error)}` }, 500);
  }
  const candidates = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
  const roles = [];
  const invalid = [];
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= candidates.length) return;
      const entry = candidates[index];
      const id = entry.name.slice(0, -3);
      let file;
      try { file = cardPathOf(cardsDir(), id); } catch (error) {
        console.warn(redactText(`${name}: role card ${entry.name} is skipped:`), safeErrorText(error));
        continue;
      }
      let info;
      let text;
      try {
        info = await stat(file);
        text = await readFile(file, 'utf8');
      } catch (error) {
        console.warn(redactText(`${name}: role card ${id} is unreadable:`), safeErrorText(error));
        continue;
      }
      try {
        const card = parseRoleCard(text, entry.name);
        roles.push(toRoleSummary(id, card, info.mtimeMs));
      } catch (error) {
        console.warn(redactText(`${name}: role card ${id} is omitted from the list:`), safeErrorText(error));
        invalid.push({ id, error: safeErrorText(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CARD_READ_CONCURRENCY, candidates.length) }, () => worker()));
  roles.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  invalid.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return json({ ok: true, roles, invalid }, 200, [['reads', performance.now() - started]]);
}
```

Concurrency is proven by outcomes + structure (worker pool + constant), NEVER by
stopwatch assertions.

### 3.5 Server-Timing (C9/D5)

`json` helper (index.js:381) gains a third parameter; header on 200 responses only:

```js
const json = (value, status = 200, timing = []) => new Response(JSON.stringify(value), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(timing.length > 0 ? { 'server-timing': timing.map(([metric, ms]) => `${metric};dur=${ms.toFixed(1)}`).join(', ') } : {})
  }
});
```

- Metric names: `reads` (GET .roles, whole handler), `catalog` (GET .catalog around
  `modelCatalog`; POST .route around the live-catalog validation when it runs),
  `write` (POST .route around the `withFileLock` block on success).
- GET .efforts: NO timing header (item 30 does not name it).
- Values are durations in milliseconds, one decimal, nothing else — no paths, ids
  or user data. Error responses carry no timing header. The unchanged response
  carries `catalog` only if catalog validation ran; never `write`.

### 3.6 POST .route — cap, allowlist, strict gate, no-op, lock error (C6/C2/C7/C5)

Handler top, BEFORE any disk access (replaces index.js:490-492):

```js
const contentLength = Number(request.headers.get('content-length'));
if (Number.isFinite(contentLength) && contentLength > MAX_ROUTE_BODY_BYTES) {
  return json({ ok: false, error: `the request body exceeds the ${MAX_ROUTE_BODY_BYTES}-byte limit` }, 413);
}
let raw;
try { raw = await request.text(); } catch { return json({ ok: false, error: 'the body is not valid JSON' }, 400); }
if (Buffer.byteLength(raw, 'utf8') > MAX_ROUTE_BODY_BYTES) {
  return json({ ok: false, error: `the request body exceeds the ${MAX_ROUTE_BODY_BYTES}-byte limit` }, 413);
}
let body;
try { body = JSON.parse(raw); } catch { return json({ ok: false, error: 'the body is not valid JSON' }, 400); }
if (body === null || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'the body must be a JSON object' }, 400);
const unknown = Object.keys(body).find((key) => !ROUTE_BODY_FIELDS.has(key));
if (unknown !== undefined) return json({ ok: false, error: `the request contains an unknown field: ${redactText(String(unknown))}` }, 400);
```

Ordering invariant: stale `expectedMtimeMs` → 409 (existing pre-check, index.js:557)
fires BEFORE the identity check. Catalog/effort fail-closed validation stays BEFORE
the identity check too — a no-op POST does NOT bypass validation (with the catalog
unavailable, even an identical route save still returns 503).

No-op branch — replaces the next-text block (index.js:613-619), placed AFTER all
validation and BEFORE the pre-lock path re-check (621):

```js
let next;
let nextCard;
try {
  next = applyCardSettings(text, patch);
  nextCard = parseRoleCard(next, `${id}.md`, { strict: true });
} catch (error) {
  return json({ ok: false, error: safeErrorText(error) }, 400);
}
if (next === text) {
  return json({ ok: true, unchanged: true, role: toRoleSummary(id, nextCard, info.mtimeMs) }, 200, catalogMs === null ? [] : [['catalog', catalogMs]]);
}
```

`catalogMs` is a `let catalogMs = null;` initialized before the catalog block and
set to the measured duration inside it. Normal success (index.js:682) becomes:
`return json({ ok: true, role }, 200, [...(catalogMs === null ? [] : [['catalog', catalogMs]]), ['write', writeMs]]);`
with `writeMs` measured around the withFileLock try-block (start before 632, end
after a successful outcome). `unchanged` is present ONLY when true.

Lock-timeout mapping — in the OUTER catch (index.js:668-672), after the
statusCode-400 branch:

```js
if (typeof error?.message === 'string' && error.message.startsWith(LOCK_TIMEOUT_PREFIX)) {
  console.warn(redactText(`${name}: locking role card ${id} timed out:`), safeErrorText(error));
  const lockName = `${path.relative(agentsRootOf(), file).split(path.sep).join('/')}.lock`;
  return json({
    ok: false,
    code: 'lock-timeout',
    error: `the role card is busy: another writer holds ${lockName}. Retry in a moment; if the lock is orphaned (owner crashed), an operator must remove that lock file manually.`
  }, 503);
}
```

- HTTP 503 (retryable; Pass 4 batch loops abort-on-first-503 by design, C9).
- `lockName` is relative to the agents root with forward slashes (e.g.
  `agents/planner.md.lock`) — never an absolute path, never a username.
- The lock file is NEVER removed by the plugin. Other lock-acquire failures
  (e.g. EACCES creating the lockfile) stay redacted 500s.

### 3.7 Client contracts (client.js)

- New constant next to SAVE_NOTICE (client.js:32):
  `const UNCHANGED_NOTICE = 'Already up to date — nothing was written.';`
- New module-level state next to the caches (client.js:26-28):
  `let lastServerTiming = null;`
- `postSettings` (89-97) returns `{ role: data.role, unchanged: data.unchanged === true }`
  (was `data.role`).
- `save()` success path (314-320): destructure `const { role: saved, unchanged } = await postSettings(payload);`
  — cache/draft updates unchanged; notice becomes
  `{ kind: 'ok', text: unchanged ? UNCHANGED_NOTICE : SAVE_NOTICE }`.
  `tracker.saves += 1` stays (an unchanged response still carries the authoritative
  server summary; the refresh-guard semantics are preserved).
- `fetchJson` (84-87): after `fetch`, read `response.headers.get('server-timing')`;
  when it is a string, `matchAll(/([A-Za-z0-9_-]+);dur=([0-9]+(?:\.[0-9]+)?)/g)` and
  store metrics named `reads`/`catalog` into
  `lastServerTiming = { ...(lastServerTiming ?? {}), [name]: Number(dur) }`.
  No signature change; efforts responses simply carry no recognized metrics.
- Roles-load success branch (166-180): read
  `const invalidCards = Array.isArray(rolesOutcome.value.invalid) ? rolesOutcome.value.invalid : [];`
  and merge into the existing `setMessages` update that deletes `__load`:
  set `next.__invalid = { kind: 'warning', text: \`Some role cards have invalid frontmatter and cannot be edited here: ${invalidCards.map((card) => card.id).join(', ')}.\` }`
  when non-empty, else `delete next.__invalid`. (Inside the existing
  `tracker.saves === startSaves` guard.)
- Render the banner right after the `__catalog` banner (client.js:489):
  `messages.__invalid ? h('div', { style: bannerStyle('warning') }, messages.__invalid.text) : null,`
- Legend line: append one conditional entry to the legend grid (after client.js:506):
  `lastServerTiming ? h('div', {}, \`Server timing — roles: ${lastServerTiming.reads ?? '—'} ms · catalog: ${lastServerTiming.catalog ?? '—'} ms\`) : null`
  (renders once at least one metric was seen; values update on the re-render that
  the roles/catalog state updates already trigger).
- Constraints: only sandbox globals, only useState/useEffect, English strings,
  SAVE_NOTICE/phase titles/mount marker untouched, zero new route literals,
  textContent-style rendering only (React children — no innerHTML/eval).

### 3.8 Frozen new test names (12; exact labels)

| ID | Label (exact) | Red at HEAD? |
| --- | --- | --- |
| N1 | `strict frontmatter: parseRoleCard strict mode rejects anchors, aliases, explicit tags, deep nesting and oversized blocks; lenient mode unchanged` | YES |
| N2 | `HTTP API: GET .roles surfaces parse-failed cards in invalid[] with redacted errors and keeps valid roles sorted` | YES |
| N3 | `HTTP API: POST .route refuses anchored, aliased, tagged, deep or oversized frontmatter with 400 before any write` | YES |
| N4 | `redactText: credential URLs, authorization headers, key assignments, key shapes and home paths become markers; codes and plain URLs survive` | YES |
| N5 | `HTTP API: catalog failures and unreadable-directory errors redact secrets and home paths in bodies and logs` | YES |
| N6 | `HTTP API: POST .route enforces the 65536-byte body cap and rejects unknown fields` | YES |
| N7 | `HTTP API: POST .route identical payload answers unchanged:true without a write; stale expectedMtimeMs still 409 first` | YES |
| N8 | `HTTP API: simultaneous POST .route on one role serializes to one 200 and one 409 with card integrity` | NO (guard — behavior exists) |
| N9 | `HTTP API: a held writer lock yields 503 lock-timeout with a relative lock name and is never auto-recovered` | YES |
| N10 | `HTTP API: Server-Timing on roles/catalog/route success carries durations only` | YES |
| N11 | `HTTP API: GET .roles with 40 cards returns every card sorted (bounded parallel reads)` | NO (guard) |
| N12 | `client.js: unchanged notice, invalid-card warning banner and server-timing legend line render through the VM harness` | YES |

Red-run expectation at HEAD + new tests: exactly **10 FAIL** labels (N1–N7, N9,
N10, N12), **41 ok** lines (39 HEAD tests + N8 + N11), final line
`10 TEST(S) FAILED`, exit 1. Green expectation after implementation: **51 ok**,
`ALL TESTS PASSED`, exit 0.

### 3.9 Synthetic fixture recipe (token-clean; used by N4/N5/N6 and friends)

Build at runtime inside scripts/test.mjs — NEVER as contiguous literals on disk:

```js
const SYNTHETIC_KEY = ['sk-', 'testonly', '0123456789abcdef'].join('');
const SYNTHETIC_WIN_PATH = [WIN_HOME_TOKEN, String.fromCharCode(92), 'fixture-user', String.fromCharCode(92), '.agents', String.fromCharCode(92), 'agents', String.fromCharCode(92), 'planner.md'].join('');
const SYNTHETIC_POSIX_PATH = ['/home/', 'fixture-user', '/.agents/agents/planner.md'].join('');
const SYNTHETIC_CRED_URL = 'https://fixture-user:fixture-pass@example.invalid/v1';
const SYNTHETIC_AUTH_HEADER = 'Authorization: Bearer fixture0123456789abcdef';
```

`WIN_HOME_TOKEN`/`POSIX_HOME_TOKEN` already exist (test.mjs:117-118). Assertions
about real fs paths use the TOKENS (platform-safe), not raw tmp paths: on POSIX
tmp dirs contain no home prefix, so "body must not contain the home tokens" is the
invariant; the `[home]` marker for real fs errors is asserted conditionally with
`process.platform === 'win32'`. Marker behavior itself is pinned cross-platform by
the N4 unit assertions on the synthetic fixtures.

## 4. Per-task contracts

Wave layout (shared checkout, no locks — suite runs ONLY at wave boundaries):

```
Step 0 (solo):  T3 tests ── red evidence (10 FAIL / 41 ok)
Wave 1 (∥):     T1 index.js   |   T2 client.js   |   T4 docs        (disjoint)
Wave 2 (solo):  I1 integration green → I2 anti-flake 5x + evidence
Wave 3 (lead):  review loop + security gate + git-commit (section 6)
```

Write scopes are 100% disjoint: T1={index.js}, T2={client.js},
T3={scripts/test.mjs}, T4={README.md, README.pt-BR.md, README.zh-CN.md,
CHANGELOG.md, SECURITY.md}, I2={.devflow/evidence/backlog-60-pass1/}.

---

### T3 — Tests first (test-writer; Step 0, solo)

**Parallelizable:** no — runs alone BEFORE Wave 1 so the red run sees HEAD sources.
**Write scope:** `scripts/test.mjs` ONLY.
**References:** scripts/test.mjs:116-138 (token constants), 156-165 (runner),
175-211 (withMockHost), 475-514 (GET roles test pattern), 676-943 (POST test
pattern incl. TOCTOU hook 722-792), 1148-1164 (static contract), 1181-1311
(mountVmClient), 1373-1396 (route mock modes), 1871-1872 (summary).

**What to do:**
1. Hoist `const source = readFileSync(path.join(packageDir, 'client.js'), 'utf8');`
   OUT of the big client VM test (1182) to the TOP constants area (right after the
   NS/EXAMPLE_* constants) — a const left mid-file would be in TDZ when earlier
   tests call the hoisted harness. Hoist the `mountVmClient`, `collectText` and
   `findNodes` function declarations (1184-1326) to module scope immediately before
   that test. This is a behavior-preserving move: the existing test keeps every
   assertion byte-identical and still passes at HEAD. It is the ONLY structural
   edit to existing test code.
2. Append the 12 new tests (exact labels, section 3.8): N1–N11 after the existing
   POST test block (before the yaml-ok test); N12 AFTER the existing client VM test
   (it uses the hoisted harness). Reuse `withMockHost`, the tmp-home pattern and
   the existing llm-stub shapes.
   Do NOT add static imports: `redactText` is imported DYNAMICALLY inside N4
   (`const mod = await import('../index.js'); const redactText = mod.redactText;`)
   with a first assertion `typeof redactText === 'function'` — a static import of
   a missing export would crash the whole suite at HEAD instead of failing one
   test. N2 may use the same dynamic import for its idempotence assertion.
3. Append ONE assertion to the existing static contract test (1148-1164):
   `assert.ok(!readFileSync(path.join(packageDir, 'index.js'), 'utf8').includes('failsafe'), 'index.js must never use the failsafe YAML schema');`
   (green at HEAD). No other existing-test assertion edits.
4. Required assertions per test (minimums — add more, never fewer):
   - **N1:** via exported `parseRoleCard`/`applyCardSettings`. Anchor card
     (`provider: &p example-hub` + `model: flash-a`): strict throws
     /anchors are not allowed/, lenient returns provider `example-hub`. Alias card
     (`model: *p`): strict throws /aliases are not allowed/, lenient throws (alias
     resolution disabled). Tag card (`model: !!str flash-a`): strict throws
     /custom tags are not allowed/, lenient returns `flash-a`. Deep card: unknown
     key with a 25-level nested flow sequence (`'['.repeat(25) + 'x' + ']'.repeat(25)`):
     strict throws /nesting is too deep/, lenient parses. Moderate nesting
     (`custom: {a: {b: 1}}`) PASSES strict. Oversized block
     (`key: ` + `'v'.repeat(65537)`): BOTH modes throw /exceeds the 65536-byte limit/.
     `applyCardSettings(anchorCard, { disabled: true })` throws /anchors/ (write
     path always strict).
   - **N2:** tmp home with 2 valid cards + 1 broken-YAML card + 1 aliased card.
     GET → 200 ok:true; `roles` = the 2 valid ids sorted; `invalid` = the 2 bad ids
     sorted, each `{id, error}` with non-empty string error; captured console.warn
     mentions both bad ids; each invalid error satisfies
     `redactText(error) === error` (dynamic import).
   - **N3:** tmp home with anchored/aliased/tagged/deep/oversized cards. For each:
     POST `{id, disabled:true}` → 400 with the matching section 3.2 message regex;
     disk bytes byte-identical before/after. A valid card with a comment + nested
     unknown key → POST disabled:true → 200, comment and unknown key preserved.
     Consistency: GET lists anchored/tagged/deep cards in `roles` (lenient) and
     aliased/oversized in `invalid`.
   - **N4:** unit assertions on `redactText` (dynamic import):
     `typeof === 'function'`; SYNTHETIC_WIN_PATH → starts `[home]`, still contains
     `planner.md`, no `fixture-user`, no home token (case-insensitive);
     SYNTHETIC_POSIX_PATH → `[home]/.agents/agents/planner.md`;
     SYNTHETIC_CRED_URL → `https://[redacted]@example.invalid/v1`;
     SYNTHETIC_AUTH_HEADER → `Authorization: [redacted]`;
     `'api_key=fixturevalue123'` → `'api_key=[redacted]'`;
     SYNTHETIC_KEY → `'[redacted]'`;
     `'EACCES: permission denied, open ' + SYNTHETIC_WIN_PATH` → starts `EACCES`,
     contains `[home]`; plain `'https://example.invalid/home/guide'` UNCHANGED;
     `redactText(path.join(homedir(), 'agents', 'x.md'))` does not contain
     `homedir()`; `'provider: example-hub\nmodel: flash-a'` UNCHANGED.
   - **N5:** (a) llm stub whose `listProviders` throws
     `Error('upstream failed: ' + SYNTHETIC_AUTH_HEADER + ' at ' + SYNTHETIC_WIN_PATH)`
     → GET .catalog 200 degraded; captured warn contains `[redacted]` and `[home]`,
     contains no `fixture-user`/`fixture0123456789abcdef`/home tokens.
     (b) `resolveModelInfo` throws `Error('lookup failed ' + SYNTHETIC_CRED_URL)`
     → GET .efforts 503; body error contains `[redacted]`, not `fixture-pass`.
     (c) write a regular FILE at `<tmpHome>/agents` → GET .roles 500; body error
     contains `unreadable`, contains NEITHER home token (case-insensitive); on
     win32 additionally contains `[home]`; captured warn likewise.
   - **N6:** POST `{id:'planner', disabled:true, surprise:'x'}` → 400
     /unknown field/; POST `{id:'planner', disabled:true, padding:'x'.repeat(70000)}`
     → 413 /exceeds the 65536-byte limit/, disk untouched; POST with the synthetic
     key AS A FIELD NAME → 400, error contains `[redacted]` not SYNTHETIC_KEY;
     a known-fields-only body just under the cap saves normally (200).
   - **N7:** routed card (example-hub/flash-a, reasoning_effort high), written in
     canonical plain-scalar form exactly like the existing POST fixture
     (test.mjs:682) so the YAML round-trip is byte-identical. GET mtime.
     POST identical `{provider, model, reasoningEffort, expectedMtimeMs}` → 200,
     `unchanged === true`, `role` deep-equals the GET summary (same mtimeMs), disk
     bytes AND statSync mtime unchanged. POST identical payload with
     `expectedMtimeMs: mtime - 5000` → 409 (stale check first). POST a real change
     → 200 with `unchanged === undefined`. Disabled-only no-op (card already
     disabled:true, POST disabled:true) → unchanged:true. With `llm: undefined`,
     identical-route POST → 503 (no-op does NOT bypass fail-closed validation).
   - **N8:** `Promise.all` of two POSTs on one role, same expectedMtimeMs, target
     models flash-a vs flash-b, llm stub listing both. Sorted statuses = [200, 409];
     409 error matches /changed on disk/; disk parses and equals the winner's
     model; GET reflects the winner. NO timing assertions.
   - **N9:** pre-create `<cardFile>.lock` (writeFileSync, content `'0\n'`). POST
     disabled:true → 503, `code === 'lock-timeout'`, error contains
     `agents/planner.md.lock` and `operator`, error does NOT contain the tmpHome
     path; lock file STILL EXISTS after the response (no auto-recovery); captured
     warn contains no home token. Then rmSync the lock and POST again → 200.
     (Adds ~2s of real lock-deadline wait to the suite — deterministic, allowed.)
   - **N10:** GET .roles header matches `/^reads;dur=\d+(\.\d+)?$/`; GET .catalog
     matches `/^catalog;dur=\d+(\.\d+)?$/`; successful route-changing POST header
     contains `catalog;dur=` and `write;dur=`; every dur parses finite >= 0; header
     contains neither the tmpHome path nor any role id; a 409 response has NO
     server-timing header; an unchanged response has NO `write` metric; GET
     .efforts has NO server-timing header.
   - **N11:** 40 valid cards (`role-00` … `role-39`) → GET returns exactly 40
     roles, sorted, every id present once. (Guard: green at HEAD and after.)
   - **N12:** (placed after the existing client VM test) fresh `mountVmClient`
     (hoisted in step 1) with its OWN fetch handler
     (pattern: vm2/vm3, test.mjs:1513-1592) and its OWN 2-card roles fixture (e.g.
     planner + alpha-custom, mtimeMs 1000) — do not modify the existing vm1 handler
     or depend on its test-local mockRoles. The roles response carries
     `invalid: [{id:'broken-card', error:'bad yaml'}]` and header
     `server-timing: reads;dur=12.3`, catalog response header
     `server-timing: catalog;dur=45.6`. Assert: warning banner text contains
     `invalid frontmatter` and `broken-card`; legend text contains `Server timing`,
     `12.3`, `45.6`. Add an `unchanged` mode to the route mock returning
     `{ok:true, unchanged:true, role:{...base}}` (mtime unchanged): dirty a card,
     save → notice `Already up to date — nothing was written.` rendered, returned
     role applied, POST payload still carries expectedMtimeMs. A normal save still
     renders SAVE_NOTICE.
5. All fixtures token-clean (section 3.9 recipe); pure LF, no BOM; no weakening of
   any existing assertion; no timing assertions anywhere.

**Must NOT do:** touch index.js/client.js/docs; add static imports of new exports;
edit existing test assertions (the helper hoist and the one static assertion are
the only allowed existing-code changes); use real home paths or contiguous
forbidden tokens in fixtures; assert on elapsed time.

**Verify (observable):**
```
node --check scripts/test.mjs
```
→ exit 0, no output. Then:
```
node scripts/test.mjs
```
→ exit 1; final line `10 TEST(S) FAILED`; exactly the 10 frozen FAIL labels
(N1–N7, N9, N10, N12); 41 `ok` lines. Cross-check the FAIL set:
```
node scripts/test.mjs 2>&1 | Select-String -Pattern '^FAIL ' -CaseSensitive
```
→ exactly 10 lines, matching section 3.8. Report the FAIL label list to the lead
as the red evidence (do NOT save the raw failure output — it carries absolute tmp
paths). If the red count differs, STOP and reconcile the test code against this
plan before Wave 1 starts.

---

### T1 — Server hardening (implementer; Wave 1, parallel)

**Parallelizable:** yes (with T2, T4). **Write scope:** `index.js` ONLY.
**References (HEAD lines):** 5 (import), 10 (constants), 108-120 (parser),
122-143 (parseRoleCard), 157-219 (applyCardSettings), 266-428 (warn sites),
381 (json), 393-434 (GET roles), 436-451 (GET catalog), 453-483 (GET efforts),
485-684 (POST route), 687 (exports). Full change-site inventory: sections 3.1–3.6.

**What to do (in this order, top to bottom so line anchors stay valid):**
1. Import `visit`; add the six constants (3.1).
2. Add `SECRET_REDACTIONS`, `redactText`, `safeErrorText` (3.3) before the parser.
3. Rework `parseFrontmatterDocument` exactly as 3.2; thread `options` through
   `parseRoleCard`; make `applyCardSettings` parse strict.
4. Apply the redaction rule (3.3) to EVERY listed warn site and error-body site —
   the inventory is exhaustive; grep for `console.warn` and
   `String(error` afterwards and confirm zero untreated sites.
5. Rewrite GET .roles per 3.4 (worker pool + invalid + timing); add timing to
   GET .catalog per 3.5.
6. POST .route: cap/allowlist top block (3.6); strict pre-check (3.2); `catalogMs`
   measurement around the catalog block; no-op branch (3.6); `writeMs` measurement
   around the withFileLock block; lock-timeout mapping in the outer catch (3.6);
   timing on the success response (3.5); redacted error bodies throughout.
7. Extend the export list with exactly `redactText` (3.3).

**Must NOT do:** add routes or route literals; add exports beyond redactText;
change success payload shapes (except the additive `unchanged`/`invalid` fields);
redact success payloads; touch any other file; introduce caches, config fields,
failsafe, or lock auto-recovery; change the 409/404/400 semantics of existing
validation branches; reorder validation before the mtime pre-check.

**Verify (observable, file-scoped — no suite runs during Wave 1):**
```
node --check index.js
```
→ exit 0. Route-literal count stays 4:
```
(Select-String -Path index.js -Pattern '/api/dsh-orchestrator-kit\.(roles|catalog|efforts|route)' -AllMatches | ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum
```
→ `4`. Failsafe absence:
```
Select-String -Path index.js -Pattern 'failsafe' -CaseSensitive
```
→ no output. Untreated-site sweep:
```
Select-String -Path index.js -Pattern 'String\(error' -CaseSensitive
```
→ exactly 1 match: the `safeErrorText` helper definition itself (every other site
now calls `safeErrorText`). Report completion + these outputs.

---

### T2 — Client handling (implementer; Wave 1, parallel)

**Parallelizable:** yes (with T1, T4). **Write scope:** `client.js` ONLY.
**References (HEAD lines):** 26-32 (caches/constants), 84-97 (fetchJson/postSettings),
159-217 (load effect), 288-330 (save), 488-506 (banners/legend). Contracts: 3.7.

**What to do:** implement exactly section 3.7: UNCHANGED_NOTICE constant;
lastServerTiming module state; postSettings return shape; save() destructure +
notice selection; fetchJson timing capture; invalid-card banner state + render;
legend timing line. Keep every existing string, marker and behavior not named in
3.7 byte-identical.

**Must NOT do:** new globals/hooks beyond the sandbox list; localStorage;
innerHTML/eval; pt-BR strings; new route literals; edits to SAVE_NOTICE, phase
titles, PHASE_TONE, tab ids, mount marker; any other file; i18n work (Pass 2).

**Verify (observable, file-scoped):**
```
node --check client.js
```
→ exit 0. Route-literal count stays 4 (same Select-String command as T1, on
client.js) → `4`. SAVE_NOTICE intact:
```
Select-String -Path client.js -Pattern 'Saved — applies on the next turn / next subagent_role.' -CaseSensitive
```
→ exactly 1 match. Report completion + outputs.

---

### T4 — Docs (tech-writer or docs-sync; Wave 1, parallel)

**Parallelizable:** yes (with T1, T2). **Write scope:** `README.md`,
`README.pt-BR.md`, `README.zh-CN.md`, `CHANGELOG.md`, `SECURITY.md` ONLY.
**References:** README.md:54-73 (Configure + protections), 112-127 (FAQ);
CHANGELOG.md:12-16 ([Unreleased]); SECURITY.md:11-32 (Scope/Known limitations).

**What to do (all three READMEs structurally identical — same headings, tables,
code blocks; translate prose, keep markers/paths/identifiers verbatim):**
1. "Configure per role" area: document that an identical save answers
   "Already up to date" without writing, and that cards with invalid frontmatter
   are listed in a warning banner (not editable until fixed).
2. "Every save is protected end to end" list: add bullets — strict frontmatter
   write gate (anchors/aliases/custom tags refused; 65536-byte and nesting limits;
   such cards remain visible but read-only until cleaned); request limits
   (65536-byte body, known fields only); busy-lock 503 with retry guidance;
   secrets and user-home paths redacted to markers in errors and logs.
3. FAQ: add two entries — "Why do I get a 503 'busy' error when saving?" (another
   writer holds the card lock; retry shortly; if the owner crashed, an operator
   removes the `<card>.md.lock` file beside the card — the plugin never removes
   locks automatically) and "What does 'Already up to date' mean?" (no-op save).
4. One line near the routes paragraph (README.md:67): successful reads/writes
   carry a `Server-Timing` header (durations only) and the legend shows the last
   load timings.
5. CHANGELOG [Unreleased]: Added (Server-Timing + legend, invalid-card surfacing,
   unchanged indicator), Changed (strict write gate, body cap + field allowlist,
   bounded parallel reads, actionable busy-lock error), Security (redaction of
   secrets and home paths in logs and error bodies). Do not touch [0.1.0].
6. SECURITY.md: under Scope or Known limitations, state the redaction policy
   (markers, success payloads untouched) and the lock protocol's operator-only
   orphan recovery; mention the plugin-level body cap.

**Must NOT do:** machine tokens; the backup-suffix literal; invented
credentials/models; structural divergence between the three READMEs; creating
docs/troubleshooting.md (Pass 5 — the FAQ carries the lock row meanwhile);
touching any source/test file; changing the mermaid diagram.

**Verify (observable):** structural parity self-check — heading LEVEL sequence +
fenced-block count + table-row count must match across the three READMEs (heading
text and diagram labels are legitimately translated, so they are NOT compared;
the richer docs-parity.mjs semantics freeze in Pass 5). Run:
```
node -e "const fs=require('fs');const shape=f=>{const t=fs.readFileSync(f,'utf8');return JSON.stringify({levels:(t.match(/^#{1,6} .*$/gm)||[]).map(x=>x.match(/^#+/)[0].length),fences:(t.match(/^```/gm)||[]).length,rows:(t.match(/^\|.*\|$/gm)||[]).length});};const a=shape('README.md'),b=shape('README.pt-BR.md'),c=shape('README.zh-CN.md');if(a!==b||a!==c){console.error('README parity diverged');process.exit(1);}console.log('README parity OK');"
```
→ `README parity OK`, exit 0 (verified green at HEAD). Token self-scan on the five
docs (split-built tokens, same list as the hygiene test):
```
node -e "const fs=require('fs');const toks=[['admin','istrator'].join(''),['c:',String.fromCharCode(92),'users'].join(''),['c:/u','sers'].join(''),['mag','pie'].join(''),['agy','-cli'].join(''),['nous','-portal'].join(''),['work','buddy'].join(''),['minimax','-code-global'].join(''),['deepseek','-rotation'].join(''),['long','cat'].join(''),['hy','4'].join(''),['auto','/','glm'].join(''),['auto','claw'].join(''),['arroto','feroz'].join(''),['.b','ak'].join('')];let bad=0;for(const f of ['README.md','README.pt-BR.md','README.zh-CN.md','CHANGELOG.md','SECURITY.md']){const t=fs.readFileSync(f,'utf8').toLowerCase();for(const k of toks){if(t.includes(k.toLowerCase())){console.error(f+' contains a forbidden token');bad=1;}}}process.exit(bad);"
```
→ exit 0, no output. Report completion + outputs.

---

### I1 — Integration green (run-conductor or one implementer; Wave 2, solo)

**Parallelizable:** no — single owner, no other lane writes during this task.
**Write scope:** any of {index.js, client.js, scripts/test.mjs, READMEs, CHANGELOG,
SECURITY} for FIXES only (one owner, sequential).
**References:** section 3 contracts; T1–T4 reports.

**What to do:** run the full suite; read the fresh output. Expected first run:
51 ok, `ALL TESTS PASSED`. If anything fails: reconcile against the FROZEN
contract — the contract wins; fix whichever side deviates (implementation or
test), never weaken an assertion to pass. Re-run until green. Then run node
--check on all three JS files. If a contract itself proves defective, STOP and
escalate to the lead (recorded rationale required before any contract change).

**Verify (observable):**
```
node scripts/test.mjs
```
→ exit 0, final line `ALL TESTS PASSED`, 51 `ok` lines, zero `FAIL`.
```
node --check index.js; node --check client.js; node --check scripts/test.mjs
```
→ all exit 0.

---

### I2 — Anti-flake + evidence (same owner; Wave 2, after I1)

**Parallelizable:** no. **Write scope:** `.devflow/evidence/backlog-60-pass1/` ONLY.

**What to do:** 5 consecutive full-suite runs, ALL green, logs kept; any failure
→ back to I1 (delete the failed log, fix, restart the 5-run sequence — never
commit failure output, it carries absolute tmp paths). Then write
`verification.md` (token-clean, repo-relative).

**Verify (observable):**
```
New-Item -ItemType Directory -Force -Path .devflow/evidence/backlog-60-pass1 | Out-Null
$ok = 0
for ($i = 1; $i -le 5; $i++) {
  node scripts/test.mjs *> ".devflow/evidence/backlog-60-pass1/test-run-$i.log"
  if ($LASTEXITCODE -eq 0) { $ok++ } else { break }
}
"green runs: $ok/5"
```
→ `green runs: 5/5`; each log's final line is `ALL TESTS PASSED` (check:
`Get-Content .devflow/evidence/backlog-60-pass1/test-run-*.log -Tail 1`).
Node-check log:
```
$log = '.devflow/evidence/backlog-60-pass1/node-check.log'
node --check index.js; "index.js exit $LASTEXITCODE" | Out-File $log
node --check client.js; "client.js exit $LASTEXITCODE" | Out-File $log -Append
node --check scripts/test.mjs; "scripts/test.mjs exit $LASTEXITCODE" | Out-File $log -Append
```
→ three `exit 0` lines. Write `verification.md` with: date; the canonical
commands; red→green transition (the 10 frozen red labels, then 51 ok); 5/5
anti-flake result; node --check results; the new-test list; placeholders for
review scores and the security verdict (lead fills at delivery). Confirm every
evidence file is token-clean (reuse the T4 token-scan snippet extended with the
evidence file list).

## 5. Verification strategy (summary)

- Canonical: `node scripts/test.mjs` → exit 0 + `ALL TESTS PASSED` (fresh output
  read in-turn at every gate).
- Red gate (T3): 10 FAIL / 41 ok at HEAD + new tests. Green gate (I1): 51 ok.
- Anti-flake (I2): 5 consecutive green runs, logs under
  `.devflow/evidence/backlog-60-pass1/test-run-<i>.log`.
- Syntax: `node --check` on index.js, client.js, scripts/test.mjs (also asserted
  in-suite).
- Static invariants re-checked by the suite itself: route surface exact-4,
  SAVE_NOTICE literal, pt-BR ban, files arrays, LF/BOM, hygiene tokens,
  failsafe absence (new assertion).
- Required new coverage: the 12 frozen tests (3.8) — strict gate matrix, GET
  surfacing, redaction unit + end-to-end, limits, no-op ordering, concurrent POST,
  busy lock + no auto-recovery, Server-Timing shape, 40-card listing, client
  unchanged/banner/legend.
- No timing assertions; the busy-lock test's ~2s real deadline wait is the only
  deliberate slow path (deterministic).

## 6. Post-parallel & final gates (lead-owned, in order)

1. Adversarial verification workflow on the working diff (feature/bugfix lenses:
   contracts/lifecycle, error paths + retry, test sufficiency, security of the
   hardened boundary, performance/maintainability, docs accuracy) PLUS a security
   lens; two refutation verifiers per finding, a THIRD for security findings;
   confirmed findings become the fix list; re-run I1/I2 after fixes.
2. Review loop: diff-reviewer scores the diff 1-10 with actionable feedback; fix
   Critical/Important; minimum 2 loops, maximum 4, gate >= 8/10 (dev-flow
   clean-exit circuit breaker applies). Re-verify (suite + 5x) after every fix
   batch.
3. Security gate: security-auditor focused diff review — redaction completeness
   (every warn/error-body site; bypass shapes: nested keys, unicode, URL interiors),
   strict-gate bypasses (lenient/strict leakage, post-write consistency), cap and
   allowlist enforcement order, lock protocol (no auto-recovery, relative names),
   no-op TOCTOU window (read-time mtime semantics), Server-Timing data leakage,
   invalid-banner rendering safety (textContent only).
4. Docs reconciliation check: README trilingual parity (T4 snippet), CHANGELOG
   accuracy vs the actual diff, SECURITY.md statements match behavior.
5. TEST VERIFICATION GATE audit: every new behavior has a failing-mode test;
   evidence complete (5 logs + node-check + verification.md) and token-clean;
   tests + logs ride the commit.
6. Delivery: ONE commit via the `git-commit` skill (it owns the full sequence:
   diff analysis, comment sweep, whitespace, checks, staging, Conventional
   Commits message). Suggested shape: `feat(server): harden route trust boundary
   (backlog-60 pass 1)` — the skill owns final wording. NO push.
7. Update `.devflow/runs/backlog-60/progress.md` (token-clean) and deliver the
   consolidated report: what shipped, commands + results, review scores, security
   verdict, remaining risks (e.g. anchored cards become read-only until cleaned —
   intended; no-op returns read-time mtime — documented), next pass readiness.

## 7. Known behavior changes (for docs accuracy & review)

1. Cards with anchors/explicit tags/deep nesting: still listed (lenient GET) but
   every write attempt returns 400 until the frontmatter is cleaned. Aliased or
   oversized cards: listed in `invalid`, not in `roles`.
2. Identical saves: 200 + `unchanged:true` + role summary at read-time mtime; no
   lock, no write. Stale expectedMtimeMs still 409 first. Fail-closed validation
   still applies to no-op saves (catalog down → 503).
3. Busy lock: 503 + `code:'lock-timeout'` + relative lock name + operator guidance
   (was: generic redacted 500). Lock files never auto-removed.
4. POST bodies > 65536 bytes → 413 before disk reads; unknown fields → 400.
5. Error bodies and logs: secrets/home paths replaced by `[redacted]`/`[home]`;
   error codes and context preserved; success payloads unchanged.
6. `Server-Timing` on successful roles/catalog/route responses (durations only);
   panel legend shows last load timings.
7. GET .roles lists cards via a bounded (8) parallel worker pool; final order
   unchanged (sorted by id).
8. Panel: "Already up to date" notice on no-op saves; warning banner naming
   invalid cards; both English until Pass 2.

## 8. Out of scope (later passes — do not smuggle in)

i18n/dictionaries (P2); pack assertion (P2); drafts/undo/batch/profiles (P3/P4);
error-action buttons beyond existing messages (P3); audit/diagnostics/readonly/
installer (P4); coverage/size-budget/docs-parity/link-check CI (P5); new routes;
config fields; package.json/cordis.patch.yml/craft/locale changes; localStorage;
module extraction (no second consumer exists yet).