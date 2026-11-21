# Backlog-60 Pass 4 — Multi-Card & Admin Surfaces (executable plan)

> **Execution:** `run-conductor` executes this plan task-by-task after a
> `plan-auditor` `OKAY` verdict. Workers have ZERO interview history: everything
> needed is in this file. Master context: `.devflow/plans/backlog-60-master.md`
> (C1, C9, C17, C18, C19, C20, C21, C8, C15 bind this pass). Repo rules:
> `AGENTS.md`. Pass-3 trail: `.devflow/plans/backlog-60-pass3.md` (rev 3),
> `.devflow/evidence/backlog-60-pass3/verification.md` + `verification-delta.md`,
> `.devflow/notes/backlog-60-pass3/decisions.md` (D-1, D-2, I1/F1 notes).

**Goal:** ship the multi-card and admin surfaces as ONE atomic vertical slice —
per-phase batch apply on the frozen `runCardLoop` (plus the authorized
`shouldCancel` hook), exportable routing profiles with a two-phase
validate-all-before-any-write import, the append-only audit trail inside the
existing lock critical section, on-demand read-only diagnostics, the craft
install script, readonly mode (server 403 + UI bootstrap field), and the item-60
chunking decision — all in the SAME commit with their tests, harness extensions
and docs.

**Architecture:** index.js gains TWO new GET routes (`.events`,
`.diagnostics`), one env-flag readonly gate on POST `.route`, and an audit
append inside the existing `withFileLock` critical section. NO new POST routes:
items 48/49 stay client loops over the single-card POST (C9/R-08/R-09). The
client gains batch controls per section, an import/export block plus events and
diagnostics sections inside the existing legend details, and a readonly mode
driven by a `readOnly` boolean on the GET `.roles` envelope (C19).
`scripts/install-craft.js` (auto-whitelisted by `files: ["scripts/"]`) copies
craft/ sources to the agents root.

**Tech Stack:** unchanged — Node >= 22 ESM, `yaml`, React via host seed
(createElement/useState/useEffect only), `node:vm` harness (extensions 3.11,
backward compatible), `withFileLock`/`writeFileAtomic` plus `appendFile` (node
builtin) for the audit append.

**Backlog items covered:** 49 (batch apply per phase), 48 (exportable routing
profiles), 25 (audit trail), 44 (installed-cards diagnostics), 45 (craft
install script), 24 (readonly mode), 60 (COND — chunking decision frozen in
3.11 and recorded in the evidence).

**Baseline (verified fresh this planning turn, mechanically):** HEAD `ae8c32a`,
clean tree, `node scripts/test.mjs` → exit 0, `ALL TESTS PASSED`, **71 ok**
(71 `await test(` labels, script-counted). index.js 796 lines / 37,806 bytes;
client.js 1242 lines / 71,207 bytes; scripts/test.mjs 4299 lines. Locale
**95 panel keys ×3**; `PANEL_KEYS` array **95**; `PANEL_RENDERABLE_KEYS` **54**
unique, zero dups. Pack live probe: **69 entries**, `scripts/` carries exactly
`scripts/test.mjs`. craft/agents **20** files; craft/ total **52**. Route
literals index.js **4**, client.js **4**. No `shouldCancel`, no audit/readonly
references, no installer at HEAD.

**Pass-4 arithmetic (frozen; see §8):** dictionary **95 + 27 = 122 keys ×3**;
`PANEL_KEYS` 95 → **122**; `PANEL_RENDERABLE_KEYS` 54 → **58** (+4
non-interpolated default-state keys); route surface 4 → **6**; pack 69 → **70**;
tests 71 → **78**; red gate **15 FAIL / 63 ok**; green gate **78 ok**.

---

## 1. Context (read before touching anything)

### 1.1 Current anchors (re-verified on disk at ae8c32a this turn)

index.js (796 lines):
- imports 1-5 (`lstat, readFile, readdir, realpath, stat` from node:fs/promises;
  `homedir`; `path`; `withFileLock, writeFileAtomic`; `parseDocument, visit`);
  inject ['connection'] 8; constants 10-18 (CATALOG_TIMEOUT_MS 10,
  FRONTMATTER_MAX_BYTES 13, MAX_ROUTE_BODY_BYTES 15, CARD_READ_CONCURRENCY 16,
  ROUTE_BODY_FIELDS 17, LOCK_TIMEOUT_PREFIX 18); agentsRootOf 20-24;
  isEntryName 26-28; cardPathOf 30-45; lstatNoSymlink 47-55;
  assertContainedRealCardPath 57-99; dominantEolOf 101-105; redaction block
  114-138; safeErrorText 140-142; parseFrontmatterDocument 144-169 (strict
  visit 154-163); parseRoleCard 171-192; validateRouteInput 194-204;
  applyCardSettings 206-266; modelCatalog 355-414 (default 362-372);
  toRoleSummary 416-427; apply(ctx, config) 429; json() 430-437; cardsDir 438;
  timeoutMs 439-441; getService 442-447; GET .roles 449-501 (ENOENT 459,
  invalid[] 465+492-493, sorts 497-498, response envelope 499); GET .catalog
  503-519; GET .efforts 521-551; POST .route 553-793 (content-length guard
  558-562; unknown-field allowlist 570-571; id 572; provider/model pairing
  577-589; disabled 591-594; reasoningEffort 596-604; expectedMtimeMs 601-604;
  at-least-one-field 606-608; reset+effort 610-612; path containment 614-634;
  stale-mtime 409 636-638; strict parse 640-648; existingMeta 650-653; catalog
  gate 655-666; effort gates 668-687; patch 689-693; next/nextCard 695-702;
  unchanged no-op 703-717; pre-lock re-check 719-725; baselineMtimeMs 727;
  withFileLock write 731-780 (containment 733, lstat 735-745, baseline 409
  743-745, writeFileAtomic 747, read-back 752-760, status return 755);
  lock-timeout 503 769-777; writeMs 781; post-write parse 783-790; 200 +
  timing 791); export line 796 (name, inject, apply, agentsRootOf,
  isEntryName, cardPathOf, parseRoleCard, applyRouteToCard, applyCardSettings,
  redactText).

client.js (1242 lines):
- NS 7; ROLES/CATALOG/EFFORTS/ROUTE constants 8-11; PANEL_DICTS 26-318
  (+ pt alias 319); LANGUAGE_OPTIONS 320; LOCALE_STORAGE_KEY 321; makeT
  323-328; readStoredLocale 330-337; writeStoredLocale 339-347;
  localeOverride 349; draftStore 351; undoSnapshots 358; sessionChangedIds
  359; PREFS_STORAGE_KEY 361; TAB_IDS 362; readStoredPrefs 365;
  writeStoredPrefs 381; storedPrefs 390; style constants 392-413;
  srOnlyStyle 414; effortKeyOf 416; parseApiResponse 418-442; fetchJson
  444-455; postSettings 457-465; **runCardLoop 467-488 (Pass-3 frozen; 3.1
  extends it)**; normalizeDraft 490-495; evaluateDraftState 497-510;
  groupRoles 512-532; phaseOf 534; createSettings 536; hostT 537;
  focusedCardId 538; state inits 540-572; locale subscribe 573; t 574; load
  effect 587 (roles/catalog handling); efforts effect 669; refreshAll 742;
  setDraft 753; retryAfterConflict 766; save 784-845; undoEntryFor 847-852;
  undo 854-895 (runCardLoop call 870-872); onPanelKeyDown 897-902;
  messageText 904; statusOf 911; sortRoles 914; matchesSearch/matchesStatus
  920; visibleRoles 922; baseSections/sections 924-930;
  breakdownOf/breakdownText 931-940; renderCard 941-1107; visibleSections
  1109; activeIndex 1110; tab keydown 1111-1121; render root 1123; header
  counts live region 1127-1131; sr-only live region 1157-1158; legend
  details 1159-1169; controls row 1170-1181; tablist 1182-1193;
  tabpanel/empty chain 1194-1208; registration 1213-1240.

scripts/test.mjs (4299 lines, 71 tests):
- withMockHost 177-213 (env override + finally restore; routes Map;
  `call(routePath, options)` asserts method + parses JSON; returns
  `{ call, routes }`); node --check array 1962 (`['index.js','client.js',
  'scripts/test.mjs']`); LF/BOM array 1969 (8 files incl. locale ×3);
  route-surface test 1896-1902; package-contract 1904-1941 (files deepEqual
  1922-1934); static contract 1943-1959; FROZEN_PACK_FILES 2748-2816 (69);
  mountVmClient 1976-2176 (return 2175 incl. windowListeners); shared helpers
  2194-2206; big VM test 2209-2553; N12 2555-2620; N17 XSS 2622-2648;
  PANEL_KEYS 2650-2746 (95); P2-N1 2822-2844; P2-N2 2846-2898
  (registrations.length === 4 = locale FACES 2878); P2-N3 2900-3208
  (requiredKeys from en.json 2903; scanTree 2941-2951; gateBreakdownText
  2912-2913; allowedData 2914-2930; missingKeys 3206-3207);
  PANEL_RENDERABLE_KEYS 3210-3221 (54); P2-N4 3223-3337; P3-N1 3339;
  P3-N2 3476; P3-N3 3608; P3-N4 3678; P3-N5 3744; P3-N6 3832; P3-N7 3897;
  P3-N8 3955; P3-N9 3989; P3-N10 4030; pack test 4038-4079; codemap
  4083-4205; craft tests 4207-4271; hygiene 4273-4287; rename 4289-4297.

### 1.2 Pass-3 lessons that bind this pass

- Zero-narrative comments; explicit catch fallbacks; plan read-only during
  execution; discoveries to `.devflow/notes/backlog-60-pass4/`; contract
  defects STOP + escalate.
- **`runCardLoop` (client.js 467-488) is frozen VERBATIM from Pass 3.** Pass 4
  adds ONLY the authorized `shouldCancel` hook (3.1). Undo's call site
  (870-872) keeps its exact options object.
- Realm-safe deepEqual (JSON round-trip) across vm/host; `settle(false)`
  microtask drain for held responses; locale-independent finders by aria-label.
- The I1/F1 lesson: plain Refresh resets drafts; the 409 action preserves them
  (C10). Import's refresh-then-apply preserves drafts by re-sending them against
  fresh mtimes, never silently.
- Frozen-test deviations are recorded in the evidence Amendment-trail section,
  fixed contract-wins, never weakened.

### 1.3 Harness semantics that bind this pass

- Q1a: POST `.route` is already owner-gated by the host; readonly (3.7) is a
  SECOND gate in front of validation, never a replacement.
- Q1d: `no-store` responses; no 304. C3: events/diagnostics are computed on
  demand, never cached server-side.
- Q4/Q6: prefs same-session; only the active settings section mounts, so
  module-level stores (and in-memory event caches) are what survive.
- The installer runs OUTSIDE the harness as a plain Node CLI (spawnSync tests
  with `DSH_AGENTS_HOME` overridden to a tmp dir); it imports the plugin's own
  exported helpers via a relative import (`../index.js`), exactly as
  scripts/test.mjs does (test.mjs:20-28).

## 2. Must Have / Must NOT Have (Pass 4)

Must have:
- ONE atomic commit (C1): index.js + client.js + locale ×3 +
  scripts/install-craft.js (NEW) + scripts/test.mjs + docs ×4 together.
- `runCardLoop` reused VERBATIM except the 3.1 hook; undo call site untouched.
- Every new user-facing string = dictionary key ×3 languages (3.9, byte
  -exact); N1/N2 parity and the N3 sentinel gate extend automatically
  (`requiredKeys` derives from en.json).
- Security gate mandatory (section 6) with concrete redaction, lock,
  path-containment and invalid-input tests per new surface (P4-N3/N4/N5/N6).
- Route-surface rework RW-P4-1 is ADDITIVE: the regex gains
  `events|diagnostics`, both sets must stay deepEqual, count 4 → 6.
- Pack revision RW-P4-2: 69 → **70** entries (ONE new tarball entry:
  `scripts/install-craft.js`), live-probed mechanism (`files: ["scripts/"]`),
  frozen list updated in the SAME commit.
- `node --check` array and LF/BOM array gain `scripts/install-craft.js`.- Anti-flake 5×; evidence under `.devflow/evidence/backlog-60-pass4/`;
  green logs only; token-clean everywhere.
- C15: N17 re-run green; new rendering interpolates data as string children.
- Tests + verification logs ride the same commit.

Must NOT have:
- No server batch/profile routes (R-08/R-09); no new POST routes; no server
  cache (C3) for events/diagnostics.
- No orphan-lock auto-recovery (C5). Audit failure NEVER rolls back the card
  write and never fails the save response (C20); audit stores NO secrets, NO
  absolute paths, NO backup-suffix literal.
- Installer: NO backups; NO overwrite mode at all (skip-existing always); no
  new runtime dependency; never writes outside `agentsRootOf()`.
- Readonly: the server flag is authoritative; the UI mirror never substitutes
  for it; no silent degradation of the 403.
- Import: never silent last-writer-wins; never writes before the full
  validate pass; never trusts profile mtimes (stripped on export, ignored on
  import).
- No new React hooks beyond useState/useEffect; no new sandbox globals beyond
  3.12; the require assert byte-identical.
- No timer-based UI decay; no timing assertions.
- No machine tokens, no backup-suffix literal, no old plugin identity;
  repo-relative paths only.
- No push; commit only via the git-commit skill.

## 3. Contract Freeze (binds ALL tasks; frozen BEFORE parallel work)

### 3.1 runCardLoop extension — the authorized shouldCancel hook (C9)

T1 replaces client.js **467-488** with EXACTLY this block (the alive guard and
the 409-continue semantics stay byte-identical; the hook is a second pre-card
check with the same abort shape). The undo call site (870-872) is NOT touched:

```js
async function runCardLoop(cards, runOne, options = {}) {
  const results = [];
  let aborted = false;
  let cancelled = false;
  for (const card of cards) {
    if (typeof options.alive === 'function' && !options.alive()) {
      aborted = true;
      break;
    }
    if (typeof options.shouldCancel === 'function' && options.shouldCancel()) {
      cancelled = true;
      break;
    }
    try {
      const outcome = await runOne(card);
      results.push({ id: card.id, ok: true, ...outcome });
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : null;
      results.push({ id: card.id, ok: false, status, detail: String(error?.message ?? error) });
      if (status !== 409) {
        aborted = true;
        break;
      }
    }
  }
  return { results, aborted, cancelled };
}
```

Additive-only delta versus Pass 3: `cancelled` flag + the second guard. Undo
destructures `{ results }` (870) and is unaffected. Pass-4 consumers:
- batch (3.2): `{ alive, shouldCancel: () => cancelRef.current }`.
- import (3.3): `{ alive }` only (import never cancels mid-write; a stopped
  import is a validation failure by definition).

### 3.2 Batch apply per phase (item 49)

Scope: the ACTIVE tab's visible cards that carry a dirty route/effort draft.
Provider+model must both be set on the source card (batch copies the SOURCE
card's draft route/effort to the others); a card already matching the target is
skipped client-side (no POST — the server would answer unchanged anyway, but a
skip keeps the report honest).

Batch control placement: one button per rendered section header (both density
modes), rendered only when `activeTab !== 'all'` (a phase-scoped action never
appears for the "all" bucket). Source card selection: the first visible card
whose draft is dirty on route/effort, in render order.

```js
const batchSourceOf = (list) => {
  const target = list.find((role) => {
    const draft = drafts?.[role.id];
    if (!draft) return false;
    const state = evaluateDraftState(draft, normalizeDraft(role), catalogEmpty);
    return (state.routeDirty || state.effortDirty) && draft.provider !== '' && draft.model !== '';
  });
  if (!target) return null;
  const draft = drafts[target.id];
  return {
    provider: draft.provider,
    model: draft.model,
    reasoningEffort: draft.reasoningEffort === '' ? null : draft.reasoningEffort
  };
};
```

Runner (component scope; in-flight lock via one state — `const [batchPhase,
setBatchPhase] = React.useState(null);` (the running phase id or null) and a
module-free cancel ref `const cancelRef = React.useState(() => ({ current:
false }))[0];` — a useState-ref, since the hook allowlist has no useRef):

```js
const runBatch = async (section, target) => {
  const targets = section.roles.filter((role) => {
    if (role.id === undefined) return false;
    const base = normalizeDraft(role);
    return base.provider !== target.provider || base.model !== target.model || base.reasoningEffort !== (target.reasoningEffort ?? '');
  });
  if (targets.length === 0) {
    const message = { kind: 'error', key: 'batch.empty' };
    setLastNotice(message);
    return;
  }
  cancelRef.current = false;
  setBatchPhase(section.id);
  setHighlightId(null);
  const { results, aborted, cancelled } = await runCardLoop(targets, (role) => {
    const payload = { id: role.id };
    if (typeof role.mtimeMs === 'number' && Number.isFinite(role.mtimeMs) && role.mtimeMs >= 0) {
      payload.expectedMtimeMs = role.mtimeMs;
    }
    payload.provider = target.provider;
    payload.model = target.model;
    if (target.reasoningEffort !== null && target.provider !== '') payload.reasoningEffort = target.reasoningEffort;
    return postSettings(payload);
  }, { alive: () => mountState.mounted, shouldCancel: () => cancelRef.current });

  if (!mountState.mounted) return;
  const ok = results.filter((result) => result.ok);
  const conflicted = results.filter((result) => !result.ok && result.status === 409);
  const failed = results.filter((result) => !result.ok && result.status !== 409);
  if (ok.length > 0) {
    tracker.saves += 1;
    const byId = new Map(ok.map((result) => [result.id, result.role]));
    const nextRoles = (rolesCache ?? roles ?? []).map((entry) => byId.get(entry.id) ?? entry);
    rolesCache = nextRoles;
    setRoles(nextRoles);
    setDrafts((current) => {
      const next = { ...current };
      for (const [id, role] of byId.entries()) next[id] = normalizeDraft(role);
      return next;
    });
    for (const id of byId.keys()) {
      pruneStoreFor(draftStore, id);
      sessionChangedIds.add(id);
    }
  }
  setMessages((current) => {
    const next = { ...current };
    for (const result of results) {
      if (result.ok) continue;
      next[result.id] = result.status === 409
        ? { kind: 'error', key: 'error.conflict', params: { detail: result.detail } }
        : { kind: 'error', key: 'error.raw', params: { detail: result.detail } };
    }
    return next;
  });
  const message = cancelled
    ? { kind: 'warning', key: 'batch.cancelled', params: { applied: String(ok.length) } }
    : aborted
      ? { kind: 'error', key: 'batch.summary', params: { applied: String(ok.length), conflicted: String(conflicted.length), failed: String(failed.length) } }
      : { kind: 'ok', key: 'batch.summary', params: { applied: String(ok.length), conflicted: String(conflicted.length), failed: String(failed.length) } };
  setLastNotice(message);
  setBatchPhase(null);
};
```

Frozen semantics: per-card expectedMtimeMs MANDATORY (index.js:629 opt-in
design); continue-and-report on 409; abort on first non-409 (503 lock-timeout
aborts, correct per C9); cancel via the 3.1 hook; no "atomic" framing
anywhere in UI copy; per-card failures render through the existing card
message slot.

Batch control markup (section header, after the count span):

```js
const batchTarget = batchSourceOf(section.roles);
const batchBusy = batchPhase === section.id;
h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' } },
  batchBusy
    ? h('button', { type: 'button', onClick: () => { cancelRef.current = true; }, style: { ...buttonStyle, fontSize: 11, padding: '4px 8px' } }, t('batch.cancel'))
    : h('button', {
        type: 'button',
        onClick: () => runBatch(section, batchTarget),
        disabled: batchTarget === null || batchPhase !== null || readonlyMode,
        style: batchTarget === null ? { ...buttonStyle, fontSize: 11, padding: '4px 8px', opacity: 0.5 } : { ...buttonStyle, fontSize: 11, padding: '4px 8px' },
        'aria-label': t('batch.applyAria', { phase: t('phase.' + section.id) })
      }, batchBusy ? t('batch.busy') : t('batch.apply')))
```

### 3.3 Routing profiles export/import (item 48)

Public file format (versioned contract):

```json
{
  "version": 1,
  "generator": "dsh-orchestrator-kit",
  "roles": {
    "planner": { "provider": "example-hub", "model": "flash-a", "reasoningEffort": "high", "disabled": false },
    "repo-scout": { "provider": null, "model": null, "reasoningEffort": null, "disabled": false }
  }
}
```

- Export: `version: 1`, `generator`, `roles` keyed by id, values = the SAVED
  summary mapped to payload vocabulary (provider/model null when inherited,
  effort null when unset, disabled boolean). **mtimeMs is NEVER exported.**
  Download through a Blob URL created with `URL.createObjectURL` — guarded
  (`typeof URL.createObjectURL === 'function'`), because the VM sandbox has no
  URL; when absent, export copies the JSON to the clipboard-less fallback
  path: it sets `window.__orchestratorExport = json` and renders the JSON in a
  read-only textarea for manual copy (deterministic in the harness, honest in
  the browser). Freeze: ONE code path, both affordances.

```js
const buildProfile = () => ({
  version: 1,
  generator: NS,
  roles: Object.fromEntries((roles ?? []).map((role) => [role.id, {
    provider: role.provider || null,
    model: role.model && role.model !== 'inherit' ? role.model : null,
    reasoningEffort: role.reasoningEffort ?? null,
    disabled: role.disabled === true
  }]))
});
```

- Validation (phase 1 — NO writes). `validateProfile(doc)` returns
  `{ ok: true, entries } | { ok: false, detail }`:
  - doc is an object, `doc.version === 1` (else detail `unsupported version: <v>`),
    `doc.roles` is a plain object with ≥1 key.
  - every key passes `isEntryName`-equivalent check client-side
    (`/^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*$/` — the server re-validates).
  - every value: `provider` null or non-empty string; `model` null or
    non-empty string; both null or both non-null (half-written rejected);
    `model !== 'inherit'` when provider is set; `reasoningEffort` null or
    non-empty string; effort non-null only when provider+model are set;
    `disabled` boolean.
  - ids not present in the current role list are skipped with a count (never a
    hard error — profiles travel across machines).
- Apply (phase 2 — refresh-then-apply): after validation passes, ONE
  `fetchJson(ROLES_ROUTE)` picks up fresh mtimes, then `runCardLoop` posts each
  entry with the FRESH expectedMtimeMs and the full route/effort/disabled set:

```js
const runImport = async (doc) => {
  const checked = validateProfile(doc);
  if (!checked.ok) {
    const message = { kind: 'error', key: 'profile.invalid', params: { detail: checked.detail } };
    setLastNotice(message);
    return;
  }
  let fresh = null;
  try {
    const reply = await fetchJson(ROLES_ROUTE);
    if (Array.isArray(reply?.roles)) fresh = reply.roles;
  } catch (error) {
    setLastNotice({ kind: 'error', key: 'error.raw', params: { detail: String(error?.message ?? error) } });
    return;
  }
  if (fresh === null) {
    setLastNotice({ kind: 'error', key: 'profile.invalid', params: { detail: 'roles could not be refreshed' } });
    return;
  }
  rolesCache = fresh;
  setRoles(fresh);
  const known = new Set(fresh.map((role) => role.id));
  const entries = checked.entries.filter((entry) => known.has(entry.id));
  const skipped = checked.entries.length - entries.length;
  if (entries.length === 0) {
    setLastNotice({ kind: 'error', key: 'profile.rejected', params: { count: String(checked.entries.length) } });
    return;
  }
  const byId = new Map(fresh.map((role) => [role.id, role]));
  setImporting(true);
  const { results } = await runCardLoop(entries, (entry) => {
    const role = byId.get(entry.id);
    const payload = {
      id: entry.id,
      provider: entry.provider,
      model: entry.model,
      disabled: entry.disabled,
      reasoningEffort: entry.reasoningEffort
    };
    if (typeof role?.mtimeMs === 'number' && Number.isFinite(role.mtimeMs) && role.mtimeMs >= 0) {
      payload.expectedMtimeMs = role.mtimeMs;
    }
    return postSettings(payload);
  }, { alive: () => mountState.mounted });
  setImporting(false);
  if (!mountState.mounted) return;
  const applied = results.filter((result) => result.ok);
  const rejected = results.filter((result) => !result.ok);
  const message = rejected.length === 0
    ? { kind: 'ok', key: 'profile.applied', params: { applied: String(applied.length), skipped: String(skipped) } }
    : { kind: 'error', key: 'profile.rejected', params: { count: String(rejected.length) } };
  setLastNotice(message);
  if (applied.length > 0) {
    tracker.saves += 1;
    const appliedById = new Map(applied.map((result) => [result.id, result.role]));
    const nextRoles = (rolesCache ?? []).map((entry) => appliedById.get(entry.id) ?? entry);
    rolesCache = nextRoles;
    setRoles(nextRoles);
    setDrafts((current) => {
      const next = { ...current };
      for (const [id, role] of appliedById.entries()) { next[id] = normalizeDraft(role); pruneStoreFor(draftStore, id); sessionChangedIds.add(id); }
      return next;
    });
  }
  setMessages((current) => {
    const next = { ...current };
    for (const result of rejected) {
      next[result.id] = result.status === 409
        ? { kind: 'error', key: 'error.conflict', params: { detail: result.detail } }
        : { kind: 'error', key: 'error.raw', params: { detail: result.detail } };
    }
    return next;
  });
};
```

Frozen: validation runs over EVERY entry BEFORE the first POST (fail-closed,
two-phase); a validation failure writes NOTHING; the refresh happens inside
phase 2 so mtimes are always fresh; 409 = continue-and-report with the
translated conflict on that card; non-409 aborts the loop and reports.

Import UI: a visually hidden `<input type="file" accept="application/json">`
plus a button that clicks it (the VM harness sets `files` + fires onChange).

### 3.4 Audit trail (item 25; C20)

File: `<agentsRootOf()>/agents/.orchestrator-audit.jsonl` (append-only JSONL,
one record per line, never rotated — documented growth). The dotfile is
invisible to GET `.roles` (its filter keeps only `*.md`, index.js:463).

Record schema (frozen; no secrets, relative-only):

```js
{
  at: new Date().toISOString(),
  id: '<role id>',
  previous: { provider: string|null, model: string|null, reasoningEffort: string|null, disabled: boolean },
  next: { provider: string|null, model: string|null, reasoningEffort: string|null, disabled: boolean },
  origin: 'panel'
}
```

- Written INSIDE the existing `withFileLock` critical section, AFTER
  `writeFileAtomic` succeeds and after the read-back, immediately before the
  callback returns `{ status: 200, ... }` (index.js 752-760 region):

```js
try {
  await appendFile(auditFileOf(), `${JSON.stringify({
    at: new Date().toISOString(),
    id,
    previous: summarizeMeta(existingMeta),
    next: { provider: nextCard.provider ?? null, model: nextCard.model ?? null, reasoningEffort: nextCard.reasoningEffort ?? null, disabled: nextCard.disabled === true },
    origin: 'panel'
  })}\n`, 'utf8');
} catch (error) {
  console.warn(redactText(`${name}: appending the audit record for ${id} failed:`), safeErrorText(error));
}
```

  `appendFile` joins the node:fs/promises import (line 1). `auditFileOf()` =
  `path.join(cardsDir(), '.orchestrator-audit.jsonl')`. `summarizeMeta(meta)` is
  a new local helper (typeof checks only, never throws):
  `provider/model/reasoning_effort/reasoningEffort` string-or-null, `disabled === true`.
- Best-effort forever: the try/catch swallows into a redacted log line; the
  card write is NEVER rolled back and the response NEVER fails because of it
  (C20).
- Lock policy inherited: the append happens in the SAME critical section as the
  write, so no second lock; a lock-timeout path (769-777) means no write and
  therefore no audit record.
- `unchanged:true` no-op (703-717) writes NO audit record (nothing changed).

New route `GET /api/dsh-orchestrator-kit.events`:

```js
path: '/api/dsh-orchestrator-kit.events', methods: ['GET'], requestBody: 'buffered',
fetch: async () => {
  const started = performance.now();
  const limit = 50;
  let text = '';
  try {
    text = await readFile(auditFileOf(), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return json({ ok: true, events: [], skipped: 0 }, 200, [['reads', performance.now() - started]]);
    console.warn(redactText(`${name}: the audit log is unreadable:`), safeErrorText(error));
    return json({ ok: false, error: `the audit log is unreadable: ${safeErrorText(error)}` }, 500);
  }
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const events = [];
  let skipped = 0;
  for (const line of lines.slice(-limit)) {
    try {
      const record = JSON.parse(line);
      if (record === null || typeof record !== 'object') { skipped += 1; continue; }
      events.push({
        at: typeof record.at === 'string' ? record.at : null,
        id: typeof record.id === 'string' ? record.id : null,
        previous: record.previous ?? null,
        next: record.next ?? null,
        origin: typeof record.origin === 'string' ? record.origin : null
      });
    } catch { skipped += 1; }
  }
  return json({ ok: true, events, skipped }, 200, [['reads', performance.now() - started]]);
}
```

Bounded read (last 50 lines), malformed lines counted not thrown, ENOENT = empty
list, no cache (C3), redaction on the error path.

### 3.5 Diagnostics (item 44; C21)

New route `GET /api/dsh-orchestrator-kit.diagnostics` — READ-ONLY, computed ON
DEMAND, never in a hot path, never cached:

```js
path: '/api/dsh-orchestrator-kit.diagnostics', methods: ['GET'], requestBody: 'buffered',
fetch: async () => {
  const started = performance.now();
  const report = { missing: [], invalid: [], outsideCatalog: [], drift: [], craftAvailable: false };
  const installed = [];
  try {
    const entries = await readdir(cardsDir(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const id = entry.name.slice(0, -3);
      let text;
      try {
        text = await readFile(path.join(cardsDir(), entry.name), 'utf8');
      } catch (error) {
        report.invalid.push({ id, error: safeErrorText(error) });
        continue;
      }
      try {
        const card = parseRoleCard(text, entry.name);
        installed.push({ id, card, body: bodyOf(text) });
      } catch (error) {
        report.invalid.push({ id, error: safeErrorText(error) });
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(redactText(`${name}: the roles directory is unreadable for diagnostics:`), safeErrorText(error));
      return json({ ok: false, error: `the roles directory is unreadable: ${safeErrorText(error)}` }, 500);
    }
  }
  const craftDir = craftAgentsDirOf();
  if (craftDir !== null) {
    report.craftAvailable = true;
    let craftIds = [];
    try {
      craftIds = (await readdir(craftDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name.slice(0, -3));
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn(redactText(`${name}: craft sources are unreadable:`), safeErrorText(error));
      report.craftAvailable = false;
      craftIds = [];
    }
    if (report.craftAvailable) {
      const installedIds = new Set(installed.map((entry) => entry.id));
      report.missing = craftIds.filter((id) => !installedIds.has(id)).sort();
      for (const entry of installed) {
        if (!craftIds.includes(entry.id)) continue;
        try {
          const source = await readFile(path.join(craftDir, `${entry.id}.md`), 'utf8');
          if (bodyOf(source) !== entry.body) report.drift.push(entry.id);
        } catch (error) {
          if (error?.code !== 'ENOENT') console.warn(redactText(`${name}: craft source ${entry.id} is unreadable:`), safeErrorText(error));
        }
      }
      report.drift.sort();
    }
  }
  const catalog = await modelCatalog(ctx, timeoutMs);
  const catalogIds = new Set();
  for (const group of catalog.groups) {
    for (const model of group.models) catalogIds.add(`${group.provider}/${model.id}`);
  }
  for (const entry of installed) {
    const provider = entry.card.provider;
    const model = entry.card.model;
    if (typeof provider !== 'string' || typeof model !== 'string' || model === 'inherit') continue;
    if (!catalogIds.has(`${provider}/${model}`)) report.outsideCatalog.push(entry.id);
  }
  report.outsideCatalog.sort();
  return json({ ok: true, ...report }, 200, [['catalog', performance.now() - started]]);
}
```

Helpers (module scope, index.js):
- `craftAgentsDirOf()` — resolves craft/ fs-relative to this module:
  `new URL('./craft/agents/', import.meta.url)` → `fileURLToPath`; returns null
  when unreadable. New import `fileURLToPath` from node:url and
  `fileURLToPath`-based resolution (the FIRST craft/ reference in the repo).
- `bodyOf(text)` — strips the frontmatter block via the existing FRONTMATTER
  regex and returns the remainder (body-only drift; frontmatter legitimately
  diverges per the mirror rule).

Degradation: craft/ missing → `craftAvailable:false`, empty missing/drift, NO
500. Catalog degraded/unavailable → `outsideCatalog` computed against
`catalog.groups` (empty when unavailable) and the payload still 200 — the panel
renders the catalog-empty banner separately. NEVER 500 because the catalog is
down.

NO restore-from-craft action (R-14).

### 3.6 Craft install script (item 45; C18)

New file `scripts/install-craft.js` (ESM, plain Node, no deps beyond the
package's own). Usage: `node scripts/install-craft.js [--dry-run]`.

Behavior:
- Root = `agentsRootOf()` imported from `../index.js` (honors
  `DSH_AGENTS_HOME`); `isEntryName`, `cardPathOf` also imported.
- Targets: `<root>/agents/<id>.md` for the 20 `craft/agents/*.md`, and
  `<root>/skills/dev-flow/` mirroring `craft/skills/dev-flow/` (SKILL.md,
  agents/*.md, playbooks/**).
- **Skip-existing ALWAYS** (no overwrite mode at all): an existing target is
  reported `skipped` and never opened for writing. Rationale: overwriting
  user-edited cards without backups is destructive, and backups are banned
  repo-wide; a user who wants a refresh deletes the file. Documented in the
  README.
- Each write runs inside `withFileLock(target, ...)` imported from
  `@deepseek-ai/dsh-atomic-write`, using `writeFileAtomic`. Copy bytes with LF
  preserved; `mkdir({ recursive: true })` for parents.
- Lock failure maps to an actionable message (C5): detect
  `LOCK_TIMEOUT_PREFIX` (`'atomic-write: timed out waiting for the writer lock'`)
  → print the relative lock name plus "retry in a moment; if the owner crashed,
  an operator must remove that lock file manually", exit code 1. Never retries,
  never removes locks.
- Output: one line per file `created|skipped <relative path>` + a final
  summary `created <n>, skipped <m>, failed <k>`; exit 0 only when failed === 0.
- `--dry-run` reports the same lines without writing.
- Path containment: every target is verified to stay under `<root>` via
  `path.relative` check before any write (rejects `..`/absolute), and the craft
  source ids are filtered through `isEntryName`.
- NO backups (`BAK`-shaped filenames never created); no secrets logged; no
  absolute paths printed (relative to root only).

### 3.7 Readonly mode (item 24; C19)

- Server gate at the TOP of the POST `.route` handler, BEFORE any body read or
  disk access (fail-closed, no work):

```js
if (readOnlyMode()) {
  return json({ ok: false, code: 'readonly', error: 'the panel is in read-only mode: saving is disabled by the server configuration' }, 403);
}
```

  `readOnlyMode()` = module-level helper reading `process.env.DSH_ORCHESTRATOR_READONLY`
  (truthy when `'1'` or case-insensitive `'true'`), evaluated per request (env
  can change without a reload; no config plumbing, no bundle-config conflict —
  C19).
- Bootstrap: GET `.roles` envelope gains `readOnly: readOnlyMode()` (499).
- Client: read `rolesOutcome.value.readOnly === true` into state
  `readonlyMode`; when true:
  - banner `readonly.title` + `readonly.notice` (bannerStyle('warning')) right
    after the load banner;
  - EVERY control that mutates is disabled: provider/model/effort selects,
    the disabled checkbox, Save, Undo, batch apply, profile import (export
    stays enabled — it is a read), plus Ctrl+S becomes a no-op (`save` early
    -returns on `readonlyMode`).
  - `save`, `undo`, `runBatch`, `runImport` each early-return when
    `readonlyMode` is true (defense in depth; the server 403 is the gate).
- The panel NEVER claims the write succeeded when the server would 403: the
  client mirrors the same env flag through the bootstrap field only.

### 3.8 Client wiring (events + diagnostics sections)

Both sections live INSIDE the existing legend `details` (1159-1169) as two
nested collapsible blocks, loaded on first expand (on-demand, C21/C3):

- `const [eventsState, setEventsState] = React.useState({ open: false, loading: false, events: [], skipped: 0, error: null });`
- `const [diagnosticsState, setDiagnosticsState] = React.useState({ open: false, loading: false, report: null, error: null });`
- `loadEvents()` / `loadDiagnostics()` fetch the two routes once per expand;
  a re-expand after a successful save re-fetches (events change). No polling,
  no timers.
- Events render (per record): `t('events.entry', { time: record.at ?? '—', id: record.id ?? '—', summary: summaryOf(record) })`
  where `summaryOf` composes DATA strings from provider/model/effort/disabled
  (never translated). Empty → `t('events.empty')`. Error → `t('events.loadError', { error })`.
- Diagnostics render: `t('diagnostics.ok')` when every list is empty; otherwise
  one line per non-empty list with `{ids}` joined by ', '; `craftMissing` line
  when `craftAvailable === false`; error → `t('diagnostics.loadError', { error })`.

### 3.9 Dictionary additions (27 new keys; 95 → 122; FROZEN)

Append EXACTLY these to each JSON `panel` (T2) and mirror verbatim into
`PANEL_DICTS` (T1). `{param}` placeholders use the host regex `/\{(\w+)\}/g`.

locale/en.json additions:
```json
"batch.apply": "Apply to phase",
"batch.applyAria": "Apply the current route to every role in {phase}",
"batch.busy": "Applying…",
"batch.cancel": "Cancel",
"batch.summary": "Batch finished: {applied} applied · {conflicted} conflicts · {failed} failed",
"batch.cancelled": "Batch cancelled — {applied} roles were already updated.",
"batch.empty": "Nothing to apply: no role in this phase has a draft route.",
"profile.summary": "Routing profiles",
"profile.export": "Export profile",
"profile.import": "Import profile",
"profile.invalid": "Invalid profile: {detail}",
"profile.rejected": "Nothing was written: {count} entries failed.",
"profile.applied": "Profile applied: {applied} roles updated, {skipped} skipped.",
"events.summary": "Recent changes",
"events.empty": "No changes recorded yet.",
"events.loadError": "Failed to load the change log: {error}",
"events.entry": "{time} · {id} · {summary}",
"diagnostics.summary": "Installed-card diagnostics",
"diagnostics.ok": "No problems found.",
"diagnostics.missing": "Missing roles: {ids}",
"diagnostics.invalid": "Cards with invalid frontmatter: {ids}",
"diagnostics.outsideCatalog": "Routes outside the live catalog: {ids}",
"diagnostics.drift": "Body differs from the craft source: {ids}",
"diagnostics.craftMissing": "craft/ sources are unavailable; drift checking was skipped.",
"diagnostics.loadError": "Failed to load diagnostics: {error}",
"readonly.title": "Read-only mode",
"readonly.notice": "Saving is disabled by the server configuration (read-only mode). Controls are shown for reference."
```

locale/pt-BR.json additions:
```json
"batch.apply": "Aplicar à fase",
"batch.applyAria": "Aplicar a rota atual a todos os papéis de {phase}",
"batch.busy": "Aplicando…",
"batch.cancel": "Cancelar",
"batch.summary": "Lote concluído: {applied} aplicados · {conflicted} conflitos · {failed} falhas",
"batch.cancelled": "Lote cancelado — {applied} papéis já foram atualizados.",
"batch.empty": "Nada para aplicar: nenhum papel desta fase tem uma rota em rascunho.",
"profile.summary": "Perfis de roteamento",
"profile.export": "Exportar perfil",
"profile.import": "Importar perfil",
"profile.invalid": "Perfil inválido: {detail}",
"profile.rejected": "Nada foi gravado: {count} entradas falharam.",
"profile.applied": "Perfil aplicado: {applied} papéis atualizados, {skipped} ignorados.",
"events.summary": "Alterações recentes",
"events.empty": "Nenhuma alteração registrada ainda.",
"events.loadError": "Falha ao carregar o histórico: {error}",
"events.entry": "{time} · {id} · {summary}",
"diagnostics.summary": "Diagnóstico dos cartões instalados",
"diagnostics.ok": "Nenhum problema encontrado.",
"diagnostics.missing": "Papéis ausentes: {ids}",
"diagnostics.invalid": "Cartões com frontmatter inválido: {ids}",
"diagnostics.outsideCatalog": "Rotas fora do catálogo ao vivo: {ids}",
"diagnostics.drift": "Corpo difere da origem em craft/: {ids}",
"diagnostics.craftMissing": "As origens em craft/ estão indisponíveis; a checagem de divergência foi ignorada.",
"diagnostics.loadError": "Falha ao carregar o diagnóstico: {error}",
"readonly.title": "Modo somente leitura",
"readonly.notice": "O salvamento está desativado pela configuração do servidor (modo somente leitura). Os controles aparecem apenas como referência."
```

locale/zh.json additions:
```json
"batch.apply": "应用到阶段",
"batch.applyAria": "将当前路由应用到 {phase} 的所有角色",
"batch.busy": "正在应用…",
"batch.cancel": "取消",
"batch.summary": "批处理完成：已应用 {applied} · 冲突 {conflicted} · 失败 {failed}",
"batch.cancelled": "批处理已取消 — 已有 {applied} 个角色被更新。",
"batch.empty": "无可应用内容：此阶段没有任何角色存在草稿路由。",
"profile.summary": "路由配置集",
"profile.export": "导出配置集",
"profile.import": "导入配置集",
"profile.invalid": "配置集无效：{detail}",
"profile.rejected": "未写入任何内容：{count} 条失败。",
"profile.applied": "配置集已应用：更新 {applied} 个角色，跳过 {skipped} 个。",
"events.summary": "最近更改",
"events.empty": "尚无更改记录。",
"events.loadError": "加载更改日志失败：{error}",
"events.entry": "{time} · {id} · {summary}",
"diagnostics.summary": "已安装卡片诊断",
"diagnostics.ok": "未发现问题。",
"diagnostics.missing": "缺失角色：{ids}",
"diagnostics.invalid": "frontmatter 无效的卡片：{ids}",
"diagnostics.outsideCatalog": "不在实时目录中的路由：{ids}",
"diagnostics.drift": "正文与 craft/ 源不一致：{ids}",
"diagnostics.craftMissing": "craft/ 源不可用；已跳过偏差检查。",
"diagnostics.loadError": "加载诊断失败：{error}",
"readonly.title": "只读模式",
"readonly.notice": "保存已被服务器配置禁用（只读模式）。控件仅作参考。"
```

NOT translated (structural): route paths, profile version literal, event origin
value 'panel', status/sort/density ids, `dsh-orchestrator-kit` generator string,
role/provider/model/effort names and ids, timestamps, counts.

### 3.10 Item 60 — chunking decision (frozen; recorded either way)

Master C17 trigger: the size tripwire proposed for a surviving new surface. The
tripwire itself lands in Pass 5 (C14: "client.js byte-size assert … set AFTER
UX surfaces land"). Pass 4 therefore freezes a MECHANICAL decision rule and
records the outcome in the evidence:

- **Decision: NO CHUNK SHIPS in Pass 4.** Rationale (recorded): the panel stays
  a single `client.js`; splitting adds a self-registering chunk protocol, forces
  every client.js-only scanner to grow sibling file-sets in the same slice, and
  requires a missing-chunk fallback — all of which Pass 5's measured budget may
  obsolete. C17 explicitly allows "or the chunk does not ship".
- **Escalation tripwire (frozen):** if measured `client.js` exceeds **98,304
  bytes (96 KiB)** at I1 time, the executor STOPS and escalates to the lead
  instead of shipping a larger single file. This is an escalation gate, not a
  chunk trigger; a fired gate returns to planning (C17 full weight applies).
- Evidence records: date, measured bytes, line count, and the decision line
  "item 60: no chunk shipped — measured N bytes (ceiling 98,304)". Pass 5 sets
  the byte assert against that measured shape.

### 3.11 Harness + numeric reworks (scripts/test.mjs — additive only)

Harness (mountVmClient, backward compatible):
- sandbox gains `Blob` and a minimal `URL` shim **only when the client feature
  -detects**: `typeof URL?.createObjectURL === 'function'`. The VM simply does
  not provide `URL` (matching a browser-less harness), so the export path
  exercises the deterministic textarea fallback; the browser path is covered by
  the same code behind the `typeof` guard, asserted by P4-N2's fallback drive.
  NO new sandbox global is added.
- `window.addEventListener` recording already exists (Pass 3); unchanged.

RW-P4 reworks (the ONLY existing-test edits; each additive, never weakening):
1. **RW-P4-1 route surface (1896-1902):** regex becomes
   `/\/api\/dsh-orchestrator-kit\.(roles|catalog|efforts|route|events|diagnostics)/g`;
   the count assert becomes **6**; the deepEqual server===client stays. Message
   text updates to "exactly the 6 namespaced routes".
2. **RW-P4-2 pack contract (2748-2816 + 4038-4044):** `FROZEN_PACK_FILES` gains
   `'scripts/install-craft.js'` (**70** entries, sorted insert after
   `scripts/test.mjs`); `entryCount` 69 → **70**; the test label becomes
   `npm pack: dry-run file list matches the frozen 70-entry contract and packed
   content passes the forbidden-token scan`.
3. **RW-P4-3 dictionary surface:**
   - `PANEL_KEYS` (2650-2746) gains the 27 keys from 3.9 → **122** entries.
   - `PANEL_RENDERABLE_KEYS` (3210-3221) gains the **4** non-interpolated
     default-state keys (`profile.summary`, `profile.export`,
     `profile.import`, `events.summary`) → **58** entries, zero phantoms.
     (4 counted mechanically: the three profile labels plus `events.summary`
     render inside the always-open legend details — client.js 1159-1169 — in
     the DEFAULT mounted state. `batch.apply` is EXCLUDED: per §3.2 the batch
     button renders ONLY when the active tab is not 'all', so it can never
     appear in P2-N4's default mounted state; it is pinned by the P2-N3
     phase-tab batch drive instead. The remaining `diagnostics.*`/`events.*`
     values render only in driven states and stay pinned by the P2-N3
     coverage backstop, mirroring the Pass-3 delta-4 discipline.)
   - Two labels become count-free so they can never go stale (label text only;
     assertion semantics unchanged): P2-N1 →
     `locale parity: en/pt-BR/zh panel key sets identical, values non-empty, frozen dictionary schema, meta preserved`;
     P2-N3 → `i18n structural gate: every panel string renders through t (sentinel bind) and every frozen dictionary key is covered across driven states`.
   - **P2-N3 driven-state additions** (so all 122 keys are observed): batch
     (phase-tab drive: apply → busy → summary; cancel path → cancelled; empty
     path → batch.empty — these states also pin batch.apply's rendered value),
     import (file input with a bad version → profile.invalid; an unknown-only
     profile → profile.rejected; a valid one → profile.applied), events expand
     (summary/empty/entry + loadError case), diagnostics expand
     (summary/ok/missing/invalid/outsideCatalog/drift/craftMissing + loadError
     case), readonly drive (server bootstrap readOnly:true → title/notice,
     controls disabled).
   - **P2-N4 pin-loop:** unchanged mechanics (iterates the allowlist itself);
     the 4 new entries are `undefined` at HEAD → red as designed; green after
     T2.
4. **RW-P4-4 shipped-file arrays:**
   - `node --check` array (1962) gains `'scripts/install-craft.js'` → 4 entries.
   - LF/BOM array (1969) gains `'scripts/install-craft.js'` → 9 entries
     (HEAD carries 8: package.json, cordis.patch.yml, index.js, client.js,
     scripts/test.mjs, locale ×3).
5. **RW-P4-5 static contract (1943-1959):** add
   `assert.ok(clientText.includes('shouldCancel'))` and
   `assert.ok(readFileSync(index.js).includes('DSH_ORCHESTRATOR_READONLY'))` —
   structural markers for the two new mechanisms (green only after T1/T3).

### 3.12 Test labels + minimum assertions (P4-N1…N7)

Frozen labels (exact strings; §8 arithmetic keys on them):

1. `batch apply: per-phase loop reuses runCardLoop with the cancel hook, per-card results, 409 continue-and-report and abort on first 503`
2. `routing profiles: export carries version and no mtimes; import validates every entry before the first write, then refresh-then-applies`
3. `audit trail: append inside the write lock, relative-only records with no secrets, best-effort failure, and the bounded events route`
4. `diagnostics: missing, invalid, outside-catalog and body-drift detection degrade gracefully when craft/ is unavailable`
5. `readonly mode: the env flag returns 403 before any disk read, the roles envelope carries readOnly and the panel disables every mutating control`
6. `craft installer: tmp-home copy, skip-existing always, lock-timeout guidance, and path containment`
7. `new surfaces render untrusted markup as text: batch summary, event entries and diagnostics lists`

Minimum assertions:
- **P4-N1:** active tab = planning with 2 cards dirty toward the SAME route →
  batch button enabled with `batch.applyAria` naming the phase; click →
  exactly 2 route POSTs, each with its own `expectedMtimeMs` and the shared
  route/effort payload; summary renders `2 applied · 0 conflicts · 0 failed`;
  drafts cleaned (no dirty suffix); a 409 case → the conflicted card keeps its
  draft and gets the conflict message while the loop continues; a 503 case →
  loop aborts, remaining card untouched, summary reports the failure; cancel
  drive: hold the first response, set the cancel button visible (busy state),
  click it, resolve → `batch.cancelled` with the applied count and NO further
  POSTs; empty path → `batch.empty` and zero POSTs.
- **P4-N2:** export builds `{version:1, generator, roles}` with provider/model
  null for inherit cards and NO `mtimeMs` anywhere (deep JSON scan);
  validation: version 2 → `profile.invalid`; half-written entry → invalid;
  unknown ids only → `profile.rejected`; a valid profile triggers ONE roles
  re-GET **before** the first POST (fetch order asserted), then one POST per
  known entry with the FRESH mtime, full route+effort+disabled set; per-card
  409 reported without aborting; applied cards updated and drafts cleaned.
- **P4-N3:** a save appends exactly ONE JSONL line with `at`/`id`/`previous`/
  `next`/`origin:'panel'`; the file path is relative-only in logs; a forced
  append failure (tmp dir made read-only or an injected throwing fs stub) still
  returns 200 for the save and the card is written; a secret-shaped value never
  appears in the record; the events route returns the last N in order, counts
  malformed lines in `skipped`, answers `[]` for ENOENT, and 500s (redacted)
  only for a real read failure; `unchanged:true` writes NO record.
- **P4-N4:** with craft sources copied beside a tmp home: one card deleted →
  `missing`; one card with broken YAML → `invalid`; one route set to a model
  absent from the stub catalog → `outsideCatalog`; one card whose body differs
  → `drift`; with craft/ resolution forced unavailable → `craftAvailable:false`
  and empty lists, still 200 (never 500); catalog down → still 200.
- **P4-N5:** `DSH_ORCHESTRATOR_READONLY=1` (set/restored around the apply) →
  POST `.route` 403 `code:'readonly'` with a valid payload AND with a body that
  would otherwise 400 (proving the gate runs before validation/disk); GET
  `.roles` carries `readOnly:true`; the VM panel mounted with that envelope
  disables provider/model/effort selects, the disabled checkbox, Save, Undo and
  batch, renders `readonly.title`/`readonly.notice`, and a Ctrl+S is a no-op
  (zero POSTs); export stays enabled. Flag off → everything behaves exactly as
  Pass 3 (guard).
- **P4-N6:** spawnSync the installer with `DSH_AGENTS_HOME` = tmp home → exit 0,
  20 agent cards + skill tree created, summary line counts; second run → all
  `skipped`, byte-identical files; a pre-held lock on one target (create the
  `.lock` file) → exit 1 with the retry/operator guidance, other files still
  created, no backups (no BAK-shaped file in the tree), and no absolute path in
  stdout; `--dry-run` writes nothing; a target path escape attempt is refused.
- **P4-N7:** markup fixtures (`<img src=x onerror=alert(1)>"'&`) flow through a
  batch summary, an event entry and every diagnostics list → rendered as text
  children; zero nodes carry `dangerouslySetInnerHTML`/`innerHTML`.

## 4. Per-task contracts

Wave layout (shared checkout, no locks; suite runs ONLY at wave boundaries;
the pass is ATOMIC — all tasks ride ONE commit):

```
Step 0 (solo):  T3 tests+harness+reworks ── red evidence (15 FAIL / 63 ok, 78 total)
Wave 1 (∥):     T1 server (index.js)  |  T2 client.js  |  T3b locale+installer  |  T4 docs
Wave 2 (solo):  I1 integration green (78 ok) → I2 anti-flake 5x + evidence
Wave 3 (lead):  security gate + adversarial workflow + review loop + live smoke + git-commit
```

Write scopes 100% disjoint: **T3-test={scripts/test.mjs}**,
**T1-server={index.js}**, **T2-client={client.js}**,
**T3b={locale/en.json, locale/pt-BR.json, locale/zh.json,
scripts/install-craft.js}**, **T4={README.md, README.pt-BR.md, README.zh-CN.md,
CHANGELOG.md}**, **I2={.devflow/evidence/backlog-60-pass4/}**.

---

### T3-test — Tests + harness + reworks (test-writer; Step 0, solo)

**Parallelizable:** no — runs alone BEFORE Wave 1 so the red run sees HEAD
sources.
**Write scope:** `scripts/test.mjs` ONLY.
**References:** 3.11 reworks, 3.12 labels/assertions, 1.1 anchors, §8.

**What to do:**
1. Apply RW-P4-1…RW-P4-5 EXACTLY (3.11): route regex+count 6; pack 70 with the
   frozen list gaining `scripts/install-craft.js`; PANEL_KEYS 122;
   PANEL_RENDERABLE_KEYS 58; the two count-free labels; the P2-N3 driven-state
   additions; node --check array 4 entries; LF/BOM array 9 entries; the two
   static markers.
2. Append P4-N1…P4-N7 (exact labels 3.12) after P3-N10 (4030), before the pack
   test (4038). Use the existing helpers (cardOf/checkboxOfId/saveOfCard/
   undoButtonsOf/routePostsOf 2194-2206) and `withMockHost` for the index.js
   drives; use `mkdtempSync` tmp homes for P4-N4/N6 (the hygiene test scans
   REPO files only, so tmp dirs are safe; never write a tmp path into a repo
   file).
3. No timing assertions; fixtures token-clean (split-literal joins for any
   secret-shaped fixture); pure LF/no BOM; realm-safe deepEqual.

**Must NOT do:** touch index.js/client.js/locale/docs/installer; weaken any
existing assertion beyond the five documented RW-P4 reworks (all additive);
change the require assert; add sandbox globals; write tmp paths into fixtures.

**Verify (observable):**
```
node --check scripts/test.mjs
```
→ exit 0. Then:
```
node scripts/test.mjs
```
→ exit 1; final line `15 TEST(S) FAILED`; exactly the 15 FAIL labels of §8;
63 ok lines. Cross-check:
```
node scripts/test.mjs 2>&1 | Select-String -Pattern '^FAIL ' -CaseSensitive
```
→ exactly 15 lines matching §8's list. Never save raw failure output (absolute
tmp paths). Count differs → STOP + escalate before Wave 1.

---

### T1-server — index.js: events route, diagnostics route, readonly gate, audit append (implementer; Wave 1, parallel)

**Parallelizable:** yes (disjoint from T2/T3b/T4). **Write scope:** `index.js` ONLY.
**References:** 3.4 (audit + events route), 3.5 (diagnostics), 3.7 (readonly
gate), 1.1 index.js anchors.

**What to do:** implement 3.7's gate at the top of the POST handler; the GET
`.roles` envelope `readOnly` field; 3.4's `auditFileOf`/`summarizeMeta` helpers,
the in-lock `appendFile` call (import `appendFile` from node:fs/promises) and
the `GET .events` route; 3.5's `craftAgentsDirOf` (node:url `fileURLToPath`),
`bodyOf`, and the `GET .diagnostics` route. Keep the export line's existing
names and add nothing to it unless a test needs it (the installer imports
`agentsRootOf`, `isEntryName`, `cardPathOf` — already exported). No comments.

**Must NOT do:** new POST routes; server caches; changing existing status codes
or payload shapes (only ADD `readOnly` to the roles envelope); touching the
lock-timeout block semantics; writing audit outside the lock; absolute paths in
records; `failsafe` schema; any client/locale/test/doc edit.

**Verify (observable):**
```
node --check index.js
```
→ exit 0. Route literals = 6:
```
(Select-String -Path index.js -Pattern '/api/dsh-orchestrator-kit\.(roles|catalog|efforts|route|events|diagnostics)' -AllMatches | ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum
```
→ `6`. Structural markers:
```
Select-String -Path index.js -Pattern 'DSH_ORCHESTRATOR_READONLY','.orchestrator-audit.jsonl','appendFile','craft/agents/' -CaseSensitive
```
→ 4 matching lines. Report completion + outputs.

---

### T2-client — client.js: batch, profiles, events, diagnostics, readonly UI (implementer; Wave 1, parallel)

**Parallelizable:** yes. **Write scope:** `client.js` ONLY.
**References:** 3.1 (loop hook — replace 467-488 EXACTLY), 3.2 (batch), 3.3
(profiles), 3.8 (events/diagnostics rendering), 3.7's client half (readonly),
3.9's en block mirrored into PANEL_DICTS ×3, 1.1 client.js anchors.

**What to do:** implement 3.1 + 3.2 + 3.3 + 3.8 + the readonly mirror;
add the two route constants; mirror the 27 dictionary keys into all three
PANEL_DICTS faces (pt alias follows automatically). No comments.

**Must NOT do:** index.js/locale/docs/test edits; new POST routes (client route
literals become 6 — the same 6 the server registers); new hooks beyond
useState/useEffect; new sandbox assumptions beyond typeof guards; innerHTML/
eval; timers; translating data; changing any en value byte.

**Verify (observable):**
```
node --check client.js
```
→ exit 0. Client route literals = 6:
```
(Select-String -Path client.js -Pattern '/api/dsh-orchestrator-kit\.(roles|catalog|efforts|route|events|diagnostics)' -AllMatches | ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum
```
→ `6`. Markers:
```
Select-String -Path client.js -Pattern 'shouldCancel','batch.applyAria','profile.summary','diagnostics.summary','readonly.title' -CaseSensitive
```
→ 5 matching lines. Report completion + outputs.

---

### T3b — Locale ×3 + installer (implementer; Wave 1, parallel)

**Parallelizable:** yes. **Write scope:** `locale/en.json`, `locale/pt-BR.json`,
`locale/zh.json`, `scripts/install-craft.js` ONLY.
**References:** 3.9 (append EXACTLY those 27 keys per language), 3.6 (installer
contract), package.json `files` (scripts/ already whitelisted — NO package.json
edit).

**What to do:** append the 27 frozen keys (122 panel keys each; meta
untouched); write the installer per 3.6 (ESM, imports `agentsRootOf`,
`isEntryName`, `cardPathOf` from `../index.js` and `withFileLock`,
`writeFileAtomic` from `@deepseek-ai/dsh-atomic-write`; skip-existing always;
actionable lock guidance; relative output paths; `--dry-run`). No comments.

**Must NOT do:** change meta or existing keys; add keys beyond the 27; touch
package.json/index.js/client.js/tests/docs; create backups; add dependencies;
print absolute paths.

**Verify (observable):**
```
node -e "const fs=require('fs');const files=['locale/en.json','locale/pt-BR.json','locale/zh.json'];const sets=files.map(f=>{const j=JSON.parse(fs.readFileSync(f,'utf8'));const keys=Object.keys(j.panel).sort();if(keys.length!==122)throw new Error(f+' key count '+keys.length);for(const k of keys){if(typeof j.panel[k]!=='string'||j.panel[k].trim()==='')throw new Error(f+' empty value '+k);}return JSON.stringify(keys);});if(sets[0]!==sets[1]||sets[0]!==sets[2])throw new Error('key sets diverge');console.log('locale parity OK: 122 keys x 3');"
```
→ `locale parity OK: 122 keys x 3`, exit 0. Installer:
```
node --check scripts/install-craft.js
```
→ exit 0, and
```
node scripts/install-craft.js --dry-run
```
→ exit 0, dry-run lines only, zero writes (assert with `git status --porcelain`
unchanged for the agents tree when `DSH_AGENTS_HOME` points at a tmp dir).

---

### T4 — Docs (tech-writer or docs-sync; Wave 1, parallel)

**Parallelizable:** yes. **Write scope:** `README.md`, `README.pt-BR.md`,
`README.zh-CN.md`, `CHANGELOG.md` ONLY.
**References:** README Configure 54-81 + FAQ 120-148; CHANGELOG [Unreleased];
Pass-2 I-2 lesson (escape-proof fence regex under pwsh).

**What to do (three READMEs structurally identical; translate prose, keep
identifiers verbatim):**
1. Configure area: batch apply (per phase, copies the source card's draft route,
   per-card results, 409 continues, 503 aborts, cancel button); routing
   profiles (export creates `{version:1,…}` with no mtimes; import validates
   every entry before writing anything, then refreshes mtimes and applies;
   unknown ids are skipped); the change log section (append-only file beside
   the cards, best-effort, recent 50 in the panel); diagnostics (missing,
   invalid, outside-catalog, body drift; read-only; degrades when craft/ is
   absent); readonly mode (`DSH_ORCHESTRATOR_READONLY=1` → server 403 + panel
   read-only); installer (`node scripts/install-craft.js [--dry-run]`,
   skip-existing always, no backups, remove a file to reinstall it).
2. FAQ: add "How do I apply a route to a whole phase?", "How do I move my
   routing to another machine?", "Where is the change log stored?" (keep FAQ
   entry counts aligned across the three READMEs).
3. CHANGELOG [Unreleased] — Added: per-phase batch apply, routing profile
   export/import, append-only change log + panel section, installed-card
   diagnostics, craft install script, read-only mode; Changed: the panel now
   disables controls when the server is read-only. Do not touch released
   sections.

**Must NOT do:** machine tokens; backup-suffix literal; invented credentials or
models; structural divergence between READMEs; source/test edits; docs/ or
CONTRIBUTING edits (Pass 5).

**Verify (observable):** README structural parity (Pass 2 T4 snippet, both
fence forms) → exit 0; token self-scan on the four docs → exit 0.

---

### I1 — Integration green (run-conductor or one implementer; Wave 2, solo)

**Write scope:** any of {index.js, client.js, locale ×3, scripts/install-craft.js,
scripts/test.mjs, READMEs, CHANGELOG} for FIXES only.
**What to do:** run the suite; expected 78 ok. Failures → reconcile against the
frozen contracts (contract wins; fix the deviating side; never weaken). Typical
risks: the 27-key mirror drifting between JSON and PANEL_DICTS (P2-N1/N2);
P2-N3 missing a driven state for a new key; the installer not matching the
P4-N6 contract; route literal count mismatch (6/6). Also MEASURE client.js
bytes and record the item-60 decision line (3.10); if bytes > 98,304 → STOP +
escalate.

**Verify (observable):**
```
node scripts/test.mjs
```
→ exit 0, `ALL TESTS PASSED`, 78 ok, zero FAIL.
```
node --check index.js; node --check client.js; node --check scripts/test.mjs; node --check scripts/install-craft.js
```
→ four exit 0. Record client.js bytes.

---

### I2 — Anti-flake + evidence (same owner; Wave 2, after I1)

**Write scope:** `.devflow/evidence/backlog-60-pass4/` ONLY.
**What to do:** 5 consecutive green full-suite runs; any failure → I1, delete
the failed log, restart. Write verification.md (token-clean): date, commands,
red→green trail (15 FAIL labels → 78 ok), 5/5, new-test list, RW-P4
before/after, the item-60 decision line with measured bytes, the security-gate
record placeholder, and the live-smoke record.

**Verify (observable):**
```
New-Item -ItemType Directory -Force -Path .devflow/evidence/backlog-60-pass4 | Out-Null
$ok = 0
for ($i = 1; $i -le 5; $i++) {
  node scripts/test.mjs *> ".devflow/evidence/backlog-60-pass4/test-run-$i.log"
  if ($LASTEXITCODE -eq 0) { $ok++ } else { break }
}
"green runs: $ok/5"
```
→ `green runs: 5/5`; each log ends `ALL TESTS PASSED` with exactly 78 ok lines.
node-check log → four `exit 0`. Token-scan every evidence file.

## 5. Verification strategy (summary)

- Canonical: `node scripts/test.mjs` → exit 0 + `ALL TESTS PASSED`, fresh output
  read in-turn at every gate. Red gate: **15 FAIL / 63 ok (78 total)**. Green:
  **78 ok**.
- Anti-flake: 5 consecutive green runs under
  `.devflow/evidence/backlog-60-pass4/test-run-<i>.log` (green only).
- Syntax: node --check ×4 (also in-suite: the array grows to 4 entries).
- Static invariants re-checked: route surface **6/6** deepEqual, package contract
  untouched except nothing (files whitelist unchanged), mount marker, old
  -identity/failsafe bans, hygiene tokens, RW-P4-5 structural markers.
- New coverage: batch (N1), profiles (N2), audit+events (N3), diagnostics (N4),
  readonly (N5), installer (N6), XSS re-run (N7). C15: N17 green every run; the
  N3 sentinel gate covers all **122** keys in real driven states.
- No timing assertions anywhere.

## 6. Post-parallel & final gates (lead-owned, in order)

1. **SECURITY GATE (mandatory this pass — new write surfaces):**
   security-auditor focused diff review of: the readonly gate ordering
   (403 before body read/disk), the audit append (no secrets, relative paths,
   best-effort, in-lock only), diagnostics (read-only, no path leakage, no 500
   on degradation, craft/ resolution confinement), the installer (path
   containment, skip-existing, lock guidance, no backups), profile import
   (fail-closed validation before any write, no mtime trust), and redaction
   coverage on both new routes' error paths. Findings → fix list → re-run I1/I2.
2. Adversarial verification workflow with the feature lens set + a security
   lens (new trust boundary: two new GET routes and one new write path).
   Confirmed findings → fix list.
3. Review loop: diff-reviewer 1-10, fix Critical/Important, min 2 loops max 4,
   gate >= 8/10 (dev-flow clean-exit breaker). Re-verify after fixes.
4. **Live-host smoke** (C8, one documented check): browser-qa against the real
   panel at the CURRENT DSH Web GUI URL from the runtime context (never hardcode
   a port in a repo file). Steps: open Settings → Orchestrator; dirty one card
   in a phase and click the batch apply (verify per-card results + the summary);
   export a profile; re-import it (verify refresh-then-apply and the counts);
   expand Recent changes (verify the new record); expand diagnostics (verify the
   four lists); set `DSH_ORCHESTRATOR_READONLY=1` for one run and confirm the
   403 + the read-only banner. Evidence: screenshot(s) + notes under
   `.devflow/evidence/backlog-60-pass4/` (token-clean). If the GUI is
   unreachable, record the consolidated-blocked note with the exact manual steps
   (Pass 2/3 precedent — never fake the smoke).
5. Docs reconciliation: README trilingual structural parity, CHANGELOG vs diff,
   readonly/batch/import/audit/diagnostics/installer semantics stated exactly as
   §3.
6. TEST VERIFICATION GATE audit: every new behavior has a failing-mode test (red
   proofs captured); evidence complete + token-clean; tests + logs in the commit.
7. Delivery: ONE atomic commit via the `git-commit` skill (owns diff analysis,
   zero-narrative comment sweep, whitespace, checks, staging, Conventional
   Commits). Suggested shape: `feat: add batch routing, profiles, audit log and
   diagnostics (backlog-60 pass 4)` — the skill owns final wording. NO push.
8. Update `.devflow/runs/backlog-60/progress.md` (token-clean) + consolidated
   report: what shipped, commands + results, security/review scores, the
   item-60 decision with measured bytes, remaining risks (audit growth is
   append-only and unbounded by design; the batch loop is sequential by design;
   skip-existing installs require manual file removal to refresh), next-pass
   readiness (Pass 5 owns coverage thresholds, the size budget set against the
   measured client.js, docs-parity.mjs, link check, and the docs suite).

## 7. Known behavior changes (for docs accuracy & review)

1. Batch apply per phase: copies the source card's draft route/effort to every
   other card in the visible phase, with per-card results; 409 keeps going and
   reports, a non-409 (busy lock) stops the run; a Cancel button stops after the
   in-flight card. Never described as atomic.
2. Profiles: export produces a versioned JSON with no mtimes; import validates
   every entry first (nothing is written on any validation failure), then
   refreshes the card list and applies each entry with a fresh expected mtime;
   ids absent locally are skipped.
3. The panel gains a Recent changes section backed by an append-only JSONL file
   beside the cards (last 50 records, best-effort: an audit write failure never
   fails or rolls back a save).
4. The panel gains read-only diagnostics: missing cards vs craft/, invalid
   frontmatter, routes outside the live catalog, and body-only drift from the
   craft sources; it degrades gracefully when craft/ is not installed.
5. `DSH_ORCHESTRATOR_READONLY=1` disables saving: the server answers 403 before
   validation and the panel mirrors the flag by disabling every mutating
   control and showing a read-only notice.
6. `node scripts/install-craft.js [--dry-run]` installs the 20 role cards and
   the dev-flow skill tree into the agents root, skipping anything that already
   exists (no backups, no overwrite); a held lock produces the documented
   retry/operator guidance.
7. Item 60: no chunk ships in this pass; the measured client.js size is
   recorded and Pass 5 sets the byte budget against it.

## 8. Frozen test names + red/green arithmetic (against the 71-test baseline)

New tests (7): the exact labels of 3.12 (P4-N1…P4-N7). All 7 are RED at HEAD
(no batch, no profiles, no audit/events route, no diagnostics route, no
readonly, no installer, no new-surface XSS drive).

Reworks (RW-P4, 3.11 — additive only), each RED at HEAD for a documented reason:

| Rework | Test label affected | Why RED at HEAD |
| --- | --- | --- |
| RW-P4-1 | `server and client agree on the /api/<name>.* route surface` | new regex finds 4+4, count assert demands 6 |
| RW-P4-2 | `npm pack: dry-run file list matches the frozen 70-entry contract and packed content passes the forbidden-token scan` | live pack is 69; frozen list has 70 |
| RW-P4-3a | `locale parity: en/pt-BR/zh panel key sets identical, values non-empty, frozen dictionary schema, meta preserved` | PANEL_KEYS 122 vs JSON 95 |
| RW-P4-3b | `i18n structural gate: every panel string renders through t (sentinel bind) and every frozen dictionary key is covered across driven states` | new driven states assert keys absent at HEAD |
| RW-P4-3c | `panel language switch: override renders pt-BR/zh from dictionaries, Auto follows host, best-effort localStorage persists and restores, storage failure degrades to host language` | the 4 new allowlist keys are `undefined` in en.json at HEAD |
| RW-P4-4a | `node --check passes on the shipped files` | `scripts/install-craft.js` missing → non-zero |
| RW-P4-4b | `all shipped files exist with UTF-8 no BOM and pure LF` | readFileSync on the missing installer throws |
| RW-P4-5 | `client.js static contract: phase grouping, save flow markers, and no old-name leftovers` | `shouldCancel` / `DSH_ORCHESTRATOR_READONLY` absent |

Note: P2-N2 (`locale registration`, 4 locale FACES) is UNAFFECTED by the new
routes and stays green throughout (its `4` counts dictionary faces, not routes).

**Red gate (T3-test solo, HEAD sources + new tests/harness/reworks): 78 total,
15 FAIL / 63 ok**, final line `15 TEST(S) FAILED`, exit 1. FAIL set (15,
mechanically counted: 7 new + 8 reworked labels):
- New: P4-N1, P4-N2, P4-N3, P4-N4, P4-N5, P4-N6, P4-N7.
- Reworked: `server and client agree on the /api/<name>.* route surface`
  (RW-P4-1), `npm pack: dry-run file list matches the frozen 70-entry contract
  and packed content passes the forbidden-token scan` (RW-P4-2), `locale
  parity: …` (RW-P4-3a), `i18n structural gate: …` (RW-P4-3b), `panel language
  switch: …` (RW-P4-3c), `node --check passes on the shipped files`
  (RW-P4-4a), `all shipped files exist with UTF-8 no BOM and pure LF`
  (RW-P4-4b), `client.js static contract: …` (RW-P4-5).
15 + 63 = 78 ✓. The other 63 existing tests stay green (78 total − 15 FAIL =
63; harness backward compatible; the five RW-P4 rework families are the only
existing-test touch). Green gate (after implementation): **78 ok**, `ALL TESTS
PASSED`, exit 0.

---

## 9. Self-review (planner, this turn — mechanically verified)

- **Counts first (script-verified against HEAD ae8c32a before writing):** 71
  test labels; 95 panel keys ×3; PANEL_KEYS 95; PANEL_RENDERABLE_KEYS 54
  unique/zero dups; FROZEN_PACK_FILES 69; route literals 4+4; pack live probe
  69 entries with `scripts/` holding only test.mjs; craft/agents 20 files;
  no `shouldCancel`/audit/readonly/installer at HEAD. The Pass-4 arithmetic
  derives from these measured bases: 95+27=122 keys ×3 (the 27-key blocks in
  3.9 count 27 keys each — the en/pt-BR/zh blocks are key-identical by
  construction); allowlist 54+4=58 (the 4 default-state keys are named and
  justified in RW-P4-3 — batch.apply is EXCLUDED because §3.2 renders the
  batch button only outside the 'all' tab, and it is pinned by the P2-N3
  phase-tab drive instead); route 4→6 (2 new GET routes); pack 69→70 (one new
  whitelisted file); tests 71+7=78; red FAIL set 7 new + 8 reworked = **15**;
  15+63=78 ✓; green 78 ✓.
- **Self-caught and fixed during composition:** the red-gate count was first
  drafted as 14 (7+8 was miscounted) — corrected to 15 everywhere
  (§2-arithmetic header, wave layout, T3 Verify, I2, §5, §8 with the full
  enumerated FAIL set); the allowlist delta was first drafted as +4, then
  mis-flipped to +5 with a wrong render-location justification — the auditor
  rejected it (§3.2 renders the batch button ONLY outside the 'all' tab, so
  batch.apply can never appear in P2-N4's default mounted state) — restored
  to **+4 / 58** with batch.apply pinned by the P2-N3 phase-tab drive instead;
  a stale `batchState` shape was replaced by the single-state `batchPhase`
  lock; stale section refs (3.12 → 3.11) were normalized; drafting artifacts
  were removed.
- **Revision-2 auditor fixes (this turn):** (1) allowlist kept at +4/58 with
  §3.2 untouched — the single consistent choice; (2) the T3 Verify literal
  corrected to 58; (3) "the other 56 existing tests" corrected to **63**
  (78 − 15); (4) LF/BOM base corrected 7 → **8** files and target to **9**
  entries (scripts/test.mjs:1969 lists 8 — recounted mechanically this turn);
  (5) §1.1's client.js anchors re-probed on disk at ae8c32a with a line-level
  scanner and every drifted entry replaced (PANEL_DICTS 26-318, pt alias 319,
  LANGUAGE_OPTIONS 320, LOCALE_STORAGE_KEY 321, makeT 323-328,
  readStoredLocale 330-337, writeStoredLocale 339-347, localeOverride 349,
  PREFS_STORAGE_KEY 361, TAB_IDS 362, readStoredPrefs 365, writeStoredPrefs
  381, storedPrefs 390, style constants 392-413, srOnlyStyle 414,
  effortKeyOf 416, parseApiResponse 418-442, fetchJson 444-455, visibleRoles
  922, baseSections 924-930, breakdownOf 931-940, renderCard 941-1107,
  visibleSections 1109, activeIndex 1110, tab keydown 1111-1121, header
  live region 1127-1131, render root 1123, legend details 1159-1169). The
  load-bearing anchors the auditor verified (runCardLoop 467-488, undo call
  site 870-872, state inits 540-572, render tail region, all index.js and
  test.mjs anchors) were confirmed by the same probe and left untouched.
- **Verification truthfully scoped:** the arithmetic checks in this revision
  were re-run mechanically (probe script over client.js/scripts/test.mjs +
  grep over this plan); final state — 95+27=122 keys ×3; allowlist 54+4=58
  with zero phantoms; red gate 78 total = **15 FAIL / 63 ok** with the
  enumerated FAIL set; green **78 ok**; LF/BOM 8→9; pack 69→70; routes 4→6;
  tripwire 98,304 = 96 × 1024. No false grep claims remain: every count in
  this plan is derived from a probe run in this session, not from memory of
  earlier revisions.
- **runCardLoop freeze:** the 3.1 block is the single authoritative shape
  (alive guard byte-identical to Pass 3, hook check inserted after it with the
  same abort shape, `cancelled` returned); the undo call site (870-872) is
  explicitly untouched; Pass-4 consumers' option objects are frozen.
- **Contract coverage:** every Pass-4 master item (49/48/25/44/45/24/60) has
  a frozen contract (3.2/3.3/3.4/3.5/3.6/3.7/3.10), a security-relevant test
  minimum (3.12), and a mandatory security gate step (6.1). R-08/R-09/C3/C5/
  C18/C19/C20/C21/C17 respected; R-14 honored (no restore-from-craft).
- **Waves disjoint:** T3-test {test.mjs} → Wave 1 {index.js | client.js |
  locale×3+installer | docs×4} → Wave 2 solo → lead gates. Write scopes are
  recorded per task; suite runs only at wave boundaries; node --check gains
  the installer (4 files).
- **Every task has runnable Verify with observable output**; the red gate
  Verify carries the STOP rule; the green gate names all four node --check
  targets; the installer verify uses --dry-run + git status (no repo writes).
- **Item 60 decision frozen** (3.10): no chunk ships; escalation tripwire
  98,304 bytes recorded; evidence records the measured size.
- Not implemented: application sources untouched; only this plan file was
  written (plus a scratch counter in .devflow/drafts/, removed).
