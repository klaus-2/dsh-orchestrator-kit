# Backlog-60 Pass 3 — Save-Safety & UX (executable plan)

> **Execution:** `run-conductor` executes this plan task-by-task after a
> `plan-auditor` `OKAY` verdict. Workers have ZERO interview history: everything
> needed is in this file. Master context: `.devflow/plans/backlog-60-master.md`
> (C1, C9, C10, C11, C15 bind this pass; D3 binds the remount policy). Repo rules:
> `AGENTS.md`. Pass 2 trail: `.devflow/notes/backlog-60-pass2/decisions.md`
> (D-1..D-3) and `.devflow/evidence/backlog-60-pass2/verification.md` +
> `verification-delta4.md`.

**Goal:** ship the panel save-safety and UX surfaces as ONE atomic vertical
slice — unsaved-changes indicator with mtime-keyed draft hoisting (C10), undo
last save through the frozen card-loop helper (C9), corrective actions on save
errors, aria-live save confirmation + live top summary, search/status-filter/
sort/density view controls, per-tab status breakdown, effective-route hint,
same-session prefs, content-visibility cards, the D3 catalog-cache skip, and
the 503-state coverage completion — all in the SAME commit with their tests.

**Architecture:** everything is client-side on top of the shipped single-card
POST contract (index.js is UNTOUCHED this pass). The client gains three
module-level stores (mtime-keyed draft store, undo snapshot map, panel prefs),
one reusable card-loop helper (`runCardLoop` — frozen now, Pass 4's batch and
profile flows reuse it verbatim), a controls row (search input, status filter
group, sort select, density select) composed AND-style with the phase tabs, and
two accessibility surfaces (a shared polite status region + the live header
counts). New strings extend the Pass 2 dictionary seam (locale JSON `panel` +
embedded `PANEL_DICTS`, parity enforced by the existing N1/N2 tests).

**Tech Stack:** unchanged — Node >= 22 ESM, React via host seed
(createElement/useState/useEffect only), `node:vm` harness (backward-compatible
extensions in 3.9), npm pack guard unchanged (no new shipped files).

**Backlog items covered:** 46 (unsaved indicator + Ctrl+S + warn-on-reload),
47 (undo last save), 43 (save errors with corrective action), 39 (aria-live
save confirmation), 51 (aria-live top summary), 50 (role search), 52 (status
filter), 55 (sort selector), 56 (per-tab status breakdown), 41 (compact
density), 59 (content-visibility), 53 (effective-route hint), 40 (tab/legend/
density prefs), 57 (session-changed seal — merged into the card-state surface;
NOTE: the master slice table row for Pass 3 names 57 and the dispatch brief
omitted it; the master binds, so it ships here as part of the same card-state
contract, 3.1), 9 (503 error-state coverage completion), 22/C15 (fixture tests
re-run), D3 (client remount catalog-cache skip).

**Baseline (verified fresh this planning turn):** HEAD `60ebd75`, clean working
tree, suite `node scripts/test.mjs` → exit 0, `ALL TESTS PASSED`, **61 ok**
(61 `await test(` labels counted by grep; full run executed and read in-turn).
client.js = 850 lines; scripts/test.mjs = 3498 lines. Locale files: 72 panel
keys ×3 (verified by script). Pack contract unchanged (no new shipped files →
P2-N5 stays green untouched).

---

## 1. Context (read before touching anything)

### 1.1 Current anchors (re-verified on disk at 60ebd75 this turn)

client.js (850 lines):
- PHASE_SECTIONS 13-17, PHASE_TONE 19; caches 21-24 (rolesCache, catalogCache,
  effortsCache, lastServerTiming); PANEL_DICTS 26-249; PANEL_DICTS.pt alias 250;
  LANGUAGE_OPTIONS 251; LOCALE_STORAGE_KEY 252; makeT 254-259;
  readStoredLocale 261-268; writeStoredLocale 270-278; `localeOverride` 280
  (THE storage pattern prefs reuse, 3.5); style constants 282-303 (cardStyle
  286, gridStyle 287, statusTone 296-300, statusBadgeStyle 301, tabStyle 294,
  bannerStyle 303); parseApiResponse 307-331 (error.status attached 315-318);
  fetchJson 333-344; postSettings 346-354 (returns { role, unchanged });
  normalizeDraft 356-361 ('' = inherit); evaluateDraftState 363-376 (dirty +
  saveBlocked); groupRoles 378-398; phaseOf 400.
- createSettings 402: hostT 403; component 404; mountToken 405; tracker 406;
  state inits 407-416 (drafts init from rolesCache 409); locale subscribe +
  override 417-424; load effect 426-490 deps [loadTick] (draft RESET 440-442 —
  unchanged this pass; invalid banner 446-450; `__load` 458; catalog branch
  461-484; `__catalog` 483); efforts effect 492-547; refreshAll 549-552;
  catalogEmpty 555; modelsOf 557; setDraft 559; save 561-603 (busy 562, base
  565, payload 569-582 incl. expectedMtimeMs 570-572, success 587-593 —
  tracker.saves 588, rolesCache update 589-590, normalizeDraft(saved) 592,
  notice 593; 409 → 'error.conflict' 596-598, else 'error.raw'; finally
  600-602); messageText 605; renderField 607-610; renderCard 612-721 (draft/
  base 613-614, message 615, state 616, header row 632-636, name suffix
  `card.disabledSuffix` 635, description 637, provider field 639-661, model
  662-678, effort 679-701, effort error line 702, message div 703, footer
  704-720, save button 714-720); sections/counts 723-727 (routedCount 725,
  disabledCount 726, countOf 727); tabs 728-732; visibleSections 733; tab
  keydown 734-745; render root 747-816 (header 748-770; counts div 751-755;
  locale select 756-763; refresh 764-770; banners 771-780; legend details
  `open: true` hardcoded 781; tablist 792-803 — tab button children = [label,
  count span] at 803; tabpanel 804-816; empty chain 805-810; sections map
  811-816); registration 820-848 (inject ['slots','locale'] 821).

index.js (READ-ONLY this pass — the client consumes these shapes):
- toRoleSummary fields 416-427 (id, name, description, provider, model,
  reasoningEffort, disabled, mtimeMs); catalog.default = the chat default
  {provider, model} from agentDefaultModel 362-372, echoed in GET .catalog
  515. POST .route: provider+model must pair (both present or both null)
  577-589; reasoningEffort null-or-string 596-604; resetRoute+effort rule
  610-612 (reasoningEffort null WITH resetRoute is valid); stale mtime → 409
  636-638; catalog unavailable → 503 661; provider/model not in catalog → 409
  664-665; effort-validation 400 670, resolver 503 674, unknown-route 409 679,
  unsupported effort 409 684-686; unchanged no-op 703-717; lock-timeout → 503
  code:'lock-timeout' with retry guidance 769-777.

scripts/test.mjs (3498 lines, 61 tests):
- mountVmClient 1976-2170: options storageMap 1988 / storage 1989 / active
  1990 / addLanguageThrows 2011 / sentinelBind 2022; sandbox globals
  2028-2063 (window.{__ModuleLoader__, localStorage}, fetch, encodeURIComponent,
  JSON, Map, Set, Array, Object, Promise, Number, String, Symbol, Error — NO
  setTimeout, NO addEventListener today); require assert `dep === 'react'`
  2071; plugin.apply ctx 2088-2105; mountInstance return { renderCycle,
  settle, unmount, meta } 2166; module return { mountInstance, fetchCalls,
  locale, storage, runPluginDisposers } 2169. collectText 2172; findNodes 2179.
- Big VM test 2187-2531 (section-title finder 2267; header summary text join
  2490; tab assertions use `children[0]` 2492-2515; vm5 empty-group 2519-2530);
  N12 2533-2598; N17 XSS 2600-2626; PANEL_KEYS frozen 72-key array 2628-2701;
  FROZEN_PACK_FILES 2703-2773 (unchanged — no new shipped files); P2-N1
  2777-2799 (asserts panel keys deepEqual the frozen PANEL_KEYS list);
  P2-N2 2801-2853; P2-N3 2855-3107 (requiredKeys derived from en.json 2858;
  sentinel regex 2875; scanTree props ['aria-label','title'] 2884-2896;
  cardOf/saveOf helpers 2897-2899; driven matrix M1…M4 + banner cases); 
  PANEL_RENDERABLE_KEYS 3109-3119; P2-N4 3121-3235 (languageSelectOf 3133;
  en-value render pin 3213-3233); P2-N5 pack 3237-3278; static contract test
  1943-1959 (all includes green at HEAD); node --check array 1961-1966;
  LF/BOM array 1968-1974 (locale files already covered); summary/exit
  3497-3498.
- Pass 2 review discipline to keep (verification-delta4.md): the
  PANEL_RENDERABLE_KEYS allowlist carries ZERO phantom keys (42 real keys at
  HEAD, mechanically counted this turn; the delta-4 prose says 43 — the
  count is the bug, not the check); the error.raw branch has an isolated vm
  drive (vmRaw 2366-2381). Pass 3 extends both patterns without phantoms.

Locale files: `panel` = 72 keys ×3 verified; meta.detail 'docs/DETAIL.md' ×3.

READMEs: Configure-per-role section 54-81, FAQ 120-148 (en; pt-BR/zh-CN
structurally identical). CHANGELOG.md has `## [Unreleased]`.

### 1.2 Pass 2 lessons that bind this pass

- **Zero-narrative comments:** shipped code carries NO comments; the why lives
  in this plan, the tests, and the docs. Catch blocks handle errors explicitly
  (return a fallback value), never empty, never comment-only.
- **Plan is read-only during execution;** live discoveries go to
  `.devflow/notes/backlog-60-pass3/`; contract defects STOP + escalate to lead.
- **Red/green discipline:** tests-first solo step; suite runs only at wave
  boundaries; green logs only under evidence (failure output carries absolute
  tmp paths); anti-flake 5×; no timing assertions (the highlight in 3.4 is
  deliberately NOT timer-based — cleared by the next interaction, deterministic
  and testable).
- **Realm-safe deepEqual:** pass deepEqual inputs through
  `JSON.parse(JSON.stringify(...))` across vm/host realms (P2-N2 pattern).
- **Draft reset on refresh is existing behavior and STAYS:** the load effect
  resets drafts on every refetch (client.js 440-442). C10 scopes hoisting to
  REMOUNT + the 409 retry action (3.3) — the plain Refresh button keeps the
  reset semantics (documented in README; the 409 action is the dedicated
  draft-preservation path).

### 1.3 Harness semantics that bind this pass (from .devflow/notes/harness-semantics.md)

- Q4: localStorage is same-origin, same-session on Desktop (origin port churn);
  prefs make NO durability claim beyond same-session (C11/R10) — same pattern
  as the shipped locale override.
- Q6: the settings section unmounts on tab switch / panel close and remounts
  on return — this is exactly the remount the draft store (3.1) serves; only
  the active section is mounted, so module-level stores are the only state
  that survives.
- No new sandbox globals except the frozen extension in 3.9 (window
  addEventListener/removeEventListener recording — required by the
  beforeunload guard; everything else reuses existing globals).

## 2. Must Have / Must NOT Have (Pass 3)

Must have:
- ONE atomic commit: client.js + locale ×3 + harness extensions + tests
  (new + RW-P3 reworks) + docs together (C1). No horizontal split.
- Frozen contracts (section 3) implemented EXACTLY: store shapes, loop-helper
  semantics, action-button behavior, prefs keys, composition logic, aria-live
  markup, dictionary values (byte-exact), test labels, red/green arithmetic.
  Contract defect → STOP + escalate; never silently deviate.
- Every NEW user-facing string = dictionary key ×3 languages, frozen in 3.8
  (byte-exact); N1/N2 parity and the N3 sentinel gate extend automatically
  (requiredKeys derives from en.json).
- `runCardLoop` (3.2) frozen EXACTLY as written: Pass 4's batch/profile flows
  reuse it verbatim; undo is its first consumer.
- No index.js / package.json / cordis.patch.yml changes (the route-surface
  test 1896-1902 stays green untouched; route literals in client stay 4).
- Existing tests stay green except the DOCUMENTED RW-P3 reworks (3.9); no
  assertion weakening; RW-P3 edits are additive (bigger frozen key list,
  stricter scan, more driven states).
- Harness extensions backward-compatible (3.9): the 61 baseline tests other
  than RW-P3 pass UNCHANGED.
- Anti-flake 5×; evidence under `.devflow/evidence/backlog-60-pass3/`; green
  logs only; token-clean everywhere (hygiene scans ALL disk files).
- C15: N17 re-run green; all new rendering interpolates data as string
  children (no innerHTML/eval, no HTML-injection props).
- Tests and verification logs ride the same commit.

Must NOT have:
- No comments in shipped code (zero-narrative sweep; explicit catch fallbacks).
- No server changes of any kind; no new fetch routes; no new runtime
  dependencies; no package.json change; no build step.
- No new React hooks beyond createElement/useState/useEffect; no new sandbox
  globals beyond 3.9; the require assert stays byte-identical.
- No timer-based UI decay (no setTimeout in client code); no timing
  assertions in tests.
- No localStorage durability claims beyond same-session; no prefs file in the
  agents root (C11/R-11); prefs never gate save behavior.
- No stale-mtime resend anywhere: the 409 action re-GETs and re-applies the
  draft; it NEVER calls postSettings (3.3).
- Undo never creates a snapshot (single-level undo, item 47); the session
  change-log / undo snapshots are NEVER persisted (C9).
- No tab/density/search persistence beyond the frozen prefs set (tab, legend,
  density only — 3.5).
- No machine tokens, no backup-suffix literal, no old plugin identity; 
  repo-relative paths only.
- No edits to installed role cards; no push; commit only via the git-commit
  skill.

## 3. Contract Freeze (binds ALL tasks; frozen BEFORE parallel work)

### 3.1 Draft store + dirty indicator + session seal (items 46 + 57; C10)

Module-level store (after `localeOverride`, near the caches):

```js
const draftStore = new Map();
const storeKeyOf = (id, baseMtimeMs) => `${id}:${baseMtimeMs}`;
const pruneStoreFor = (store, id) => {
  for (const key of [...store.keys()]) {
    if (key.split(':')[0] === id) store.delete(key);
  }
};
```

Role ids pass isEntryName (no `:`), so `key.split(':')[0]` is the id.
`pruneStoreFor` is shared with the undo snapshot map (3.2).

Write path — replace setDraft (client.js 559):

```js
const setDraft = (id, patch) => {
  setHighlightId(null);
  setDrafts((current) => {
    const next = { ...current, [id]: { ...current[id], ...patch } };
    const role = (rolesCache ?? []).find((entry) => entry.id === id);
    if (role) {
      pruneStoreFor(draftStore, id);
      draftStore.set(storeKeyOf(id, role.mtimeMs), { baseMtimeMs: role.mtimeMs, draft: next[id] });
    }
    return next;
  });
};
```

Save success (inside the try at 587-593, after normalizeDraft(saved) is
applied): `pruneStoreFor(draftStore, role.id);` — a clean card holds no draft.

Remount hoisting — replace the drafts init (client.js 409):

```js
const [drafts, setDrafts] = React.useState(() => {
  if (!rolesCache) return null;
  for (const key of [...draftStore.keys()]) {
    const [id, base] = key.split(':');
    const role = rolesCache.find((entry) => entry.id === id);
    if (!role || role.mtimeMs !== Number(base)) draftStore.delete(key);
  }
  return Object.fromEntries(rolesCache.map((role) => {
    const stored = draftStore.get(storeKeyOf(role.id, role.mtimeMs));
    return [role.id, stored ? stored.draft : normalizeDraft(role)];
  }));
});
```

C10 semantics exactly: `{baseMtimeMs, draft}` kept on remount ONLY when the
server mtime (rolesCache entry) matches the stored baseMtimeMs; mismatched
entries are deleted. The plain Refresh keeps the existing reset (1.2).

Dirty + session seal rendering (renderCard 612-721):
- `state.dirty` (evaluateDraftState, unchanged) drives:
  - name suffix: the name span children become
    `role.name, draft.disabled ? t('card.disabledSuffix') : '', state.dirty ? t('card.dirtySuffix') : ''`
    (mirrors the shipped disabledSuffix pattern; covers ALL sections — every
    card in every section renders it, default tab 'all' shows all).
  - border accent: the card container style gains
    `...(state.dirty ? { borderColor: 'var(--dsw-alias-state-warning-primary, #f59e0b)' } : {})`.
- Session seal (item 57): module-level `const sessionChangedIds = new Set();`
  — save success adds `sessionChangedIds.add(role.id)`; undo success KEEPS the
  id (the card changed this session); undo DELETE path unchanged. Cards render
  a discreet seal when `sessionChangedIds.has(role.id) && !state.dirty`:
  a small dot span before the status badge,
  `h('span', { title: t('card.sealTitle'), style: dotStyle('var(--dsw-alias-state-info-primary, #4f8cff)') })`.
  The Set is module-level (session lifetime) and NEVER persisted (C9).
  NEW KEY: `card.sealTitle` (3.8).

### 3.2 Undo last save + runCardLoop (item 47; C9 — frozen for Pass 4 reuse)

Module-level snapshot map (after the draft store):

```js
const undoSnapshots = new Map();
```

Entry shape (frozen): `{ id, baseMtimeMs, postMtimeMs, summary }` where
summary = the PRE-save normalized draft mapped to the server payload
vocabulary: `{ provider: base.provider === '' ? null : base.provider,
model: base.model === '' ? null : base.model,
reasoningEffort: base.reasoningEffort === '' ? null : base.reasoningEffort,
disabled: base.disabled }`. Map key = `storeKeyOf(id, baseMtimeMs)`
(id+baseMtime composite per C9); ONE entry per card — each save prunes the
card's previous entries first (`pruneStoreFor(undoSnapshots, role.id)`) so
"undo LAST save" holds.

Loop helper — frozen EXACTLY (place near postSettings; Pass 4 reuses verbatim):

```js
async function runCardLoop(cards, runOne, options = {}) {
  const results = [];
  let aborted = false;
  for (const card of cards) {
    if (typeof options.alive === 'function' && !options.alive()) {
      aborted = true;
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
  return { results, aborted };
}
```

Frozen semantics: alive guard consulted BEFORE each card; per-card results
(`{ id, ok, role?, unchanged? }` on success — postSettings' return spread;
`{ id, ok:false, status, detail }` on failure); continue-and-report on 409;
abort on ANY other failure (503 lock-timeout aborts per C9; network/parse
failures carry status null → abort). Cancel affordance: Pass 4's first batch
consumer adds an `options.shouldCancel()` check with the same placement and
records the extension — no speculative parameter ships now.

Alive guard plumbing (component scope): mountState pattern (hooks-compliant):

```js
const [mountState] = React.useState(() => ({ mounted: true }));
React.useEffect(() => () => { mountState.mounted = false; }, []);
```

Save path records the snapshot (inside the save try, after postSettings
resolves, BEFORE the rolesCache update):

```js
pruneStoreFor(undoSnapshots, role.id);
undoSnapshots.set(storeKeyOf(role.id, role.mtimeMs), {
  id: role.id,
  baseMtimeMs: role.mtimeMs,
  postMtimeMs: saved.mtimeMs,
  summary: {
    provider: base.provider === '' ? null : base.provider,
    model: base.model === '' ? null : base.model,
    reasoningEffort: base.reasoningEffort === '' ? null : base.reasoningEffort,
    disabled: base.disabled
  }
});
```

Lookup helper (component scope):

```js
const undoEntryFor = (role) => {
  for (const entry of undoSnapshots.values()) {
    if (entry.id === role.id && entry.postMtimeMs === role.mtimeMs) return entry;
  }
  return null;
};
```

Undo action (component scope; state `const [undoingId, setUndoingId] =
React.useState(null);`):

```js
const undo = async (role) => {
  const entry = undoEntryFor(role);
  const busy = roles === null || drafts === null || savingId !== null || undoingId !== null || refreshing || entry === null;
  if (busy) return;
  setUndoingId(role.id);
  setHighlightId(null);
  setMessages((current) => ({ ...current, [role.id]: undefined }));
  const payload = {
    id: role.id,
    expectedMtimeMs: entry.postMtimeMs,
    provider: entry.summary.provider,
    model: entry.summary.model,
    disabled: entry.summary.disabled,
    reasoningEffort: entry.summary.reasoningEffort
  };
  try {
    const { results } = await runCardLoop([payload], (card) => postSettings(card), {
      alive: () => mountState.mounted
    });
    const result = results[0];
    if (result.ok) {
      tracker.saves += 1;
      const nextRoles = (rolesCache ?? roles ?? []).map((entry2) => (entry2.id === role.id ? result.role : entry2));
      rolesCache = nextRoles;
      setRoles(nextRoles);
      setDrafts((current) => ({ ...current, [role.id]: normalizeDraft(result.role) }));
      undoSnapshots.delete(storeKeyOf(role.id, entry.baseMtimeMs));
      const notice = { kind: 'ok', key: result.unchanged ? 'notice.unchanged' : 'notice.undo' };
      setLastNotice(notice);
      setMessages((current) => ({ ...current, [role.id]: notice }));
      setHighlightId(role.id);
    } else {
      const message = result.status === 409
        ? { kind: 'error', key: 'error.conflict', params: { detail: result.detail } }
        : { kind: 'error', key: 'error.raw', params: { detail: result.detail } };
      setLastNotice(message);
      setMessages((current) => ({ ...current, [role.id]: message }));
    }
  } finally {
    setUndoingId(null);
  }
};
```

Server-contract notes (verified against index.js): the reverse payload always
carries provider+model as a pair (null/null = resetRoute, valid 577-589);
reasoningEffort null with resetRoute is valid (610-612); a null reasoningEffort
explicitly clears a saved effort; disabled always boolean. Undo 409 renders
the translated conflict message (C9: correct conflict detection). Undo NEVER
creates a snapshot; on success the consumed entry is deleted; on failure the
entry is retained. Busy propagation: `busy` expressions in save (562) and the
refresh button (767) gain `|| undoingId !== null`; the save button's
saveDisabled gains it too. Undo button (per card, ONLY when a snapshot
matches): rendered in the footer row before the save button (and in compact
rows, 3.7):

```js
undoEntryFor(role) ? h('button', {
  type: 'button',
  onClick: () => undo(role),
  disabled: busy || undoingId !== null,
  style: buttonStyle,
  'aria-label': t('undo.aria', { name: role.name })
}, undoingId === role.id ? t('undo.busy') : t('undo.label')) : null
```

### 3.3 Save errors with corrective action (item 43)

Retry-after-conflict (component scope; NEVER calls postSettings):

```js
const retryAfterConflict = async (id) => {
  try {
    const reply = await fetchJson(ROLES_ROUTE);
    if (!Array.isArray(reply?.roles)) return;
    rolesCache = reply.roles;
    setRoles(reply.roles);
    setMessages((current) => ({ ...current, [id]: undefined }));
    const kept = drafts?.[id];
    const fresh = reply.roles.find((entry) => entry.id === id);
    if (kept && fresh) {
      pruneStoreFor(draftStore, id);
      draftStore.set(storeKeyOf(id, fresh.mtimeMs), { baseMtimeMs: fresh.mtimeMs, draft: kept });
    }
  } catch (error) {
    setMessages((current) => ({ ...current, [id]: { kind: 'error', key: 'error.raw', params: { detail: String(error?.message ?? error) } } }));
  }
};
```

Frozen semantics: one roles re-GET; rolesCache/roles replaced; ALL drafts kept
as-is (the conflicting card's draft stays dirty against the fresh base); the
card's draft-store entry re-based to the fresh mtime; the conflict message
cleared; NO route POST is issued by the action — the user's next save carries
the FRESH expectedMtimeMs. Never a stale-mtime resend (C10).

409 message shape change (save catch, client.js 596-598): when the failed
payload carried an effort, the message gains a hint marker:

```js
const message = error?.status === 409
  ? { kind: 'error', key: 'error.conflict', params: { detail, ...(payload.reasoningEffort !== undefined ? { effortHint: true } : {}) } }
  : { kind: 'error', key: 'error.raw', params: { detail } };
```

Rendering (message div, client.js 703): 409 messages render the text + the
action button + the optional effort hint line:

```js
message ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: message.kind === 'ok' ? 'var(--dsw-alias-state-success-primary, #22c55e)' : 'var(--dsw-alias-state-error-primary, #ef4444)' } },
  messageText(message),
  message.key === 'error.conflict' ? h('button', { type: 'button', onClick: () => retryAfterConflict(role.id), style: { ...buttonStyle, fontSize: 11, padding: '4px 8px', alignSelf: 'flex-start' }, 'aria-label': t('error.action.regetAria', { name: role.name }) }, t('error.action.reget')) : null,
  message.key === 'error.conflict' && message.params?.effortHint ? h('div', { style: { fontSize: 11 } }, t('error.hint.effort')) : null) : null
```

503 lock-timeout: NO new button — the server's own guidance (index.js 775)
renders through error.raw with the lock name and retry instruction (shipped
behavior, now pinned by P3-N3). Other 503s (catalog unavailable, resolver)
keep error.raw.

### 3.4 Accessible save confirmation + live summary + unload guard + Ctrl+S (items 39, 51, 46)

Component state: `const [lastNotice, setLastNotice] = React.useState(null);`
and `const [highlightId, setHighlightId] = React.useState(null);`. Save success
path: `setLastNotice(message); setHighlightId(role.id);` (the same message
object stored per-card). Save failure path: `setLastNotice(message);` (no
highlight). Save start + undo start: `setHighlightId(null);` (3.2 already
shows undo). setDraft clears the highlight (3.1). refreshAll adds
`setHighlightId(null);`. The highlight is cleared by the NEXT interaction —
deliberately NOT a timer (1.2).

Shared polite region — sr-only, rendered once in the panel root, right after
the banner block (client.js 771-780):

```js
h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', style: srOnlyStyle },
  lastNotice ? messageText(lastNotice) : '')
```

Module constant (style constants block):

```js
const srOnlyStyle = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 };
```

Top summary (item 51): the existing header counts div (751-755) gains
`role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true'` — counts update
after every save/undo via the existing rolesCache replacement; no new text.

Warn-before-unload (item 46; guarded — the sandbox has no addEventListener at
HEAD, 3.9 adds a recording stub):

```js
React.useEffect(() => {
  if (typeof window.addEventListener !== 'function') return undefined;
  const handler = (event) => {
    const dirtyNow = roles !== null && drafts !== null && Object.entries(drafts).some(([id, draft]) => {
      const role = roles.find((entry) => entry.id === id);
      return role ? evaluateDraftState(draft, normalizeDraft(role), false).dirty : false;
    });
    if (dirtyNow) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [roles, drafts]);
```

Ctrl+S on the focused card (item 46) — NO window listener and NO new harness
surface: the panel root div (747) gains onKeyDown + the cards track focus:

```js
const onPanelKeyDown = (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key !== 's') return;
  event.preventDefault();
  const role = (roles ?? []).find((entry) => entry.id === focusedCardId);
  if (role) save(role);
};
```

`focusedCardId` is a closure variable in createSettings scope
(`let focusedCardId = null;`) — set by the card container's
`onFocusCapture: () => { focusedCardId = role.id; }` (comfortable cards and
compact rows both). Ctrl+S with no focused card is a no-op after
preventDefault. The panel root div props become
`{ 'data-dsh-orchestrator-kit-settings': '', style: ..., onKeyDown: onPanelKeyDown }`.

Saved-card highlight style: the card container style gains
`...(highlightId === role.id ? { borderColor: 'var(--dsw-alias-state-success-primary, #22c55e)' } : {})`
AFTER the dirty spread (highlight wins while shown).

### 3.5 Panel prefs (item 40; C11 — locale-override storage pattern)

Module level (after writeStoredLocale):

```js
const PREFS_STORAGE_KEY = 'dsh-orchestrator-kit.prefs';
const TAB_IDS = ['all', 'discovery', 'planning', 'verification', 'other'];
const DENSITY_OPTIONS = ['comfortable', 'compact'];

function readStoredPrefs() {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const prefs = {};
    if (TAB_IDS.includes(parsed.tab)) prefs.tab = parsed.tab;
    if (typeof parsed.legend === 'boolean') prefs.legend = parsed.legend;
    if (DENSITY_OPTIONS.includes(parsed.density)) prefs.density = parsed.density;
    return prefs;
  } catch {
    return {};
  }
}

function writeStoredPrefs(value) {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let storedPrefs = readStoredPrefs();
```

Component wiring:
- `const [activeTabState, setActiveTabState] = React.useState(storedPrefs.tab ?? 'all');`
  and a wrapper that persists: `const setActiveTab = (id) => { setActiveTabState(id); storedPrefs = { ...storedPrefs, tab: id }; writeStoredPrefs(storedPrefs); };`
  — ALL tab call sites (click 801, arrow keys 744) switch to the wrapper.
- Legend: `const [legendOpen, setLegendOpen] = React.useState(storedPrefs.legend ?? true);`
  — the details element (781) becomes `open: legendOpen, onToggle: (event) => {
  setLegendOpen(event.target.open); storedPrefs = { ...storedPrefs, legend:
  event.target.open }; writeStoredPrefs(storedPrefs); }`.
- Density: `const [density, setDensity] = React.useState(storedPrefs.density ?? 'comfortable');`
  — the density select (3.7) persists on change the same way.
- Search (3.6) and sort (3.6) are NOT persisted (transient view filters;
  frozen scope: tab/legend/density only).
- Storage failure degrades silently (try/catch → in-memory state still
  updates), mirroring the locale override.

### 3.6 Search, status filter, sort selector, per-tab breakdown (items 50, 52, 55, 56)

Component state: `search` (''), `statusFilter` ('all'), `sortMode` ('name').
Pure helpers (component scope; statusOf matches the saved-state predicates the
counts already use):

```js
const statusOf = (role) => (role.disabled === true ? 'disabled' : role.provider && role.model && role.model !== 'inherit' ? 'routed' : 'inherit');
const STATUS_RANKS = { name: null, routedFirst: { routed: 0, inherit: 1, disabled: 2 }, inheritsFirst: { inherit: 0, disabled: 1, routed: 2 } };
const byName = (left, right) => left.name.localeCompare(right.name);
const sortRoles = (list) => {
  const rank = STATUS_RANKS[sortMode];
  if (!rank) return [...list].sort(byName);
  return [...list].sort((left, right) => (rank[statusOf(left)] - rank[statusOf(right)]) || byName(left, right));
};
const query = search.toLowerCase();
const matchesSearch = (role) => query === '' || role.name.toLowerCase().includes(query) || (typeof role.description === 'string' && role.description.toLowerCase().includes(query));
const matchesStatus = (role) => statusFilter === 'all' || statusOf(role) === statusFilter;
const visibleRoles = (list) => sortRoles(list.filter((role) => matchesSearch(role) && matchesStatus(role)));
```

Composition: sections derive from UNFILTERED grouping, then filter+sort per
section — the tab counts stay SAVED-state/unfiltered (existing semantics):

```js
const baseSections = roles ? groupRoles(roles) : [];
const sections = baseSections.map((section) => ({ ...section, roles: visibleRoles(section.roles) }));
```

visibleSections logic unchanged (733). Breakdown per tab (56):

```js
const breakdownOf = (id) => {
  const list = id === 'all' ? (roles ?? []) : (baseSections.find((section) => section.id === id)?.roles ?? []);
  return {
    routed: list.filter((role) => statusOf(role) === 'routed').length,
    inherit: list.filter((role) => statusOf(role) === 'inherit').length,
    disabled: list.filter((role) => statusOf(role) === 'disabled').length
  };
};
const breakdownText = (id) => { const counts = breakdownOf(id); return `${counts.routed}/${counts.inherit}/${counts.disabled}`; };
```

Every tab button (793-803) appends after the count span:

```js
h('span', { title: t('tab.breakdownTitle'), style: { marginLeft: 8, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums', fontSize: 11 } }, breakdownText(tab.id))
```

Controls row — rendered between the legend details and the tablist (one row,
flex wrap, gap 8):

```js
h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } },
  h('input', { type: 'search', value: search, onChange: (event) => setSearch(event.target.value), placeholder: t('search.placeholder'), 'aria-label': t('search.aria'), style: { ...controlStyle, width: 'auto', flex: '1 1 200px', minWidth: 0 } }),
  h('div', { role: 'group', 'aria-label': t('filter.status.aria'), style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
    [{ id: 'all', labelKey: 'filter.status.all' }, { id: 'routed', labelKey: 'status.routed' }, { id: 'inherit', labelKey: 'status.inherit' }, { id: 'disabled', labelKey: 'status.disabled' }].map((option) =>
      h('button', { key: option.id, type: 'button', 'aria-pressed': statusFilter === option.id, onClick: () => setStatusFilter(option.id), style: tabStyle(statusFilter === option.id) }, t(option.labelKey)))),
  h('select', { value: sortMode, onChange: (event) => setSortMode(event.target.value), 'aria-label': t('sort.aria'), style: { ...controlStyle, width: 'auto', flex: 'none' } },
    h('option', { value: 'name' }, t('sort.name')),
    h('option', { value: 'routedFirst' }, t('sort.routedFirst')),
    h('option', { value: 'inheritsFirst' }, t('sort.inheritsFirst'))),
  h('select', { value: density, onChange: (event) => { const value = event.target.value; setDensity(value); storedPrefs = { ...storedPrefs, density: value }; writeStoredPrefs(storedPrefs); }, 'aria-label': t('density.aria'), style: { ...controlStyle, width: 'auto', flex: 'none' } },
    h('option', { value: 'comfortable' }, t('density.comfortable')),
    h('option', { value: 'compact' }, t('density.compact'))))
```

The status filter reuses the shipped status.* keys + tabStyle (statusTone key
pattern reuse). Empty-state chain (805-810) becomes:

```js
const visibleCount = activeTab === 'all' ? sections.reduce((sum, section) => sum + section.roles.length, 0) : (sections.find((section) => section.id === activeTab)?.roles.length ?? 0);
const unfilteredCount = activeTab === 'all' ? total : countOf(activeTab);
```

`visibleSections.length === 0` branch → show `t('empty.noMatch')` when
`unfilteredCount > 0`, else keep `t('empty.noGroup')` (roles null → loading;
roles.length === 0 → noRoles unchanged).

### 3.7 Compact density + content-visibility + inherit hint (items 41, 59, 53)

renderCard signature: `renderCard(role, compact = false)`; call site
(816): `section.roles.map((role) => renderCard(role, density === 'compact'))`.

Container style (both modes keep the dirty/highlight spreads from 3.1/3.4):

```js
compact
  ? { ...cardStyle, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 8, opacity: draft.disabled ? 0.7 : 1 }
  : { ...cardStyle, opacity: draft.disabled ? 0.7 : 1, contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' }
```

content-visibility applies to COMFORTABLE grid cards only (3.7 rationale:
compact rows are single-line, a 220px reserve would inflate them; item 59
names grid cards).

Comfortable mode: structure unchanged except the additions from 3.1/3.3/3.4
(seal, suffixes, borders, undo button, message block with action button, hint
below the description). Inherit hint (item 53) — comfortable: a div after the
description (637); compact: an inline span in the row:

```js
const inheritHint = isInherit && catalog?.default?.provider && catalog?.default?.model
  ? t('card.inheritHint', { provider: catalog.default.provider, model: catalog.default.model })
  : null;
```

Rendered as string children (C15); absent when catalog.default is null.

Compact mode structure (one line per role; same controls, same aria-labels):
name span (title attr carries role.description ?? role.name, same ellipsis
style) + disabled/dirty suffixes, inherit-hint span (when present), seal dot
(3.1), status badge (unchanged), the three selects with
`style: { ...controlStyle, width: 'auto', flex: '1 1 140px', minWidth: 0 }`
(direct, WITHOUT the renderField label/help wrappers), disabled checkbox +
`t('disabled.label')` label, undo button (3.2), save button (unchanged). The
message block renders as a full-width child (`flexBasis: '100%'`) ONLY when a
message exists. No help text in compact rows.

### 3.8 Dictionary additions (23 new keys; 72 → 95; FROZEN)

Schema unchanged (flat panel object, dotted keys, `{param}` placeholders).
T2 appends EXACTLY these to each JSON `panel`; T1 mirrors them verbatim into
PANEL_DICTS (N1/N2 enforce equality).

locale/en.json additions:
```json
"search.aria": "Search roles",
"search.placeholder": "Filter by name or description",
"empty.noMatch": "No roles match the current search or filter.",
"filter.status.aria": "Filter roles by status",
"filter.status.all": "All statuses",
"sort.aria": "Sort roles",
"sort.name": "By name",
"sort.routedFirst": "Routed first",
"sort.inheritsFirst": "Inherits first",
"density.aria": "Density",
"density.comfortable": "Cards",
"density.compact": "Compact list",
"tab.breakdownTitle": "Routed / inherit / disabled counts for this tab",
"card.inheritHint": "Inherits chat default: {provider} / {model}",
"card.dirtySuffix": " (unsaved)",
"card.sealTitle": "Changed during this session",
"undo.aria": "Undo last save for {name}",
"undo.label": "Undo",
"undo.busy": "Undoing…",
"notice.undo": "Undone — the previous settings are restored.",
"error.action.reget": "Reload saved state, keep edits",
"error.action.regetAria": "Reload saved state and keep edits for {name}",
"error.hint.effort": "The chosen reasoning effort may not be supported by this route — check the Reasoning effort select."
```

locale/pt-BR.json additions:
```json
"search.aria": "Pesquisar papéis",
"search.placeholder": "Filtrar por nome ou descrição",
"empty.noMatch": "Nenhum papel corresponde à busca ou ao filtro atual.",
"filter.status.aria": "Filtrar papéis por status",
"filter.status.all": "Todos os status",
"sort.aria": "Ordenar papéis",
"sort.name": "Por nome",
"sort.routedFirst": "Roteados primeiro",
"sort.inheritsFirst": "Herdados primeiro",
"density.aria": "Densidade",
"density.comfortable": "Cartões",
"density.compact": "Lista compacta",
"tab.breakdownTitle": "Contagens de roteados / herdados / desativados nesta aba",
"card.inheritHint": "Herdando o padrão do chat: {provider} / {model}",
"card.dirtySuffix": " (não salvo)",
"card.sealTitle": "Alterado nesta sessão",
"undo.aria": "Desfazer o último salvamento de {name}",
"undo.label": "Desfazer",
"undo.busy": "Desfazendo…",
"notice.undo": "Desfeito — as configurações anteriores foram restauradas.",
"error.action.reget": "Recarregar estado salvo, manter edições",
"error.action.regetAria": "Recarregar estado salvo e manter as edições de {name}",
"error.hint.effort": "O esforço de raciocínio escolhido pode não ser suportado por esta rota — verifique a seleção de Esforço de raciocínio."
```

locale/zh.json additions:
```json
"search.aria": "搜索角色",
"search.placeholder": "按名称或描述筛选",
"empty.noMatch": "没有符合当前搜索或筛选条件的角色。",
"filter.status.aria": "按状态筛选角色",
"filter.status.all": "全部状态",
"sort.aria": "排序角色",
"sort.name": "按名称",
"sort.routedFirst": "已路由优先",
"sort.inheritsFirst": "继承优先",
"density.aria": "密度",
"density.comfortable": "卡片",
"density.compact": "紧凑列表",
"tab.breakdownTitle": "此标签页的已路由 / 继承 / 已禁用计数",
"card.inheritHint": "继承对话默认：{provider} / {model}",
"card.dirtySuffix": "（未保存）",
"card.sealTitle": "本次会话中已更改",
"undo.aria": "撤销 {name} 的上次保存",
"undo.label": "撤销",
"undo.busy": "撤销中…",
"notice.undo": "已撤销 — 已恢复之前的设置。",
"error.action.reget": "重新加载已保存状态，保留修改",
"error.action.regetAria": "重新加载 {name} 的已保存状态并保留修改",
"error.hint.effort": "所选的推理强度可能不受此路由支持 — 请检查推理强度选择框。"
```

NOT translated (structural constants, frozen): TAB_IDS, DENSITY_OPTIONS,
STATUS_FILTER option ids, SORT_MODE ids ('name' | 'routedFirst' |
'inheritsFirst'), PREFS_STORAGE_KEY, srOnlyStyle, the store keys. Data stays
data: role/catalog/effort names, counts, breakdown numbers, search query text.

### 3.9 Harness extensions + RW-P3 reworks (scripts/test.mjs — additive only)

Harness (mountVmClient, backward compatible — existing callers unchanged):
- `const windowListeners = [];` near the other locals.
- sandbox.window gains:
  ```js
  addEventListener(type, handler) { windowListeners.push({ type, handler }); },
  removeEventListener(type, handler) {
    const index = windowListeners.findIndex((entry) => entry.type === type && entry.handler === handler);
    if (index >= 0) windowListeners.splice(index, 1);
  }
  ```
- module return gains `windowListeners`:
  `return { mountInstance, fetchCalls, locale: localeState, storage: storageMap, runPluginDisposers, windowListeners };`
- The require assert and every other sandbox global stay byte-identical.
  Rationale: only the beforeunload guard (3.4) needs it; Ctrl+S is driven via
  container onKeyDown props; the highlight has no timer (1.2) so no
  setTimeout global is added.

RW-P3 reworks (the ONLY existing-test edits; all additive, each red at HEAD
for a documented reason):
1. PANEL_KEYS (2628-2701): append the 23 new keys from 3.8 → 95 entries.
   Red at HEAD because the locale JSONs still carry 72 keys (T2 fixes it in
   Wave 1).
2. P2-N3 (2855-3107): (a) scanTree prop list becomes
   `['aria-label', 'title', 'placeholder']`; (b) allowedData gains the
   breakdown strings COMPUTED in-test from the gate fixture (the test
   replicates statusOf/breakdownText over gateRoles — no hardcoded literals);
   (c) driven-state additions so every new key renders through t in a real
   state:
   - controls row (always rendered): search.aria, search.placeholder,
     filter.status.aria, filter.status.all, status.routed/inherit/disabled
     (reused), sort.aria/name/routedFirst/inheritsFirst, density.aria/
     comfortable/compact; tab.breakdownTitle via the title attr on breakdown
     spans.
   - dirty state: toggle a draft → card.dirtySuffix.
   - inherit hint: gate catalog gains `default: { provider: EXAMPLE_CLOUD,
     model: 'reasoner-d' }` → card.inheritHint.
   - empty.noMatch: type 'ghost' into the search input (findNodes by the
     sentinel aria '⟦search.aria⟧') → noMatch sentinel.
   - undo flow: save zeta (route ok) → undo.aria/undo.label; hold the undo
     response → undo.busy; resolve → notice.undo.
   - 409 flow: routeMode '409' → error.action.reget/regetAria on the button
     (aria-label scanned).
   - effort 409 flow: planner effort change + routeMode '409' →
     error.hint.effort.
   - card.sealTitle: after a successful save the seal dot's title attr.
   Red at HEAD via these new assertions (no undo button, no controls row).
3. PANEL_RENDERABLE_KEYS (3109-3119): append the 12 keys whose EN VALUES
   render in the DEFAULT driven state (search.aria, search.placeholder,
   filter.status.aria, filter.status.all, sort.aria, sort.name,
   sort.routedFirst, sort.inheritsFirst, density.aria, density.comfortable,
   density.compact, tab.breakdownTitle). ZERO phantom keys — each must be a
   real en.json key (pass-2 delta-5 discipline). REWORK the P2-N4 en-value
   pin loop (currently `for (const [key, value] of Object.entries(enDict)) {
   if (!PANEL_RENDERABLE_KEYS.has(key)) continue; ... }`): iterate the
   allowlist itself —
   ```js
   for (const key of PANEL_RENDERABLE_KEYS) {
     const value = enDict[key];
     assert.ok(value !== undefined && renderedStrings.includes(value), 'the en value for ' + key + ' must render in the driven panel state');
   }
   ```
   Rationale (red-proof): at HEAD en.json holds only the 72 baseline keys, so
   Object.entries never yields the 12 new keys and the appended allowlist
   entries would be a silent no-op (P2-N4 would stay green and the red gate
   would miscount). Iterating the allowlist makes `enDict[key]` undefined for
   the 12 at HEAD → P2-N4 fails exactly as claimed; after T2 every value is
   defined and rendered → green. The delta-5 anti-phantom intent is preserved
   and strengthened: an allowlist key absent from en.json now fails outright
   instead of being skipped. Red at HEAD because those 12 values are
   undefined/do not render until T1/T2 land. ALSO (same rework,
   additive/stricter — no-weakening rule): P2-N4's scanEnValues prop list
   (test.mjs:3220, currently `['aria-label', 'title']`) becomes
   `['aria-label', 'title', 'placeholder']`, mirroring the P2-N3 scanTree
   change — search.placeholder renders ONLY in the placeholder prop, which
   the current scanner never collects, so without this extension the frozen
   71-ok green gate is unreachable. The red gate is UNCHANGED by this
   addition: at HEAD the undefined enDict[key] values fail first regardless
   of the wider prop scan.

P2-N2 stays green through the red gate (embedded 72 == JSON 72 at HEAD) and
through the green gate (both sides 95, realm-normalized deep-equal).

### 3.10 D3 — remount catalog-cache skip

Load effect (client.js 426-490): replace the catalog request line:

```js
const catalogRequest = loadTick === 0 && catalogCache !== null ? null : fetchJson(CATALOG_ROUTE);
Promise.allSettled([fetchJson(ROLES_ROUTE), catalogRequest])
```

and branch the catalog handling: when `catalogRequest === null` →
`setCatalog(catalogCache);` + clear `__catalog` from messages (the roles
branch is untouched); else the existing fulfilled/rejected branches
unchanged. Frozen semantics: freshness = non-null (NO TTL — C3); roles ALWAYS
refetch; an explicit refresh (loadTick > 0) always fetches both; the first
mount ever (catalogCache null) fetches. lastServerTiming is untouched by the
skip (module-level, latest-response semantics).

## 4. Per-task contracts

Wave layout (shared checkout, no locks; suite runs ONLY at wave boundaries;
the pass is ATOMIC — all tasks ride ONE commit):

```
Step 0 (solo):  T3 tests+harness+reworks ── red evidence (12 FAIL / 59 ok, 71 total)
Wave 1 (∥):     T1 client.js   |   T2 locale/*.json   |   T4 docs      (disjoint)
Wave 2 (solo):  I1 integration green (71 ok) → I2 anti-flake 5x + evidence
Wave 3 (lead):  adversarial workflow + review loop + live smoke + git-commit (section 6)
```

Write scopes 100% disjoint: T3={scripts/test.mjs}, T1={client.js},
T2={locale/en.json, locale/pt-BR.json, locale/zh.json}, T4={README.md,
README.pt-BR.md, README.zh-CN.md, CHANGELOG.md}, I2={.devflow/evidence/backlog-60-pass3/}.

---

### T3 — Tests + harness + reworks (test-writer; Step 0, solo)

**Parallelizable:** no — runs alone BEFORE Wave 1 so the red run sees HEAD
sources.
**Write scope:** `scripts/test.mjs` ONLY.
**References:** 3.1-3.10 contracts; 1.1 anchors; 3.9 harness + RW-P3; §8
labels and arithmetic.

**What to do:**
1. Apply the 3.9 harness extension (windowListeners recording + return) and
   the three RW-P3 reworks EXACTLY (PANEL_KEYS +23; P2-N3 scanTree placeholder
   + computed breakdown allowlist + full driven-state additions;
   PANEL_RENDERABLE_KEYS +12 zero-phantom keys + pin-loop rework).
2. Append P3-N1…N10 (exact labels in §8) after the P2-N4 test (3235), before
   the npm-pack test (3237). Implement per these minimums:
   - **P3-N1:** roles across three phases (discovery/planning/other);
     dirty a draft on each → 3 dirty suffixes + amber borders with tab 'all';
     beforeunload handler present in vm.windowListeners ONLY while dirty
     (deps re-register), drive it with a spy event → preventDefault called
     when dirty, NOT called after a save makes it clean; Ctrl+S: card
     onFocusCapture() then panel-root onKeyDown({key:'s', ctrlKey:true,
     preventDefault:spy}) → POST for the focused card with the CURRENT draft
     payload; metaKey variant; key 'x' → no POST; remount hoist (mtime
     matches → draft restored, select value asserted); discard on mismatch
     (mock serves mtime+1000 → draft gone, next save posts the FRESH mtime);
     clean save prunes the store (remount shows no dirty state).
   - **P3-N2:** save zeta (disabled toggle) → exact save POST asserted →
     undo button appears; undo POST body deep-equals
     `{ id, expectedMtimeMs: <post mtime>, provider: null, model: null,
     disabled: false, reasoningEffort: null }` (pre-save summary); success →
     roles updated, notice.undo renders, entry consumed (button gone);
     route-dirty save on planner with effort → undo payload carries
     provider/model/effort strings; undo 409 → conflict text renders AND the
     snapshot is retained; undo unchanged:true → notice.unchanged; no
     snapshot → no undo button; second save replaces the snapshot (undo
     restores the SECOND save's pre-state); undo never creates a snapshot
     (after undo success, no new undo button); alive guard: hold the undo
     response, unmount, resolve → no crash (guarded setters).
   - **P3-N3:** routeMode '409' → conflict message + reget button (aria
     'Reload saved state and keep edits for planner'); click → roles re-GET
     issued, ZERO new .route calls from the action, message cleared, draft
     still dirty, next save posts the FRESH expectedMtimeMs (never stale);
     effort-409 (payload has reasoningEffort) → hint text renders;
     routeMode '503' with a lock-timeout body → the raw guidance (lock name +
     retry wording) renders via error.raw.
   - **P3-N4:** shared region node (role 'status', aria-live 'polite') exists;
     save → region text equals the notice text; failure → error text;
     unchanged → unchanged text; saved card gets the green borderColor;
     header counts div carries aria-live and its text updates after a save.
   - **P3-N5:** search 'plan' hides zeta-custom and shows planner (name
     match); description fragment matches too; status filter
     routed/inherit/disabled each composes AND with a phase tab and the
     search; sort routedFirst/inheritsFirst reorder WITHIN a section (assert
     the exact rendered order via checkbox aria-labels); breakdown spans show
     the exact per-tab `${routed}/${inherit}/${disabled}`; empty.noMatch when
     filters exclude everything while the tab is non-empty; empty.noGroup
     still renders for a genuinely empty phase.
   - **P3-N6:** density select → compact: rows have flexDirection 'row', the
     same aria-labels resolve, zero fieldHelp-style nodes in compact rows;
     comfortable default unchanged (grid + contentVisibility 'auto' +
     containIntrinsicSize 'auto 220px' on card containers; compact containers
     lack both); inherit hint renders the catalog.default provider/model on
     inherit cards and is absent when default is null; dirty suffix and undo
     still work in compact mode (one composed drive).
   - **P3-N7:** tab switch → storage prefs key JSON contains tab; legend
     onToggle → legend:false; density switch → 'compact'; fresh
     mountInstance restores all three (aria-selected tab, details open false,
     select value); storage-throw variant → no crash, in-memory switch works,
     storage stays empty; invalid-JSON seed → defaults.
   - **P3-N8:** catalog fetch counter; first mount → 1 catalog fetch;
     mountInstance again (same vm) → roles refetched, catalog NOT; Refresh
     click → both refetched.
   - **P3-N9:** catalog 503 → banner renders the message, provider/model
     selects disabled, route-dirty save blocked (saveDisabled true),
     disabled-toggle save enabled and its POST succeeds.
   - **P3-N10:** static-marker test (readFileSync client.js): includes
     'contentVisibility', 'undoSnapshots', 'dsh-orchestrator-kit.prefs',
     'aria-live'.
3. No timing assertions; fixtures token-clean; pure LF/no BOM; realm-safe
   deepEqual; new fixture catalogs may add `default: {...}` (data).

**Must NOT do:** touch client.js/locale/docs; weaken any existing assertion
beyond the three RW-P3 additions; change the require assert; add sandbox
globals beyond 3.9; touch FROZEN_PACK_FILES or the LF/BOM array (both stay
green untouched).

**Verify (observable):**
```
node --check scripts/test.mjs
```
→ exit 0. Then:
```
node scripts/test.mjs
```
→ exit 1; final line `12 TEST(S) FAILED`; exactly the 12 FAIL labels from §8;
59 ok lines. Cross-check:
```
node scripts/test.mjs 2>&1 | Select-String -Pattern '^FAIL ' -CaseSensitive
```
→ exactly those 12 lines. Report the FAIL label list as red evidence (never
save raw failure output — absolute tmp paths). If the count differs, STOP and
reconcile before Wave 1.

---

### T1 — Client save-safety & UX (implementer; Wave 1, parallel)

**Parallelizable:** yes (with T2, T4). **Write scope:** `client.js` ONLY.
**References:** 3.1-3.7, 3.10 exact code; 1.1 anchors.

**What to do:** implement 3.1 (draft store + prune helpers + setDraft +
remount init + dirty suffix/border + session seal), 3.2 (undoSnapshots +
runCardLoop + mountState + snapshot recording + undo + busy propagation),
3.3 (retryAfterConflict + 409 message shape + action button + effort hint),
3.4 (lastNotice/highlight state + sr-only region + counts aria-live +
beforeunload effect + focusedCardId + onPanelKeyDown), 3.5 (prefs module
constants + component wiring + tab wrapper + legend onToggle), 3.6 (search/
statusFilter/sortMode state + helpers + sections rework + breakdown + controls
row + empty chain), 3.7 (renderCard compact param + container styles +
inheritHint + compact structure), 3.10 (D3 catalog skip). Mirror the 3.8
dictionary additions verbatim into PANEL_DICTS (all three faces + pt alias
inherits automatically). No comments anywhere in the diff.

**Must NOT do:** index.js/package.json/docs/locale edits; new routes (route
literal count stays 4); new hooks beyond useState/useEffect; new sandbox
assumptions beyond the 3.9 window methods (guard with typeof); innerHTML/
eval; timer-based decay; persist search/sort; translate data strings;
rework the load effect's draft reset; change en values by one byte.

**Verify (observable, file-scoped):**
```
node --check client.js
```
→ exit 0. Route-literal count stays 4:
```
(Select-String -Path client.js -Pattern '/api/dsh-orchestrator-kit\.(roles|catalog|efforts|route)' -AllMatches | ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum
```
→ `4`. Structural markers present:
```
Select-String -Path client.js -Pattern 'contentVisibility','undoSnapshots','dsh-orchestrator-kit.prefs','aria-live' -CaseSensitive
```
→ 4 matching lines. Report completion + outputs.

---

### T2 — Locale dictionaries (implementer or tech-writer; Wave 1, parallel)

**Parallelizable:** yes (with T1, T4). **Write scope:** `locale/en.json`,
`locale/pt-BR.json`, `locale/zh.json` ONLY.
**References:** 3.8 canonical additions (append EXACTLY those keys to each
file's `panel`; meta untouched).

**What to do:** append the 23 frozen keys per language (95 panel keys each);
pure LF, no BOM, valid JSON; key sets identical across the three files.

**Must NOT do:** change meta values or any existing key/value; add keys
beyond the frozen 23; touch any other file; introduce machine tokens.

**Verify (observable):**
```
node -e "const fs=require('fs');const files=['locale/en.json','locale/pt-BR.json','locale/zh.json'];const sets=files.map(f=>{const j=JSON.parse(fs.readFileSync(f,'utf8'));const keys=Object.keys(j.panel).sort();if(keys.length!==95)throw new Error(f+' key count '+keys.length);for(const k of keys){if(typeof j.panel[k]!=='string'||j.panel[k].trim()==='')throw new Error(f+' empty value '+k);}return JSON.stringify(keys);});if(sets[0]!==sets[1]||sets[0]!==sets[2])throw new Error('key sets diverge');console.log('locale parity OK: 95 keys x 3');"
```
→ `locale parity OK: 95 keys x 3`, exit 0. LF/BOM check (Pass 2 T2 snippet) →
exit 0. Report completion + outputs.

---

### T4 — Docs (tech-writer or docs-sync; Wave 1, parallel)

**Parallelizable:** yes (with T1, T2). **Write scope:** `README.md`,
`README.pt-BR.md`, `README.zh-CN.md`, `CHANGELOG.md` ONLY.
**References:** README.md Configure area 54-81 + FAQ 120-148; CHANGELOG
[Unreleased]; structural parity snippet (Pass 2 T4; I-2 lesson: use the
escape-proof fence regex when running under pwsh).

**What to do (three READMEs structurally identical; translate prose, keep
markers/paths/identifiers verbatim):**
1. Configure area: document the new controls row (search by name/description;
   status filter routed/inherit/disabled composed with the phase tabs; sort
   name/routed-first/inherits-first within sections; density cards/compact);
   per-tab routed/inherit/disabled breakdown; the effective-route hint on
   inherit cards; the unsaved indicator + warn-before-reload + Ctrl+S
   (saves the focused card); Undo (one level per card, session-only, conflict
   → reload action, never persisted); the 409 action ("Reload saved state,
   keep edits" — never resends the stale mtime) and the effort hint;
   aria-live confirmation + highlight (until the next change); same-session
   prefs (tab, legend, density — best-effort localStorage, same semantics as
   the language override); plain Refresh resets drafts (the 409 action is the
   draft-preserving path).
2. FAQ: add "How does Undo work?" and "What do the numbers beside the tabs
   mean?" entries (keep all three languages' FAQ entry counts aligned).
3. CHANGELOG [Unreleased]: Added — panel search/status filter/sort/density
   controls, per-tab status breakdown, unsaved-changes indicator with Ctrl+S
   and reload warning, undo last save, corrective actions on save errors,
   aria-live confirmations, effective-route hint, content-visibility cards,
   same-session panel prefs, catalog-cache skip on remount. Do not touch
   released sections.

**Must NOT do:** machine tokens; backup-suffix literal; invented
credentials/models; structural divergence between READMEs; source/test edits;
durability claims beyond same-session; docs/ or CONTRIBUTING edits (Pass 5).

**Verify (observable):** structural parity (Pass 2 T4 snippet, both fence
forms identical ×3) → exit 0; token self-scan on the four docs (split-built
list) → exit 0. Report completion + outputs.

---

### I1 — Integration green (run-conductor or one implementer; Wave 2, solo)

**Parallelizable:** no — single owner. **Write scope:** any of {client.js,
locale/*.json, scripts/test.mjs, READMEs, CHANGELOG} for FIXES only.
**References:** section 3 contracts; T1-T4 reports.

**What to do:** run the suite; expected first run 71 ok. Failures → reconcile
against the FROZEN contracts (contract wins; fix the deviating side; never
weaken assertions). Typical risks: dictionary byte-drift (N1/N2 fail → fix
dictionary/embedded copy); a 3.8 key missed in PANEL_DICTS (N2 fail); compact
rows losing an aria-label (P3-N6 fail); breakdown allowlist mismatch
(P2-N3 fail — recompute from the fixture). Contract defect → STOP + escalate.
Then node --check ×3.

**Verify (observable):**
```
node scripts/test.mjs
```
→ exit 0, `ALL TESTS PASSED`, 71 ok, zero FAIL.
```
node --check index.js; node --check client.js; node --check scripts/test.mjs
```
→ all exit 0.

---

### I2 — Anti-flake + evidence (same owner; Wave 2, after I1)

**Parallelizable:** no. **Write scope:** `.devflow/evidence/backlog-60-pass3/` ONLY.

**What to do:** 5 consecutive green full-suite runs; any failure → I1, delete
the failed log, restart the sequence. Write verification.md (token-clean):
date, commands, red→green trail (12 FAIL labels → 71 ok), 5/5, new-test list,
RW-P3 before/after summary, runCardLoop freeze note for Pass 4, placeholders
for review scores + live-smoke record (lead fills).

**Verify (observable):**
```
New-Item -ItemType Directory -Force -Path .devflow/evidence/backlog-60-pass3 | Out-Null
$ok = 0
for ($i = 1; $i -le 5; $i++) {
  node scripts/test.mjs *> ".devflow/evidence/backlog-60-pass3/test-run-$i.log"
  if ($LASTEXITCODE -eq 0) { $ok++ } else { break }
}
"green runs: $ok/5"
```
→ `green runs: 5/5`; each log ends `ALL TESTS PASSED` with exactly 71 ok lines.
node-check log → three `exit 0` lines. Token-scan every evidence file.

## 5. Verification strategy (summary)

- Canonical: `node scripts/test.mjs` → exit 0 + `ALL TESTS PASSED`, fresh
  output read in-turn at every gate. Red gate: 12 FAIL / 59 ok (71 total).
  Green: 71 ok.
- Anti-flake: 5 consecutive green runs, logs under
  `.devflow/evidence/backlog-60-pass3/test-run-<i>.log` (green only).
- Syntax: node --check ×3 (also in-suite). Static invariants re-checked by the
  suite: route surface 4+4, package contract UNTOUCHED, mount marker,
  old-identity/failsafe bans, hygiene tokens, P3-N10 structural markers.
- New coverage: draft hoisting/dirty/unload/Ctrl+S (N1), undo + loop-helper
  guards (N2), 409 action + effort hint + lock guidance (N3), aria-live pair
  + highlight (N4), search/filter/sort/breakdown composition (N5), density +
  content-visibility + inherit hint (N6), prefs lifecycle (N7), D3 skip (N8),
  catalog 503 state (N9), static markers (N10). C15: N17 re-run green every
  run; N3 sentinel gate covers every new key in a real driven state.
- No timing assertions anywhere (the highlight is interaction-cleared).

## 6. Post-parallel & final gates (lead-owned, in order)

1. Adversarial verification workflow (feature lenses: contracts/API surface,
   error paths, test sufficiency, performance/maintainability, docs accuracy;
   no new trust boundary — same-origin localStorage prefs, no new routes,
   redaction untouched; security lens optional at lead discretion, mirroring
   Pass 2). Confirmed findings → fix list → re-run I1/I2.
2. Review loop: diff-reviewer 1-10, fix Critical/Important, min 2 loops max 4,
   gate >= 8/10 (dev-flow clean-exit breaker). Re-verify after fixes.
3. **Live-host smoke (C8, one documented check):** browser-qa against the real
   panel at the CURRENT DSH Web GUI URL from the runtime context (never
   hardcode a port in any repo file). Steps: open Settings → Orchestrator;
   verify the controls row (search/filters/sort/density) renders; type a
   search fragment; toggle the status filter; switch density; edit a draft →
   unsaved seal + reload warning fires; save → aria-live confirmation +
   highlight; undo appears → undo restores; 409 path → "Reload saved state,
   keep edits" appears and keeps the edits; reload the page → prefs (tab/
   legend/density) restored same-session. Evidence: screenshot(s) + notes
   under `.devflow/evidence/backlog-60-pass3/` (token-clean; panel content
   only). If the GUI is unreachable, record the blocker and the exact manual
   steps for the human — never fake the smoke (Pass 2 precedent: the auth
   gate produced a documented consolidated-blocked record; expect the same
   and document it).
4. Docs reconciliation: README trilingual structural parity, CHANGELOG
   accuracy vs the diff, prefs semantics match C11 (same-session), undo/
   refresh draft semantics stated exactly as 1.2/3.1/3.3.
5. TEST VERIFICATION GATE audit: every new behavior has a failing-mode test
   (red proofs captured); evidence complete + token-clean; tests + logs ride
   the commit.
6. Delivery: ONE atomic commit via the `git-commit` skill (owns diff analysis,
   zero-narrative comment sweep, whitespace, checks, staging, Conventional
   Commits message). Suggested shape: `feat(panel): save-safety and view
   controls for the role panel (backlog-60 pass 3)` — the skill owns final
   wording. NO push.
7. Update `.devflow/runs/backlog-60/progress.md` (token-clean) + consolidated
   report: what shipped, commands + results, review scores, smoke record,
   remaining risks (module-level stores are session-scoped by design; undo is
   single-level; runCardLoop awaits its Pass 4 multi-card consumers for the
   continue/abort proof beyond the single-card drive), next-pass readiness
   (Pass 4 reuses runCardLoop verbatim + adds the shouldCancel hook).

## 7. Known behavior changes (for docs accuracy & review)

1. Editing any card control marks it dirty: amber border + " (unsaved)" name
   suffix, across every section and both density modes. Reload with dirty
   drafts triggers the browser's leave-confirmation. Ctrl+S / Cmd+S saves the
   focused card (no-op when nothing is focused).
2. Unsaved drafts survive panel tab switches and settings reopen via
   mtime-keyed hoisting: kept only while the card's server mtime matches the
   stored base; an external edit discards the stale draft. The plain Refresh
   button still resets drafts; the 409 action preserves them.
3. Every successful save offers Undo (one level, per card, session-only). Undo
   POSTs the pre-save summary with the post-save mtime; a 409 surfaces the
   translated conflict; undo never chains.
4. 409 save failures gain a "Reload saved state, keep edits" action (re-GET +
   re-apply draft, never a stale resend); effort-validation 409s add a hint
   pointing at the effort select; 503 lock-timeout keeps its server-provided
   guidance.
5. A shared polite live region announces the last save/undo outcome; the
   header counts are a polite live region; the saved card flashes a green
   border until the next change.
6. New view controls: search (name/description fragment), status filter
   (routed/inherit/disabled), sort (name/routed-first/inherits-first, within
   sections), density (cards/compact one-line rows). All compose AND-style
   with the phase tabs; a filtered-empty view shows a distinct no-match state.
7. Each tab shows its routed/inherit/disabled breakdown; inherit cards show
   the chat-default route (when the harness exposes one); comfortable cards
   reserve space via content-visibility.
8. Tab choice, legend state and density persist for the browser session
   (best-effort localStorage; same semantics as the language override);
   search and sort are transient.
9. Remounting the panel skips the catalog refetch while a cached catalog
   exists (roles always refetch; explicit refresh always refetches both).

## 8. Frozen test names + red/green arithmetic (against the 61-test baseline)

New tests (10):

| ID | Exact label | Red at HEAD? |
| --- | --- | --- |
| P3-N1 | `save safety: mtime-keyed draft hoisting, dirty seal on every section, warn-before-unload and Ctrl+S on the focused card` | YES |
| P3-N2 | `undo last save: reverse POST of the pre-save summary with the post-save mtime, snapshot lifecycle and loop-helper guards` | YES |
| P3-N3 | `save error actions: 409 re-GET keeps the draft and never resends a stale mtime; effort hint; lock-timeout guidance renders` | YES |
| P3-N4 | `accessible save confirmation: shared polite region announces success/failure/unchanged, saved-card highlight and live top summary` | YES |
| P3-N5 | `role view controls: search, status filter, sort selector and per-tab status breakdown compose with phase tabs` | YES |
| P3-N6 | `density modes: compact one-line rows keep the same controls; grid cards reserve space via content-visibility; inherit hint shows the chat default` | YES |
| P3-N7 | `panel prefs: tab, legend and density persist same-session with best-effort localStorage and degrade silently` | YES |
| P3-N8 | `remount cache: a fresh catalog cache skips the catalog refetch while roles still refetch; explicit refresh always refetches both` | YES |
| P3-N9 | `catalog 503 state: banner renders, provider/model selects disable, route saves block and disabled-only saves still work` | NO (guard — HEAD behavior pinned) |
| P3-N10 | `client.js pass-3 static markers: contentVisibility, undoSnapshots, prefs key and aria-live present in source` | YES |

Reworks (RW-P3, 3.9 — additive edits to three existing tests; each red at
HEAD for a documented reason): PANEL_KEYS +23 (P2-N1 fails while the JSONs
still hold 72 keys), P2-N3 sentinel-gate extension (placeholder prop +
computed breakdown allowlist + driven-state additions), PANEL_RENDERABLE_KEYS
+12 + pin-loop rework (P2-N4 fails while the new values do not render).

Red gate (T3 solo, HEAD sources + new tests/harness/reworks): **71 total,
12 FAIL / 59 ok**, final line `12 TEST(S) FAILED`, exit 1. FAIL set = {P3-N1,
P3-N2, P3-N3, P3-N4, P3-N5, P3-N6, P3-N7, P3-N8, P3-N10, P2-N1, P2-N3, P2-N4}.
The other 58 existing tests + P3-N9 stay green (harness backward compatible;
RW-P3 is the only existing-test touch). Green gate (after implementation):
**71 ok**, `ALL TESTS PASSED`, exit 0.

## 9. Out of scope (later passes — do not smuggle in)

Batch apply, profile export/import, audit trail, diagnostics, readonly mode,
installer (P4 — they consume runCardLoop verbatim + add the shouldCancel
hook); coverage thresholds, size budget, docs-parity.mjs, link check,
CONTRIBUTING glossary, client.js byte-size assert (P5); chunking (conditional
P4 tripwire); ANY index.js/package.json change; new routes; undo history
beyond one level; persisting the undo snapshots or session change-log;
persisting search/sort prefs; timer-based UI decay.

---

## Self-review (planner; revision 3 — round-3 fixes human-authorized via the circuit-breaker gate)

- Round-3 fixes (auditor-prescribed, applied EXACTLY, nothing else): (1) the
  RW-P3 #3 block now also prescribes extending P2-N4's scanEnValues prop
  list to `['aria-label', 'title', 'placeholder']` (test.mjs:3220),
  mirroring the P2-N3 scanTree change — additive/stricter under the
  no-weakening rule, red gate UNCHANGED (undefined values fail first), and
  it is what makes the frozen 71-ok green gate achievable: search.placeholder
  renders ONLY in the placeholder prop, which P2-N4's scanner previously
  never collected, so the en-value pin for that key could never pass;
  (2) T2 Must-NOT-do corrected to "beyond the frozen 23"; (3) this
  self-review records the round-3 fixes with the green-gate failure
  mechanism and the human authorization for this third round.
- Revision 2 fixes (auditor round 1, mechanically verified with a scratch
  Node script): (1) the frozen §3.8 blocks carry exactly 23 keys ×3 with
  zero duplicates — every numeric surface says 23 new / 95 total (§3.8
  header, RW-P3 #1, P2-N2 green-gate note, T3 brief, T2 what-to-do, T2
  Verify literal + expected output, T2 Must-NOT-do, §8 reworks paragraph);
  (2) RW-P3 #3 prescribes the pin-loop rework — P2-N4 iterates
  PANEL_RENDERABLE_KEYS itself with an `enDict[key] !== undefined`
  assertion, so the 12 appended keys are `undefined` at HEAD (red as
  claimed) instead of a silent no-op inside the Object.entries loop;
  (3) the HEAD allowlist count corrected 43 → 42 (mechanically counted:
  42 entries, zero duplicates) with a note that the delta-4 prose is off
  by one — the count is the bug, not the check.
- Final arithmetic (re-verified this revision): 72 + 23 = 95 keys ×3; red
  gate = 71 total, 12 FAIL / 59 ok, FAIL set {P3-N1..N8, P3-N10, P2-N1,
  P2-N3, P2-N4} UNCHANGED by the round-3 scanner extension (at HEAD the
  undefined enDict values fail before any rendered-strings comparison);
  green gate = 71 ok with the extended scanner (placeholder now collected);
  allowlist 42 at HEAD → 54 after the +12 append (42 + 12, zero phantoms).
- Every cited anchor read/grepped on CURRENT disk at 60ebd75 this turn
  (client.js full read; index.js POST/catalog/default regions;
  scripts/test.mjs harness + all five P2 tests + static/LF arrays; locale key
  counts scripted; README section lines; master C9/C10/C11/C15/D3 + slice
  row 3; pass-2 evidence + decisions; harness-semantics Q4/Q6). The
  numeric claims were re-counted mechanically this planning session; the
  test.mjs:3220 scanEnValues prop list was read directly.
- Waves disjoint: T3 {test.mjs} → Wave 1 {client.js | locale ×3 | docs ×4} →
  Wave 2 solo → lead gates. No scope overlaps; suite runs only at boundaries.
- Zero unresolved blockers: the item-57 assignment omission is resolved IN
  PLAN (master slice table binds; merged into 3.1 and flagged for the
  auditor); the undo keying question is resolved (composite id+baseMtime key
  + last-wins-per-card + postMtime lookup); the Ctrl+S mechanism is resolved
  (container onKeyDown — no window listener, no new sandbox surface);
  the highlight decay is resolved (interaction-cleared, no timers).
- Every task has runnable Verify with observable output; red/green arithmetic
  is exact (12 FAIL labels enumerated; P3-N9 proven green-at-HEAD against the
  existing catalog-failure path).
- Contract freeze covers every Pass 3 item from the master slice table
  (9/22-C15/39/40/41/43/46/47/50/51/52/53/55/56/57/59 + D3) with exact code,
  exact dictionary content ×3, and the runCardLoop freeze for Pass 4.
- Not implemented: application sources untouched; only this plan file
  (revision 3) was written.
