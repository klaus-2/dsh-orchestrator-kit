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
      { id: 'discovery', ids: ['repo-scout', 'docs-scout', 'media-analyst', 'arch-advisor'] },
      { id: 'planning', ids: ['scope-analyst', 'planner', 'plan-auditor', 'run-conductor', 'implementer', 'debugger'] },
      { id: 'verification', ids: ['diff-reviewer', 'test-auditor', 'test-writer', 'browser-qa', 'error-auditor', 'security-auditor', 'perf-auditor', 'debt-auditor', 'docs-sync', 'tech-writer'] }
    ];

    const PHASE_TONE = { discovery: '#4f8cff', planning: '#3ecf8e', verification: '#f59e0b', other: '#8fa3bd' };

    let rolesCache = null;
    let catalogCache = null;
    let effortsCache = new Map();
    let lastServerTiming = null;

    const PANEL_DICTS = {
      en: {
        'nav.label': 'Orchestrator',
        'header.title': 'Role routing',
        'header.countsTitle': 'Counts show saved state; card badges show the current draft.',
        'header.countRoles': ' roles · ',
        'header.countRouted': ' routed · ',
        'header.countInherit': ' inherit · ',
        'header.countDisabled': ' disabled',
        'refresh': 'Refresh',
        'refresh.busy': 'Refreshing…',
        'refresh.aria': 'Refresh roles and catalog',
        'tab.all': 'All roles',
        'phase.discovery': 'Discovery & Advisory',
        'phase.planning': 'Planning & Execution',
        'phase.verification': 'Verification, QA & Docs',
        'phase.other': 'Other',
        'tablist.aria': 'Filter roles by phase',
        'status.routed': 'Routed',
        'status.inherit': 'Inherits chat',
        'status.disabled': 'Disabled',
        'card.disabledSuffix': ' (disabled)',
        'field.provider': 'Provider',
        'field.providerHelp': 'Which provider serves this role.',
        'field.providerAria': 'Provider for {name}',
        'field.model': 'Model',
        'field.modelHelp': 'Which model this role runs on.',
        'field.modelAria': 'Model for {name}',
        'field.effort': 'Reasoning effort',
        'field.effortHelp': 'How long the model thinks before answering.',
        'field.effortAria': 'Reasoning effort for {name}',
        'inherit.label': 'Chat default (inherit)',
        'effort.auto': 'Auto (model default)',
        'effort.loading': 'Loading levels…',
        'effort.unavailable': 'Effort unavailable',
        'effort.default': 'Default ({effort})',
        'effort.none': 'No configurable levels',
        'effort.savedUnavailable': '{effort} (saved / unavailable)',
        'option.unavailable': '{name} (unavailable)',
        'option.withId': '{name} ({id})',
        'effort.errorLine': 'Effort unavailable for this route: {error}',
        'disabled.label': 'Disabled',
        'disabled.aria': 'Disable {name}',
        'save': 'Save',
        'save.busy': 'Saving…',
        'save.aria': 'Save {name} settings',
        'notice.saved': 'Saved — applies on the next turn / next subagent_role.',
        'notice.unchanged': 'Already up to date — nothing was written.',
        'error.conflict': 'Conflict/validation error (409): {detail}. Click "Refresh" to reload the latest state before saving.',
        'banner.loadError': 'Failed to load roles: {error}',
        'banner.catalogError': 'Failed to load model catalog: {error}',
        'banner.invalidCards': 'Some role cards have invalid frontmatter and cannot be edited here: {ids}.',
        'banner.partialCatalog': 'Partial catalog: failed to list models for {providers}. Some routes may appear unavailable.',
        'banner.partialCatalogGeneric': 'Partial catalog: one or more providers failed to list models; some routes may appear unavailable.',
        'banner.catalogEmpty': 'The model catalog is unavailable right now; provider/model switching is disabled, but you can still toggle "Disabled".',
        'legend.summary': 'What these settings do',
        'legend.provider': 'Provider',
        'legend.providerText': ' — which provider serves the role.',
        'legend.model': 'Model',
        'legend.modelText': ' — which model the role runs on.',
        'legend.effort': 'Reasoning effort',
        'legend.effortText': ' — how long the model thinks before answering.',
        'legend.disabled': 'Disabled',
        'legend.disabledText': ' — skip the role when dispatching work.',
        'legend.inherit': 'Chat default (inherit)',
        'legend.inheritText': ' — remove the route and follow the Lead.',
        'legend.subagent': 'Members created with plain subagent always inherit the Lead.',
        'legend.apply': 'Changes apply on the next turn / next subagent_role.',
        'legend.timing': 'Server timing — roles: {reads} ms · catalog: {catalog} ms',
        'empty.loading': 'Loading roles…',
        'empty.noRoles': 'No role cards found in the agent roles directory.',
        'empty.noGroup': 'No roles in this group yet. Add role cards to the agent roles directory to fill it.',
        'locale.auto': 'Auto (host language)',
        'locale.aria': 'Panel language'
      },
      'pt-br': {
        'nav.label': 'Orchestrator',
        'header.title': 'Roteamento por papel',
        'header.countsTitle': 'Os contadores mostram o estado salvo; os selos dos cartões mostram o rascunho atual.',
        'header.countRoles': ' papéis · ',
        'header.countRouted': ' roteados · ',
        'header.countInherit': ' herdados · ',
        'header.countDisabled': ' desativados',
        'refresh': 'Atualizar',
        'refresh.busy': 'Atualizando…',
        'refresh.aria': 'Atualizar papéis e catálogo',
        'tab.all': 'Todos os papéis',
        'phase.discovery': 'Descoberta e Consultoria',
        'phase.planning': 'Planejamento e Execução',
        'phase.verification': 'Verificação, QA e Documentação',
        'phase.other': 'Outros',
        'tablist.aria': 'Filtrar papéis por fase',
        'status.routed': 'Roteado',
        'status.inherit': 'Herdado do chat',
        'status.disabled': 'Desativado',
        'card.disabledSuffix': ' (desativado)',
        'field.provider': 'Provedor',
        'field.providerHelp': 'Qual provedor atende este papel.',
        'field.providerAria': 'Provedor de {name}',
        'field.model': 'Modelo',
        'field.modelHelp': 'Em qual modelo este papel executa.',
        'field.modelAria': 'Modelo de {name}',
        'field.effort': 'Esforço de raciocínio',
        'field.effortHelp': 'Quanto tempo o modelo pensa antes de responder.',
        'field.effortAria': 'Esforço de raciocínio de {name}',
        'inherit.label': 'Padrão do chat (herdar)',
        'effort.auto': 'Automático (padrão do modelo)',
        'effort.loading': 'Carregando níveis…',
        'effort.unavailable': 'Esforço indisponível',
        'effort.default': 'Padrão ({effort})',
        'effort.none': 'Sem níveis configuráveis',
        'effort.savedUnavailable': '{effort} (salvo / indisponível)',
        'option.unavailable': '{name} (indisponível)',
        'option.withId': '{name} ({id})',
        'effort.errorLine': 'Esforço indisponível para esta rota: {error}',
        'disabled.label': 'Desativado',
        'disabled.aria': 'Desativar {name}',
        'save': 'Salvar',
        'save.busy': 'Salvando…',
        'save.aria': 'Salvar configurações de {name}',
        'notice.saved': 'Salvo — aplica no próximo turno / próximo subagent_role.',
        'notice.unchanged': 'Já está atualizado — nada foi gravado.',
        'error.conflict': 'Erro de conflito/validação (409): {detail}. Clique em "Atualizar" para recarregar o estado mais recente antes de salvar.',
        'banner.loadError': 'Falha ao carregar papéis: {error}',
        'banner.catalogError': 'Falha ao carregar o catálogo de modelos: {error}',
        'banner.invalidCards': 'Alguns cartões de papel têm frontmatter inválido e não podem ser editados aqui: {ids}.',
        'banner.partialCatalog': 'Catálogo parcial: falha ao listar modelos de {providers}. Algumas rotas podem parecer indisponíveis.',
        'banner.partialCatalogGeneric': 'Catálogo parcial: um ou mais provedores falharam ao listar modelos; algumas rotas podem parecer indisponíveis.',
        'banner.catalogEmpty': 'O catálogo de modelos está indisponível no momento; a troca de provedor/modelo está desativada, mas você ainda pode alternar "Desativado".',
        'legend.summary': 'O que estas configurações fazem',
        'legend.provider': 'Provedor',
        'legend.providerText': ' — qual provedor atende o papel.',
        'legend.model': 'Modelo',
        'legend.modelText': ' — em qual modelo o papel executa.',
        'legend.effort': 'Esforço de raciocínio',
        'legend.effortText': ' — quanto tempo o modelo pensa antes de responder.',
        'legend.disabled': 'Desativado',
        'legend.disabledText': ' — ignora o papel ao despachar trabalho.',
        'legend.inherit': 'Padrão do chat (herdar)',
        'legend.inheritText': ' — remove a rota e segue o Lead.',
        'legend.subagent': 'Membros criados com subagent simples sempre herdam o Lead.',
        'legend.apply': 'As alterações aplicam no próximo turno / próximo subagent_role.',
        'legend.timing': 'Tempos do servidor — papéis: {reads} ms · catálogo: {catalog} ms',
        'empty.loading': 'Carregando papéis…',
        'empty.noRoles': 'Nenhum cartão de papel encontrado no diretório de papéis do agente.',
        'empty.noGroup': 'Ainda não há papéis neste grupo. Adicione cartões de papel ao diretório de papéis do agente para preenchê-lo.',
        'locale.auto': 'Automático (idioma do host)',
        'locale.aria': 'Idioma do painel'
      },
      zh: {
        'nav.label': 'Orchestrator',
        'header.title': '角色路由',
        'header.countsTitle': '计数显示已保存状态；卡片徽章显示当前草稿。',
        'header.countRoles': ' 个角色 · ',
        'header.countRouted': ' 已路由 · ',
        'header.countInherit': ' 继承 · ',
        'header.countDisabled': ' 已禁用',
        'refresh': '刷新',
        'refresh.busy': '正在刷新…',
        'refresh.aria': '刷新角色与目录',
        'tab.all': '全部角色',
        'phase.discovery': '发现与咨询',
        'phase.planning': '规划与执行',
        'phase.verification': '验证、QA 与文档',
        'phase.other': '其他',
        'tablist.aria': '按阶段筛选角色',
        'status.routed': '已路由',
        'status.inherit': '继承对话',
        'status.disabled': '已禁用',
        'card.disabledSuffix': '（已禁用）',
        'field.provider': '提供商',
        'field.providerHelp': '此角色由哪个提供商服务。',
        'field.providerAria': '{name} 的提供商',
        'field.model': '模型',
        'field.modelHelp': '此角色运行于哪个模型。',
        'field.modelAria': '{name} 的模型',
        'field.effort': '推理强度',
        'field.effortHelp': '模型在回答前思考多久。',
        'field.effortAria': '{name} 的推理强度',
        'inherit.label': '对话默认（继承）',
        'effort.auto': '自动（模型默认）',
        'effort.loading': '正在加载级别…',
        'effort.unavailable': '强度不可用',
        'effort.default': '默认（{effort}）',
        'effort.none': '无可配置级别',
        'effort.savedUnavailable': '{effort}（已保存 / 不可用）',
        'option.unavailable': '{name}（不可用）',
        'option.withId': '{name}（{id}）',
        'effort.errorLine': '此路由的强度不可用：{error}',
        'disabled.label': '已禁用',
        'disabled.aria': '禁用 {name}',
        'save': '保存',
        'save.busy': '正在保存…',
        'save.aria': '保存 {name} 的设置',
        'notice.saved': '已保存 — 于下一轮 / 下一次 subagent_role 生效。',
        'notice.unchanged': '已是最新 — 未写入任何内容。',
        'error.conflict': '冲突/验证错误（409）：{detail}。请点击"刷新"重新加载最新状态后再保存。',
        'banner.loadError': '加载角色失败：{error}',
        'banner.catalogError': '加载模型目录失败：{error}',
        'banner.invalidCards': '部分角色卡的 frontmatter 无效，无法在此编辑：{ids}。',
        'banner.partialCatalog': '目录不完整：列出 {providers} 的模型失败。部分路由可能显示为不可用。',
        'banner.partialCatalogGeneric': '目录不完整：一个或多个提供商列出模型失败；部分路由可能显示为不可用。',
        'banner.catalogEmpty': '模型目录当前不可用；提供商/模型切换已禁用，但您仍可切换"已禁用"。',
        'legend.summary': '这些设置的作用',
        'legend.provider': '提供商',
        'legend.providerText': ' — 此角色由哪个提供商服务。',
        'legend.model': '模型',
        'legend.modelText': ' — 此角色运行于哪个模型。',
        'legend.effort': '推理强度',
        'legend.effortText': ' — 模型在回答前思考多久。',
        'legend.disabled': '已禁用',
        'legend.disabledText': ' — 分派工作时跳过此角色。',
        'legend.inherit': '对话默认（继承）',
        'legend.inheritText': ' — 移除路由并跟随 Lead。',
        'legend.subagent': '使用普通 subagent 创建的成员始终继承 Lead。',
        'legend.apply': '更改于下一轮 / 下一次 subagent_role 生效。',
        'legend.timing': '服务器计时 — 角色：{reads} ms · 目录：{catalog} ms',
        'empty.loading': '正在加载角色…',
        'empty.noRoles': '在代理角色目录中未找到角色卡。',
        'empty.noGroup': '此分组暂无角色。向代理角色目录添加角色卡以填充。',
        'locale.auto': '自动（宿主语言）',
        'locale.aria': '面板语言'
      }
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
      ? { key: 'status.disabled', dot: 'var(--dsw-alias-state-error-primary, #ef4444)', background: 'rgba(239,68,68,0.12)' }
      : isInherit
        ? { key: 'status.inherit', dot: 'var(--dsw-alias-label-secondary)', background: 'rgba(127,127,127,0.12)' }
        : { key: 'status.routed', dot: 'var(--dsw-alias-state-success-primary, #22c55e)', background: 'rgba(34,197,94,0.12)' });
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
        if (items.length > 0) sections.push({ id: phase.id, roles: items });
      }
      const other = list
        .filter((role) => !assigned.has(role.id))
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      if (other.length > 0) sections.push({ id: 'other', roles: other });
      return sections;
    }

    const phaseOf = (id) => PHASE_SECTIONS.find((phase) => phase.ids.includes(id))?.id ?? 'other';

    function createSettings(ctx) {
      const hostT = ctx.locale.bind(NS);
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
        const [, setLocaleTick] = React.useState(0);
        React.useEffect(() => ctx.locale.subscribe(() => setLocaleTick((n) => n + 1)), []);
        const t = localeOverride === null ? hostT : makeT(localeOverride);
        const onLocaleChange = (event) => {
          const value = event.target.value;
          localeOverride = value === '' ? null : value;
          writeStoredLocale(localeOverride);
          setLocaleTick((n) => n + 1);
        };

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
                      next.__invalid = { kind: 'warning', key: 'banner.invalidCards', params: { ids: invalidCards.map((card) => card.id).join(', ') } };
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
                setMessages((current) => ({ ...current, __load: { kind: 'error', key: 'banner.loadError', params: { error: String(error?.message ?? error) } } }));
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
                setMessages((current) => ({ ...current, __catalog: { kind: 'error', key: 'banner.catalogError', params: { error: String(error?.message ?? error) } } }));
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
            setMessages((current) => ({ ...current, [role.id]: { kind: 'ok', key: unchanged ? 'notice.unchanged' : 'notice.saved' } }));
          } catch (error) {
            const detail = String(error?.message ?? error);
            const message = error?.status === 409
              ? { kind: 'error', key: 'error.conflict', params: { detail } }
              : { kind: 'error', key: 'error.raw', params: { detail } };
            setMessages((current) => ({ ...current, [role.id]: message }));
          } finally {
            setSavingId(null);
          }
        };

        const messageText = (message) => (message.key === 'error.raw' ? message.params.detail : t(message.key, message.params));

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
          const phaseTone = PHASE_TONE[phaseOf(role.id)] ?? PHASE_TONE.other;

          return h('div', { key: role.id, style: { ...cardStyle, opacity: draft.disabled ? 0.7 : 1 } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
                h('span', { style: dotStyle(phaseTone) }),
                h('span', { title: role.name, style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, role.name, draft.disabled ? t('card.disabledSuffix') : '')),
              h('span', { style: statusBadgeStyle(tone) }, h('span', { style: dotStyle(tone.dot) }), t(tone.key))),
            role.description ? h('div', { title: role.description, style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '16px' } }, role.description) : null,
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              renderField(t('field.provider'), t('field.providerHelp'),
                h('select', {
                  value: draft.provider,
                  disabled: busy || catalogEmpty,
                  style: controlStyle,
                  'aria-label': t('field.providerAria', { name: role.name }),
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
                  h('option', { value: '' }, t('inherit.label')),
                  providerMissing ? h('option', { value: draft.provider }, t('option.unavailable', { name: draft.provider })) : null,
                  groups.map((group) => h('option', { key: group.provider, value: group.provider }, group.name)))),
              renderField(t('field.model'), t('field.modelHelp'),
                h('select', {
                  value: draft.model,
                  disabled: busy || catalogEmpty || draft.provider === '',
                  style: controlStyle,
                  'aria-label': t('field.modelAria', { name: role.name }),
                  onChange: (event) => {
                    const nextModel = event.target.value;
                    setDraft(role.id, {
                      model: nextModel,
                      reasoningEffort: nextModel === draft.model ? draft.reasoningEffort : ''
                    });
                  }
                },
                  h('option', { value: '' }, t('inherit.label')),
                  modelMissing ? h('option', { value: draft.model }, t('option.unavailable', { name: draft.model })) : null,
                  providerModels.map((model) => h('option', { key: model.id, value: model.id }, model.name === model.id ? model.name : t('option.withId', { name: model.name, id: model.id }))))),
              renderField(t('field.effort'), t('field.effortHelp'),
                h('select', {
                  value: isInherit ? '' : draft.reasoningEffort,
                  disabled: effortDisabled,
                  style: controlStyle,
                  'aria-label': t('field.effortAria', { name: role.name }),
                  onChange: (event) => setDraft(role.id, { reasoningEffort: event.target.value })
                },
                  h('option', { value: '' },
                    isInherit
                      ? t('effort.auto')
                      : effortLoading
                        ? t('effort.loading')
                        : effortEntry?.status === 'error'
                          ? t('effort.unavailable')
                          : effortEntry?.defaultEffort
                            ? t('effort.default', { effort: effortEntry.defaultEffort })
                            : efforts.length === 0
                              ? t('effort.none')
                              : t('effort.auto')),
                  !isInherit && effortMissing ? h('option', { value: draft.reasoningEffort }, t('effort.savedUnavailable', { effort: draft.reasoningEffort })) : null,
                  efforts.map((effort) => h('option', { key: effort.id, value: effort.id, title: effort.description },
                    effort.name === effort.id ? effort.name : t('option.withId', { name: effort.name, id: effort.id })))))),
            effortEntry?.status === 'error' ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, t('effort.errorLine', { error: effortEntry.error })) : null,
            message ? h('div', { style: { fontSize: 12, color: message.kind === 'ok' ? 'var(--dsw-alias-state-success-primary, #22c55e)' : 'var(--dsw-alias-state-error-primary, #ef4444)' } }, messageText(message)) : null,
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 12 } },
              h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', cursor: busy ? 'default' : 'pointer', padding: '4px 0' } },
                h('input', {
                  type: 'checkbox',
                  checked: draft.disabled,
                  disabled: busy,
                  'aria-label': t('disabled.aria', { name: role.name }),
                  onChange: (event) => setDraft(role.id, { disabled: event.target.checked })
                }),
                t('disabled.label')),
              h('button', {
                type: 'button',
                onClick: () => save(role),
                disabled: saveDisabled,
                style: saveDisabled ? { ...buttonStyle, opacity: 0.5 } : primaryButtonStyle,
                'aria-label': t('save.aria', { name: role.name })
              }, savingId === role.id ? t('save.busy') : t('save'))));
        };

        const sections = roles ? groupRoles(roles) : [];
        const total = roles?.length ?? 0;
        const routedCount = roles?.filter((role) => role.provider && role.model && role.model !== 'inherit').length ?? 0;
        const disabledCount = roles?.filter((role) => role.disabled === true).length ?? 0;
        const countOf = (id) => sections.find((section) => section.id === id)?.roles.length ?? 0;
        const tabs = [
          { id: 'all', labelKey: 'tab.all', count: total },
          ...PHASE_SECTIONS.map((phase) => ({ id: phase.id, labelKey: 'phase.' + phase.id, count: countOf(phase.id) })),
          { id: 'other', labelKey: 'phase.other', count: countOf('other') }
        ];
        const visibleSections = activeTab === 'all' ? sections : sections.filter((section) => section.id === activeTab);
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
              h('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, t('header.title')),
              h('div', { title: t('header.countsTitle'), style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } },
                h('span', { style: statStyle }, String(total)), t('header.countRoles'),
                h('span', { style: statStyle }, String(routedCount)), t('header.countRouted'),
                h('span', { style: statStyle }, String(total - routedCount)), t('header.countInherit'),
                h('span', { style: statStyle }, String(disabledCount)), t('header.countDisabled'))),
            h('select', {
              value: localeOverride ?? '',
              onChange: onLocaleChange,
              style: { ...controlStyle, width: 'auto', flex: 'none' },
              'aria-label': t('locale.aria')
            },
              h('option', { value: '' }, t('locale.auto')),
              LANGUAGE_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label))),
            h('button', {
              type: 'button',
              onClick: refreshAll,
              disabled: refreshing || savingId !== null,
              style: { ...buttonStyle, flex: 'none', opacity: refreshing || savingId !== null ? 0.5 : 1 },
              'aria-label': t('refresh.aria')
            }, refreshing ? t('refresh.busy') : t('refresh'))),
          messages.__load ? h('div', { style: bannerStyle('error') }, messageText(messages.__load)) : null,
          messages.__catalog ? h('div', { style: bannerStyle('error') }, messageText(messages.__catalog)) : null,
          messages.__invalid ? h('div', { style: bannerStyle('warning') }, messageText(messages.__invalid)) : null,
          catalogPartialWarning
            ? h('div', { style: bannerStyle('warning') },
                catalog.failedProviders?.length > 0
                  ? t('banner.partialCatalog', { providers: catalog.failedProviders.join(', ') })
                  : t('banner.partialCatalogGeneric'))
            : null,
          catalogEmpty ? h('div', { style: bannerStyle('neutral') }, t('banner.catalogEmpty')) : null,
          h('details', { open: true, style: legendStyle },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontSize: 12 } }, t('legend.summary')),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 8, marginTop: 8 } },
              h('div', {}, h('span', { style: legendTermStyle }, t('legend.provider')), t('legend.providerText')),
              h('div', {}, h('span', { style: legendTermStyle }, t('legend.model')), t('legend.modelText')),
              h('div', {}, h('span', { style: legendTermStyle }, t('legend.effort')), t('legend.effortText')),
              h('div', {}, h('span', { style: legendTermStyle }, t('legend.disabled')), t('legend.disabledText')),
              h('div', {}, h('span', { style: legendTermStyle }, t('legend.inherit')), t('legend.inheritText')),
              h('div', {}, t('legend.subagent')),
              h('div', {}, t('legend.apply')),
              lastServerTiming ? h('div', {}, t('legend.timing', { reads: lastServerTiming.reads ?? '—', catalog: lastServerTiming.catalog ?? '—' })) : null)),
          h('div', { role: 'tablist', 'aria-label': t('tablist.aria'), style: tabRowStyle, onKeyDown: onTabListKeyDown },
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
            }, t(tab.labelKey), h('span', { style: { marginLeft: 8, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' } }, tab.count)))),
          h('div', { role: 'tabpanel', id: 'orch-role-panel', 'aria-labelledby': `orch-tab-${activeIndex}`, style: { display: 'flex', flexDirection: 'column', gap: 16 } },
            roles === null
              ? (messages.__load ? null : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, t('empty.loading')))
              : roles.length === 0
                ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, t('empty.noRoles'))
                : visibleSections.length === 0
                  ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, t('empty.noGroup'))
                  : visibleSections.map((section) => h('div', { key: section.id, style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                      h('div', { style: sectionTitleStyle },
                        h('span', { style: dotStyle(PHASE_TONE[section.id] ?? PHASE_TONE.other) }),
                        t('phase.' + section.id),
                        h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' } }, section.roles.length)),
                      h('div', { style: gridStyle }, section.roles.map(renderCard))))));
      };
    }

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
  }
});
