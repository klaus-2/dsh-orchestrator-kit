window.__ModuleLoader__.load({
  id: 'dsh-orchestrator-kit',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-orchestrator-kit';
    const ROLES_ROUTE = '/api/dsh-orchestrator-kit.roles';
    const CATALOG_ROUTE = '/api/dsh-orchestrator-kit.catalog';
    const EFFORTS_ROUTE = '/api/dsh-orchestrator-kit.efforts';
    const ROUTE_ROUTE = '/api/dsh-orchestrator-kit.route';

    const PHASE_SECTIONS = [
      { title: 'Discovery & Advisory', ids: ['repo-scout', 'docs-scout', 'media-analyst', 'arch-advisor'] },
      { title: 'Planning & Execution', ids: ['scope-analyst', 'planner', 'plan-auditor', 'run-conductor', 'implementer', 'debugger'] },
      { title: 'Verification, QA & Docs', ids: ['diff-reviewer', 'test-auditor', 'test-writer', 'browser-qa', 'error-auditor', 'security-auditor', 'perf-auditor', 'debt-auditor', 'docs-sync', 'tech-writer'] }
    ];

    const PHASE_TONE = {
      'Discovery & Advisory': '#4f8cff',
      'Planning & Execution': '#3ecf8e',
      'Verification, QA & Docs': '#f59e0b',
      'Other': '#8fa3bd'
    };

    let rolesCache = null;
    let catalogCache = null;
    let effortsCache = new Map();
    let lastServerTiming = null;

    const INHERIT_LABEL = 'Chat default (inherit)';
    const EFFORT_AUTO_LABEL = 'Auto (model default)';
    const SAVE_NOTICE = 'Saved — applies on the next turn / next subagent_role.';
    const UNCHANGED_NOTICE = 'Already up to date — nothing was written.';
    const SURFACE_TINT = 'rgba(127,127,127,0.08)';
    const controlStyle = { background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 8, fontSize: 13, width: '100%', minWidth: 0 };
    const buttonStyle = { background: 'none', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '8px 12px', color: 'var(--dsw-alias-label-primary)', fontSize: 12, fontWeight: 500, cursor: 'pointer' };
    const primaryButtonStyle = { ...buttonStyle, background: 'var(--dsw-alias-button-primary-fill, #2563eb)', border: '1px solid var(--dsw-alias-button-primary-fill, #2563eb)', color: 'var(--dsw-alias-label-primary-inverted, #ffffff)' };
    const cardStyle = { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: 16, background: 'var(--dsw-alias-bg-base)', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 };
    const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 12, alignItems: 'stretch' };
    const fieldLabelStyle = { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)', marginBottom: 4 };
    const fieldHelpStyle = { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4, lineHeight: '16px' };
    const sectionTitleStyle = { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' };
    const legendStyle = { background: SURFACE_TINT, borderRadius: 8, padding: 12, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: '18px' };
    const legendTermStyle = { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' };
    const tabRowStyle = { display: 'flex', flexWrap: 'wrap', gap: 4, background: SURFACE_TINT, borderRadius: 8, padding: 4 };
    const tabStyle = (active) => ({ border: 'none', borderRadius: 4, padding: '8px 12px', fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer', background: active ? 'var(--dsw-alias-bg-base)' : 'transparent', color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)' });
    const dotStyle = (color) => ({ width: 6, height: 6, borderRadius: 999, background: color, flex: 'none' });
    const statusTone = (disabled, isInherit) => (disabled
      ? { word: 'Disabled', dot: 'var(--dsw-alias-state-error-primary, #ef4444)', background: 'rgba(239,68,68,0.12)' }
      : isInherit
        ? { word: 'Inherits chat', dot: 'var(--dsw-alias-label-secondary)', background: 'rgba(127,127,127,0.12)' }
        : { word: 'Routed', dot: 'var(--dsw-alias-state-success-primary, #22c55e)', background: 'rgba(34,197,94,0.12)' });
    const statusBadgeStyle = (tone) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 500, background: tone.background, color: 'var(--dsw-alias-label-primary)', flex: 'none' });
    const statStyle = { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' };
    const bannerStyle = (kind) => ({ fontSize: 12, borderRadius: 8, padding: '8px 12px', color: 'var(--dsw-alias-label-primary)', background: kind === 'error' ? 'rgba(239,68,68,0.10)' : kind === 'warning' ? 'rgba(245,158,11,0.10)' : SURFACE_TINT });

    const effortKeyOf = (provider, model) => JSON.stringify([provider, model]);

    async function parseApiResponse(response, requireOkTrue = false) {
      let data = null;
      let invalidJson = false;
      try {
        data = await response.json();
      } catch {
        invalidJson = true;
      }
      if (!response.ok) {
        const error = new Error(data?.error ?? `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      if (invalidJson || data === null || typeof data !== 'object' || Array.isArray(data)) {
        const error = new Error(`Invalid JSON response (HTTP ${response.status})`);
        error.status = 502;
        throw error;
      }
      if (requireOkTrue ? data.ok !== true : data.ok === false) {
        const error = new Error(data.error ?? `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    }

    async function fetchJson(url) {
      const response = await fetch(url, { cache: 'no-store' });
      const timing = response.headers.get('server-timing');
      if (typeof timing === 'string') {
        for (const [, metric, dur] of timing.matchAll(/([A-Za-z0-9_-]+);dur=([0-9]+(?:\.[0-9]+)?)/g)) {
          if (metric === 'reads' || metric === 'catalog') {
            lastServerTiming = { ...(lastServerTiming ?? {}), [metric]: Number(dur) };
          }
        }
      }
      return parseApiResponse(response, false);
    }

    async function postSettings(payload) {
      const response = await fetch(ROUTE_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await parseApiResponse(response, true);
      return { role: data.role, unchanged: data.unchanged === true };
    }

    const normalizeDraft = (role) => ({
      provider: role.provider ?? '',
      model: role.model === 'inherit' ? '' : (role.model ?? ''),
      reasoningEffort: role.reasoningEffort ?? '',
      disabled: role.disabled === true
    });

    function evaluateDraftState(draft, base, catalogEmpty) {
      const routeDirty = draft.provider !== base.provider || draft.model !== base.model;
      const effortDirty = draft.reasoningEffort !== base.reasoningEffort;
      const disabledDirty = draft.disabled !== base.disabled;
      const dirty = routeDirty || effortDirty || disabledDirty;
      const isInherit = draft.provider === '' || draft.model === '';
      const routeComplete = !routeDirty || (draft.provider === '' ? draft.model === '' : draft.model !== '');
      const effortAllowed = !effortDirty
        || (draft.provider === '' && draft.model === '' && draft.reasoningEffort === '')
        || (draft.provider !== '' && draft.model !== '');
      const complete = routeComplete && effortAllowed;
      const saveBlocked = !dirty || !complete || (catalogEmpty && routeDirty);
      return { routeDirty, effortDirty, disabledDirty, dirty, isInherit, complete, saveBlocked };
    }

    function groupRoles(list) {
      const byId = new Map(list.map((role) => [role.id, role]));
      const assigned = new Set();
      const sections = [];
      for (const phase of PHASE_SECTIONS) {
        const items = [];
        for (const id of phase.ids) {
          const role = byId.get(id);
          if (role) {
            items.push(role);
            assigned.add(id);
          }
        }
        if (items.length > 0) sections.push({ title: phase.title, roles: items });
      }
      const other = list
        .filter((role) => !assigned.has(role.id))
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      if (other.length > 0) sections.push({ title: 'Other', roles: other });
      return sections;
    }

    const phaseOf = (id) => PHASE_SECTIONS.find((phase) => phase.ids.includes(id))?.title ?? 'Other';

    function createSettings(ctx) {
      return function OrchestratorSettings() {
        const [mountToken] = React.useState(() => Symbol());
        const [tracker] = React.useState(() => ({ saves: 0 }));
        const [roles, setRoles] = React.useState(rolesCache);
        const [catalog, setCatalog] = React.useState(catalogCache);
        const [drafts, setDrafts] = React.useState(() => (rolesCache ? Object.fromEntries(rolesCache.map((role) => [role.id, normalizeDraft(role)])) : null));
        const [messages, setMessages] = React.useState({});
        const [savingId, setSavingId] = React.useState(null);
        const [refreshing, setRefreshing] = React.useState(false);
        const [loadTick, setLoadTick] = React.useState(0);
        const [activeTab, setActiveTab] = React.useState('all');
        const [, setEffortsTick] = React.useState(0);

        React.useEffect(() => {
          let alive = true;
          const startSaves = tracker.saves;
          setRefreshing(true);
          Promise.allSettled([fetchJson(ROLES_ROUTE), fetchJson(CATALOG_ROUTE)])
            .then(([rolesOutcome, catalogOutcome]) => {
              if (!alive) return;
              if (rolesOutcome.status === 'fulfilled' && Array.isArray(rolesOutcome.value?.roles)) {
                if (tracker.saves === startSaves) {
                  const list = rolesOutcome.value.roles;
                  const invalidCards = Array.isArray(rolesOutcome.value.invalid) ? rolesOutcome.value.invalid : [];
                  if (loadTick > 0) {
                    effortsCache = new Map();
                  }
                  rolesCache = list;
                  setRoles(list);
                  setDrafts(Object.fromEntries(list.map((role) => [role.id, normalizeDraft(role)])));
                  setMessages((current) => {
                    const next = { ...current };
                    delete next.__load;
                    if (invalidCards.length > 0) {
                      next.__invalid = { kind: 'warning', text: `Some role cards have invalid frontmatter and cannot be edited here: ${invalidCards.map((card) => card.id).join(', ')}.` };
                    } else {
                      delete next.__invalid;
                    }
                    return next;
                  });
                }
              } else {
                const error = rolesOutcome.status === 'rejected'
                  ? rolesOutcome.reason
                  : new Error('Invalid roles response: missing roles field');
                setMessages((current) => ({ ...current, __load: { kind: 'error', text: `Failed to load roles: ${String(error?.message ?? error)}` } }));
              }

              if (catalogOutcome.status === 'fulfilled' && Array.isArray(catalogOutcome.value?.groups)) {
                const catalogReply = catalogOutcome.value;
                catalogCache = {
                  available: catalogReply.available !== false,
                  degraded: catalogReply.degraded === true,
                  failedProviders: Array.isArray(catalogReply.failedProviders) ? catalogReply.failedProviders : [],
                  default: catalogReply.default ?? null,
                  groups: catalogReply.groups
                };
                setCatalog(catalogCache);
                setMessages((current) => {
                  const next = { ...current };
                  delete next.__catalog;
                  return next;
                });
              } else {
                const error = catalogOutcome.status === 'rejected'
                  ? catalogOutcome.reason
                  : new Error('Invalid catalog response: missing groups field');
                if (catalogCache === null) {
                  setCatalog({ available: false, degraded: true, failedProviders: [], default: null, groups: [] });
                }
                setMessages((current) => ({ ...current, __catalog: { kind: 'error', text: `Failed to load model catalog: ${String(error?.message ?? error)}` } }));
              }
            })
            .finally(() => {
              if (alive) setRefreshing(false);
            });
          return () => { alive = false; };
        }, [loadTick]);

        React.useEffect(() => {
          if (!drafts) return undefined;
          let alive = true;
          const targetCache = effortsCache;
          const activePairs = new Map();
          for (const draft of Object.values(drafts)) {
            if (draft.provider !== '' && draft.model !== '') {
              const key = effortKeyOf(draft.provider, draft.model);
              if (!activePairs.has(key)) activePairs.set(key, { provider: draft.provider, model: draft.model });
            }
          }
          for (const [key, pair] of activePairs.entries()) {
            const existing = targetCache.get(key);
            if (existing?.status === 'loading') {
              existing.promise?.finally(() => {
                if (alive && targetCache === effortsCache) setEffortsTick((n) => n + 1);
              });
              continue;
            }
            if (existing && !(existing.status === 'error' && existing.transient && existing.mountToken !== mountToken)) {
              continue;
            }
            const query = `${EFFORTS_ROUTE}?provider=${encodeURIComponent(pair.provider)}&model=${encodeURIComponent(pair.model)}`;
            const promise = fetchJson(query)
              .then((reply) => {
                if (!Array.isArray(reply.efforts)) {
                  const err = new Error('Invalid efforts response: missing efforts field');
                  err.status = 502;
                  throw err;
                }
                if (targetCache !== effortsCache) return;
                targetCache.set(key, {
                  status: 'ready',
                  defaultEffort: reply.defaultEffort ?? null,
                  efforts: reply.efforts
                });
              })
              .catch((error) => {
                if (targetCache !== effortsCache) return;
                const transient = typeof error?.status !== 'number' || error.status >= 500;
                targetCache.set(key, {
                  status: 'error',
                  transient,
                  mountToken,
                  defaultEffort: null,
                  efforts: [],
                  error: String(error?.message ?? error)
                });
              })
              .finally(() => {
                if (alive && targetCache === effortsCache) setEffortsTick((n) => n + 1);
              });
            targetCache.set(key, { status: 'loading', defaultEffort: null, efforts: [], promise });
          }
          return () => { alive = false; };
        }, [drafts]);

        const refreshAll = () => {
          setMessages({});
          setLoadTick((n) => n + 1);
        };

        const groups = catalog?.groups ?? [];
        const catalogEmpty = catalog !== null && groups.length === 0;
        const catalogPartialWarning = !messages.__catalog && catalog?.degraded === true && !catalogEmpty;
        const modelsOf = (provider) => groups.find((group) => group.provider === provider)?.models ?? [];

        const setDraft = (id, patch) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

        const save = async (role) => {
          const busy = roles === null || drafts === null || savingId !== null || refreshing;
          const draft = drafts?.[role.id];
          if (busy || !draft) return;
          const base = normalizeDraft(role);
          const state = evaluateDraftState(draft, base, catalogEmpty);
          if (state.saveBlocked) return;

          const payload = { id: role.id };
          if (typeof role.mtimeMs === 'number' && Number.isFinite(role.mtimeMs) && role.mtimeMs >= 0) {
            payload.expectedMtimeMs = role.mtimeMs;
          }
          if (state.routeDirty) {
            payload.provider = draft.provider === '' ? null : draft.provider;
            payload.model = draft.model === '' ? null : draft.model;
          }
          if (state.disabledDirty) {
            payload.disabled = draft.disabled;
          }
          if (state.effortDirty && draft.provider !== '') {
            payload.reasoningEffort = draft.reasoningEffort === '' ? null : draft.reasoningEffort;
          }

          setSavingId(role.id);
          setMessages((current) => ({ ...current, [role.id]: undefined }));
          try {
            const { role: saved, unchanged } = await postSettings(payload);
            tracker.saves += 1;
            const nextRoles = (rolesCache ?? roles ?? []).map((entry) => (entry.id === role.id ? saved : entry));
            rolesCache = nextRoles;
            setRoles(nextRoles);
            setDrafts((current) => ({ ...current, [role.id]: normalizeDraft(saved) }));
            setMessages((current) => ({ ...current, [role.id]: { kind: 'ok', text: unchanged ? UNCHANGED_NOTICE : SAVE_NOTICE } }));
          } catch (error) {
            const detail = String(error?.message ?? error);
            const text = error?.status === 409
              ? `Conflict/validation error (409): ${detail}. Click "Refresh" to reload the latest state before saving.`
              : detail;
            setMessages((current) => ({ ...current, [role.id]: { kind: 'error', text } }));
          } finally {
            setSavingId(null);
          }
        };

        const renderField = (label, help, control) => h('div', { style: { minWidth: 0 } },
          h('div', { style: fieldLabelStyle }, label),
          control,
          h('div', { style: fieldHelpStyle }, help));

        const renderCard = (role) => {
          const draft = drafts?.[role.id] ?? normalizeDraft(role);
          const base = normalizeDraft(role);
          const message = messages[role.id];
          const state = evaluateDraftState(draft, base, catalogEmpty);
          const busy = roles === null || drafts === null || savingId !== null || refreshing;
          const isInherit = state.isInherit;
          const effortEntry = !isInherit ? effortsCache.get(effortKeyOf(draft.provider, draft.model)) : null;
          const effortLoading = effortEntry?.status === 'loading';
          const efforts = effortEntry?.efforts ?? [];
          const providerMissing = draft.provider !== '' && !groups.some((group) => group.provider === draft.provider);
          const providerModels = modelsOf(draft.provider);
          const modelMissing = draft.model !== '' && !providerModels.some((model) => model.id === draft.model);
          const effortMissing = draft.reasoningEffort !== '' && !efforts.some((effort) => effort.id === draft.reasoningEffort);
          const effortDisabled = busy || isInherit || (effortLoading && draft.reasoningEffort === '') || (!effortLoading && efforts.length === 0 && draft.reasoningEffort === '');
          const saveDisabled = busy || state.saveBlocked;
          const tone = statusTone(draft.disabled, isInherit);
          const phaseTone = PHASE_TONE[phaseOf(role.id)] ?? PHASE_TONE.Other;

          return h('div', { key: role.id, style: { ...cardStyle, opacity: draft.disabled ? 0.7 : 1 } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
                h('span', { style: dotStyle(phaseTone) }),
                h('span', { title: role.name, style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, role.name, draft.disabled ? ' (disabled)' : '')),
              h('span', { style: statusBadgeStyle(tone) }, h('span', { style: dotStyle(tone.dot) }), tone.word)),
            role.description ? h('div', { title: role.description, style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '16px' } }, role.description) : null,
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              renderField('Provider', 'Which provider serves this role.',
                h('select', {
                  value: draft.provider,
                  disabled: busy || catalogEmpty,
                  style: controlStyle,
                  'aria-label': `Provider for ${role.name}`,
                  onChange: (event) => {
                    const provider = event.target.value;
                    if (provider === '') {
                      setDraft(role.id, { provider: '', model: '', reasoningEffort: '' });
                      return;
                    }
                    const keepsModel = modelsOf(provider).some((model) => model.id === draft.model);
                    setDraft(role.id, {
                      provider,
                      model: keepsModel ? draft.model : '',
                      reasoningEffort: keepsModel ? draft.reasoningEffort : ''
                    });
                  }
                },
                  h('option', { value: '' }, INHERIT_LABEL),
                  providerMissing ? h('option', { value: draft.provider }, `${draft.provider} (unavailable)`) : null,
                  groups.map((group) => h('option', { key: group.provider, value: group.provider }, group.name)))),
              renderField('Model', 'Which model this role runs on.',
                h('select', {
                  value: draft.model,
                  disabled: busy || catalogEmpty || draft.provider === '',
                  style: controlStyle,
                  'aria-label': `Model for ${role.name}`,
                  onChange: (event) => {
                    const nextModel = event.target.value;
                    setDraft(role.id, {
                      model: nextModel,
                      reasoningEffort: nextModel === draft.model ? draft.reasoningEffort : ''
                    });
                  }
                },
                  h('option', { value: '' }, INHERIT_LABEL),
                  modelMissing ? h('option', { value: draft.model }, `${draft.model} (unavailable)`) : null,
                  providerModels.map((model) => h('option', { key: model.id, value: model.id }, model.name === model.id ? model.name : `${model.name} (${model.id})`)))),
              renderField('Reasoning effort', 'How long the model thinks before answering.',
                h('select', {
                  value: isInherit ? '' : draft.reasoningEffort,
                  disabled: effortDisabled,
                  style: controlStyle,
                  'aria-label': `Reasoning effort for ${role.name}`,
                  onChange: (event) => setDraft(role.id, { reasoningEffort: event.target.value })
                },
                  h('option', { value: '' },
                    isInherit
                      ? EFFORT_AUTO_LABEL
                      : effortLoading
                        ? 'Loading levels…'
                        : effortEntry?.status === 'error'
                          ? 'Effort unavailable'
                          : effortEntry?.defaultEffort
                            ? `Default (${effortEntry.defaultEffort})`
                            : efforts.length === 0
                              ? 'No configurable levels'
                              : EFFORT_AUTO_LABEL),
                  !isInherit && effortMissing ? h('option', { value: draft.reasoningEffort }, `${draft.reasoningEffort} (saved / unavailable)`) : null,
                  efforts.map((effort) => h('option', { key: effort.id, value: effort.id, title: effort.description },
                    effort.name === effort.id ? effort.name : `${effort.name} (${effort.id})`))))),
            effortEntry?.status === 'error' ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, `Effort unavailable for this route: ${effortEntry.error}`) : null,
            message ? h('div', { style: { fontSize: 12, color: message.kind === 'ok' ? 'var(--dsw-alias-state-success-primary, #22c55e)' : 'var(--dsw-alias-state-error-primary, #ef4444)' } }, message.text) : null,
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 12 } },
              h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', cursor: busy ? 'default' : 'pointer', padding: '4px 0' } },
                h('input', {
                  type: 'checkbox',
                  checked: draft.disabled,
                  disabled: busy,
                  'aria-label': `Disable ${role.name}`,
                  onChange: (event) => setDraft(role.id, { disabled: event.target.checked })
                }),
                'Disabled'),
              h('button', {
                type: 'button',
                onClick: () => save(role),
                disabled: saveDisabled,
                style: saveDisabled ? { ...buttonStyle, opacity: 0.5 } : primaryButtonStyle,
                'aria-label': `Save ${role.name} settings`
              }, savingId === role.id ? 'Saving…' : 'Save')));
        };

        const sections = roles ? groupRoles(roles) : [];
        const total = roles?.length ?? 0;
        const routedCount = roles?.filter((role) => role.provider && role.model && role.model !== 'inherit').length ?? 0;
        const disabledCount = roles?.filter((role) => role.disabled === true).length ?? 0;
        const countOf = (title) => sections.find((section) => section.title === title)?.roles.length ?? 0;
        const tabs = [
          { id: 'all', label: 'All roles', count: total },
          ...PHASE_SECTIONS.map((phase) => ({ id: phase.title, label: phase.title, count: countOf(phase.title) })),
          { id: 'Other', label: 'Other', count: countOf('Other') }
        ];
        const visibleSections = activeTab === 'all' ? sections : sections.filter((section) => section.title === activeTab);
        const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
        const onTabListKeyDown = (event) => {
          if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
          const current = buttons.indexOf(event.target);
          const next = event.key === 'Home' ? 0
            : event.key === 'End' ? buttons.length - 1
              : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
          setActiveTab(tabs[next].id);
        };

        return h('div', { 'data-dsh-orchestrator-kit-settings': '', style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 } },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, 'Role routing'),
              h('div', { title: 'Counts show saved state; card badges show the current draft.', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } },
                h('span', { style: statStyle }, String(total)), ' roles · ',
                h('span', { style: statStyle }, String(routedCount)), ' routed · ',
                h('span', { style: statStyle }, String(total - routedCount)), ' inherit · ',
                h('span', { style: statStyle }, String(disabledCount)), ' disabled')),
            h('button', {
              type: 'button',
              onClick: refreshAll,
              disabled: refreshing || savingId !== null,
              style: { ...buttonStyle, flex: 'none', opacity: refreshing || savingId !== null ? 0.5 : 1 },
              'aria-label': 'Refresh roles and catalog'
            }, refreshing ? 'Refreshing…' : 'Refresh')),
          messages.__load ? h('div', { style: bannerStyle('error') }, messages.__load.text) : null,
          messages.__catalog ? h('div', { style: bannerStyle('error') }, messages.__catalog.text) : null,
          messages.__invalid ? h('div', { style: bannerStyle('warning') }, messages.__invalid.text) : null,
          catalogPartialWarning
            ? h('div', { style: bannerStyle('warning') },
                catalog.failedProviders?.length > 0
                  ? `Partial catalog: failed to list models for ${catalog.failedProviders.join(', ')}. Some routes may appear unavailable.`
                  : 'Partial catalog: one or more providers failed to list models; some routes may appear unavailable.')
            : null,
          catalogEmpty ? h('div', { style: bannerStyle('neutral') }, 'The model catalog is unavailable right now; provider/model switching is disabled, but you can still toggle "Disabled".') : null,
          h('details', { open: true, style: legendStyle },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontSize: 12 } }, 'What these settings do'),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 8, marginTop: 8 } },
              h('div', {}, h('span', { style: legendTermStyle }, 'Provider'), ' — which provider serves the role.'),
              h('div', {}, h('span', { style: legendTermStyle }, 'Model'), ' — which model the role runs on.'),
              h('div', {}, h('span', { style: legendTermStyle }, 'Reasoning effort'), ' — how long the model thinks before answering.'),
              h('div', {}, h('span', { style: legendTermStyle }, 'Disabled'), ' — skip the role when dispatching work.'),
              h('div', {}, h('span', { style: legendTermStyle }, 'Chat default (inherit)'), ' — remove the route and follow the Lead.'),
              h('div', {}, 'Members created with plain subagent always inherit the Lead.'),
              h('div', {}, 'Changes apply on the next turn / next subagent_role.'),
              lastServerTiming ? h('div', {}, `Server timing — roles: ${lastServerTiming.reads ?? '—'} ms · catalog: ${lastServerTiming.catalog ?? '—'} ms`) : null)),
          h('div', { role: 'tablist', 'aria-label': 'Filter roles by phase', style: tabRowStyle, onKeyDown: onTabListKeyDown },
            tabs.map((tab, index) => h('button', {
              key: tab.id,
              id: `orch-tab-${index}`,
              type: 'button',
              role: 'tab',
              'aria-selected': activeTab === tab.id,
              'aria-controls': 'orch-role-panel',
              tabIndex: activeTab === tab.id ? 0 : -1,
              onClick: () => setActiveTab(tab.id),
              style: tabStyle(activeTab === tab.id)
            }, tab.label, h('span', { style: { marginLeft: 8, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' } }, tab.count)))),
          h('div', { role: 'tabpanel', id: 'orch-role-panel', 'aria-labelledby': `orch-tab-${activeIndex}`, style: { display: 'flex', flexDirection: 'column', gap: 16 } },
            roles === null
              ? (messages.__load ? null : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, 'Loading roles…'))
              : roles.length === 0
                ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, 'No role cards found in the agent roles directory.')
                : visibleSections.length === 0
                  ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, 'No roles in this group yet. Add role cards to the agent roles directory to fill it.')
                  : visibleSections.map((section) => h('div', { key: section.title, style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                      h('div', { style: sectionTitleStyle },
                        h('span', { style: dotStyle(PHASE_TONE[section.title] ?? PHASE_TONE.Other) }),
                        section.title,
                        h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' } }, section.roles.length)),
                      h('div', { style: gridStyle }, section.roles.map(renderCard))))));
      };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: NS,
          order: 96,
          label: () => 'Orchestrator',
          locale: NS
        }, createSettings(ctx)));
      }
    };
  }
});
