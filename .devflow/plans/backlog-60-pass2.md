# Backlog-60 Pass 2 — i18n Seam (executable plan)

> **Execution:** `run-conductor` executes this plan task-by-task after a
> `plan-auditor` `OKAY` verdict. Workers have ZERO interview history: everything
> needed is in this file. Master context: `.devflow/plans/backlog-60-master.md`
> (C1, C8, C11, C14, C15 bind this pass). Repo rules: `AGENTS.md`. Pass 1 trail:
> `.devflow/notes/backlog-60-pass1/decisions.md` (D-1..D-6) and
> `.devflow/evidence/backlog-60-pass1/verification.md`.

**Goal:** ship the panel i18n seam as ONE atomic vertical slice — trilingual
dictionaries (en/pt-BR/zh) with a manual panel language switch defaulting to the
host language, stable phase ids + key/label split, the static-test policy rework
(English-only ban → locale-key parity + structural t-usage gate), the VM-harness
locale extension, the npm-pack exact-content assertion + tarball token scan, and
the trilingual docs — all in the SAME commit.

**Architecture:** dictionaries live in `locale/*.json` under a new `panel` object
(canonical source) and are embedded verbatim in `client.js` (the module loader
cannot fetch package JSON — see 3.1); the client registers them with
`ctx.locale.register` and resolves panel strings through a single `t` (host
`bind(NS)` when following the host language, an embedded-dictionary lookup when a
manual override is set). An in-runner sync test proves registered faces ===
JSON panel sections; a sentinel-bind render gate proves every UI string flows
through `t`.

**Tech Stack:** Node >= 22 ESM, host `ctx.locale` service (register/addLanguage/
bind/getSnapshot/subscribe), React via host seed (createElement/useState/useEffect
only in the VM stub), `node:vm` harness, npm pack + tar for the pack assertion.

**Backlog items covered:** 38 (panel i18n en/pt-BR/zh + manual switch), 8 (locale
key parity — the English-only half is superseded by the user's i18n decision),
40-language-override seam (tab/density/legend prefs remain Pass 3), 6 (npm pack
exact assertion + tarball token scan — lands HERE because locale files change the
packed content; C14).

**Baseline (verified fresh this planning turn):** HEAD `fe4e508`, suite
`node scripts/test.mjs` → exit 0, `ALL TESTS PASSED`, **56 ok**. Pack dry-run →
**69 entries** (3.9). Locale files LF/no-BOM ✓.

---

## 1. Context (read before touching anything)

### 1.1 Current anchors (re-verified on disk at fe4e508 — Pass 1 shifted everything)

client.js (566 lines):
- PHASE_SECTIONS 13-17 (title-keyed), PHASE_TONE 19-24 (title keys), caches
  26-29 (rolesCache/catalogCache/effortsCache/lastServerTiming), string constants
  31-34 (INHERIT_LABEL, EFFORT_AUTO_LABEL, SAVE_NOTICE, UNCHANGED_NOTICE),
  statusTone 49-53 (word literals), groupRoles 131-151 (title-keyed sections),
  phaseOf 153, createSettings 155, load effect 169-233 (invalid banner 189-193),
  save 304-346 (409 text 339-341, notices 336), renderCard 353-462 (field
  labels/help 380/403/420, aria-labels 385/408/425/451/460, option labels
  400-442, effort error line 443, disabled label 454, Save/Saving 461),
  header 489-503 (title 491, counts title 492, count words 493-496, Refresh
  497-503), banners 504-513, legend 514-524 (timing line 524), tabs 469-473 +
  tablist 525-536, empty states 538-543, section render 544-549, slot
  registration 553-564 (inject ['slots'] 554, label 560, locale: NS 561).

scripts/test.mjs (2761 lines, 56 tests):
- `const source` 38 (module scope, Pass 1 hoist); FORBIDDEN_TOKENS 116-134;
  package-contract test 1904-1941 (exports deepEqual 1915, files deepEqual 1922);
  static contract test 1943-1960 (phase-title literals 1945-1947, Refresh 1948,
  SAVE_NOTICE literal 1951, PT_BR_WORD_RE ban 1956-1957, failsafe ban 1959);
  node --check array 1962-1967; LF/BOM array 1969-1975; mountVmClient 1977-2104
  (module scope; sandbox globals 1988-2009; require assert `dep === 'react'`
  2017; plugin.apply ctx = { slots } 2034-2045); collectText 2106, findNodes 2113;
  big VM test 2121-2446; N12 VM test 2448-2513 (SAVE_NOTICE render assertion
  2511); N17 XSS test 2515-2541; hygiene 2735; rename 2751; summary/exit
  2759-2761.

locale/en.json, locale/pt-BR.json, locale/zh.json: each holds ONLY
`meta.title` / `meta.description` / `meta.detail` ("docs/DETAIL.md"). The host
reads meta.* server-side for plugin listing/detail; extra top-level keys are
ignored by the host (verified: dsh-app-boot/src/package-meta.ts reads only
meta.title/meta.description; harness-semantics Q3).

### 1.2 Pass 1 lessons that bind this pass

- **Zero-narrative comments:** the git-commit skill's delivery sweep deleted 105
  diff-added comments. Shipped code in this pass carries NO comments; the why
  lives in this plan, the tests, and the docs. Catch blocks handle errors
  explicitly (return a fallback value), never empty, never comment-only.
- **Plan is read-only during execution;** live discoveries go to
  `.devflow/notes/backlog-60-pass2/`; contract defects STOP + escalate to lead.
- **Red/green discipline:** tests-first solo step, suite runs only at wave
  boundaries, green logs only under evidence (failure output carries absolute
  tmp paths), anti-flake 5×, no timing assertions.
- **N17 (C15/item 22) exists** at 2515-2541: markup/quotes fixtures render as
  text, zero HTML-injection props. It stays green through this pass (data
  strings are never translated) and is re-run as the C15 obligation.
- D-4/D-5/D-6 amended Pass 1 server contracts (no-op re-stat, redaction shapes).
  This pass does NOT touch index.js; never cite the stale pass-1 regexes.

### 1.3 Verified host locale contract (live-probed this turn; checkout-relative cites)

dsh-client-locale/src/client/index.ts:
- `register(ns, locale, dict)` untyped single-locale form (403-441): any namespace
  string, any BCP 47-style tag (`LOCALE_ID_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u`,
  locale-settings.ts:12 — 'pt-BR' accepted); duplicate (ns, locale) THROWS;
  returns an idempotent disposer; registration bumps the snapshot revision and
  notifies subscribers (no 'locale/change' event). The typed multi-locale form
  requires a namespace merged into LocaleNamespaceMap + both baseline locales —
  our NS is outside the merge table, so the untyped form is the correct one.
- `addLanguage({ id, label, fallback })` (276-298): fallback must already be
  registered; chain must terminate at 'en'; occupied id THROWS; returns an
  idempotent disposer. The host registers 'pt' (Português, fallback 'en') at boot
  (583-584); 'en'/'zh' are built-ins (119-125).
- `getSnapshot()` (228-230) → `{ active, locales: [{id,label,fallback?}], revision }`;
  `subscribe(fn)` (239-242) → returns unsubscribe; notified on EVERY snapshot
  change (switch or registration).
- `bind(ns)` untyped (459-468) → stable Translate fn reading the active locale at
  call time; `translate` (470-478): fallbackChain(active) lookup in ns, then
  common, then the key itself; params interpolate via `/\{(\w+)\}/g`.
- Browser detection (539-555): per browser tag, EXACT catalog match first, then
  primary subtag — a pt-BR browser matches a registered 'pt-BR' exactly before
  'pt' by primary. Without addLanguage('pt-BR'), active can never be 'pt-BR'.
- t-seat synthesis: dsh-client-ui-renderer/src/client/scoped-slots.tsx:604-613 —
  `locale: NS` on the slot registration synthesizes `kit.t = localeSeat(face, NS)`;
  a declared locale with no installed face is a loud assembly error (the web
  composition installs it: dsh-client-locale apply calls ctx.slots.installLocale).

dsh-client-modules serving rules (mechanism evidence):
- Client entry: classic script via `/plugins/??…` combo or `/plugins/<id>/client.js?rev=`.
- Chunks: ONLY `/plugins/<pkg>/client.<name>.js` siblings matching
  `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`, self-registering (harness-semantics Q2).
- Assets: ONLY `/plugins/<pkg>/assets/<path>` (index.ts:241 regex), resolved via
  the package's `./assets/*` export self-reference (index.ts:1214-1258); unexported
  paths 404; asset filenames carry content revisions written by a BUILD step
  (assets.ts:25-79). Our package has no `./assets/*` export and no build step.

## 2. Must Have / Must NOT Have (Pass 2)

Must have:
- ONE atomic commit: dictionaries + client i18n + harness extension + static
  reworks + parity/sync/t-gate/pack tests + docs together (C1/C8). No horizontal
  split of the seam.
- Frozen contracts (section 3) implemented EXACTLY: key list, dictionary values
  (byte-exact en), phase ids, signatures, test labels, red/green arithmetic.
  Contract defect → STOP + escalate; never silently deviate.
- Every existing test stays green except the DOCUMENTED rework RW1 (3.6); no
  assertion weakening beyond the user-approved English-only → i18n policy change.
- en dictionary values byte-identical to the current UI strings (the big VM test,
  N12 and N17 assert them verbatim — they must pass unchanged).
- Anti-flake 5×; evidence under `.devflow/evidence/backlog-60-pass2/`; green logs
  only; token-clean everywhere (hygiene scans ALL disk files incl. evidence).
- C15: N17 re-run green; new rendering interpolates data as string children only.

Must NOT have:
- No comments in shipped code (zero-narrative sweep; explicit catch fallbacks).
- No new fetch surface for dictionaries; no `./assets/*` export; no package.json
  change (exports/files stay byte-identical — the package-contract test 1904-1941
  stays green UNTOUCHED); no index.js change; no cordis.patch.yml change; no new
  runtime dependency; no build step.
- No new VM sandbox globals; no React hooks beyond createElement/useState/
  useEffect in client code; the require assert (`dep === 'react'`) stays
  byte-identical (mechanism (a) adds no requires — C8's "relaxed require"
  anticipation is NOT needed; recorded deviation, no weakening).
- No regex literal scan of client.js source for translatable strings (R-12);
  the t-gate is render-based (3.7/3.8 N3).
- No host-wide language write from the panel switch (the override is
  panel-scoped; ctx.locale.setLocale/configForms is NOT called — C11).
- No machine tokens, no backup-suffix literal, no old plugin identity in any
  file; repo-relative paths only; DSH cites checkout-relative.
- No localStorage durability claims beyond same-session (C11/R10); no prefs
  file in the agents root; no tab/density/legend prefs (Pass 3).
- No edits to installed role cards; no push; commit only via the git-commit skill.

## 3. Contract Freeze (binds ALL tasks; frozen BEFORE parallel work)

### 3.1 Dictionary mechanism — DECISION: (a) embedded + JSON parity

**Chosen (a):** panel dictionaries live in `locale/{en,pt-BR,zh}.json` under a new
top-level `panel` object (canonical source of truth, ships in the tarball, host
ignores non-meta keys) AND are embedded verbatim in client.js as `PANEL_DICTS`.
The client registers the embedded faces with `ctx.locale.register`. An in-runner
test (N2) mounts the module with a recording locale stub and deep-equals every
registered face against the JSON `panel` section; N1 cross-parities the three
JSON files. Drift is impossible to ship: the suite fails.

Why not (b) HTTP fetch: the host serves package files to the browser ONLY via
the client entry, self-registering `client.*.js` chunks, and `/assets/<path>`
resolved through a `./assets/*` export (1.3 cites). locale/*.json is not
browser-servable; enabling it would require a new public export + a
content-revisioned build layout we do not have + a package-contract test rework +
async load/failure states in the panel. Rejected: heavier, changes the public npm
contract, adds a fetch surface for zero benefit over (a).

Why not (c) client.locale.js chunk: the chunk protocol works (harness-semantics
Q2) but drags in C17's full weight — every client.js-only scanner extended to
siblings in the same slice, missing-chunk fallback design, combo-serving
interactions — for a payload that is pure data. Rejected for Pass 2; chunking
stays conditional on the Pass 4 size tripwire (C17). If the tripwire fires later,
PANEL_DICTS is the natural first chunk candidate (recorded).

Cost of (a): ~12 KB of embedded data in client.js (measured at delivery; the
Pass 5 size budget accounts for it). Editing rule (documented in README +
CONTRIBUTING later): edit the JSON `panel` first, mirror verbatim into
PANEL_DICTS; N1/N2 enforce equality.

### 3.2 Phase ids + key/label split (C8)

Stable ids replace English titles as structural keys everywhere:

```js
const PHASE_SECTIONS = [
  { id: 'discovery', ids: ['repo-scout', 'docs-scout', 'media-analyst', 'arch-advisor'] },
  { id: 'planning', ids: ['scope-analyst', 'planner', 'plan-auditor', 'run-conductor', 'implementer', 'debugger'] },
  { id: 'verification', ids: ['diff-reviewer', 'test-auditor', 'test-writer', 'browser-qa', 'error-auditor', 'security-auditor', 'perf-auditor', 'debt-auditor', 'docs-sync', 'tech-writer'] }
];
const PHASE_TONE = { discovery: '#4f8cff', planning: '#3ecf8e', verification: '#f59e0b', other: '#8fa3bd' };
```

- `groupRoles` pushes `{ id: phase.id, roles: items }`; the Other bucket is
  `{ id: 'other', roles: other }`. `phaseOf` returns the id or `'other'`.
- `tabs` = `[{ id: 'all', labelKey: 'tab.all', count: total }, ...PHASE_SECTIONS.map(p => ({ id: p.id, labelKey: 'phase.' + p.id, count: countOf(p.id) })), { id: 'other', labelKey: 'phase.other', count: countOf('other') }]`;
  `countOf(id)` looks up `section.id`; `visibleSections` filters by id;
  `activeTab` state holds ids ('all' default unchanged).
- Tab buttons render `t(tab.labelKey)`; section headers render
  `t('phase.' + section.id)` with `key: section.id` and
  `PHASE_TONE[section.id] ?? PHASE_TONE.other`; card phase dot uses
  `PHASE_TONE[phaseOf(role.id)] ?? PHASE_TONE.other`.
- `statusTone` returns `{ key, dot, background }` with keys 'status.disabled' /
  'status.inherit' / 'status.routed' (colors unchanged); the badge renders
  `t(tone.key)`.
- Rendered en text is byte-identical to today (dictionary values below), so the
  big VM test's label-based lookups keep working unchanged.

### 3.3 Dictionary schema + canonical content (72 keys; FROZEN)

Schema: flat `panel` object, dotted lowercase keys, string values, `{name}`
placeholders (host interpolation regex `/\{(\w+)\}/g`). The three JSON files keep
`meta` VERBATIM and gain `panel`. Full canonical content (T2 writes exactly this;
T1 embeds the panel objects verbatim):

locale/en.json:
```json
{
  "meta": {
    "title": "Orchestrator kit",
    "description": "DeepSeek Harness plugin that turns Settings into a control panel for AI agent teams: route provider, model and reasoning effort for each of the 20 Craft dev-flow roles (repo-scout, planner, implementer, diff-reviewer and 16 more), with fail-closed validation against the live provider catalog, atomic locked writes and per-role inherit defaults. Install via Plugins > Add plugin; configure in Settings > Orchestrator.",
    "detail": "docs/DETAIL.md"
  },
  "panel": {
    "nav.label": "Orchestrator",
    "header.title": "Role routing",
    "header.countsTitle": "Counts show saved state; card badges show the current draft.",
    "header.countRoles": " roles · ",
    "header.countRouted": " routed · ",
    "header.countInherit": " inherit · ",
    "header.countDisabled": " disabled",
    "refresh": "Refresh",
    "refresh.busy": "Refreshing…",
    "refresh.aria": "Refresh roles and catalog",
    "tab.all": "All roles",
    "phase.discovery": "Discovery & Advisory",
    "phase.planning": "Planning & Execution",
    "phase.verification": "Verification, QA & Docs",
    "phase.other": "Other",
    "tablist.aria": "Filter roles by phase",
    "status.routed": "Routed",
    "status.inherit": "Inherits chat",
    "status.disabled": "Disabled",
    "card.disabledSuffix": " (disabled)",
    "field.provider": "Provider",
    "field.providerHelp": "Which provider serves this role.",
    "field.providerAria": "Provider for {name}",
    "field.model": "Model",
    "field.modelHelp": "Which model this role runs on.",
    "field.modelAria": "Model for {name}",
    "field.effort": "Reasoning effort",
    "field.effortHelp": "How long the model thinks before answering.",
    "field.effortAria": "Reasoning effort for {name}",
    "inherit.label": "Chat default (inherit)",
    "effort.auto": "Auto (model default)",
    "effort.loading": "Loading levels…",
    "effort.unavailable": "Effort unavailable",
    "effort.default": "Default ({effort})",
    "effort.none": "No configurable levels",
    "effort.savedUnavailable": "{effort} (saved / unavailable)",
    "option.unavailable": "{name} (unavailable)",
    "option.withId": "{name} ({id})",
    "effort.errorLine": "Effort unavailable for this route: {error}",
    "disabled.label": "Disabled",
    "disabled.aria": "Disable {name}",
    "save": "Save",
    "save.busy": "Saving…",
    "save.aria": "Save {name} settings",
    "notice.saved": "Saved — applies on the next turn / next subagent_role.",
    "notice.unchanged": "Already up to date — nothing was written.",
    "error.conflict": "Conflict/validation error (409): {detail}. Click \"Refresh\" to reload the latest state before saving.",
    "banner.loadError": "Failed to load roles: {error}",
    "banner.catalogError": "Failed to load model catalog: {error}",
    "banner.invalidCards": "Some role cards have invalid frontmatter and cannot be edited here: {ids}.",
    "banner.partialCatalog": "Partial catalog: failed to list models for {providers}. Some routes may appear unavailable.",
    "banner.partialCatalogGeneric": "Partial catalog: one or more providers failed to list models; some routes may appear unavailable.",
    "banner.catalogEmpty": "The model catalog is unavailable right now; provider/model switching is disabled, but you can still toggle \"Disabled\".",
    "legend.summary": "What these settings do",
    "legend.provider": "Provider",
    "legend.providerText": " — which provider serves the role.",
    "legend.model": "Model",
    "legend.modelText": " — which model the role runs on.",
    "legend.effort": "Reasoning effort",
    "legend.effortText": " — how long the model thinks before answering.",
    "legend.disabled": "Disabled",
    "legend.disabledText": " — skip the role when dispatching work.",
    "legend.inherit": "Chat default (inherit)",
    "legend.inheritText": " — remove the route and follow the Lead.",
    "legend.subagent": "Members created with plain subagent always inherit the Lead.",
    "legend.apply": "Changes apply on the next turn / next subagent_role.",
    "legend.timing": "Server timing — roles: {reads} ms · catalog: {catalog} ms",
    "empty.loading": "Loading roles…",
    "empty.noRoles": "No role cards found in the agent roles directory.",
    "empty.noGroup": "No roles in this group yet. Add role cards to the agent roles directory to fill it.",
    "locale.auto": "Auto (host language)",
    "locale.aria": "Panel language"
  }
}
```

locale/pt-BR.json (meta verbatim from current file):
```json
{
  "meta": {
    "title": "Kit do Orchestrator",
    "description": "Painel de controle para rotear provider, model e reasoning effort por papel do time no pipeline dev-flow Craft de 20 papéis. UI de configurações validada sobre um catálogo de providers ao vivo, com escritas atômicas fail-closed.",
    "detail": "docs/DETAIL.md"
  },
  "panel": {
    "nav.label": "Orchestrator",
    "header.title": "Roteamento por papel",
    "header.countsTitle": "Os contadores mostram o estado salvo; os selos dos cartões mostram o rascunho atual.",
    "header.countRoles": " papéis · ",
    "header.countRouted": " roteados · ",
    "header.countInherit": " herdados · ",
    "header.countDisabled": " desativados",
    "refresh": "Atualizar",
    "refresh.busy": "Atualizando…",
    "refresh.aria": "Atualizar papéis e catálogo",
    "tab.all": "Todos os papéis",
    "phase.discovery": "Descoberta e Consultoria",
    "phase.planning": "Planejamento e Execução",
    "phase.verification": "Verificação, QA e Documentação",
    "phase.other": "Outros",
    "tablist.aria": "Filtrar papéis por fase",
    "status.routed": "Roteado",
    "status.inherit": "Herdado do chat",
    "status.disabled": "Desativado",
    "card.disabledSuffix": " (desativado)",
    "field.provider": "Provedor",
    "field.providerHelp": "Qual provedor atende este papel.",
    "field.providerAria": "Provedor de {name}",
    "field.model": "Modelo",
    "field.modelHelp": "Em qual modelo este papel executa.",
    "field.modelAria": "Modelo de {name}",
    "field.effort": "Esforço de raciocínio",
    "field.effortHelp": "Quanto tempo o modelo pensa antes de responder.",
    "field.effortAria": "Esforço de raciocínio de {name}",
    "inherit.label": "Padrão do chat (herdar)",
    "effort.auto": "Automático (padrão do modelo)",
    "effort.loading": "Carregando níveis…",
    "effort.unavailable": "Esforço indisponível",
    "effort.default": "Padrão ({effort})",
    "effort.none": "Sem níveis configuráveis",
    "effort.savedUnavailable": "{effort} (salvo / indisponível)",
    "option.unavailable": "{name} (indisponível)",
    "option.withId": "{name} ({id})",
    "effort.errorLine": "Esforço indisponível para esta rota: {error}",
    "disabled.label": "Desativado",
    "disabled.aria": "Desativar {name}",
    "save": "Salvar",
    "save.busy": "Salvando…",
    "save.aria": "Salvar configurações de {name}",
    "notice.saved": "Salvo — aplica no próximo turno / próximo subagent_role.",
    "notice.unchanged": "Já está atualizado — nada foi gravado.",
    "error.conflict": "Erro de conflito/validação (409): {detail}. Clique em \"Atualizar\" para recarregar o estado mais recente antes de salvar.",
    "banner.loadError": "Falha ao carregar papéis: {error}",
    "banner.catalogError": "Falha ao carregar o catálogo de modelos: {error}",
    "banner.invalidCards": "Alguns cartões de papel têm frontmatter inválido e não podem ser editados aqui: {ids}.",
    "banner.partialCatalog": "Catálogo parcial: falha ao listar modelos de {providers}. Algumas rotas podem parecer indisponíveis.",
    "banner.partialCatalogGeneric": "Catálogo parcial: um ou mais provedores falharam ao listar modelos; algumas rotas podem parecer indisponíveis.",
    "banner.catalogEmpty": "O catálogo de modelos está indisponível no momento; a troca de provedor/modelo está desativada, mas você ainda pode alternar \"Desativado\".",
    "legend.summary": "O que estas configurações fazem",
    "legend.provider": "Provedor",
    "legend.providerText": " — qual provedor atende o papel.",
    "legend.model": "Modelo",
    "legend.modelText": " — em qual modelo o papel executa.",
    "legend.effort": "Esforço de raciocínio",
    "legend.effortText": " — quanto tempo o modelo pensa antes de responder.",
    "legend.disabled": "Desativado",
    "legend.disabledText": " — ignora o papel ao despachar trabalho.",
    "legend.inherit": "Padrão do chat (herdar)",
    "legend.inheritText": " — remove a rota e segue o Lead.",
    "legend.subagent": "Membros criados com subagent simples sempre herdam o Lead.",
    "legend.apply": "As alterações aplicam no próximo turno / próximo subagent_role.",
    "legend.timing": "Tempos do servidor — papéis: {reads} ms · catálogo: {catalog} ms",
    "empty.loading": "Carregando papéis…",
    "empty.noRoles": "Nenhum cartão de papel encontrado no diretório de papéis do agente.",
    "empty.noGroup": "Ainda não há papéis neste grupo. Adicione cartões de papel ao diretório de papéis do agente para preenchê-lo.",
    "locale.auto": "Automático (idioma do host)",
    "locale.aria": "Idioma do painel"
  }
}
```

locale/zh.json (meta verbatim from current file):
```json
{
  "meta": {
    "title": "Orchestrator 套件",
    "description": "控制面板，为 20 角色 Craft dev-flow 流水线的每个团队角色配置 provider、model 与 reasoning effort 路由。经过验证的设置界面，基于实时 provider 目录，写入原子化且 fail-closed。",
    "detail": "docs/DETAIL.md"
  },
  "panel": {
    "nav.label": "Orchestrator",
    "header.title": "角色路由",
    "header.countsTitle": "计数显示已保存状态；卡片徽章显示当前草稿。",
    "header.countRoles": " 个角色 · ",
    "header.countRouted": " 已路由 · ",
    "header.countInherit": " 继承 · ",
    "header.countDisabled": " 已禁用",
    "refresh": "刷新",
    "refresh.busy": "正在刷新…",
    "refresh.aria": "刷新角色与目录",
    "tab.all": "全部角色",
    "phase.discovery": "发现与咨询",
    "phase.planning": "规划与执行",
    "phase.verification": "验证、QA 与文档",
    "phase.other": "其他",
    "tablist.aria": "按阶段筛选角色",
    "status.routed": "已路由",
    "status.inherit": "继承对话",
    "status.disabled": "已禁用",
    "card.disabledSuffix": "（已禁用）",
    "field.provider": "提供商",
    "field.providerHelp": "此角色由哪个提供商服务。",
    "field.providerAria": "{name} 的提供商",
    "field.model": "模型",
    "field.modelHelp": "此角色运行于哪个模型。",
    "field.modelAria": "{name} 的模型",
    "field.effort": "推理强度",
    "field.effortHelp": "模型在回答前思考多久。",
    "field.effortAria": "{name} 的推理强度",
    "inherit.label": "对话默认（继承）",
    "effort.auto": "自动（模型默认）",
    "effort.loading": "正在加载级别…",
    "effort.unavailable": "强度不可用",
    "effort.default": "默认（{effort}）",
    "effort.none": "无可配置级别",
    "effort.savedUnavailable": "{effort}（已保存 / 不可用）",
    "option.unavailable": "{name}（不可用）",
    "option.withId": "{name}（{id}）",
    "effort.errorLine": "此路由的强度不可用：{error}",
    "disabled.label": "已禁用",
    "disabled.aria": "禁用 {name}",
    "save": "保存",
    "save.busy": "正在保存…",
    "save.aria": "保存 {name} 的设置",
    "notice.saved": "已保存 — 于下一轮 / 下一次 subagent_role 生效。",
    "notice.unchanged": "已是最新 — 未写入任何内容。",
    "error.conflict": "冲突/验证错误（409）：{detail}。请点击\"刷新\"重新加载最新状态后再保存。",
    "banner.loadError": "加载角色失败：{error}",
    "banner.catalogError": "加载模型目录失败：{error}",
    "banner.invalidCards": "部分角色卡的 frontmatter 无效，无法在此编辑：{ids}。",
    "banner.partialCatalog": "目录不完整：列出 {providers} 的模型失败。部分路由可能显示为不可用。",
    "banner.partialCatalogGeneric": "目录不完整：一个或多个提供商列出模型失败；部分路由可能显示为不可用。",
    "banner.catalogEmpty": "模型目录当前不可用；提供商/模型切换已禁用，但您仍可切换\"已禁用\"。",
    "legend.summary": "这些设置的作用",
    "legend.provider": "提供商",
    "legend.providerText": " — 此角色由哪个提供商服务。",
    "legend.model": "模型",
    "legend.modelText": " — 此角色运行于哪个模型。",
    "legend.effort": "推理强度",
    "legend.effortText": " — 模型在回答前思考多久。",
    "legend.disabled": "已禁用",
    "legend.disabledText": " — 分派工作时跳过此角色。",
    "legend.inherit": "对话默认（继承）",
    "legend.inheritText": " — 移除路由并跟随 Lead。",
    "legend.subagent": "使用普通 subagent 创建的成员始终继承 Lead。",
    "legend.apply": "更改于下一轮 / 下一次 subagent_role 生效。",
    "legend.timing": "服务器计时 — 角色：{reads} ms · 目录：{catalog} ms",
    "empty.loading": "正在加载角色…",
    "empty.noRoles": "在代理角色目录中未找到角色卡。",
    "empty.noGroup": "此分组暂无角色。向代理角色目录添加角色卡以填充。",
    "locale.auto": "自动（宿主语言）",
    "locale.aria": "面板语言"
  }
}
```

NOT translated (structural constants / data, frozen):
- Language option self-labels: `LANGUAGE_OPTIONS = [['en', 'English'], ['pt-BR', 'Português (BR)'], ['zh', '简体中文']]`
  (proper nouns written in the represented language, mirroring the host's
  addLanguage labels).
- Route constants, style objects, the mount marker, phase ids, tab ids.
- Fetch-helper diagnostic strings ('Invalid JSON response (HTTP …)', 'HTTP …',
  'Invalid roles response: missing roles field', 'Invalid catalog response:
  missing groups field', 'Invalid efforts response: missing efforts field') stay
  English: they are technical error payloads rendered as {error}/{detail} DATA
  params inside translated templates, analogous to server error bodies. The
  t-gate treats them as data (3.8 N3 allowlist).
- Role names/descriptions, provider/model/effort ids and names, counts, '—'
  placeholder: DATA, never translated (C15: interpolated as string children).

### 3.4 Client implementation contract (client.js — exact code)

(a) Replace PHASE_SECTIONS/PHASE_TONE per 3.2. Delete the four string constants
INHERIT_LABEL/EFFORT_AUTO_LABEL/SAVE_NOTICE/UNCHANGED_NOTICE (their values live in
the dictionary now). Add after the caches:

```js
const PANEL_DICTS = {
  en: { /* en panel object from 3.3, verbatim */ },
  'pt-br': { /* pt-BR panel object from 3.3, verbatim */ },
  zh: { /* zh panel object from 3.3, verbatim */ }
};
PANEL_DICTS.pt = PANEL_DICTS['pt-br'];
const LANGUAGE_OPTIONS = [['en', 'English'], ['pt-BR', 'Português (BR)'], ['zh', '简体中文']];
const LOCALE_STORAGE_KEY = 'dsh-orchestrator-kit.locale';

const makeT = (locale) => (key, params) => {
  const dict = PANEL_DICTS[String(locale).toLowerCase()] ?? PANEL_DICTS.en;
  const template = dict[key] ?? PANEL_DICTS.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
};

function readStoredLocale() {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === 'en' || stored === 'pt-BR' || stored === 'zh' ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredLocale(value) {
  try {
    if (value === null) window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    else window.localStorage.setItem(LOCALE_STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

let localeOverride = readStoredLocale();
```

(b) `createSettings(ctx)`: add `const hostT = ctx.locale.bind(NS);` before the
component. Inside the component add:

```js
const [, setLocaleTick] = React.useState(0);
React.useEffect(() => ctx.locale.subscribe(() => setLocaleTick((n) => n + 1)), []);
const t = localeOverride === null ? hostT : makeT(localeOverride);
const onLocaleChange = (event) => {
  const value = event.target.value;
  localeOverride = value === '' ? null : value;
  writeStoredLocale(localeOverride);
  setLocaleTick((n) => n + 1);
};
```

Resolution semantics: no override → host `bind(NS)` (reads active at call time,
host fallback chain, registered faces); override → `makeT(override)` over the
embedded faces (lowercased lookup, en fallback, key last, identical {param}
interpolation). N2 guarantees registered === embedded === JSON, so both paths
render identically for the same locale. The host-synthesized `props.t` exists
(locale: NS stays declared) but the component binds directly so ONE code path
honors the override; re-render on host language change rides the subscribe tick
(and the host's own revision re-render in production).

(c) Language select — insert in the header row between the counts div and the
Refresh button (client.js:489-503 region):

```js
h('select', {
  value: localeOverride ?? '',
  onChange: onLocaleChange,
  style: { ...controlStyle, width: 'auto', flex: 'none' },
  'aria-label': t('locale.aria')
},
  h('option', { value: '' }, t('locale.auto')),
  LANGUAGE_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label)))
```

(d) Registration + nav label — replace the return block (553-564):

```js
return {
  inject: ['slots', 'locale'],
  apply(ctx) {
    const addLanguageOnce = () => {
      try {
        return ctx.locale.addLanguage({ id: 'pt-BR', label: 'Português (BR)', fallback: 'en' });
      } catch {
        return null;
      }
    };
    ctx.effect(() => {
      const disposers = [
        ctx.locale.register(NS, 'en', PANEL_DICTS.en),
        ctx.locale.register(NS, 'pt-BR', PANEL_DICTS['pt-br']),
        ctx.locale.register(NS, 'pt', PANEL_DICTS.pt),
        ctx.locale.register(NS, 'zh', PANEL_DICTS.zh),
        addLanguageOnce()
      ];
      return () => { for (const dispose of disposers) { if (dispose) dispose(); } };
    }, 'locale: panel dictionaries');
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: NS,
      order: 96,
      label: () => ctx.locale.bind(NS)('nav.label'),
      locale: NS
    }, createSettings(ctx)));
  }
};
```

addLanguage makes 'pt-BR' a first-class host language while the plugin is active
(exact browser-tag match beats 'pt' primary; the host Language row gains the
option; the ctx.effect disposer removes it on deactivation). The try/catch tolerates
an occupied id (another language pack registered it first) — panel functionality
never depends on addLanguage succeeding; the override path works regardless.
'pt' mirrors the pt-BR dictionary so generic-Portuguese host users get content
instead of the en fallback.

(e) Render-string replacement map (every component-composed UI string → t;
current anchors from 1.1; en values byte-identical):

| Current site | Replacement |
| --- | --- |
| statusTone words 49-53 | `{ key: 'status.disabled'/'status.inherit'/'status.routed', dot, background }`; badge renders `t(tone.key)` (377) |
| ' (disabled)' 376 | `t('card.disabledSuffix')` |
| 'Provider'/'Which provider serves this role.' 380 | `t('field.provider')`, `t('field.providerHelp')` |
| 'Provider for {name}' aria 385 | `t('field.providerAria', { name: role.name })` |
| INHERIT_LABEL options 400/417 | `t('inherit.label')` |
| '{provider} (unavailable)' 401 / '{model} (unavailable)' 418 | `t('option.unavailable', { name: draft.provider })` / `{ name: draft.model }` |
| model option `${name} (${id})` 419 | `model.name === model.id ? model.name : t('option.withId', { name: model.name, id: model.id })` |
| 'Model'/'Which model this role runs on.' 403 | `t('field.model')`, `t('field.modelHelp')` |
| 'Model for {name}' aria 408 | `t('field.modelAria', { name: role.name })` |
| 'Reasoning effort'/'How long the model thinks…' 420 | `t('field.effort')`, `t('field.effortHelp')` |
| 'Reasoning effort for {name}' aria 425 | `t('field.effortAria', { name: role.name })` |
| effort option ladder 428-439 | `t('effort.auto')` / `t('effort.loading')` / `t('effort.unavailable')` / `t('effort.default', { effort: effortEntry.defaultEffort })` / `t('effort.none')` / `t('effort.auto')` |
| '{effort} (saved / unavailable)' 440 | `t('effort.savedUnavailable', { effort: draft.reasoningEffort })` |
| effort option `${name} (${id})` 442 | `effort.name === effort.id ? effort.name : t('option.withId', { name: effort.name, id: effort.id })` |
| 'Effort unavailable for this route: …' 443 | `t('effort.errorLine', { error: effortEntry.error })` |
| 'Disabled' checkbox label 454 | `t('disabled.label')` |
| 'Disable {name}' aria 451 | `t('disabled.aria', { name: role.name })` |
| 'Saving…'/'Save' 461 | `t('save.busy')` / `t('save')` |
| 'Save {name} settings' aria 460 | `t('save.aria', { name: role.name })` |
| notices 336 | `t(unchanged ? 'notice.unchanged' : 'notice.saved')` |
| 409 text 339-341 | `t('error.conflict', { detail })` (non-409 stays raw `detail` data) |
| 'Role routing' 491 | `t('header.title')` |
| counts title 492 | `t('header.countsTitle')` |
| count words 493-496 | `t('header.countRoles')` / `t('header.countRouted')` / `t('header.countInherit')` / `t('header.countDisabled')` (numbers stay String(...) data children) |
| 'Refreshing…'/'Refresh' 503 | `t('refresh.busy')` / `t('refresh')` |
| 'Refresh roles and catalog' aria 502 | `t('refresh.aria')` |
| __load banner 201 | `t('banner.loadError', { error: String(error?.message ?? error) })` |
| __catalog banner 226 | `t('banner.catalogError', { error: String(error?.message ?? error) })` |
| __invalid banner 190 | `t('banner.invalidCards', { ids: invalidCards.map((card) => card.id).join(', ') })` |
| partial catalog 510-511 | `t('banner.partialCatalog', { providers: catalog.failedProviders.join(', ') })` / `t('banner.partialCatalogGeneric')` |
| catalog empty 513 | `t('banner.catalogEmpty')` |
| legend summary 515 | `t('legend.summary')` |
| legend entries 517-523 | term spans `t('legend.provider')` etc. + text `t('legend.providerText')` etc.; subagent/apply lines `t('legend.subagent')` / `t('legend.apply')` |
| timing line 524 | `t('legend.timing', { reads: lastServerTiming.reads ?? '—', catalog: lastServerTiming.catalog ?? '—' })` |
| tablist aria 525 | `t('tablist.aria')` |
| tab labels 469-473/536 | `t(tab.labelKey)` per 3.2 |
| empty states 539/541/543 | `t('empty.loading')` / `t('empty.noRoles')` / `t('empty.noGroup')` |
| section titles 547 | `t('phase.' + section.id)` |

The load-effect banners (201/226/190) and per-card save messages (336/342) store
{ key, params } instead of resolved text, and resolve through the CURRENT t at
RENDER time — so every banner/notice re-translates live on language switch with
no effect-deps churn:
`messages.__load = { kind: 'error', key: 'banner.loadError', params: { error: String(error?.message ?? error) } }`;
`__catalog` → 'banner.catalogError'; `__invalid` → 'banner.invalidCards' with
params { ids }; save success → `{ kind: 'ok', key: unchanged ? 'notice.unchanged' : 'notice.saved' }`;
409 → `{ kind: 'error', key: 'error.conflict', params: { detail } }`; non-409 →
`{ kind: 'error', key: 'error.raw', params: { detail } }`. Render:
`m.key === 'error.raw' ? m.params.detail : t(m.key, m.params)` ('error.raw' is a
structural marker for raw diagnostic data, NOT a dictionary key; the t-gate
allowlists raw detail as data). The effects themselves never call t.

### 3.5 VM harness extension (scripts/test.mjs — same commit, C8)

`mountVmClient(fetchHandler, options = {})` — backward compatible (existing
callers pass one arg). Additions:

```js
const storageMap = new Map();
const storageThrows = options.storage === 'throw';
const localeState = { active: options.active ?? 'en', revision: 0, registrations: [], languages: [], faces: new Map(), listeners: new Set() };
const notifyLocale = () => { localeState.revision += 1; for (const fn of [...localeState.listeners]) fn(); };
const lookupRegistered = (ns, key, params) => {
  let template;
  for (const locale of [localeState.active.toLowerCase(), 'en']) {
    const dict = localeState.faces.get(`${ns}:${locale}`);
    if (dict && dict[key] !== undefined) { template = dict[key]; break; }
  }
  if (template === undefined) template = key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
};
const boundFns = new Map();
const localeStub = {
  register(ns, locale, dict) {
    localeState.registrations.push({ ns, locale, dict });
    localeState.faces.set(`${ns}:${locale.toLowerCase()}`, dict);
    notifyLocale();
    return () => {};
  },
  addLanguage(input) {
    if (options.addLanguageThrows) throw new Error('language already registered');
    localeState.languages.push(input);
    notifyLocale();
    return () => {};
  },
  getSnapshot() {
    return { active: localeState.active, locales: [{ id: 'en', label: 'English' }, { id: 'zh', label: '中文' }, ...localeState.languages.map((l) => ({ id: l.id, label: l.label }))], revision: localeState.revision };
  },
  subscribe(fn) { localeState.listeners.add(fn); return () => { localeState.listeners.delete(fn); }; },
  setLocale(id) { localeState.active = id; notifyLocale(); },
  bind(ns) {
    if (options.sentinelBind) return (key) => `⟦${key}⟧`;
    if (!boundFns.has(ns)) boundFns.set(ns, (key, params) => lookupRegistered(ns, key, params));
    return boundFns.get(ns);
  }
};
```

- sandbox.window gains `localStorage: { getItem, setItem, removeItem }` backed by
  storageMap (each throws Error('storage disabled') when options.storage ===
  'throw'); getItem returns null for absent keys. NO other sandbox globals change.
- plugin.apply ctx becomes `{ slots: {…unchanged…}, locale: localeStub, effect(fn) { const dispose = fn(); pluginDisposers.push(dispose); return dispose; } }`
  (effect runs immediately, records disposers; pluginDisposers is a local array).
- The require assert `assert.equal(dep, 'react')` stays BYTE-IDENTICAL (no new
  requires in mechanism (a); recorded deviation from C8's anticipation).
- Return gains `locale: localeState, storage: storageMap` (existing destructures
  unaffected).
- Default options (active 'en', real lookup bind) make the big VM test, N12 and
  N17 pass UNCHANGED after implementation: registered en faces resolve to the
  byte-identical English strings they assert today.

### 3.6 Static contract rework RW1 (before/after — the ONLY existing-assertion change)

Test 'client.js static contract…' (1943-1960):
- REMOVE: phase-title literal includes ×4 (1945-1947), 'Refresh' include (1948),
  SAVE_NOTICE literal include (1951), PT_BR_WORD_RE ban (1956-1957). Rationale:
  user-approved policy change — translatable literals move to dictionaries;
  render-based gates (N3) + dictionary parity (N1/N2) + N12's SAVE_NOTICE render
  assertion (2511, unchanged) replace them. The pt-BR ban is incompatible with
  embedded pt-BR dictionaries by design.
- KEEP byte-identical: expectedMtimeMs include (1949), efforts route include
  (1950), mount marker (1952), spawn_teammate ban (1953), old-name bans
  (1954-1955, 1958), failsafe ban (1959).
- ADD (structural, green only after implementation):
  `assert.ok(clientText.includes("id: 'discovery'"))`, same for 'planning',
  'verification', 'other' (phase-id rekey); `assert.ok(clientText.includes('locale: NS'))`
  (slot locale declaration kept); `assert.ok(clientText.includes("inject: ['slots', 'locale']"))`.
- Before/after semantics for the auditor: no protection is dropped without a
  stronger replacement — literal presence → rendered-through-t coverage (N3) +
  dictionary content parity (N1/N2); English-only ban → trilingual parity (user
  decision). At HEAD the reworked test FAILS on the phase-id includes (expected
  rework-fail, counted in 3.8).

Also (additive, green at HEAD — verified LF/no-BOM this turn): append
'locale/en.json', 'locale/pt-BR.json', 'locale/zh.json' to the LF/BOM array
(1970). No other existing-test edits.

### 3.7 Structural t-usage gate design (N3; replaces regex literal scans, R-12)

Sentinel mode: `mountVmClient(handler, { sentinelBind: true })` — bind returns
`(key) => '⟦' + key + '⟧'`. With no override, every panel string resolves through
bind → every UI string renders as its sentinel key. The gate asserts TWO things
across a driven state matrix:
1. **No raw literals leak:** every text child and every aria-label/title prop
   value in every driven tree is either a sentinel (`⟦…⟧`) or a member of the
   EXACT allowed-data set built from the test's own fixture constants (role
   ids/names/descriptions, provider/model/effort ids/names, String(counts),
   LANGUAGE_OPTIONS self-labels, '—', and the empty string '' — the
   disabled-suffix ternary emits '' for non-disabled cards). No regex heuristics
   on source; the allowlist is exact fixture knowledge.
2. **Full key coverage:** the union of observed sentinel keys across all driven
   states ⊇ the frozen 72-key list (read from locale/en.json panel). Every
   dictionary key is proven to flow through t in at least one real render state.

Driven state matrix (frozen minimum; the test may add states):
- M1 default: 3 roles (routed planner w/ name+description, disabled inherit
  alpha-custom, inherit zeta-custom), catalog ok (Example Hub: flash-a 'Flash A',
  flash-b 'Flash B'), efforts ready defaultEffort 'medium' + [{id:'high',name:'High'}]
  → header.*, refresh(+aria), tab.all, phase.*×4, tablist.aria, status.*×3,
  card.disabledSuffix, field.*×9, inherit.label, effort.default, option.withId,
  disabled.label/aria, save(+aria), legend.* (except timing), locale.auto/aria;
  meta.label() === '⟦nav.label⟧'.
- M1 actions: save click → save.busy (renderCycle during await) then notice.saved;
  refresh click mid-inflight → refresh.busy; routeMode '409' → error.conflict;
  routeMode 'unchanged' → notice.unchanged.
- M1b: roles/catalog responses carry server-timing headers → legend.timing.
- M2 effort states: held promise → effort.loading; 503 → effort.unavailable +
  effort.errorLine; ready [] + defaultEffort null → effort.none + effort.auto;
  draft effort 'xhigh' absent from list → effort.savedUnavailable; draft provider
  'ghost' absent from catalog → option.unavailable.
- M3 empties: initial renderCycle (roles null) → empty.loading; roles [] →
  empty.noRoles; click a phase tab with no roles → empty.noGroup.
- M4 banners: roles 500 → banner.loadError; catalog 500 → banner.catalogError;
  invalid[] → banner.invalidCards; degraded + failedProviders ['ghost'] →
  banner.partialCatalog; degraded + [] → banner.partialCatalogGeneric;
  groups [] → banner.catalogEmpty.

Override path is gated semantically by N4 (real translated values from JSON).

### 3.8 Frozen test names + red/green arithmetic (against the 56-test suite)

New tests (5):

| ID | Exact label | Red at HEAD? |
| --- | --- | --- |
| P2-N1 | `locale parity: en/pt-BR/zh panel key sets identical, values non-empty, frozen 72-key schema, meta preserved` | YES (no panel section at HEAD) |
| P2-N2 | `locale registration: embedded dictionaries sync with locale JSON panel sections; pt mirrors pt-BR; addLanguage pt-BR; inject slots+locale` | YES (inject ['slots'], zero registrations at HEAD) |
| P2-N3 | `i18n structural gate: every panel string renders through t (sentinel bind) and all 72 keys are covered across driven states` | YES (no bind usage at HEAD) |
| P2-N4 | `panel language switch: override renders pt-BR/zh from dictionaries, Auto follows host, best-effort localStorage persists and restores, storage failure degrades to host language` | YES (no language select at HEAD) |
| P2-N5 | `npm pack: dry-run file list matches the frozen 69-entry contract and packed content passes the forbidden-token scan` | NO (guard — HEAD pack already matches; frozen from live probe) |

Rework (1): RW1 static contract (3.6) — FAILS at HEAD after rework (phase-id
includes absent). Reworks change expectation; they are not frozen-red new tests.

Red gate (T3 solo, HEAD sources + new tests/harness/rework): **61 total tests,
5 FAIL / 56 ok**, final line `5 TEST(S) FAILED`, exit 1. FAIL set = {P2-N1,
P2-N2, P2-N3, P2-N4, RW1 static label}. The other 55 existing tests + P2-N5 stay
green (harness extension is backward compatible; en values byte-identical).
Green gate (after implementation): **61 ok**, `ALL TESTS PASSED`, exit 0.

Required assertion minimums:
- **P2-N1:** parse the 3 JSON files; panel objects exist; key sets deep-equal
  each other AND the frozen 72-key list (embed the list in the test); every
  value a non-empty string; meta.title/description non-empty strings,
  meta.detail === 'docs/DETAIL.md' in all three; en panel values byte-equal the
  frozen en content (spot-anchor at least notice.saved, error.conflict,
  header.countRoles, legend.timing — full equality via the embedded list).
- **P2-N2:** mountVmClient with recording stub; plugin.inject deepEqual
  ['slots', 'locale']; registrations: exactly 4 faces for NS with locales
  en/pt-BR/pt/zh; each dict deep-equals the corresponding JSON panel (pt ===
  pt-BR panel); languages recorded includes { id:'pt-BR', label:'Português (BR)',
  fallback:'en' }; options.addLanguageThrows variant → still 4 registrations,
  panel mounts and renders (degradation proof).
- **P2-N3:** per 3.7 (both assertions, full matrix, exact allowlist).
- **P2-N4:** default stub active 'en'; find the select by aria-label
  t('locale.aria') (en 'Panel language'); onChange 'pt-BR' → header title ===
  pt-BR JSON panel['header.title'], save button === panel['save'], first phase
  tab === panel['phase.discovery']; storage map holds
  'dsh-orchestrator-kit.locale' → 'pt-BR'; a fresh mountInstance on the SAME vm
  restores pt-BR (module-level override + storage); onChange '' → English
  returns + storage key removed; stub.setLocale('zh') + renderCycle → Auto
  follows host (zh strings); onChange 'zh' → zh strings; options.storage
  'throw' variant → panel renders English, no crash, override stays null.
- **P2-N5:** per 3.9.

### 3.9 Pack assertion mechanics (item 6; frozen from live probe at HEAD)

- `spawnSync('npm pack --dry-run', { cwd: packageDir, encoding: 'utf8', shell: true })`
  — single-string command form (no args array: avoids Node's DEP0190 args+shell
  warning; fixed literal, no injection surface; shell:true is required for
  npm.cmd on Windows post-BatBadBut). Append ` --json` for the list assertion.
  Parse stdout JSON; assert status 0; `parsed[0].filename === PKG.name + '-' + PKG.version + '.tgz'`;
  `parsed[0].entryCount === 69`; sorted `parsed[0].files.map(f => f.path)`
  deep-equals FROZEN_PACK_FILES (below).
- Real pack + content scan: `mkdtempSync(path.join(tmpdir(), 'pack-scan-'))`;
  `spawnSync('npm pack --pack-destination ' + JSON.stringify(tmp), { cwd: packageDir, encoding: 'utf8', shell: true })`
  → tgz path (JSON.stringify quotes the destination safely for cmd/sh);
  `spawnSync('tar', ['-xzf', tgz, '-C', tmp], …)` (tar is a real executable on
  Windows 10+ and CI — no shell needed); walk `tmp/package` recursively; relative
  path set deep-equals FROZEN_PACK_FILES; EVERY extracted file scanned
  case-insensitively for the split-built FORBIDDEN_TOKENS + the backup-suffix
  literal (same constants the hygiene test uses); packed package.json parses and
  name/version equal PKG; rmSync tmp in finally. No tarball ever lands in the repo.
- The frozen list is the OBSERVED pack output (npm auto-includes README variants
  beyond the files whitelist — a naive whitelist expansion would be wrong). Any
  future pass changing the packed file list updates FROZEN_PACK_FILES in the SAME
  commit (C1/C14).

FROZEN_PACK_FILES (69, sorted):
```
CHANGELOG.md
client.js
cordis.patch.yml
craft/agents/arch-advisor.md
craft/agents/browser-qa.md
craft/agents/debt-auditor.md
craft/agents/debugger.md
craft/agents/diff-reviewer.md
craft/agents/docs-scout.md
craft/agents/docs-sync.md
craft/agents/error-auditor.md
craft/agents/implementer.md
craft/agents/media-analyst.md
craft/agents/perf-auditor.md
craft/agents/plan-auditor.md
craft/agents/planner.md
craft/agents/repo-scout.md
craft/agents/run-conductor.md
craft/agents/scope-analyst.md
craft/agents/security-auditor.md
craft/agents/tech-writer.md
craft/agents/test-auditor.md
craft/agents/test-writer.md
craft/README.md
craft/skills/dev-flow/agents/arch-advisor.md
craft/skills/dev-flow/agents/browser-qa.md
craft/skills/dev-flow/agents/debt-auditor.md
craft/skills/dev-flow/agents/debugger.md
craft/skills/dev-flow/agents/diff-reviewer.md
craft/skills/dev-flow/agents/docs-scout.md
craft/skills/dev-flow/agents/docs-sync.md
craft/skills/dev-flow/agents/error-auditor.md
craft/skills/dev-flow/agents/implementer.md
craft/skills/dev-flow/agents/media-analyst.md
craft/skills/dev-flow/agents/perf-auditor.md
craft/skills/dev-flow/agents/plan-auditor.md
craft/skills/dev-flow/agents/planner.md
craft/skills/dev-flow/agents/repo-scout.md
craft/skills/dev-flow/agents/run-conductor.md
craft/skills/dev-flow/agents/scope-analyst.md
craft/skills/dev-flow/agents/security-auditor.md
craft/skills/dev-flow/agents/tech-writer.md
craft/skills/dev-flow/agents/test-auditor.md
craft/skills/dev-flow/agents/test-writer.md
craft/skills/dev-flow/playbooks/ai-estimates.md
craft/skills/dev-flow/playbooks/clonedeps.md
craft/skills/dev-flow/playbooks/codemap.md
craft/skills/dev-flow/playbooks/codemap/scripts/codemap.mjs
craft/skills/dev-flow/playbooks/deanchor.md
craft/skills/dev-flow/playbooks/deepwork.md
craft/skills/dev-flow/playbooks/reflect.md
craft/skills/dev-flow/playbooks/simplify.md
craft/skills/dev-flow/playbooks/step-back.md
craft/skills/dev-flow/playbooks/verification-planning.md
craft/skills/dev-flow/SKILL.md
docs/DETAIL.md
docs/preview.svg
docs/showcase.svg
icon.svg
index.js
LICENSE
locale/en.json
locale/pt-BR.json
locale/zh.json
package.json
README.md
README.pt-BR.md
README.zh-CN.md
scripts/test.mjs
```

## 4. Per-task contracts

Wave layout (shared checkout, no locks; suite runs ONLY at wave boundaries;
the i18n commit is ATOMIC — all tasks ride ONE commit):

```
Step 0 (solo):  T3 tests+harness+rework ── red evidence (5 FAIL / 56 ok)
Wave 1 (∥):     T1 client.js   |   T2 locale/*.json   |   T4 docs      (disjoint)
Wave 2 (solo):  I1 integration green (61 ok) → I2 anti-flake 5x + evidence
Wave 3 (lead):  review loop + live-host smoke + git-commit (section 6)
```

Write scopes 100% disjoint: T3={scripts/test.mjs}, T1={client.js},
T2={locale/en.json, locale/pt-BR.json, locale/zh.json}, T4={README.md,
README.pt-BR.md, README.zh-CN.md, CHANGELOG.md}, I2={.devflow/evidence/backlog-60-pass2/}.

---

### T3 — Tests + harness + rework (test-writer; Step 0, solo)

**Parallelizable:** no — runs alone BEFORE Wave 1 so the red run sees HEAD sources.
**Write scope:** `scripts/test.mjs` ONLY.
**References:** 1.1 anchors; 3.5 harness code; 3.6 rework; 3.7 gate design;
3.8 labels/assertions; 3.9 pack mechanics + frozen list.

**What to do:**
1. Extend mountVmClient per 3.5 (options, locale stub, effect stub, localStorage,
   extended return). Keep the require assert and sandbox globals byte-identical.
2. Apply RW1 (3.6) exactly; append locale files to the LF/BOM array (3.6).
3. Append P2-N1…P2-N5 (exact labels 3.8) after N17 (2541), before the codemap
   test. P2-N3 implements the full 3.7 matrix; P2-N5 embeds FROZEN_PACK_FILES
   (3.9) and uses the split-built token constants already in the file.
4. No static imports of new exports (none exist); no timing assertions; fixtures
   token-clean; pure LF/no BOM.

**Must NOT do:** touch client.js/locale/docs; weaken any existing assertion
beyond RW1's documented removals; change the require assert; add sandbox globals;
use regex literal scans of client.js source for translatable strings.

**Verify (observable):**
```
node --check scripts/test.mjs
```
→ exit 0. Then:
```
node scripts/test.mjs
```
→ exit 1; final line `5 TEST(S) FAILED`; exactly 5 FAIL labels (P2-N1..N4 + the
static contract label); 56 ok lines. Cross-check:
```
node scripts/test.mjs 2>&1 | Select-String -Pattern '^FAIL ' -CaseSensitive
```
→ exactly those 5 lines. Report the FAIL label list as red evidence (never save
raw failure output — absolute tmp paths). If the count differs, STOP and
reconcile before Wave 1.

---

### T1 — Client i18n (implementer; Wave 1, parallel)

**Parallelizable:** yes (with T2, T4). **Write scope:** `client.js` ONLY.
**References:** 3.2 (phase rekey), 3.3 (dictionary content — embed verbatim),
3.4 (exact code + replacement map), 1.1 anchors.

**What to do:** implement 3.2 + 3.4 exactly: phase ids/tone/groupRoles/tabs
rekey; PANEL_DICTS (en/pt-br/zh verbatim from 3.3; pt alias); makeT/storage/
override; hostT + subscribe tick + t selection; language select; registration
block + inject + nav label; EVERY replacement in the 3.4(e) map including the
message-as-{key,params} banner form. Delete the four moved string constants.
No comments anywhere in the diff.

**Must NOT do:** new globals/hooks; new requires; new route literals (the
route-surface test counts 4+4); package.json/index.js/locale/docs edits;
host-wide setLocale/configForms calls; innerHTML/eval; translate data strings
(role/catalog/effort names); change en dictionary values by even one byte;
localStorage durability claims; tab/density prefs.

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
Select-String -Path client.js -Pattern "id: 'discovery'","inject: \['slots', 'locale'\]",'locale: NS' -CaseSensitive
```
→ 3 matching lines. Report completion + outputs.

---

### T2 — Locale dictionaries (implementer or tech-writer; Wave 1, parallel)

**Parallelizable:** yes (with T1, T4). **Write scope:** `locale/en.json`,
`locale/pt-BR.json`, `locale/zh.json` ONLY.
**References:** 3.3 canonical content (write EXACTLY those three files).

**What to do:** replace each file with the frozen 3.3 content — meta VERBATIM
from the current file, panel object verbatim from the plan. Pure LF, no BOM,
valid JSON, 72 panel keys each.

**Must NOT do:** change meta values; add/remove keys beyond the frozen schema;
translate into other languages; touch any other file; introduce machine tokens
(the translations are token-clean by construction — keep them verbatim).

**Verify (observable):**
```
node -e "const fs=require('fs');const files=['locale/en.json','locale/pt-BR.json','locale/zh.json'];const sets=files.map(f=>{const j=JSON.parse(fs.readFileSync(f,'utf8'));if(!j.meta||!j.meta.title||!j.meta.description||j.meta.detail!=='docs/DETAIL.md')throw new Error(f+' meta broken');const keys=Object.keys(j.panel).sort();if(keys.length!==72)throw new Error(f+' key count '+keys.length);for(const k of keys){if(typeof j.panel[k]!=='string'||j.panel[k].trim()==='')throw new Error(f+' empty value '+k);}return JSON.stringify(keys);});if(sets[0]!==sets[1]||sets[0]!==sets[2])throw new Error('key sets diverge');console.log('locale parity OK: 72 keys x 3');"
```
→ `locale parity OK: 72 keys x 3`, exit 0. LF/BOM:
```
node -e "const fs=require('fs');for(const f of ['locale/en.json','locale/pt-BR.json','locale/zh.json']){const b=fs.readFileSync(f);if(b.subarray(0,3).equals(Buffer.from([0xEF,0xBB,0xBF]))||b.toString('utf8').includes('\r\n'))throw new Error(f+' BOM/CRLF');}console.log('locale LF/no-BOM OK');"
```
→ exit 0. Report completion + outputs.

---

### T4 — Docs (tech-writer or docs-sync; Wave 1, parallel)

**Parallelizable:** yes (with T1, T2). **Write scope:** `README.md`,
`README.pt-BR.md`, `README.zh-CN.md`, `CHANGELOG.md` ONLY.
**References:** README.md:54-73 (Configure area), 112-127 (FAQ); CHANGELOG.md
[Unreleased]; Pass 1 T4 parity snippet (structural: heading levels + fence
count + table rows — translated prose is NOT compared).

**What to do (three READMEs structurally identical; translate prose, keep
markers/paths/identifiers verbatim):**
1. Configure per role area: document the panel language — follows the harness
   language by default; a header select switches the panel between Auto (host
   language), English, Português (BR) and 简体中文; the choice is remembered for
   the browser session (best-effort localStorage; on Desktop the local origin
   port can change between app restarts, so the override may not survive an app
   restart — same-session semantics, no durability claim).
2. FAQ: add "Which languages does the panel support?" (en/pt-BR/zh; host
   language default; manual switch; role/card/catalog names are data and stay
   as-is) and "How do I add or fix a translation?" (edit locale/<lang>.json
   panel, mirror into client.js PANEL_DICTS; the suite enforces parity).
3. CHANGELOG [Unreleased]: Added — panel i18n en/pt-BR/zh with manual switch
   defaulting to the host language; locale key parity + registered-dictionary
   sync tests; structural t-usage gate; npm pack exact-content assertion +
   tarball token scan. Changed — panel strings resolve through the locale
   system; the English-only test policy is replaced by trilingual parity (user
   decision). Do not touch [0.1.0].

**Must NOT do:** machine tokens; backup-suffix literal; invented
credentials/models; structural divergence between READMEs; SECURITY.md /
CONTRIBUTING.md / docs/ edits (later passes); source/test edits; durability
claims beyond same-session.

**Verify (observable):** structural parity (Pass 1 snippet, re-verified green at
HEAD this turn):
```
node -e "const fs=require('fs');const shape=f=>{const t=fs.readFileSync(f,'utf8');return JSON.stringify({levels:(t.match(/^#{1,6} .*$/gm)||[]).map(x=>x.match(/^#+/)[0].length),fences:(t.match(/^```/gm)||[]).length,rows:(t.match(/^\|.*\|$/gm)||[]).length});};const a=shape('README.md'),b=shape('README.pt-BR.md'),c=shape('README.zh-CN.md');if(a!==b||a!==c){console.error('README parity diverged');process.exit(1);}console.log('README parity OK');"
```
→ `README parity OK`, exit 0. Token self-scan on the four docs (split-built
list, Pass 1 T4 snippet) → exit 0. Report completion + outputs.

---

### I1 — Integration green (run-conductor or one implementer; Wave 2, solo)

**Parallelizable:** no — single owner. **Write scope:** any of {client.js,
locale/*.json, scripts/test.mjs, READMEs, CHANGELOG} for FIXES only.
**References:** section 3 contracts; T1–T4 reports.

**What to do:** run the suite; expected first run 61 ok. Failures → reconcile
against the FROZEN contracts (contract wins; fix the deviating side; never weaken
assertions). Typical reconciliation risks: en dictionary byte-drift (big VM test
/ N12 / N17 fail → fix the dictionary/embedded copy, NOT the tests); message
{key,params} form missed at one banner site (N3 allowlist fail → fix the site);
pt alias missing (N2 fail). Contract defect → STOP + escalate. Then node --check
×3.

**Verify (observable):**
```
node scripts/test.mjs
```
→ exit 0, `ALL TESTS PASSED`, 61 ok, zero FAIL.
```
node --check index.js; node --check client.js; node --check scripts/test.mjs
```
→ all exit 0.

---

### I2 — Anti-flake + evidence (same owner; Wave 2, after I1)

**Parallelizable:** no. **Write scope:** `.devflow/evidence/backlog-60-pass2/` ONLY.

**What to do:** 5 consecutive green full-suite runs (P2-N5 adds ~5-10s of npm
pack per run — deterministic, no timing assertions); any failure → I1, delete
the failed log, restart the sequence. Write verification.md (token-clean).

**Verify (observable):**
```
New-Item -ItemType Directory -Force -Path .devflow/evidence/backlog-60-pass2 | Out-Null
$ok = 0
for ($i = 1; $i -le 5; $i++) {
  node scripts/test.mjs *> ".devflow/evidence/backlog-60-pass2/test-run-$i.log"
  if ($LASTEXITCODE -eq 0) { $ok++ } else { break }
}
"green runs: $ok/5"
```
→ `green runs: 5/5`; each log ends `ALL TESTS PASSED` with exactly 61 ok lines
(`Get-Content .devflow/evidence/backlog-60-pass2/test-run-*.log -Tail 1`).
node-check log (Pass 1 I2 pattern) → three `exit 0` lines. verification.md:
date, commands, red→green (5 FAIL labels → 61 ok), 5/5, new-test list, rework
before/after summary (3.6), placeholders for review scores + live-smoke record
(lead fills). Token-scan every evidence file (Pass 1 snippet extended).

## 5. Verification strategy (summary)

- Canonical: `node scripts/test.mjs` → exit 0 + `ALL TESTS PASSED`, fresh output
  read in-turn at every gate. Red gate: 5 FAIL / 56 ok (61 total). Green: 61 ok.
- Anti-flake: 5 consecutive green runs, logs under
  `.devflow/evidence/backlog-60-pass2/test-run-<i>.log` (green only).
- Syntax: node --check ×3 (also in-suite). LF/BOM array now covers locale JSON.
- Static invariants re-checked by the suite: route surface 4+4, package contract
  UNTOUCHED, mount marker, old-identity/failsafe bans, hygiene tokens, phase-id
  structural includes (RW1).
- New coverage: JSON parity + frozen schema (N1), registered↔JSON sync + inject
  + addLanguage + degradation (N2), structural t-gate full 72-key matrix (N3),
  override/host-follow/persistence/storage-failure (N4), pack exact list +
  tarball token scan (N5). C15: N17 re-run green every run.
- No timing assertions; npm pack runtime is the only deliberate slow path.

## 6. Post-parallel & final gates (lead-owned, in order)

1. Adversarial verification workflow (feature lenses: contracts/API surface,
   error paths, test sufficiency, performance/maintainability, docs accuracy;
   no new trust boundary — dictionaries are shipped constants, localStorage is
   same-origin best-effort; security lens optional at lead discretion). Confirmed
   findings → fix list → re-run I1/I2.
2. Review loop: diff-reviewer 1-10, fix Critical/Important, min 2 loops max 4,
   gate >= 8/10 (dev-flow clean-exit breaker). Re-verify after fixes.
3. **Live-host smoke (C8, one documented check):** browser-qa against the real
   panel at the CURRENT DSH Web GUI URL from the runtime context (do not hardcode
   a port in any repo file). Steps: open Settings → Orchestrator; verify the
   panel renders in the host language; switch the panel select to Português (BR)
   → verify translated header/tabs/fields/buttons; switch to 简体中文 → verify;
   back to Auto → host language returns; reload the page → override restored
   (same session). Evidence: screenshot(s) + notes under
   `.devflow/evidence/backlog-60-pass2/` (token-clean; panel content only). If the
   GUI is unreachable, record the blocker and the exact manual steps for the
   human — never fake the smoke.
4. Docs reconciliation: README trilingual structural parity, CHANGELOG accuracy
   vs the diff, language-switch semantics match C11 (same-session).
5. TEST VERIFICATION GATE audit: every new behavior has a failing-mode test
   (red proofs captured); evidence complete + token-clean; tests + logs ride the
   commit.
6. Delivery: ONE atomic commit via the `git-commit` skill (owns diff analysis,
   zero-narrative comment sweep — this plan's code carries no comments by design,
   whitespace, checks, staging, Conventional Commits message). Suggested shape:
   `feat(panel): trilingual panel i18n with manual language switch (backlog-60 pass 2)`
   — the skill owns final wording. NO push.
7. Update `.devflow/runs/backlog-60/progress.md` (token-clean) + consolidated
   report: what shipped, commands + results, review scores, smoke record,
   remaining risks (embedded-dictionary duplication enforced by tests; banner
   messages stored as keys; addLanguage global side effect documented; client.js
   size growth measured for the Pass 5 budget), next-pass readiness.

## 7. Known behavior changes (for docs accuracy & review)

1. Panel renders in the host language by default (en/pt-BR/zh faces; other host
   languages fall back to English for panel strings). 'pt-BR' becomes a
   selectable host language while the plugin is active (addLanguage; disposer on
   deactivation); generic 'pt' resolves to the pt-BR dictionary.
2. Header language select: Auto (host) / English / Português (BR) / 简体中文;
   panel-scoped override, best-effort localStorage, same-session semantics;
   storage failure degrades silently to host language.
3. All panel labels/badges/notices/banners/legend/empty-states flow through t;
   banners store {key,params} and re-translate live on switch. Role/catalog/
   effort names and counts remain data (untranslated, text-only rendering).
4. Phase tabs/sections keyed by stable ids (discovery/planning/verification/
   other); rendered English text unchanged.
5. English-only test policy replaced by: JSON key parity + registered-dictionary
   sync + structural t-usage gate (user-approved).
6. Suite gains the npm-pack exact-content + tarball token-scan guard (69 entries
   frozen; future file-list changes update it in the same commit).

## 8. Out of scope (later passes — do not smuggle in)

Tab/density/legend prefs + draft hoisting + undo + error-action buttons (P3);
batch/profiles/audit/diagnostics/readonly/installer (P4); coverage/size-budget/
docs-parity.mjs/link-check/CONTRIBUTING glossary (P5); chunking (conditional P4
tripwire); any server/index.js change; package.json exports/files changes; new
fetch surfaces; host-wide language writes from the panel.