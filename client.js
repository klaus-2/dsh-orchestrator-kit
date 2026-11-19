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

    let rolesCache = null;
    let catalogCache = null;
    let effortsCache = new Map();

    const INHERIT_LABEL = 'Padrão do chat (herdar)';
    const EFFORT_AUTO_LABEL = 'Automático (padrão do modelo)';
    const SAVE_NOTICE = 'Configuração salva — entra em vigor no próximo turno / próximo subagent_role.';
    const controlStyle = { background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '5px 8px', fontSize: 13, maxWidth: 220 };
    const buttonStyle = { background: 'none', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '5px 10px', color: 'var(--dsw-alias-label-primary)', fontSize: 12, cursor: 'pointer' };
    const sectionHeaderStyle = { fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--dsw-alias-label-secondary)', padding: '14px 0 6px', borderBottom: '1px solid var(--dsw-alias-border-l1)' };

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
        const error = new Error(`Resposta JSON inválida (HTTP ${response.status})`);
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
      return parseApiResponse(response, false);
    }

    async function postSettings(payload) {
      const response = await fetch(ROUTE_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await parseApiResponse(response, true);
      return data.role;
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
                  if (loadTick > 0) {
                    effortsCache = new Map();
                  }
                  rolesCache = list;
                  setRoles(list);
                  setDrafts(Object.fromEntries(list.map((role) => [role.id, normalizeDraft(role)])));
                  setMessages((current) => {
                    const next = { ...current };
                    delete next.__load;
                    return next;
                  });
                }
              } else {
                const error = rolesOutcome.status === 'rejected'
                  ? rolesOutcome.reason
                  : new Error('Resposta inválida de papéis: campo roles ausente');
                setMessages((current) => ({ ...current, __load: { kind: 'error', text: `Falha ao carregar papéis: ${String(error?.message ?? error)}` } }));
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
                  : new Error('Resposta inválida do catálogo: campo groups ausente');
                if (catalogCache === null) {
                  setCatalog({ available: false, degraded: true, failedProviders: [], default: null, groups: [] });
                }
                setMessages((current) => ({ ...current, __catalog: { kind: 'error', text: `Falha ao carregar catálogo de modelos: ${String(error?.message ?? error)}` } }));
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
                  const err = new Error('Resposta inválida de esforços: campo efforts ausente');
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
            const saved = await postSettings(payload);
            tracker.saves += 1;
            const nextRoles = (rolesCache ?? roles ?? []).map((entry) => (entry.id === role.id ? saved : entry));
            rolesCache = nextRoles;
            setRoles(nextRoles);
            setDrafts((current) => ({ ...current, [role.id]: normalizeDraft(saved) }));
            setMessages((current) => ({ ...current, [role.id]: { kind: 'ok', text: SAVE_NOTICE } }));
          } catch (error) {
            const detail = String(error?.message ?? error);
            const text = error?.status === 409
              ? `Conflito de concorrência/validação (409): ${detail}. Clique em "Atualizar" para recarregar o estado mais recente antes de salvar.`
              : detail;
            setMessages((current) => ({ ...current, [role.id]: { kind: 'error', text } }));
          } finally {
            setSavingId(null);
          }
        };

        const renderRow = (role) => {
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

          return h('div', { key: role.id, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '.5px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap', opacity: draft.disabled ? 0.6 : 1 } },
            h('div', { style: { minWidth: 0, flex: '1 1 220px' } },
              h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, role.name, draft.disabled ? ' (desativado)' : ''),
              role.description ? h('div', { title: role.description, style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, role.description) : null,
              effortEntry?.status === 'error' ? h('div', { style: { fontSize: 11, marginTop: 2, color: 'var(--dsw-alias-label-tertiary)' } }, `Esforço indisponível para esta rota: ${effortEntry.error}`) : null,
              message ? h('div', { style: { fontSize: 12, marginTop: 2, color: message.kind === 'ok' ? 'var(--dsw-alias-state-success-primary, #22c55e)' : 'var(--dsw-alias-state-error-primary, #ef4444)' } }, message.text) : null),
            h('div', { style: { flex: 'none', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } },
              h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', cursor: busy ? 'default' : 'pointer' } },
                h('input', {
                  type: 'checkbox',
                  checked: draft.disabled,
                  disabled: busy,
                  'aria-label': `Desativar ${role.name}`,
                  onChange: (event) => setDraft(role.id, { disabled: event.target.checked })
                }),
                'Desativado'),
              h('select', {
                value: draft.provider,
                disabled: busy || catalogEmpty,
                style: controlStyle,
                'aria-label': `Provedor de ${role.name}`,
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
                providerMissing ? h('option', { value: draft.provider }, `${draft.provider} (indisponível)`) : null,
                groups.map((group) => h('option', { key: group.provider, value: group.provider }, group.name))),
              h('select', {
                value: draft.model,
                disabled: busy || catalogEmpty || draft.provider === '',
                style: controlStyle,
                'aria-label': `Modelo de ${role.name}`,
                onChange: (event) => {
                  const nextModel = event.target.value;
                  setDraft(role.id, {
                    model: nextModel,
                    reasoningEffort: nextModel === draft.model ? draft.reasoningEffort : ''
                  });
                }
              },
                h('option', { value: '' }, INHERIT_LABEL),
                modelMissing ? h('option', { value: draft.model }, `${draft.model} (indisponível)`) : null,
                providerModels.map((model) => h('option', { key: model.id, value: model.id }, model.name === model.id ? model.name : `${model.name} (${model.id})`))),
              h('select', {
                value: isInherit ? '' : draft.reasoningEffort,
                disabled: effortDisabled,
                style: { ...controlStyle, maxWidth: 180 },
                'aria-label': `Esforço de raciocínio de ${role.name}`,
                onChange: (event) => setDraft(role.id, { reasoningEffort: event.target.value })
              },
                h('option', { value: '' },
                  isInherit
                    ? EFFORT_AUTO_LABEL
                    : effortLoading
                      ? 'Carregando níveis…'
                      : effortEntry?.status === 'error'
                        ? 'Esforço indisponível'
                        : effortEntry?.defaultEffort
                          ? `Padrão (${effortEntry.defaultEffort})`
                          : efforts.length === 0
                            ? 'Sem níveis configuráveis'
                            : EFFORT_AUTO_LABEL),
                !isInherit && effortMissing ? h('option', { value: draft.reasoningEffort }, `${draft.reasoningEffort} (salvo / indisponível)`) : null,
                efforts.map((effort) => h('option', { key: effort.id, value: effort.id, title: effort.description },
                  effort.name === effort.id ? effort.name : `${effort.name} (${effort.id})`))),
              h('button', {
                type: 'button',
                onClick: () => save(role),
                disabled: saveDisabled,
                style: { ...buttonStyle, opacity: saveDisabled ? 0.5 : 1 },
                'aria-label': `Salvar configuração de ${role.name}`
              }, savingId === role.id ? 'Salvando…' : 'Salvar')));
        };

        const sections = roles ? groupRoles(roles) : [];

        return h('div', { 'data-dsh-orchestrator-kit-settings': '' },
          h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingBottom: 8 } },
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: '18px' } },
              'Configure ativação (desativado), provedor, modelo e esforço de raciocínio para cada um dos 20 papéis Craft. "Padrão do chat (herdar)" remove a rota e herda o Lead. Membros criados com subagent puro sempre herdam o Lead.'),
            h('button', {
              type: 'button',
              onClick: refreshAll,
              disabled: refreshing || savingId !== null,
              style: { ...buttonStyle, flex: 'none', opacity: refreshing || savingId !== null ? 0.5 : 1 },
              'aria-label': 'Atualizar papéis e catálogo'
            }, refreshing ? 'Atualizando…' : 'Atualizar')),
          messages.__load ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #ef4444)', paddingBottom: 8 } }, messages.__load.text) : null,
          messages.__catalog ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #ef4444)', paddingBottom: 8 } }, messages.__catalog.text) : null,
          catalogPartialWarning
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-warning-primary, #f59e0b)', paddingBottom: 8 } },
                catalog.failedProviders?.length > 0
                  ? `Catálogo parcial: falha ao listar modelos de ${catalog.failedProviders.join(', ')}. Algumas rotas podem aparecer como indisponíveis.`
                  : 'Catálogo parcial: um ou mais provedores falharam ao listar modelos; algumas rotas podem aparecer como indisponíveis.')
            : null,
          catalogEmpty ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', paddingBottom: 8 } }, 'O catálogo de modelos não está disponível agora; a troca de provedor/modelo fica desabilitada, mas você ainda pode alternar "Desativado".') : null,
          roles === null
            ? (messages.__load ? null : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, 'Carregando papéis…'))
            : roles.length === 0
              ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, 'Nenhum role card encontrado no diretório de papéis do agente.')
              : sections.map((section) => h('div', { key: section.title },
                  h('div', { style: sectionHeaderStyle }, section.title),
                  section.roles.map(renderRow))));
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
