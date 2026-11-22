# Plan: update-system — port of the dsh-composer-plus update system

## Context & Objectives

Port the update system of `furkancak1r/dsh-composer-plus` into this plugin. Reference clone locator (token-free on purpose — the repo hygiene gate scans `.devflow`): re-clone `https://github.com/furkancak1r/dsh-composer-plus` into an empty temp directory OUTSIDE this repo at Wave 1 start; every `probe index.js:Lnnn` / `probe client.js:Lnnn` anchor below is relative to that clone and was verified against commit `a59ec55`. Today `dsh-orchestrator-kit` has zero outbound network calls, six frozen local routes, and no update UX; the panel is a custom React component in `settings.section`. The reference system has two halves: a Host route that compares the installed version against GitHub releases (double-gated by npm) and a Client store that installs through dsh's own plugin manager, plus a What's-new dialog fed by a shipped `release-notes.json`.

User decisions (frozen, do not reopen):

1. **Install for real** via the host plugin manager (`remote.pluginManager.installBundle` + exact-tarball fallback).
2. **Auto-check ~15 s after startup, no auto-install** — install only on button click (differs from the reference, which auto-installs).
3. **Fiel What's-New dialog** with per-language release notes + `release-notes.json` shipped in the package.

Deliverables: seventh server route `GET /api/dsh-orchestrator-kit.update`, client updater store + What's-New dialog + settings row, `release-notes.json`, manifest inject `@deepseek-ai/dsh-api-remotes`, locale strings in en/pt-BR/zh, full `scripts/test.mjs` contract updates, docs reconciliation.

**Must Have invariants**
- Every response envelope keeps the repo convention: `{ ok: true, ... }` on success, `{ ok: false, error }` on failure (adapts the reference's bare-info shape to this repo's `docs/api.md` contract).
- All outbound requests are read-only GETs (GitHub releases API, npm registry), no credentials, 10 s timeout, and no external data is executed or rendered as HTML (notes render as plain text after `plainNotes`).
- All new user-facing strings flow through `t` in all four locale layers (3 `PANEL_DICTS` faces + 3 `locale/*.json` + `PANEL_KEYS` + sentinel driven states).
- Every persisted key survives `localStorage` failure via try/catch best-effort (repo pattern: `client.js:438-455,473-497`).
- `node scripts/test.mjs` exits 0 on ≥3 consecutive runs at the end (anti-flake), with the byte budget re-measured, not self-adjusted.

**Must NOT Have exclusions (out of scope, do not implement)**
- Usage/telemetry counters (reference `activeCounter`), OS `Notification` toasts (install is manual — the user is on the page; the row's `role=status` is the feedback), `codeChanged`/`LOADED_HASH` diffing, feature toggles, release-notes pipeline script, changes to personas/routes of the craft bundles, any `TODO`/`FIXME`, any forbidden token (the hygiene scan walks `.devflow` too — no user-home paths, machine names, or private handles in any plan/evidence file; all `.devflow` artifacts stay token-free).

**Read-only mode justification** (frozen): `DSH_ORCHESTRATOR_READONLY` gates the card-write route server-side (`index.js:27-32,705-707`). The update check is a read and runs regardless; the install click is a client-side host-manager mutation, outside the flag's server scope. Document this in `SECURITY.md`.

## Contract Freeze (shared interfaces — no lane may drift)

### C1. Server route (Lane S owns implementation)
- Path: `GET /api/dsh-orchestrator-kit.update`, `requestBody: 'buffered'`, registered inside `apply` with the `json` helper (`index.js:462-469`) pattern.
- Without query: runs `checkUpdate(fetch, PACKAGE, request.signal)` + `installedUpdate()` → `200 { ok: true, name, current, latest, managed, newer, url?, notes?, installed? }`; any thrown error → `502 { ok: false, error: String(error?.message ?? error) }`.
- `?current=1`: `200 { ok: true, current: PACKAGE.version, notes?: <shipped per-language notes> }` — zero network, served from the module-scope `SHIPPED_NOTES` cache; `notes` omitted when no file/broken file.
- New exports from `index.js` (for direct unit tests through the existing `await import('../index.js')` pattern, `scripts/test.mjs:1111,1185,1616`): `parseVersion`, `newer`, `releaseNotes`, `shippedNotes`, `installedUpdate`, `checkUpdate(fetchImpl = fetch, pkg = PACKAGE, signal)`.
- New module constants: `RELEASES_URL = 'https://api.github.com/repos/klaus-2/dsh-orchestrator-kit/releases/latest'`, `NPM_NAME = 'dsh-orchestrator-kit'`, `NOTES_MAX = 20000`.
- `PACKAGE = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))` (add `readFileSync` import from `node:fs`; sync read at module scope, same pattern as reference `index.js:91-93`).
- `checkUpdate` semantics (reference `index.js:742-760`): strict `x.y.z` versions only; `managed = pkg.name === NPM_NAME && current !== undefined`; `AbortSignal.timeout(10000)` combined via `AbortSignal.any`; GitHub headers `accept: application/vnd.github+json` + `user-agent: dsh-orchestrator-kit`; `url` kept only when `release.html_url` starts with `https://github.com/`; `newer: npm.ok` double-gate only when the local version is parseable and older than the release tag.
- `installedUpdate()` returns a newer-on-disk version string or `undefined` (detects "updated without restart").

### C2. Client store & UI (Lane C owns implementation)
- Route constant: `const UPDATE_ROUTE = '/api/dsh-orchestrator-kit.update';` next to the six existing ones (`client.js:9-14`).
- Storage keys (machine data, deliberately outside the `dsh-orchestrator-kit.prefs` whitelist): `UPDATE_INSTALLED_KEY = 'dsh-orchestrator-kit.update.installed'`, `WHATS_NEW_KEY = 'dsh-orchestrator-kit.update.whatsNew'`, `SEEN_KEY = 'dsh-orchestrator-kit.update.seen'`.
- `createUpdater()`: external store `{ getSnapshot, subscribe, check, install }` with `busy` reentrancy flag and a `manager` property; state `{ status, info?, error? }`; status machine:
  - `check()`: `idle → checking`; route 404 while a `restart` state stands keeps the previous state (host may be unloaded post-install); non-OK / `ok:false` → `{ status: 'error', error }`; success derives: `installed` on disk newer than `current` → `restart`; `!newer` → `current`; `remembered() === info.latest` (UPDATE_INSTALLED_KEY) → `restart`; `info.managed` → `available`; else → `manual`.
  - `install()`: only from `available` with `manager` set; `installBundle('dsh-orchestrator-kit@<latest>', { requestId })` → on `result.error?.code === 'already-installed'` retry with `https://registry.npmjs.org/dsh-orchestrator-kit/-/dsh-orchestrator-kit-<latest>.tgz`; accept `application ∈ { 'applied', 'restart-required' }` or `result.version === info.latest`, else throw with the first pnpm diagnostic line; persist UPDATE_INSTALLED_KEY and WHATS_NEW_KEY `{ version, notes?, url }` (try/catch); set `current` (applied) or `restart`.
- `createWhatsNew()`: `{ getSnapshot, getRunning, subscribe, close, stopStar(hide), refresh, show, load }` per reference `client.js:11196-11258` (install-time record consumption, `SEEN_KEY` written before the dialog opens, per-language notes fallback to English, `ask()` = `?current=1` fetch with catch → `undefined`).
- `plainNotes(text)`: strips headings and bold → plain text (anti-XSS, reference `client.js:11259`).
- Helper set: `versionOf`, `compareVersions`, `matchLanguage`, `notesByLanguage` (reference `client.js:11182-11193`).
- `primitives` access: `let primitives; try { primitives = require('@deepseek-ai/dsh-client-ui-primitives'); } catch { primitives = undefined; }` — degrade to no dialog when the host lacks the base module (guard `primitives?.Modal === undefined → null`).
- `UpdateSettings` row (adapted to repo style, NOT reference inline styles): CSS classes `dsh-ok-update*` in a new `UPDATE_STYLES` string constant rendered on the panel root as `h('style', null, SUPPORT_STYLES + '\n' + UPDATE_STYLES)` (`client.js:501,1619` pattern); structure: version line `role=status` with per-state text + release-notes link (when `info.url` and status ≠ `current`) + single button `disabled` during `checking`/`installing`; `canInstall = status === 'available' && manager !== undefined`; button label switches `update.install` / `update.check`; placement: between `supportBanner` and the `messages.__load` banner (`client.js:1643-1644`).
- The row runs `check()` on mount only when `status === 'idle'` (reference behavior) — the harness default handler must answer the update route (see T1 item 4).
- What's-New dialog: injected as its own slot `ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'whats-new', locale: NS }, WhatsNewDialog))` inside `apply` (`client.js:1802-1808` pattern); dialog footer: notes link (`info.url`) + close button; body: plain-text notes.
- Star line in the dialog **reuses the existing prefs state**: shown only when `storedPrefs.support` is not answered; link click → `thankStar()` (`client.js:789-793`), "don't ask again" → `dismissSupport()` (`client.js:794-798`). No fourth storage key.
- Wiring in `apply` (`client.js:1782-1809`): module-level `const updater = createUpdater(); const whatsNew = createWhatsNew();` before the plugin return; manager binding via `injectScope(['remote.pluginManager'], (scope) => { updater.manager = scope.remote?.pluginManager; })` with dispose that clears it; auto-check effect: `ctx.effect(() => { const timerId = setTimeout(() => { updater.check(); }, 15000); return () => clearTimeout(timerId); }, 'update: auto-check')` and `timerId.unref?.()` before returning the cleanup; `whatsNew.load()` triggered on apply (degrades silently on 404/storage failure).
- `injectScope(deps, setup)`: `if (ctx.inject === undefined) return [];` else `const fiber = ctx.inject(deps, setup); return [() => fiber.dispose()];` (reference `client.js:14079-14084`).

### C3. Manifest (Lane C owns)
- `package.json`: `"dsh.client.inject": ["@deepseek-ai/dsh-api-remotes"]` (was `[]`, `package.json:64-66`); `"files"` gains `"release-notes.json"` (`package.json:37-49`). Nothing else in the manifest changes.

### C4. Locale strings (Lane L owns; Lane C consumes keys verbatim)
18 new panel keys, frozen text (EN; pt-BR/zh equivalents authored by Lane L with same placeholders). `PANEL_KEYS` grows 130 → 148:

| Key | EN text |
| --- | --- |
| `update.title` | `Updates` |
| `update.checking` | `Checking for updates…` |
| `update.current` | `You have the latest version.` |
| `update.available` | `Version {version} is available.` |
| `update.installing` | `Installing {version}…` |
| `update.restart` | `Version {version} is installed. Restart the harness to finish.` |
| `update.manual` | `Version {version} is available. This copy was not installed from npm; update it from Settings → Plugins.` |
| `update.failed` | `Update check failed: {error}` |
| `update.version` | `Version {version}` |
| `update.check` | `Check for updates` |
| `update.install` | `Update now` |
| `update.notes` | `Release notes` |
| `update.whatsNew` | `What's new` |
| `whatsNew.title` | `What's new in {version}` |
| `whatsNew.close` | `Close` |
| `whatsNew.star` | `Enjoying the kit? ` |
| `whatsNew.starLink` | `Star it on GitHub` |
| `whatsNew.starDismiss` | `Don't ask again` |

(`update.notes` covers both the row link and the dialog footer link — no separate dialog-notes key. The table above is the complete, authoritative list: 18 distinct keys.)

- `PANEL_KEYS` grows 130 → 148 (Lane T appends exactly the 18 keys from the table above, in table order).
- New file `release-notes.json` at repo root: `{ "version": "0.1.0", "notes": { "en": "...", "pt-BR": "...", "zh": "..." } }` — short initial-release notes in all three languages (Lane L owns content).

## Dependency Graph & Parallel Waves

```
Wave 1 (parallel, disjoint): S(index.js) | C(client.js + package.json) | L(locale/*.json + release-notes.json)
Wave 2 (parallel, disjoint, after Wave 1): T(scripts/test.mjs) | D(docs + READMEs + SECURITY/CHANGELOG/CONTRIBUTING)
Wave 3: reconciliation + deterministic preflight + anti-flake (Lead)
```

## Tasks

### Task S1 — Server route + update helpers (Lane S)
- `Parallelizable`: YES (with C1, L1)
- `Write Scope`: `index.js` only
- `References`: `index.js:1-19` (imports), `index.js:27-32` (readonly), `index.js:461-469` (json helper), `index.js:482-534` (route pattern), `index.js:957` (exports); probe `index.js:688-760,2293-2308`
- `What to do`:
  1. Add `import { readFileSync } from 'node:fs';` alongside the fs/promises import.
  2. Add module constants `RELEASES_URL`, `NPM_NAME`, `NOTES_MAX`, `PACKAGE`, `SHIPPED_NOTES` (lazy-read `release-notes.json` once at module scope in an IIFE with try/catch → `undefined`).
  3. Implement + export `parseVersion`, `newer`, `releaseNotes`, `shippedNotes`, `installedUpdate`, `checkUpdate` exactly per contract C1 (strict semver; no pre-release; `NOTES_LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/` filter on shipped-notes language keys, blocking `__proto`-style keys; release body cut at `## Install` heading, capped at `NOTES_MAX`).
  4. Register the `update` route inside `apply` per C1 (before the closing of `apply` at `index.js:955`, after the diagnostics route at `index.js:621-698`).
- `Must NOT do`: no fetch of anything beyond `RELEASES_URL` and `https://registry.npmjs.org/<name>/<version>`; no `codeChanged`/hashing; no new dependencies; do not touch existing routes.
- `Verify`: `node --check index.js` exit 0; `node -e "const m = await import('./index.js'); console.log(typeof m.checkUpdate, typeof m.parseVersion)"` prints `function function`; `node scripts/test.mjs` — the route-surface test will fail until Lane T lands (expected; Wave 1 verify is syntax + import only, full verify in Wave 3).

### Task C1 — Client updater + dialog + row + wiring (Lane C)
- `Parallelizable`: YES (with S1, L1)
- `Write Scope`: `client.js` + `package.json` only
- `References`: `client.js:1-14` (module head/routes), `client.js:429-499` (locale/prefs helpers), `client.js:501,1618-1619` (style rendering), `client.js:730-820` (createSettings/support helpers), `client.js:1643-1644` (row placement), `client.js:1782-1809` (apply wiring); probe `client.js:11040-11327,14079-14084,14627-14652`
- `What to do`:
  1. Manifest: `inject: ['@deepseek-ai/dsh-api-remotes']`, `files` += `release-notes.json` (contract C3).
  2. Add `UPDATE_ROUTE`, the three storage keys, helpers (`versionOf`, `compareVersions`, `matchLanguage`, `notesByLanguage`, `plainNotes`), `createUpdater`, `createWhatsNew`, `UpdateSettings` component, `WhatsNewDialog` component, `UPDATE_STYLES`, per contract C2 — all keys from C4 verbatim through `t`.
  3. Render the update row between `supportBanner` and `messages.__load` (after `client.js:1643`), and concat `UPDATE_STYLES` into the root `<style>` at `client.js:1619`.
  4. Wire `apply`: create updater + whatsNew stores, `injectScope(['remote.pluginManager'])` binding with dispose, `shell.overlay` slot injection for the dialog, auto-check 15 s effect with `unref`, `whatsNew.load()`.
- `Must NOT do`: no `Notification` API; no telemetry; no inline-styled widgets (follow repo CSS-class style); no changes to existing components' markup beyond the two insertion points; no fourth storage key.
- `Verify`: `node --check client.js` exit 0; byte size recorded in `.devflow/evidence/update-system/client-size.txt` (Lane T needs the measured size); `node scripts/test.mjs` — route-surface + sentinel will fail until Lane T lands (expected in Wave 1).

### Task L1 — Locale strings + release notes content (Lane L)
- `Parallelizable`: YES (with S1, C1)
- `Write Scope`: `locale/en.json`, `locale/pt-BR.json`, `locale/zh.json`, `release-notes.json` (new)
- `References`: `locale/en.json:1-139` (shape: `meta` + `panel`, `{param}` placeholders), `client.js:29-426` (dictionary faces must stay deep-equal to the JSON panels per `scripts/test.mjs:3020-3023`)
- `What to do`:
  1. Append exactly the 18 keys from contract C4 to `panel` in each of the three JSON files, correct pt-BR (with diacritics) and zh translations, preserving JSON formatting/key order of the file (append after the last existing key, matching indentation).
  2. Author `release-notes.json` per C4 with concise 0.1.0 release notes per language (3-6 lines each; plain text, no links).
- `Must NOT do`: no changes to `meta` sections; no reordering/reformatting of existing keys; no keys outside C4.
- `Verify`: `node -e "JSON.parse(require('fs').readFileSync('locale/en.json','utf8'))"` ×3 exits 0; diff shows only appends; `release-notes.json` parses and has `en`, `pt-BR`, `zh` keys.

### Task T1 — Test contracts update + new coverage (Lane T)
- `Parallelizable`: NO (depends on S1, C1, L1)
- `Write Scope`: `scripts/test.mjs` only
- `References`: `scripts/test.mjs:36-40` (floors + ceiling constant), `scripts/test.mjs:1988-2033` (route surface + package contract), `scripts/test.mjs:2070-2272` (mountVmClient sandbox + React stub), `scripts/test.mjs:2746-2877` (PANEL_KEYS), `scripts/test.mjs:2879-2957` (FROZEN_PACK_FILES), `scripts/test.mjs:3001` (probeModule React stub), `scripts/test.mjs:3039-3142` (sentinel gate + support persistence test), `scripts/test.mjs:5385-5391` (byte budget), `scripts/test.mjs:5461-5513` (reference docs gates)
- `What to do`:
  1. Route surface: extend the regex with `|update`, expect `serverRoutes.length === 7` (`scripts/test.mjs:1989-1993`).
  2. Package contract: `dsh.client.inject` deep-equals `['@deepseek-ai/dsh-api-remotes']`; `PKG.files` gains `'release-notes.json'` in the same position as `package.json` (`scripts/test.mjs:2014-2030`).
  3. `FROZEN_PACK_FILES` gains `'release-notes.json'` in alphabetical position (`scripts/test.mjs:2879-2957`, 77 → 78 entries); update the now-stale "77-entry" wording in the npm-pack test title/messages (`scripts/test.mjs:5046,5052,5072` — cosmetic strings) AND the hard-coded count assertion at `scripts/test.mjs:5051` (`parsed[0].entryCount` 77 → 78), which will genuinely fail if missed.
  4. Harness: add `useSyncExternalStore(subscribe, getSnapshot) { return getSnapshot(); }` to both React stubs (`scripts/test.mjs:2174-2188` and the probeModule stub at `scripts/test.mjs:3001`); widen the `slots.inject` assertion at `scripts/test.mjs:2192-2194` to accept `'settings.section'` and `'shell.overlay'`; extend the default registration-handler pattern so mounted sessions answer `/api/<NS>.update` and `/api/<NS>.update?current=1` with up-to-date fixtures unless a test overrides (prevents 404-driven error states from leaking into existing tests).
  5. `PANEL_KEYS` += exactly the 18 keys from C4 in table order (`scripts/test.mjs:2746-2877`; the parity gate at `scripts/test.mjs:2967` deep-equals `PANEL_KEYS` against the JSON panel keys, so Lane L's appended set and this array must match 1:1 — 130 → 148).
  6. Sentinel gate: driven states covering every new key — mount with update-row states (`current`, `available`, `manual`, `restart`, `installing`, `checking`, `error`), dialog open states with per-language notes and the star line, `allowedData` additions for version fixtures (`'0.1.0'`, a fixture latest like `'0.2.0'`) and plain-notes fixture text (`scripts/test.mjs:3053-3081`).
  7. New unit tests (module import pattern of `scripts/test.mjs:1111,1185,1616`) for `parseVersion`, `newer`, `releaseNotes`, `shippedNotes`, `installedUpdate`, `checkUpdate`: happy path, non-`x.y.z` rejection, GitHub non-OK, npm gate `newer:false`, missing/bad tag, non-github `html_url`, body with `## Install` cut, `__proto`-style language key rejection, newer-on-disk, signal propagation.
  8. New VM tests: updater state machine (`current`/`available`/`manual`/`restart`/`error`/404-preserves-restart), install flow (`applied` → current + UPDATE_INSTALLED_KEY persisted, `restart-required` → restart, `already-installed` → tarball fallback spec visible in manager calls, invalid result → error), row button labels/disabled per state, What's-New once-per-version (`SEEN_KEY` write, no re-show), per-language notes resolution (`pt-BR` match, English fallback), `stopStar`/star-link persistence into `dsh-orchestrator-kit.prefs.support`, plain-notes sanitization (heading/bold stripped).
  9. Byte budget: replace `107774` with the measured size from `.devflow/evidence/update-system/client-size.txt`, raise `CLIENT_BYTE_CEILING` to the next 4 KiB multiple above the measured size, update the headroom assertion accordingly, and refresh the stale numeric wording inside the same block (test title `...112640-byte ceiling...` and messages `112640 bytes (110 KiB)` at `scripts/test.mjs:5385,5388,5390`) plus the `'112640'` echo assertion that hard-codes the ceiling string (`scripts/test.mjs:5511-5512`) — the numbers must be re-measured, never guessed.
  10. Reference-docs gates (`scripts/test.mjs:5461-5513`): extend to cover the new route section in `docs/api.md` and route table in `docs/architecture.md` if those gates enumerate sections.
- `Must NOT do`: no weakening of the forbidden-token scan, hygiene walker, or coverage floors; no test skips; no self-adjusting byte assertions.
- `Verify`: `node scripts/test.mjs` exit 0 (full suite), run 3 consecutive times, log outputs to `.devflow/evidence/update-system/`.

### Task D1 — Docs reconciliation (Lane D)
- `Parallelizable`: YES (with T1, after S1+C1)
- `Write Scope`: `README.md`, `README.pt-BR.md`, `README.zh-CN.md`, `docs/api.md`, `docs/architecture.md`, `docs/troubleshooting.md`, `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`
- `References`: `docs/api.md:1-19` (route summary shape), `docs/architecture.md:49-60` (route surface), `SECURITY.md:11-45` (scope + "no remote-execution surface" claim), `docs/troubleshooting.md:47` (byte-budget row), `CHANGELOG.md:14-20` (Unreleased → Added), `scripts/docs-parity.mjs:11-63` (three-README parity)
- `What to do`:
  1. `docs/api.md`: add `/api/dsh-orchestrator-kit.update` to the route summary table + a `GET update` section documenting both shapes (default + `?current=1`), the 502 error envelope, and the outbound sources (GitHub releases API, npm registry).
  2. `docs/architecture.md`: extend the route-surface table; add a short "Update checking" paragraph stating the route performs read-only outbound GETs without credentials and that install runs through the host plugin manager client-side.
  3. `SECURITY.md`: add the update route to the in-scope route list; reword the "serves local HTTP routes only" sentence to the new truth (local routes + read-only outbound GET to GitHub/npm, no credentialed or write traffic, install delegated to the host plugin manager); keep the read-only-mode paragraph consistent with the C2 justification.
  4. `docs/troubleshooting.md`: update the byte-budget row to the new ceiling measured in T1 (if T1 hasn't finished, write "the versioned ceiling" and fill the number in the Wave 3 reconciliation pass).
  5. Three READMEs (structurally identical): a short "Updates" subsection under install/configuration — the panel checks GitHub releases every startup, installs through the harness plugin manager from the Settings page, shows What's-new notes per language, and treats non-npm (renamed/linked) copies as manual-update-only.
  6. `CHANGELOG.md`: under `## [Unreleased] → Added`, describe the update system (route, panel row, What's-New dialog, release-notes.json, manifest inject).
  7. `CONTRIBUTING.md`: document the manual `release-notes.json` update step per release (edit all three languages, bump `version` to the released one).
- `Must NOT do`: no invented behavior beyond the frozen contract; no docs drift between the three READMEs (parity gates will fail); no relative links that do not resolve.
- `Verify`: `node scripts/docs-parity.mjs` exit 0 (or the suite's docs tests green); relative-link scan green in `node scripts/test.mjs`.

## Post-Parallel Reconciliation & Gates (Lead, Wave 3)

1. Reconcile Wave 1 diffs against contract C1-C4 (route name, envelope `ok` flags, key names, exports) before T1 runs.
2. Deterministic preflight: `node scripts/test.mjs` full suite exit 0, then ≥3 consecutive green runs (anti-flake gate, behavioral suite) with outputs logged to `.devflow/evidence/update-system/`.
3. Security gate (mandatory — new outbound surface + code-install path): dispatch `security-auditor` over the full diff; findings re-enter implementation with delta-scoped re-verification.
4. Corps review: `diff-reviewer` (mandatory) + `test-auditor` + `error-auditor` over the preflight-clean diff; Review-Loop circuit breaker applies (skip second round on zero surviving Critical/Important findings).
5. Docs sync is covered by D1; confirm no drift between docs and the shipped behavior in the final read.

## Evidence

`.devflow/evidence/update-system/` — client byte-size measurement, per-run test outputs, security-auditor verdict, corps score.
