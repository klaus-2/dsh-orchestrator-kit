window.__ModuleLoader__.load({
  id: 'dsh-orchestrator-kit',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-orchestrator-kit';
    const REPO_URL = 'https://github.com/klaus-2/dsh-orchestrator-kit';
    const ROLES_ROUTE = '/api/dsh-orchestrator-kit.roles';
    const CATALOG_ROUTE = '/api/dsh-orchestrator-kit.catalog';
    const EFFORTS_ROUTE = '/api/dsh-orchestrator-kit.efforts';
    const ROUTE_ROUTE = '/api/dsh-orchestrator-kit.route';
    const EVENTS_ROUTE = '/api/dsh-orchestrator-kit.events';
    const SETTINGS_ROUTE = '/api/dsh-orchestrator-kit.settings';
    const DIAGNOSTICS_ROUTE = '/api/dsh-orchestrator-kit.diagnostics';
    const UPDATE_ROUTE = '/api/dsh-orchestrator-kit.update';
    const UPDATE_INSTALLED_KEY = 'dsh-orchestrator-kit.update.installed';
    const WHATS_NEW_KEY = 'dsh-orchestrator-kit.update.whatsNew';
    const SEEN_KEY = 'dsh-orchestrator-kit.update.seen';

    const PHASE_SECTIONS = [
      { id: 'discovery', ids: ['repo-scout', 'docs-scout', 'media-analyst', 'arch-advisor'] },
      { id: 'planning', ids: ['scope-analyst', 'planner', 'plan-auditor', 'run-conductor', 'implementer', 'debugger'] },
      { id: 'verification', ids: ['diff-reviewer', 'test-auditor', 'test-writer', 'browser-qa', 'error-auditor', 'security-auditor', 'perf-auditor', 'debt-auditor', 'docs-sync', 'tech-writer'] }
    ];

    const PHASE_TONE = { discovery: '#4f8cff', planning: '#3ecf8e', verification: '#f59e0b', other: '#8fa3bd' };
    const TIER_TONE = { fast: '#38bdf8', balanced: '#a78bfa', deep: '#f472b6' };

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
        'team.defaultLabel': 'Start new sessions in Agent Teams mode',
        'team.defaultAria': 'Agent Teams default for new sessions',
        'team.saved': 'Saved — applies to sessions created from now on.',
        'onboard.presetHint': 'New chats load the preset set as default: in a chat model menu or the Agent presets settings, pick Orchestrator and press "Set as new task default".',
        'onboard.teamHint': 'The checkbox above defaults new sessions to Agent Teams; the model menu toggle (Use Agent Teams) still overrides per session, and existing sessions keep their mode.',
        'onboard.rolesHint': 'The 20 role cards and the dev-flow skill install automatically beside your agents home when this plugin starts.',
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
        'field.fallback': 'Fallback route',
        'field.fallbackHelp': 'One-shot retry route when the role route hits quota, rate limits or an outage. Empty retries on the session default.',
        'field.fallbackProviderAria': 'Fallback provider for {name}',
        'field.fallbackModelAria': 'Fallback model for {name}',
        'fallback.none': 'None — session default',
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
        'locale.aria': 'Panel language',
        'search.aria': 'Search roles',
        'search.placeholder': 'Filter by name or description',
        'empty.noMatch': 'No roles match the current search or filter.',
        'filter.status.aria': 'Filter roles by status',
        'filter.status.all': 'All statuses',
        'sort.aria': 'Sort roles',
        'sort.name': 'By name',
        'sort.routedFirst': 'Routed first',
        'sort.inheritsFirst': 'Inherits first',
        'density.aria': 'Density',
        'density.comfortable': 'Cards',
        'density.compact': 'Compact list',
        'tab.breakdownTitle': 'Routed / inherit / disabled counts for this tab',
        'card.inheritHint': 'Inherits chat default: {provider} / {model}',
        'card.fallbackSame': 'The fallback repeats the primary route; pick another model or None.',
        'card.noFallback': 'No fallback',
        'copyRoute.placeholder': 'Copy route from…',
        'copyRoute.aria': 'Copy another role’s route into {name}',
        'copyRoute.done': 'Copied from {name}; review and press Save to keep it.',
        'header.countNoFallback': ' · {n} without fallback',
        'card.dirtySuffix': ' (unsaved)',
        'card.sealTitle': 'Changed during this session',
        'undo.aria': 'Undo last save for {name}',
        'undo.label': 'Undo',
        'undo.busy': 'Undoing…',
        'notice.undo': 'Undone — the previous settings are restored.',
        'error.action.reget': 'Reload saved state, keep edits',
        'error.action.regetAria': 'Reload saved state and keep edits for {name}',
        'error.hint.effort': 'The chosen reasoning effort may not be supported by this route — check the Reasoning effort select.',
        'batch.apply': 'Apply to phase',
        'batch.applyAria': 'Apply the current route to every role in {phase}',
        'batch.busy': 'Applying…',
        'batch.cancel': 'Cancel',
        'batch.summary': 'Batch finished: {applied} applied · {conflicted} conflicts · {failed} failed',
        'batch.cancelled': 'Batch cancelled — {applied} roles were already updated.',
        'batch.empty': 'Nothing to apply: no role in this phase has a draft route.',
        'profile.summary': 'Routing profiles',
        'profile.export': 'Export profile',
        'profile.import': 'Import profile',
        'profile.invalid': 'Invalid profile: {detail}',
        'profile.rejected': 'Nothing was written: {count} entries failed.',
        'profile.applied': 'Profile applied: {applied} roles updated, {skipped} skipped.',
        'events.summary': 'Recent changes',
        'events.empty': 'No changes recorded yet.',
        'events.loadError': 'Failed to load the change log: {error}',
        'events.entry': '{time} · {id} · {summary}',
        'diagnostics.summary': 'Installed-card diagnostics',
        'diagnostics.ok': 'No problems found.',
        'diagnostics.missing': 'Missing roles: {ids}',
        'diagnostics.invalid': 'Cards with invalid frontmatter: {ids}',
        'diagnostics.outsideCatalog': 'Routes outside the live catalog: {ids}',
        'diagnostics.fallbackOutsideCatalog': 'Fallback routes outside the live catalog: {ids}',
        'diagnostics.drift': 'Body differs from the craft source: {ids}',
        'diagnostics.craftMissing': 'craft/ sources are unavailable; drift checking was skipped.',
        'diagnostics.loadError': 'Failed to load diagnostics: {error}',
        'diagnostics.copy': 'Copy for an issue',
        'diagnostics.copied': 'Copied to the clipboard.',
        'diagnostics.copyFallback': 'The clipboard is unavailable; copy the text below.',
        'preset.title': 'Ready-made profiles',
        'preset.economy': 'Economy',
        'preset.balanced': 'Balance',
        'preset.rigorous': 'Rigorous review',
        'preset.fast': 'Fast model…',
        'preset.deep': 'Strong model…',
        'preset.review': 'Review',
        'preset.confirm': 'Apply “{goal}” to {count} roles? Every card is saved; adjust any card afterwards.',
        'preset.apply': 'Apply profile',
        'readonly.title': 'Read-only mode',
        'readonly.notice': 'Saving is disabled by the server configuration (read-only mode). Controls are shown for reference.',
        'support.star': '⭐',
        'support.spark': '✦',
        'support.title': 'Enjoying Orchestrator Kit?',
        'support.message': 'A star on GitHub helps other people discover the plugin — it takes ten seconds.',
        'support.cta': 'Star on GitHub',
        'support.thanks': 'Thank you! Every star helps the plugin reach more people.',
        'support.close': '✕',
        'support.dismiss': 'Dismiss',
        'update.title': 'Updates',
        'update.checking': 'Checking for updates…',
        'update.current': 'You have the latest version.',
        'update.available': 'Version {version} is available.',
        'update.installing': 'Installing {version}…',
        'update.restart': 'Version {version} is installed. Restart the harness to finish.',
        'update.manual': 'Version {version} is available. This copy was not installed from npm; update it from Settings → Plugins.',
        'update.failed': 'Update check failed: {error}',
        'update.version': 'Version {version}',
        'update.check': 'Check for updates',
        'update.install': 'Update now',
        'update.notes': 'Release notes',
        'update.whatsNew': 'What\'s new',
        'whatsNew.title': 'What\'s new in {version}',
        'whatsNew.close': 'Close',
        'whatsNew.star': 'Enjoying the kit? ',
        'whatsNew.starLink': 'Star it on GitHub',
        'whatsNew.starDismiss': 'Don\'t ask again',
        'role.does': 'What it does:',
        'role.skip': 'What it doesn\'t do:',
        'tier.title': 'Recommended model profile for this role',
        'tier.fast': 'Fast & cheap',
        'tier.balanced': 'Balanced',
        'tier.deep': 'Deep reasoning'
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
        'field.fallback': 'Rota de fallback',
        'field.fallbackHelp': 'Rota de retry única quando a rota do papel esgota quota, sofre rate limits ou fica indisponível. Vazio faz o retry no default da sessão.',
        'field.fallbackProviderAria': 'Provedor de fallback de {name}',
        'field.fallbackModelAria': 'Modelo de fallback de {name}',
        'fallback.none': 'Nenhum — default da sessão',
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
        'locale.aria': 'Idioma do painel',
        'team.defaultLabel': 'Iniciar novas sessões em modo Agent Teams',
        'team.defaultAria': 'Padrão do Agent Teams para novas sessões',
        'team.saved': 'Salvo — vale para as sessões criadas de agora em diante.',
        'onboard.presetHint': 'Novos chats carregam o preset definido como default: no menu de modelos de um chat ou nas configurações de Agent presets, escolha Orchestrator e pressione "Set as new task default".',
        'onboard.teamHint': 'A caixa acima torna novas sessões Agent Teams por padrão; o toggle do menu de modelos (Use Agent Teams) continua valendo por sessão, e sessões existentes mantêm o modo.',
        'onboard.rolesHint': 'Os 20 cards de papel e a skill dev-flow instalam-se automaticamente ao lado do seu agents home quando este plugin inicia.',
        'search.aria': 'Pesquisar papéis',
        'search.placeholder': 'Filtrar por nome ou descrição',
        'empty.noMatch': 'Nenhum papel corresponde à busca ou ao filtro atual.',
        'filter.status.aria': 'Filtrar papéis por status',
        'filter.status.all': 'Todos os status',
        'sort.aria': 'Ordenar papéis',
        'sort.name': 'Por nome',
        'sort.routedFirst': 'Roteados primeiro',
        'sort.inheritsFirst': 'Herdados primeiro',
        'density.aria': 'Densidade',
        'density.comfortable': 'Cartões',
        'density.compact': 'Lista compacta',
        'tab.breakdownTitle': 'Contagens de roteados / herdados / desativados nesta aba',
        'card.inheritHint': 'Herdando o padrão do chat: {provider} / {model}',
        'card.fallbackSame': 'O fallback repete a rota principal; escolha outro modelo ou Nenhum.',
        'card.noFallback': 'Sem fallback',
        'copyRoute.placeholder': 'Copiar rota de…',
        'copyRoute.aria': 'Copiar a rota de outro papel para {name}',
        'copyRoute.done': 'Copiado de {name}; revise e clique em Salvar para manter.',
        'header.countNoFallback': ' · {n} sem fallback',
        'card.dirtySuffix': ' (não salvo)',
        'card.sealTitle': 'Alterado nesta sessão',
        'undo.aria': 'Desfazer o último salvamento de {name}',
        'undo.label': 'Desfazer',
        'undo.busy': 'Desfazendo…',
        'notice.undo': 'Desfeito — as configurações anteriores foram restauradas.',
        'error.action.reget': 'Recarregar estado salvo, manter edições',
        'error.action.regetAria': 'Recarregar estado salvo e manter as edições de {name}',
        'error.hint.effort': 'O esforço de raciocínio escolhido pode não ser suportado por esta rota — verifique a seleção de Esforço de raciocínio.',
        'batch.apply': 'Aplicar à fase',
        'batch.applyAria': 'Aplicar a rota atual a todos os papéis de {phase}',
        'batch.busy': 'Aplicando…',
        'batch.cancel': 'Cancelar',
        'batch.summary': 'Lote concluído: {applied} aplicados · {conflicted} conflitos · {failed} falhas',
        'batch.cancelled': 'Lote cancelado — {applied} papéis já foram atualizados.',
        'batch.empty': 'Nada para aplicar: nenhum papel desta fase tem uma rota em rascunho.',
        'profile.summary': 'Perfis de roteamento',
        'profile.export': 'Exportar perfil',
        'profile.import': 'Importar perfil',
        'profile.invalid': 'Perfil inválido: {detail}',
        'profile.rejected': 'Nada foi gravado: {count} entradas falharam.',
        'profile.applied': 'Perfil aplicado: {applied} papéis atualizados, {skipped} ignorados.',
        'events.summary': 'Alterações recentes',
        'events.empty': 'Nenhuma alteração registrada ainda.',
        'events.loadError': 'Falha ao carregar o histórico: {error}',
        'events.entry': '{time} · {id} · {summary}',
        'diagnostics.summary': 'Diagnóstico dos cartões instalados',
        'diagnostics.ok': 'Nenhum problema encontrado.',
        'diagnostics.missing': 'Papéis ausentes: {ids}',
        'diagnostics.invalid': 'Cartões com frontmatter inválido: {ids}',
        'diagnostics.outsideCatalog': 'Rotas fora do catálogo ao vivo: {ids}',
        'diagnostics.fallbackOutsideCatalog': 'Rotas de fallback fora do catálogo ao vivo: {ids}',
        'diagnostics.drift': 'Corpo difere da origem em craft/: {ids}',
        'diagnostics.craftMissing': 'As origens em craft/ estão indisponíveis; a checagem de divergência foi ignorada.',
        'diagnostics.loadError': 'Falha ao carregar o diagnóstico: {error}',
        'diagnostics.copy': 'Copiar para issue',
        'diagnostics.copied': 'Copiado para a área de transferência.',
        'diagnostics.copyFallback': 'A área de transferência está indisponível; copie o texto abaixo.',
        'preset.title': 'Perfis prontos',
        'preset.economy': 'Economia',
        'preset.balanced': 'Equilíbrio',
        'preset.rigorous': 'Revisão rigorosa',
        'preset.fast': 'Modelo rápido…',
        'preset.deep': 'Modelo forte…',
        'preset.review': 'Revisar',
        'preset.confirm': 'Aplicar “{goal}” a {count} papéis? Todos os cards serão salvos; ajuste qualquer card depois.',
        'preset.apply': 'Aplicar perfil',
        'readonly.title': 'Modo somente leitura',
        'readonly.notice': 'O salvamento está desativado pela configuração do servidor (modo somente leitura). Os controles aparecem apenas como referência.',
        'support.star': '⭐',
        'support.spark': '✦',
        'support.title': 'Gostando do Orchestrator Kit?',
        'support.message': 'Uma estrela no GitHub ajuda outras pessoas a descobrirem o plugin — leva dez segundos.',
        'support.cta': 'Dar estrela no GitHub',
        'support.thanks': 'Obrigado! Cada estrela ajuda o plugin a chegar em mais pessoas.',
        'support.close': '✕',
        'support.dismiss': 'Dispensar',
        'update.title': 'Atualizações',
        'update.checking': 'Verificando atualizações…',
        'update.current': 'Você já tem a versão mais recente.',
        'update.available': 'A versão {version} está disponível.',
        'update.installing': 'Instalando {version}…',
        'update.restart': 'A versão {version} está instalada. Reinicie o harness para concluir.',
        'update.manual': 'A versão {version} está disponível. Esta cópia não foi instalada pelo npm; atualize em Settings → Plugins.',
        'update.failed': 'Falha ao verificar atualizações: {error}',
        'update.version': 'Versão {version}',
        'update.check': 'Verificar atualizações',
        'update.install': 'Atualizar agora',
        'update.notes': 'Notas da versão',
        'update.whatsNew': 'Novidades',
        'whatsNew.title': 'Novidades da versão {version}',
        'whatsNew.close': 'Fechar',
        'whatsNew.star': 'Gostando do kit? ',
        'whatsNew.starLink': 'Deixe uma estrela no GitHub',
        'whatsNew.starDismiss': 'Não perguntar novamente',
        'role.does': 'O que faz:',
        'role.skip': 'O que não faz:',
        'tier.title': 'Perfil de modelo recomendado para este papel',
        'tier.fast': 'Rápido e barato',
        'tier.balanced': 'Equilibrado',
        'tier.deep': 'Raciocínio forte'
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
        'field.fallback': '后备路由',
        'field.fallbackHelp': '角色路由遇到配额、限流或故障时的一次性重试路由。留空则在会话默认模型上重试。',
        'field.fallbackProviderAria': '{name} 的后备提供商',
        'field.fallbackModelAria': '{name} 的后备模型',
        'fallback.none': '无 — 会话默认',
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
        'locale.aria': '面板语言',
        'team.defaultLabel': '新会话以 Agent Teams 模式启动',
        'team.defaultAria': '新会话的 Agent Teams 默认值',
        'team.saved': '已保存 — 对此后创建的会话生效。',
        'onboard.presetHint': '新聊天会加载设为默认的 preset：在聊天模型菜单或 Agent presets 设置中选择 Orchestrator，然后按“Set as new task default”。',
        'onboard.teamHint': '上方复选框让新会话默认启用 Agent Teams；模型菜单中的开关（Use Agent Teams）仍可按会话覆盖，已有会话保持原模式。',
        'onboard.rolesHint': '插件启动时，20 张角色卡和 dev-flow 技能会自动安装到你的 agents 主目录旁。',
        'search.aria': '搜索角色',
        'search.placeholder': '按名称或描述筛选',
        'empty.noMatch': '没有符合当前搜索或筛选条件的角色。',
        'filter.status.aria': '按状态筛选角色',
        'filter.status.all': '全部状态',
        'sort.aria': '排序角色',
        'sort.name': '按名称',
        'sort.routedFirst': '已路由优先',
        'sort.inheritsFirst': '继承优先',
        'density.aria': '密度',
        'density.comfortable': '卡片',
        'density.compact': '紧凑列表',
        'tab.breakdownTitle': '此标签页的已路由 / 继承 / 已禁用计数',
        'card.inheritHint': '继承对话默认：{provider} / {model}',
        'card.fallbackSame': '回退路由与主路由相同；请选择其他模型或“无”。',
        'card.noFallback': '无回退',
        'copyRoute.placeholder': '复制路由自…',
        'copyRoute.aria': '将其他角色的路由复制到 {name}',
        'copyRoute.done': '已从 {name} 复制；请检查后点击保存。',
        'header.countNoFallback': ' · {n} 个无回退',
        'card.dirtySuffix': '（未保存）',
        'card.sealTitle': '本次会话中已更改',
        'undo.aria': '撤销 {name} 的上次保存',
        'undo.label': '撤销',
        'undo.busy': '撤销中…',
        'notice.undo': '已撤销 — 已恢复之前的设置。',
        'error.action.reget': '重新加载已保存状态，保留修改',
        'error.action.regetAria': '重新加载 {name} 的已保存状态并保留修改',
        'error.hint.effort': '所选的推理强度可能不受此路由支持 — 请检查推理强度选择框。',
        'batch.apply': '应用到阶段',
        'batch.applyAria': '将当前路由应用到 {phase} 的所有角色',
        'batch.busy': '正在应用…',
        'batch.cancel': '取消',
        'batch.summary': '批处理完成：已应用 {applied} · 冲突 {conflicted} · 失败 {failed}',
        'batch.cancelled': '批处理已取消 — 已有 {applied} 个角色被更新。',
        'batch.empty': '无可应用内容：此阶段没有任何角色存在草稿路由。',
        'profile.summary': '路由配置集',
        'profile.export': '导出配置集',
        'profile.import': '导入配置集',
        'profile.invalid': '配置集无效：{detail}',
        'profile.rejected': '未写入任何内容：{count} 条失败。',
        'profile.applied': '配置集已应用：更新 {applied} 个角色，跳过 {skipped} 个。',
        'events.summary': '最近更改',
        'events.empty': '尚无更改记录。',
        'events.loadError': '加载更改日志失败：{error}',
        'events.entry': '{time} · {id} · {summary}',
        'diagnostics.summary': '已安装卡片诊断',
        'diagnostics.ok': '未发现问题。',
        'diagnostics.missing': '缺失角色：{ids}',
        'diagnostics.invalid': 'frontmatter 无效的卡片：{ids}',
        'diagnostics.outsideCatalog': '不在实时目录中的路由：{ids}',
        'diagnostics.fallbackOutsideCatalog': '不在实时目录中的后备路由：{ids}',
        'diagnostics.drift': '正文与 craft/ 源不一致：{ids}',
        'diagnostics.craftMissing': 'craft/ 源不可用；已跳过偏差检查。',
        'diagnostics.loadError': '加载诊断失败：{error}',
        'diagnostics.copy': '复制用于 issue',
        'diagnostics.copied': '已复制到剪贴板。',
        'diagnostics.copyFallback': '剪贴板不可用；请复制下面的文本。',
        'preset.title': '预设配置',
        'preset.economy': '节省',
        'preset.balanced': '均衡',
        'preset.rigorous': '严格审查',
        'preset.fast': '快速模型…',
        'preset.deep': '强模型…',
        'preset.review': '预览',
        'preset.confirm': '将“{goal}”应用到 {count} 个角色？所有卡片都会保存；之后可单独调整。',
        'preset.apply': '应用配置',
        'readonly.title': '只读模式',
        'readonly.notice': '保存已被服务器配置禁用（只读模式）。控件仅作参考。',
        'support.star': '⭐',
        'support.spark': '✦',
        'support.title': '喜欢 Orchestrator Kit 吗？',
        'support.message': '在 GitHub 上加一颗 Star，能让更多人发现这个插件——只要十秒。',
        'support.cta': '去 GitHub 点 Star',
        'support.thanks': '感谢支持！每一颗 Star 都能让插件帮到更多人。',
        'support.close': '✕',
        'support.dismiss': '关闭',
        'update.title': '更新',
        'update.checking': '正在检查更新…',
        'update.current': '您已是最新版本。',
        'update.available': '有新版本 {version} 可用。',
        'update.installing': '正在安装 {version}…',
        'update.restart': '{version} 已安装。重启 harness 以完成更新。',
        'update.manual': '有新版本 {version} 可用。此副本并非通过 npm 安装；请在设置 → 插件中更新。',
        'update.failed': '检查更新失败：{error}',
        'update.version': '版本 {version}',
        'update.check': '检查更新',
        'update.install': '立即更新',
        'update.notes': '版本说明',
        'update.whatsNew': '新功能',
        'whatsNew.title': '{version} 的新功能',
        'whatsNew.close': '关闭',
        'whatsNew.star': '喜欢这个套件吗？ ',
        'whatsNew.starLink': '去 GitHub 点个 Star',
        'whatsNew.starDismiss': '不再询问',
        'role.does': '做什么：',
        'role.skip': '不做什么：',
        'tier.title': '此角色推荐的模型档位',
        'tier.fast': '快速低价',
        'tier.balanced': '均衡',
        'tier.deep': '强推理'
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

    const draftStore = new Map();
    const storeKeyOf = (id, baseMtimeMs) => `${id}:${baseMtimeMs}`;
    const pruneStoreFor = (store, id) => {
      for (const key of [...store.keys()]) {
        if (key.split(':')[0] === id) store.delete(key);
      }
    };
    const undoSnapshots = new Map();
    const sessionChangedIds = new Set();

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
        if (parsed.support === 'dismissed' || parsed.support === 'thanked') prefs.support = parsed.support;
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

    const SUPPORT_STYLES = '.dsh-ok-support { position: relative; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 40px 12px 14px; border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4f8cff) 38%, var(--dsw-alias-border-l1, #2a2f3a)); border-radius: 14px; background: linear-gradient(120deg, color-mix(in srgb, var(--dsw-alias-brand-primary, #4f8cff) 9%, var(--dsw-alias-bg-layer-1, #16181d)) 0%, var(--dsw-alias-bg-layer-1, #16181d) 62%); overflow: hidden; animation: dsh-ok-support-in 420ms cubic-bezier(0.22,1,0.36,1) both; }\n.dsh-ok-support-star { display: inline-flex; flex: none; font-size: 24px; line-height: 1; animation: dsh-ok-star-twinkle 2.6s ease-in-out infinite; }\n.dsh-ok-support-spark { position: absolute; font-size: 10px; line-height: 1; color: var(--dsw-alias-brand-primary, #4f8cff); pointer-events: none; animation: dsh-ok-support-spark 2.6s ease-in-out infinite; }\n.dsh-ok-support-body { min-width: 180px; flex: 1; }\n.dsh-ok-support-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #eee); }\n.dsh-ok-support-text { font-size: 12px; line-height: 17px; margin-top: 2px; color: var(--dsw-alias-label-secondary, #bbb); }\n.dsh-ok-support-cta { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; white-space: nowrap; color: var(--dsw-alias-label-primary, #eee); background: linear-gradient(135deg, rgba(245,158,11,0.18), rgba(245,158,11,0.06)); border: 1px solid rgba(245,158,11,0.45); border-radius: 10px; cursor: pointer; text-decoration: none; transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease; }\n.dsh-ok-support-cta:hover { transform: translateY(-1px); border-color: rgba(245,158,11,0.75); box-shadow: 0 3px 14px rgba(245,158,11,0.24); }\n.dsh-ok-support-cta:active { transform: translateY(0) scale(0.98); box-shadow: none; }\n.dsh-ok-support-cta:focus-visible, .dsh-ok-support-close:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f8cff); outline-offset: 1px; }\n.dsh-ok-support-close { position: absolute; top: 6px; right: 8px; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; font: inherit; font-size: 11px; line-height: 1; color: var(--dsw-alias-label-tertiary, #888); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: color 120ms ease, background 120ms ease; }\n.dsh-ok-support-close:hover { color: var(--dsw-alias-label-primary, #eee); background: var(--dsw-alias-bg-layer-2, #1d2026); }\n.dsh-ok-support-thanks { padding-top: 10px; padding-bottom: 10px; }\n.dsh-ok-support-thanks .dsh-ok-support-star { animation: dsh-ok-star-pop 700ms cubic-bezier(0.34,1.56,0.64,1) both; }\n@keyframes dsh-ok-support-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }\n@keyframes dsh-ok-star-twinkle { 0%, 100% { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 1px transparent); } 50% { transform: scale(1.18) rotate(-9deg); filter: drop-shadow(0 0 7px rgba(245,158,11,0.65)); } }\n@keyframes dsh-ok-support-spark { 0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); } 50% { opacity: 0.85; transform: scale(1) rotate(45deg); } }\n@keyframes dsh-ok-star-pop { 0% { transform: scale(0.4) rotate(-30deg); } 62% { transform: scale(1.4) rotate(10deg); } 100% { transform: scale(1) rotate(0deg); } }\n@media (prefers-reduced-motion: reduce) { .dsh-ok-support, .dsh-ok-support-star, .dsh-ok-support-spark, .dsh-ok-support-cta, .dsh-ok-support-close { animation: none; transition: none; } }';

    const RELEASE_TAG_URL = REPO_URL + '/releases/tag/v';
    const versionOf = (text) => { const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(text ?? '')); return m === null ? undefined : m.slice(1).map(Number); };
    const compareVersions = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
    const matchLanguage = (ids, active) => {
      const lower = String(active ?? '').toLowerCase();
      return ids.find((x) => x.toLowerCase() === lower) ?? ids.find((x) => x.toLowerCase() === lower.split('-')[0]);
    };
    const notesByLanguage = (value) => (value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
      .filter(([id, text]) => /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(id) && typeof text === 'string' && text.trim() !== '')) : {});
    const notesIn = (notes, active) => {
      const id = matchLanguage(Object.keys(notes), active) ?? (Object.hasOwn(notes, 'en') ? 'en' : Object.keys(notes)[0]);
      return { lang: id, text: notes[id] };
    };
    const plainNotes = (text) => String(text ?? '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*\n]+)\*\*/g, '$1');
    const isGitHubUrl = (value) => typeof value === 'string' && /^https:\/\/github\.com(?:\/|$)/.test(value);

    function createUpdater() {
      let state = { status: 'idle' };
      let busy = false;
      const listeners = new Set();
      const set = (next) => { state = next; for (const fn of [...listeners]) fn(); return state; };
      const remembered = () => { try { return window.localStorage.getItem(UPDATE_INSTALLED_KEY); } catch { return null; } };
      const updater = {
        manager: undefined,
        getSnapshot: () => state,
        subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        async check() {
          if (busy) return state;
          const before = state;
          busy = true;
          set({ ...state, status: 'checking' });
          try {
            const response = await fetch(UPDATE_ROUTE, { cache: 'no-store' });
            const info = await response.json().catch(() => null);
            if ((!response.ok || info === null) && before.status === 'restart') return set(before);
            if (!response.ok || info === null || info.ok === false) throw new Error(info?.error ?? `HTTP ${response.status}`);
            const installed = versionOf(info.installed);
            const current = versionOf(info.current);
            const installedNewer = installed !== undefined && current !== undefined && compareVersions(installed, current) > 0;
            const status = installedNewer ? 'restart' : !info.newer ? 'current' : remembered() === info.latest ? 'restart' : info.managed ? 'available' : 'manual';
            return set({ status, info });
          } catch (error) {
            if (before.status === 'restart') return set(before);
            return set({ status: 'error', info: state.info, error: String(error?.message ?? error) });
          }
          finally { busy = false; }
        },
        async install() {
          const { info } = state;
          if (busy || state.status !== 'available' || updater.manager === undefined) return state;
          if (versionOf(info?.latest) === undefined || info?.name !== NS) return set({ status: 'error', info, error: 'malformed update info' });
          busy = true;
          set({ status: 'installing', info });
          try {
            const install = async (spec) => {
              const reply = await updater.manager.installBundle(spec, { requestId: `${NS}-update-${info.latest}-${Date.now()}` });
              if (!reply?.ok) throw new Error(reply?.error?.message ?? reply?.error?.diagnostic?.split('\n').find((line) => line.trim() !== '') ?? reply?.error?.code ?? 'plugin manager did not answer');
              return reply.value;
            };
            let result = await install(`${info.name}@${info.latest}`);
            if (result.error?.code === 'already-installed') result = await install(`https://registry.npmjs.org/${info.name}/-/${info.name}-${info.latest}.tgz`);
            const firstLine = () => result.error?.diagnostic?.split('\n').find((line) => line.trim() !== '') ?? result.error?.code ?? result.application;
            const live = result.application === 'applied';
            if (!live && result.application !== 'restart-required' && result.version !== info.latest) throw new Error(firstLine());
            try { window.localStorage.setItem(UPDATE_INSTALLED_KEY, info.latest); } catch { /* the status below still says restart */ }
            const notes = typeof info.notes === 'string' && info.notes !== '' ? { notes: info.notes } : {};
            try { window.localStorage.setItem(WHATS_NEW_KEY, JSON.stringify({ version: info.latest, ...notes, url: info.url })); } catch { /* no dialog then */ }
            return set(live ? { status: 'current', info: { ...info, current: info.latest, newer: false } } : { status: 'restart', info });
          } catch (error) { return set({ status: 'error', info, error: String(error?.message ?? error) }); }
          finally { busy = false; }
        }
      };
      return updater;
    }

    function createWhatsNew() {
      let note = null; // the dialog's note, or null
      let running = null; // the running copy's notes for the row: { version, notes } or null
      let loaded = false;
      let refreshSeq = 0;
      const listeners = new Set();
      const emit = () => { for (const fn of [...listeners]) fn(); };
      const set = (next) => { note = next; emit(); };
      const starDue = () => storedPrefs.support !== 'dismissed' && storedPrefs.support !== 'thanked';
      const ask = async () => {
        try {
          const response = await fetch(`${UPDATE_ROUTE}?current=1`, { cache: 'no-store' });
          const answer = response.ok ? await response.json() : undefined;
          const nums = versionOf(answer?.current);
          return nums === undefined ? undefined : { version: answer.current, nums, notes: notesByLanguage(answer?.notes) };
        } catch { return undefined; }
      };
      return {
        getSnapshot: () => note,
        getRunning: () => running,
        subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        close: () => set(null),
        stopStar(hide) {
          storedPrefs = { ...storedPrefs, support: hide ? 'dismissed' : 'thanked' };
          writeStoredPrefs(storedPrefs);
          if (note !== null) set({ ...note, star: hide ? false : 'thanked' });
        },
        refresh() {
          const seq = ++refreshSeq;
          ask().then((run) => { if (seq === refreshSeq) { running = run === undefined ? null : { version: run.version, notes: run.notes }; emit(); } });
        },
        show() { if (running !== null && Object.keys(running.notes).length > 0) set({ version: running.version, notes: running.notes, url: RELEASE_TAG_URL + running.version, star: starDue() }); },
        async load() {
          if (loaded) return;
          loaded = true;
          let raw = null;
          try { raw = window.localStorage.getItem(WHATS_NEW_KEY); if (raw !== null) window.localStorage.removeItem(WHATS_NEW_KEY); } catch { return; }
          const keep = () => { try { if (window.localStorage.getItem(WHATS_NEW_KEY) === null) window.localStorage.setItem(WHATS_NEW_KEY, raw); } catch { /* shown at no start then */ } };
          const run = await ask();
          running = run === undefined ? null : { version: run.version, notes: run.notes }; emit();
          let record;
          if (raw !== null) {
            let saved; try { saved = JSON.parse(raw); } catch { saved = undefined; }
            const version = versionOf(saved?.version);
            if (version !== undefined) {
              if (run === undefined) { keep(); return; } // the Host did not answer: try again at the next start
              const order = compareVersions(run.nums, version);
              if (order < 0) { keep(); return; } // the harness still runs the older copy until it restarts
              if (order === 0) record = { version: saved.version, notes: { ...(typeof saved.notes === 'string' && saved.notes.trim() !== '' ? { en: saved.notes } : {}), ...run.notes },
                url: isGitHubUrl(saved.url) ? saved.url : undefined };
            } // a broken record or one for an older version goes; the seen version decides
          }
          if (run === undefined) return; // the Host did not answer: the seen version stays
          let seen; try { seen = versionOf(window.localStorage.getItem(SEEN_KEY)); } catch { return; }
          if (seen !== undefined && compareVersions(run.nums, seen) <= 0) return; // this version showed (or ran) already
          try { window.localStorage.setItem(SEEN_KEY, run.version); } catch { /* it can show again at the next start */ }
          const shown = record ?? (seen === undefined ? undefined : { version: run.version, notes: run.notes, url: RELEASE_TAG_URL + run.version });
          if (shown !== undefined && Object.keys(shown.notes).length > 0) set({ ...shown, star: starDue() });
        }
      };
    }

    const UPDATE_STYLES = '.dsh-ok-update { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1, #2a2f3a); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #16181d); }\n.dsh-ok-update-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #eee); }\n.dsh-ok-update-status { display: flex; flex: 1; min-width: 180px; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary, #bbb); }\n.dsh-ok-update-link { color: var(--dsw-alias-label-primary, #eee); text-decoration: underline; text-underline-offset: 2px; }\n.dsh-ok-update-open { padding: 0; font: inherit; color: var(--dsw-alias-label-secondary, #bbb); background: none; border: none; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }\n.dsh-ok-update-open:hover { color: var(--dsw-alias-label-primary, #eee); }\n.dsh-ok-update-action { flex: none; padding: 7px 14px; font-size: 12.5px; font-weight: 600; white-space: nowrap; color: var(--dsw-alias-label-primary, #eee); background: var(--dsw-alias-bg-layer-2, #1d2026); border: 1px solid var(--dsw-alias-border-l1, #2a2f3a); border-radius: 10px; cursor: pointer; transition: border-color 160ms ease; }\n.dsh-ok-update-action:hover { border-color: var(--dsw-alias-brand-primary, #4f8cff); }\n.dsh-ok-update-action:disabled { opacity: 0.5; cursor: default; }\n.dsh-ok-update-action:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f8cff); outline-offset: 1px; }\n@media (prefers-reduced-motion: reduce) { .dsh-ok-update-action { transition: none; } }';

    let primitives;
    try { primitives = require('@deepseek-ai/dsh-client-ui-primitives'); } catch { primitives = undefined; }

    function UpdateSettings({ updater, whatsNew, t }) {
      const state = React.useSyncExternalStore(updater.subscribe, updater.getSnapshot);
      const running = React.useSyncExternalStore(whatsNew.subscribe, whatsNew.getRunning);
      React.useEffect(() => { if (updater.getSnapshot().status === 'idle') updater.check(); }, []);
      React.useEffect(() => { whatsNew.refresh(); }, [whatsNew]);
      const { status, info } = state;
      const latest = status === 'restart' && versionOf(info?.installed) !== undefined ? info.installed : info?.latest;
      const text = status === 'checking' || status === 'idle' ? t('update.checking')
        : status === 'error' ? t('update.failed', { error: state.error })
        : t('update.' + status, { version: latest });
      const canInstall = status === 'available' && updater.manager !== undefined;
      return h('div', { className: 'dsh-ok-update' },
        h('div', { className: 'dsh-ok-update-title' }, t('update.title')),
        h('div', { className: 'dsh-ok-update-status', role: 'status' },
          info?.current ? h('span', {}, t('update.version', { version: info.current })) : null,
          text,
          info?.url && status !== 'current' ? h('a', { className: 'dsh-ok-update-link', href: info.url, target: '_blank', rel: 'noopener noreferrer' }, t('update.notes')) : null,
          running !== null && primitives?.Modal !== undefined && Object.keys(running.notes).length > 0 ? h('button', { type: 'button', className: 'dsh-ok-update-open', onClick: () => whatsNew.show() }, t('update.whatsNew')) : null),
        h('button', {
          type: 'button',
          className: 'dsh-ok-update-action',
          disabled: status === 'checking' || status === 'installing',
          onClick: () => (canInstall ? updater.install() : updater.check())
        }, canInstall ? t('update.install') : t('update.check')));
    }

    const WHATS_NEW_STYLES = '.dsh-ok-wn.dsh-ok-wn { width: min(520px, 100%); max-height: calc(100vh - 48px); }\n.dsh-ok-whatsnew { max-height: min(52vh, 440px); overflow-y: auto; overscroll-behavior: contain; margin: 0 -6px; padding: 2px 6px; border-radius: 8px; font-size: 13.5px; line-height: 21px; color: var(--dsw-alias-label-primary, #eee); overflow-wrap: anywhere; }\n.dsh-ok-whatsnew:focus { outline: none; }\n.dsh-ok-whatsnew:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f8cff); outline-offset: 2px; }\n.dsh-ok-whatsnew p { margin: 0; }\n.dsh-ok-whatsnew ul { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }\n.dsh-ok-whatsnew li { position: relative; padding-left: 18px; }\n.dsh-ok-whatsnew li::before { content: ""; position: absolute; left: 3px; top: 8px; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-brand-primary, #4f8cff); }\n.dsh-ok-whatsnew-star { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 18px; padding: 10px 12px; border: 1px solid rgba(245,158,11,0.35); border-radius: 12px; background: rgba(245,158,11,0.07); font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-secondary, #bbb); }\n.dsh-ok-whatsnew-star-icon { flex: none; font-size: 16px; line-height: 1; }\n.dsh-ok-whatsnew-star-text { flex: 1 1 140px; min-width: 0; }\n.dsh-ok-whatsnew-link { display: inline-flex; align-items: center; padding: 5px 10px; font-weight: 600; white-space: nowrap; color: var(--dsw-alias-label-primary, #eee); text-decoration: none; background: rgba(245,158,11,0.14); border: 1px solid rgba(245,158,11,0.5); border-radius: 8px; transition: border-color 160ms ease, background 160ms ease; }\n.dsh-ok-whatsnew-link:hover { border-color: rgba(245,158,11,0.8); background: rgba(245,158,11,0.22); }\n.dsh-ok-whatsnew-dismiss { padding: 5px 6px; font: inherit; font-size: 12px; color: var(--dsw-alias-label-tertiary, #888); background: none; border: none; border-radius: 6px; cursor: pointer; }\n.dsh-ok-whatsnew-dismiss:hover { color: var(--dsw-alias-label-primary, #eee); text-decoration: underline; text-underline-offset: 2px; }\n.dsh-ok-whatsnew-star[data-state="thanked"] .dsh-ok-whatsnew-star-icon { animation: dsh-ok-wn-pop 700ms cubic-bezier(0.34,1.56,0.64,1) both; }\n.dsh-ok-whatsnew-foot { display: flex; flex: 1; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px 12px; min-width: 0; }\n.dsh-ok-whatsnew-notes { margin-right: auto; font-size: 12.5px; color: var(--dsw-alias-label-secondary, #bbb); text-decoration: underline; text-underline-offset: 2px; }\n.dsh-ok-whatsnew-notes::after { content: "\\00a0\\2197"; }\n.dsh-ok-whatsnew-notes:hover { color: var(--dsw-alias-label-primary, #eee); }\n.dsh-ok-whatsnew-link:focus-visible, .dsh-ok-whatsnew-dismiss:focus-visible, .dsh-ok-whatsnew-notes:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f8cff); outline-offset: 2px; }\n@keyframes dsh-ok-wn-pop { 0% { transform: scale(0.4) rotate(-30deg); } 62% { transform: scale(1.4) rotate(10deg); } 100% { transform: scale(1) rotate(0deg); } }\n@media (prefers-reduced-motion: reduce) { .dsh-ok-whatsnew-link { transition: none; } .dsh-ok-whatsnew-star-icon { animation: none !important; } }';

    const trapDialogFocus = () => {
      if (typeof document === 'undefined') return undefined;
      const before = document.activeElement;
      const dialog = () => document.querySelector('.dsh-ok-wn');
      dialog()?.querySelector('[data-dsh-ok-autofocus]')?.focus();
      const onKey = (event) => {
        const root = dialog();
        if (event.key !== 'Tab' || root === null) return;
        const items = [...root.querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]')];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const at = document.activeElement;
        if (!root.contains(at)) { event.preventDefault(); first.focus(); }
        else if (event.shiftKey && at === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && at === last) { event.preventDefault(); first.focus(); }
      };
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('keydown', onKey);
        if (before?.isConnected) before.focus?.();
      };
    };

    function createWhatsNewDialog(ctx, whatsNew) {
      return function WhatsNewDialog() {
        const note = React.useSyncExternalStore(whatsNew.subscribe, whatsNew.getSnapshot);
        const [, setLocaleTick] = React.useState(0);
        React.useEffect(() => ctx.locale.subscribe(() => setLocaleTick((n) => n + 1)), []);
        const open = note !== null && primitives?.Modal !== undefined;
        React.useEffect(() => (open ? trapDialogFocus() : undefined), [open]);
        const t = localeOverride === null ? ctx.locale.bind(NS) : makeT(localeOverride);
        const active = localeOverride ?? ctx.locale?.getSnapshot?.()?.active ?? 'en';
        if (!open) return null;
        const shown = notesIn(note.notes, active);
        const title = t('whatsNew.title', { version: note.version });
        const lines = plainNotes(shown.text).split(/\r?\n/).map((line) => line.replace(/^\s*[-*•]\s+/, '').trim()).filter((line) => line !== '');
        const thanked = note.star === 'thanked';
        return h(primitives.Modal, {
          open: true,
          onClose: whatsNew.close,
          closeLabel: t('whatsNew.close'),
          title,
          className: 'dsh-ok-wn',
          footer: h('div', { className: 'dsh-ok-whatsnew-foot' },
            note.url === undefined ? null : h('a', { className: 'dsh-ok-whatsnew-notes', href: note.url, target: '_blank', rel: 'noopener noreferrer' }, t('update.notes')),
            h(primitives.Button, { variant: 'primary', onClick: whatsNew.close }, t('whatsNew.close')))
        },
          h('style', null, WHATS_NEW_STYLES),
          h('div', { className: 'dsh-ok-whatsnew', lang: shown.lang, tabIndex: 0, role: 'region', 'aria-label': title, 'data-dsh-ok-autofocus': '' },
            lines.length > 1 ? h('ul', null, lines.map((line, index) => h('li', { key: index }, line))) : h('p', null, lines[0] ?? '')),
          note.star ? h('div', { className: 'dsh-ok-whatsnew-star', 'data-state': thanked ? 'thanked' : 'ask' },
            h('span', { className: 'dsh-ok-whatsnew-star-icon', 'aria-hidden': 'true' }, t('support.star')),
            thanked ? h('span', { className: 'dsh-ok-whatsnew-star-text', role: 'status' }, t('support.thanks')) : [
              h('span', { key: 'text', className: 'dsh-ok-whatsnew-star-text' }, t('whatsNew.star').trim()),
              h('a', { key: 'link', className: 'dsh-ok-whatsnew-link', href: REPO_URL, target: '_blank', rel: 'noopener noreferrer', onClick: () => whatsNew.stopStar(false) }, t('whatsNew.starLink')),
              h('button', { key: 'dismiss', type: 'button', className: 'dsh-ok-whatsnew-dismiss', onClick: () => whatsNew.stopStar(true) }, t('whatsNew.starDismiss'))
            ]) : null);
      };
    }

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
    const ROLE_TEXT_RE = /^\s*\[([^\]]+)\]\s*(?:Does|Faz|做什么)\s*[:：]\s*([\s\S]+?)\s*\/\s*(?:Skip|Não use|不适用)\s*[:：]\s*([\s\S]+?)\s*$/;
    const INLINE_RE = /(\x60[^\x60]+\x60|\*\*[^*]+\*\*|\.[\w-]+(?:\/[\w*<>-]+(?:\.[\w*<>-]+)*)+\/?|\b[a-z]+(?:_[a-z]+)+\b)/g;
    const codeStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11, padding: '0 4px', borderRadius: 4, background: SURFACE_TINT, color: 'var(--dsw-alias-label-primary)' };
    const inlineOf = (text) => text.split(INLINE_RE).map((part, i) => (i % 2 === 0 ? part
      : part.startsWith('**') ? h('strong', { key: i, style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, part.slice(2, -2))
      : h('code', { key: i, style: codeStyle }, part.startsWith('\x60') ? part.slice(1, -1) : part))).filter((part) => part !== '');
    const dotStyle = (color) => ({ width: 6, height: 6, borderRadius: 999, background: color, flex: 'none' });
    const statusTone = (disabled, isInherit) => (disabled
      ? { key: 'status.disabled', dot: 'var(--dsw-alias-state-error-primary, #ef4444)', background: 'rgba(239,68,68,0.12)' }
      : isInherit
        ? { key: 'status.inherit', dot: 'var(--dsw-alias-label-secondary)', background: 'rgba(127,127,127,0.12)' }
        : { key: 'status.routed', dot: 'var(--dsw-alias-state-success-primary, #22c55e)', background: 'rgba(34,197,94,0.12)' });
    const statusBadgeStyle = (tone) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 500, background: tone.background, color: 'var(--dsw-alias-label-primary)', flex: 'none' });
    const statStyle = { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' };
    const bannerStyle = (kind) => ({ fontSize: 12, borderRadius: 8, padding: '8px 12px', color: 'var(--dsw-alias-label-primary)', background: kind === 'error' ? 'rgba(239,68,68,0.10)' : kind === 'warning' ? 'rgba(245,158,11,0.10)' : SURFACE_TINT });
    const srOnlyStyle = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 };

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

    async function postJson(url, payload) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return parseApiResponse(response, true);
    }

    const isEntryNameLike = (value) => typeof value === 'string' && /^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*$/.test(value);

    const eventSummaryOf = (record) => {
      const next = record?.next ?? null;
      const previous = record?.previous ?? null;
      const nextProvider = typeof next?.provider === 'string' ? next.provider : null;
      const nextModel = typeof next?.model === 'string' ? next.model : null;
      const effort = typeof next?.reasoningEffort === 'string' ? next.reasoningEffort : null;
      if (nextProvider === null || nextModel === null) {
        return typeof previous?.disabled === 'boolean' && previous.disabled === false && next?.disabled === true
          ? 'disabled'
          : 'cleared';
      }
      const route = `${nextProvider}/${nextModel}`;
      const withEffort = effort !== null ? `${route} (${effort})` : route;
      return next?.disabled === true ? `${withEffort} · disabled` : withEffort;
    };

    const buildProfileOf = (list) => ({
      version: 1,
      generator: NS,
      roles: Object.fromEntries((list ?? []).map((role) => [role.id, {
        provider: role.provider || null,
        model: role.model && role.model !== 'inherit' ? role.model : null,
        reasoningEffort: role.reasoningEffort ?? null,
        fallback: role.fallbackProvider && role.fallbackModel ? { provider: role.fallbackProvider, model: role.fallbackModel } : null,
        disabled: role.disabled === true
      }]))
    });

    function validateProfileOf(doc) {
      if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
        return { ok: false, detail: 'the profile must be a JSON object' };
      }
      if (doc.version !== 1) {
        return { ok: false, detail: `unsupported version: ${String(doc.version)}` };
      }
      const roles = doc.roles;
      if (roles === null || typeof roles !== 'object' || Array.isArray(roles) || Object.keys(roles).length === 0) {
        return { ok: false, detail: 'roles must be a non-empty object' };
      }
      const entries = [];
      for (const [id, value] of Object.entries(roles)) {
        if (!isEntryNameLike(id)) {
          return { ok: false, detail: `invalid role id: ${id}` };
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return { ok: false, detail: `${id}: the entry must be an object` };
        }
        const providerOk = value.provider === null || (typeof value.provider === 'string' && value.provider !== '');
        const modelOk = value.model === null || (typeof value.model === 'string' && value.model !== '');
        if (!providerOk) return { ok: false, detail: `${id}: provider must be null or a non-empty string` };
        if (!modelOk) return { ok: false, detail: `${id}: model must be null or a non-empty string` };
        if ((value.provider === null) !== (value.model === null)) {
          return { ok: false, detail: `${id}: provider and model must be set together` };
        }
        if (typeof value.model === 'string' && value.model === 'inherit') {
          return { ok: false, detail: `${id}: model must not be 'inherit'; use null` };
        }
        if (value.reasoningEffort !== null && value.reasoningEffort !== undefined && (typeof value.reasoningEffort !== 'string' || value.reasoningEffort === '')) {
          return { ok: false, detail: `${id}: reasoningEffort must be null or a non-empty string` };
        }
        if (typeof value.reasoningEffort === 'string' && (value.provider === null || value.model === null)) {
          return { ok: false, detail: `${id}: reasoningEffort requires provider and model` };
        }
        const fallbackOk = value.fallback === null || value.fallback === undefined
          || (typeof value.fallback === 'object' && !Array.isArray(value.fallback)
            && typeof value.fallback.provider === 'string' && value.fallback.provider !== ''
            && typeof value.fallback.model === 'string' && value.fallback.model !== '');
        if (!fallbackOk) {
          return { ok: false, detail: `${id}: fallback must be null or a {provider, model} object` };
        }
        if (typeof value.disabled !== 'boolean') {
          return { ok: false, detail: `${id}: disabled must be a boolean` };
        }
        entries.push({
          id,
          provider: value.provider,
          model: value.model,
          reasoningEffort: typeof value.reasoningEffort === 'string' ? value.reasoningEffort : null,
          fallback: value.fallback === undefined ? undefined : (typeof value.fallback === 'object' && value.fallback !== null ? { provider: value.fallback.provider, model: value.fallback.model } : null),
          disabled: value.disabled
        });
      }
      return { ok: true, entries };
    }

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

    const normalizeDraft = (role) => ({
      provider: role.provider ?? '',
      model: role.model === 'inherit' ? '' : (role.model ?? ''),
      reasoningEffort: role.reasoningEffort ?? '',
      fallbackProvider: role.fallbackProvider ?? '',
      fallbackModel: role.fallbackModel ?? '',
      disabled: role.disabled === true
    });

    function evaluateDraftState(draft, base, catalogEmpty) {
      const routeDirty = draft.provider !== base.provider || draft.model !== base.model;
      const effortDirty = draft.reasoningEffort !== base.reasoningEffort;
      const fallbackDirty = draft.fallbackProvider !== base.fallbackProvider || draft.fallbackModel !== base.fallbackModel;
      const disabledDirty = draft.disabled !== base.disabled;
      const dirty = routeDirty || effortDirty || disabledDirty || fallbackDirty;
      const isInherit = draft.provider === '' || draft.model === '';
      const routeComplete = !routeDirty || (draft.provider === '' ? draft.model === '' : draft.model !== '');
      const fallbackComplete = !fallbackDirty || (draft.fallbackProvider === '' ? draft.fallbackModel === '' : draft.fallbackModel !== '');
      const effortAllowed = !effortDirty
        || (draft.provider === '' && draft.model === '' && draft.reasoningEffort === '')
        || (draft.provider !== '' && draft.model !== '');
      const complete = routeComplete && effortAllowed && fallbackComplete;
      const fallbackSame = !isInherit && draft.fallbackProvider === draft.provider && draft.fallbackModel === draft.model;
      const saveBlocked = !dirty || !complete || (catalogEmpty && (routeDirty || fallbackDirty)) || (fallbackSame && (routeDirty || fallbackDirty));
      return { routeDirty, effortDirty, disabledDirty, fallbackDirty, dirty, isInherit, complete, fallbackSame, saveBlocked };
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
      let focusedCardId = null;
      return function OrchestratorSettings() {
        const [mountToken] = React.useState(() => Symbol());
        const [tracker] = React.useState(() => ({ saves: 0 }));
        const [mountState] = React.useState(() => ({ mounted: true }));
        React.useEffect(() => () => { mountState.mounted = false; }, []);
        const [roles, setRoles] = React.useState(rolesCache);
        const [catalog, setCatalog] = React.useState(catalogCache);
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
        const [messages, setMessages] = React.useState({});
        const [savingId, setSavingId] = React.useState(null);
        const [refreshing, setRefreshing] = React.useState(false);
        const [teamDefault, setTeamDefault] = React.useState(null);
        const [savingTeamDefault, setSavingTeamDefault] = React.useState(false);
        const [loadTick, setLoadTick] = React.useState(0);
        const [activeTabState, setActiveTabState] = React.useState(storedPrefs.tab ?? 'all');
        const [lastNotice, setLastNotice] = React.useState(null);
        const [highlightId, setHighlightId] = React.useState(null);
        const [undoingId, setUndoingId] = React.useState(null);
        const [search, setSearch] = React.useState('');
        const [statusFilter, setStatusFilter] = React.useState('all');
        const [sortMode, setSortMode] = React.useState('name');
        const [density, setDensity] = React.useState(storedPrefs.density ?? 'comfortable');
        const [legendOpen, setLegendOpen] = React.useState(storedPrefs.legend ?? true);
        const [, setEffortsTick] = React.useState(0);
        const [, setLocaleTick] = React.useState(0);
        const [batchPhase, setBatchPhase] = React.useState(null);
        const [cancelRef] = React.useState(() => ({ current: false }));
        const [importing, setImporting] = React.useState(false);
        const [readonlyMode, setReadonlyMode] = React.useState(false);
        const [profileExportText, setProfileExportText] = React.useState(null);
        const [profileFileInputRef] = React.useState(() => ({ current: null }));
        const [eventsState, setEventsState] = React.useState({ open: false, loading: false, events: [], skipped: 0, error: null });
        const [diagnosticsState, setDiagnosticsState] = React.useState({ open: false, loading: false, report: null, error: null });
        const [diagCopy, setDiagCopy] = React.useState(null);
        const [preset, setPreset] = React.useState({ goal: 'balanced', fast: '', deep: '', pending: null });
        React.useEffect(() => ctx.locale.subscribe(() => setLocaleTick((n) => n + 1)), []);
        const t = localeOverride === null ? hostT : makeT(localeOverride);
        const roleLang = String(localeOverride ?? ctx.locale?.getSnapshot?.()?.active ?? 'en').toLowerCase();
        const roleLangKey = roleLang.startsWith('pt') ? 'pt-BR' : roleLang.startsWith('zh') ? 'zh' : null;
        const renderDescription = (text, tone) => {
          const box = { title: text, style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '16px' } };
          const match = ROLE_TEXT_RE.exec(text);
          if (!match) return h('div', box, text);
          const row = (label, color, body) => h('div', {},
            h('span', { style: { marginRight: 6, fontSize: 11, fontWeight: 600, color } }, label),
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, ...inlineOf(body)));
          return h('div', { ...box, style: { ...box.style, display: 'flex', flexDirection: 'column', gap: 4 } },
            h('span', { style: { alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, lineHeight: '16px', borderRadius: 999, padding: '0 8px', color: tone, background: tone + '1f', border: '1px solid ' + tone + '55' } }, match[1]),
            row(t('role.does'), '#3ecf8e', match[2]),
            row(t('role.skip'), '#f87171', match[3]));
        };
        const describe = (role) => (roleLangKey !== null && typeof role.descriptionI18n?.[roleLangKey] === 'string' ? role.descriptionI18n[roleLangKey] : role.description);
        const onLocaleChange = (event) => {
          const value = event.target.value;
          localeOverride = value === '' ? null : value;
          writeStoredLocale(localeOverride);
          setLocaleTick((n) => n + 1);
        };
        const [supportPopped, setSupportPopped] = React.useState(false);
        React.useEffect(() => {
          if (supportPopped !== true) return undefined;
          const timerId = window.setTimeout(() => setSupportPopped(false), 6000);
          return () => window.clearTimeout(timerId);
        }, [supportPopped]);
        const thankStar = () => {
          storedPrefs = { ...storedPrefs, support: 'thanked' };
          writeStoredPrefs(storedPrefs);
          setSupportPopped(true);
        };
        const dismissSupport = () => {
          storedPrefs = { ...storedPrefs, support: 'dismissed' };
          writeStoredPrefs(storedPrefs);
          setSupportPopped(false);
        };
        const supportAnswered = storedPrefs.support === 'dismissed' || storedPrefs.support === 'thanked';
        const supportBanner = supportAnswered === true && supportPopped !== true ? null
          : supportPopped === true ? h('div', { className: 'dsh-ok-support dsh-ok-support-thanks', role: 'status' },
            h('span', { className: 'dsh-ok-support-star', 'aria-hidden': 'true' }, t('support.star')),
            h('span', { className: 'dsh-ok-support-text' }, t('support.thanks')))
          : h('div', { className: 'dsh-ok-support' },
            h('span', { className: 'dsh-ok-support-star', 'aria-hidden': 'true' }, t('support.star')),
            h('span', { className: 'dsh-ok-support-spark', style: { top: 8, left: 44 }, 'aria-hidden': 'true' }, t('support.spark')),
            h('span', { className: 'dsh-ok-support-spark', style: { bottom: 10, left: 26, animationDelay: '1.3s' }, 'aria-hidden': 'true' }, t('support.spark')),
            h('div', { className: 'dsh-ok-support-body' },
              h('div', { className: 'dsh-ok-support-title' }, t('support.title')),
              h('div', { className: 'dsh-ok-support-text' }, t('support.message'))),
            h('a', { className: 'dsh-ok-support-cta', href: REPO_URL, target: '_blank', rel: 'noreferrer', 'aria-label': t('support.cta'), title: t('support.cta'), onClick: thankStar },
              h('span', { 'aria-hidden': 'true' }, t('support.star')), t('support.cta')),
            h('button', {
              type: 'button',
              className: 'dsh-ok-support-close',
              'aria-label': t('support.dismiss'),
              title: t('support.dismiss'),
              onMouseDown: (event) => event.preventDefault(),
              onClick: dismissSupport
            }, t('support.close')));
        const setActiveTab = (id) => {
          setActiveTabState(id);
          storedPrefs = { ...storedPrefs, tab: id };
          writeStoredPrefs(storedPrefs);
        };

        React.useEffect(() => {
          let alive = true;
          const startSaves = tracker.saves;
          setRefreshing(true);
          const catalogRequest = loadTick === 0 && catalogCache !== null ? null : fetchJson(CATALOG_ROUTE);
          Promise.allSettled([fetchJson(ROLES_ROUTE), catalogRequest])
            .then(([rolesOutcome, catalogOutcome]) => {
              if (!alive) return;
              if (rolesOutcome.status === 'fulfilled' && Array.isArray(rolesOutcome.value?.roles)) {
                setReadonlyMode((current) => {
                  const envelopeReadonly = rolesOutcome.value.readOnly === true;
                  return envelopeReadonly === current ? current : envelopeReadonly;
                });
                if (tracker.saves === startSaves) {
                  const list = rolesOutcome.value.roles;
                  const invalidCards = Array.isArray(rolesOutcome.value.invalid) ? rolesOutcome.value.invalid : [];
                  if (loadTick > 0) {
                    effortsCache = new Map();
                  }
                  rolesCache = list;
                  setRoles(list);
                  setDrafts(Object.fromEntries(list.map((role) => {
                    const fresh = normalizeDraft(role);
                    if (loadTick !== 0) return [role.id, fresh];
                    for (const key of [...draftStore.keys()]) {
                      const [id, base] = key.split(':');
                      if (id === role.id && role.mtimeMs === Number(base)) return [role.id, draftStore.get(key).draft];
                    }
                    return [role.id, fresh];
                  })));
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

              if (catalogRequest === null) {
                setCatalog(catalogCache);
                setMessages((current) => {
                  const next = { ...current };
                  delete next.__catalog;
                  return next;
                });
              } else if (catalogOutcome.status === 'fulfilled' && Array.isArray(catalogOutcome.value?.groups)) {
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
          let alive = true;
          fetchJson(SETTINGS_ROUTE)
            .then((reply) => {
              if (!alive || reply?.ok !== true || typeof reply?.settings?.teamModeDefault !== 'boolean') return;
              setTeamDefault(reply.settings.teamModeDefault);
            })
            .catch(() => {});
          return () => { alive = false; };
        }, [loadTick]);

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
          setHighlightId(null);
          setLoadTick((n) => n + 1);
        };

        const saveTeamDefault = async (next) => {
          if (readonlyMode || teamDefault === null || savingTeamDefault) return;
          setSavingTeamDefault(true);
          try {
            const reply = await postJson(SETTINGS_ROUTE, { teamModeDefault: next });
            if (reply?.ok === true && typeof reply?.settings?.teamModeDefault === 'boolean') {
              setTeamDefault(reply.settings.teamModeDefault);
              setLastNotice({ kind: 'ok', key: 'team.saved' });
            }
          } catch (error) {
            setLastNotice({ kind: 'error', key: 'error.raw', params: { detail: String(error?.message ?? error) } });
          } finally {
            setSavingTeamDefault(false);
          }
        };

        const groups = catalog?.groups ?? [];
        const catalogEmpty = catalog !== null && groups.length === 0;
        const catalogPartialWarning = !messages.__catalog && catalog?.degraded === true && !catalogEmpty;
        const modelsOf = (provider) => groups.find((group) => group.provider === provider)?.models ?? [];

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

        const save = async (role) => {
          if (readonlyMode) return;
          const busy = roles === null || drafts === null || savingId !== null || undoingId !== null || refreshing;
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
          if (state.fallbackDirty) {
            payload.fallback = draft.fallbackProvider === '' ? null : { provider: draft.fallbackProvider, model: draft.fallbackModel };
          }
          if (state.disabledDirty) {
            payload.disabled = draft.disabled;
          }
          if (state.effortDirty && draft.provider !== '') {
            payload.reasoningEffort = draft.reasoningEffort === '' ? null : draft.reasoningEffort;
          }

          setSavingId(role.id);
          setHighlightId(null);
          setMessages((current) => ({ ...current, [role.id]: undefined }));
          try {
            const { role: saved, unchanged } = await postSettings(payload);
            tracker.saves += 1;
            pruneStoreFor(undoSnapshots, role.id);
            undoSnapshots.set(storeKeyOf(role.id, role.mtimeMs), {
              id: role.id,
              baseMtimeMs: role.mtimeMs,
              postMtimeMs: saved.mtimeMs,
              summary: {
                provider: base.provider === '' ? null : base.provider,
                model: base.model === '' ? null : base.model,
                reasoningEffort: base.reasoningEffort === '' ? null : base.reasoningEffort,
                fallback: base.fallbackProvider === '' ? null : { provider: base.fallbackProvider, model: base.fallbackModel },
                disabled: base.disabled
              }
            });
            sessionChangedIds.add(role.id);
            const nextRoles = (rolesCache ?? roles ?? []).map((entry) => (entry.id === role.id ? saved : entry));
            rolesCache = nextRoles;
            setRoles(nextRoles);
            setDrafts((current) => ({ ...current, [role.id]: normalizeDraft(saved) }));
            pruneStoreFor(draftStore, role.id);
            const message = { kind: 'ok', key: unchanged ? 'notice.unchanged' : 'notice.saved' };
            setLastNotice(message);
            setMessages((current) => ({ ...current, [role.id]: message }));
            setHighlightId(role.id);
          } catch (error) {
            const detail = String(error?.message ?? error);
            const message = error?.status === 409
              ? { kind: 'error', key: 'error.conflict', params: { detail, ...(payload.reasoningEffort !== undefined ? { effortHint: true } : {}) } }
              : { kind: 'error', key: 'error.raw', params: { detail } };
            setLastNotice(message);
            setMessages((current) => ({ ...current, [role.id]: message }));
          } finally {
            setSavingId(null);
          }
        };

        const undoEntryFor = (role) => {
          for (const entry of undoSnapshots.values()) {
            if (entry.id === role.id && entry.postMtimeMs === role.mtimeMs) return entry;
          }
          return null;
        };

        const undo = async (role) => {
          if (readonlyMode) return;
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
            reasoningEffort: entry.summary.reasoningEffort,
            fallback: entry.summary.fallback
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
                ? { kind: 'error', key: 'error.conflict', params: { detail: result.detail, ...(payload.reasoningEffort !== undefined ? { effortHint: true } : {}) } }
                : { kind: 'error', key: 'error.raw', params: { detail: result.detail } };
              setLastNotice(message);
              setMessages((current) => ({ ...current, [role.id]: message }));
            }
          } finally {
            setUndoingId(null);
          }
        };

        const runBatch = async (section, batchTarget) => {
          if (readonlyMode) return;
          const targets = (batchTarget === null ? [] : section.roles.filter((role) => {
            if (role.id === undefined) return false;
            const base = normalizeDraft(role);
            return base.provider !== batchTarget.provider || base.model !== batchTarget.model || base.reasoningEffort !== (batchTarget.reasoningEffort ?? '');
          }));
          if (batchTarget === null || targets.length === 0) {
            setLastNotice({ kind: 'error', key: 'batch.empty' });
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
            payload.provider = batchTarget.provider;
            payload.model = batchTarget.model;
            if (batchTarget.reasoningEffort !== null && batchTarget.provider !== '') payload.reasoningEffort = batchTarget.reasoningEffort;
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

        const runImport = async (doc) => {
          if (readonlyMode) return;
          const checked = validateProfileOf(doc);
          if (!checked.ok) {
            setLastNotice({ kind: 'error', key: 'profile.invalid', params: { detail: checked.detail } });
            return;
          }
          let fresh = null;
          try {
            const reply = await fetchJson(ROLES_ROUTE);
            if (Array.isArray(reply?.roles)) fresh = reply.roles;
          } catch (error) {
            setLastNotice({ kind: 'error', key: 'profile.invalid', params: { detail: `roles could not be refreshed: ${String(error?.message ?? error)}` } });
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
              reasoningEffort: entry.reasoningEffort,
              ...(entry.fallback === undefined ? {} : { fallback: entry.fallback })
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
              for (const [id, role] of appliedById.entries()) {
                next[id] = normalizeDraft(role);
                pruneStoreFor(draftStore, id);
                sessionChangedIds.add(id);
              }
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

        const presetDocOf = (goal, fastKey, deepKey) => {
          const pairOf = (key) => { const [provider, model] = JSON.parse(key); return { provider, model }; };
          const fast = pairOf(fastKey);
          const deep = pairOf(deepKey);
          return { version: 1, roles: Object.fromEntries((roles ?? []).map((role) => {
            const useDeep = goal === 'rigorous' || (goal === 'balanced' && role.recommendedTier === 'deep');
            const primary = useDeep ? deep : fast;
            return [role.id, { ...primary, reasoningEffort: null, fallback: fastKey === deepKey ? null : (useDeep ? fast : deep), disabled: role.disabled === true }];
          })) };
        };

        const presetPairOptions = groups.map((group) => h('optgroup', { key: group.provider, label: group.name ?? group.provider },
          ...group.models.map((model) => h('option', { value: effortKeyOf(group.provider, model.id) }, model.name ?? model.id))));

        const loadEvents = async () => {
          setEventsState({ open: true, loading: true, events: [], skipped: 0, error: null });
          try {
            const reply = await fetchJson(EVENTS_ROUTE);
            if (!Array.isArray(reply.events)) {
              const err = new Error('Invalid events response: missing events field');
              err.status = 502;
              throw err;
            }
            setEventsState({ open: true, loading: false, events: reply.events, skipped: reply.skipped ?? 0, error: null });
          } catch (error) {
            setEventsState({ open: true, loading: false, events: [], skipped: 0, error: String(error?.message ?? error) });
          }
        };

        const diagnosticsLinesOf = (report) => {
          const lines = [
            ['missing', report.missing.join(', ')],
            ['invalid', report.invalid.map((entry) => entry.id).join(', ')],
            ['outsideCatalog', report.outsideCatalog.join(', ')],
            ['fallbackOutsideCatalog', report.fallbackOutsideCatalog.join(', ')],
            ['drift', report.drift.join(', ')]
          ].filter(([, ids]) => ids !== '').map(([key, ids]) => [key, t('diagnostics.' + key, { ids })]);
          return lines.length === 0 ? [['ok', t('diagnostics.ok')]] : lines;
        };

        const copyDiagnostics = async () => {
          const report = diagnosticsState.report;
          if (report === null) return;
          const text = [
            '### ' + t('diagnostics.summary'),
            '',
            ...diagnosticsLinesOf(report).map(([, line]) => '- ' + line),
            ...report.invalid.map((entry) => `  - ${entry.id}: ${entry.error ?? ''}`),
            ...(report.craftAvailable ? [] : ['- ' + t('diagnostics.craftMissing')])
          ].join('\n');
          let copied = false;
          try {
            await globalThis.navigator.clipboard.writeText(text);
            copied = true;
          } catch {
            copied = false;
          }
          if (mountState.mounted) setDiagCopy({ text, copied });
        };

        const loadDiagnostics = async () => {
          setDiagCopy(null);
          setDiagnosticsState({ open: true, loading: true, report: null, error: null });
          try {
            const reply = await fetchJson(DIAGNOSTICS_ROUTE);
            if (reply === null || typeof reply !== 'object' || Array.isArray(reply)) {
              const err = new Error('Invalid diagnostics response');
              err.status = 502;
              throw err;
            }
            setDiagnosticsState({ open: true, loading: false, report: {
              missing: Array.isArray(reply.missing) ? reply.missing : [],
              invalid: Array.isArray(reply.invalid) ? reply.invalid : [],
              outsideCatalog: Array.isArray(reply.outsideCatalog) ? reply.outsideCatalog : [],
              fallbackOutsideCatalog: Array.isArray(reply.fallbackOutsideCatalog) ? reply.fallbackOutsideCatalog : [],
              drift: Array.isArray(reply.drift) ? reply.drift : [],
              craftAvailable: reply.craftAvailable === true
            }, error: null });
          } catch (error) {
            setDiagnosticsState({ open: true, loading: false, report: null, error: String(error?.message ?? error) });
          }
        };

        const exportProfile = () => {
          const json = JSON.stringify(buildProfileOf(roles), null, 2);
          if (typeof URL === 'object' || typeof URL === 'function') {
            try {
              if (typeof URL.createObjectURL === 'function') {
                const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'dsh-orchestrator-routing-profile.json';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                return;
              }
            } catch {
              return exportProfileFallback(json);
            }
          }
          return exportProfileFallback(json);
        };

        const exportProfileFallback = (json) => {
          window.__orchestratorExport = json;
          setProfileExportText(json);
        };

        const importProfile = () => {
          if (profileFileInputRef.current === null) return;
          profileFileInputRef.current.click();
        };

        const onImportFile = async (event) => {
          const file = event.target?.files?.[0];
          event.target.value = '';
          if (!file) return;
          let text = '';
          try {
            text = await file.text();
          } catch (error) {
            setLastNotice({ kind: 'error', key: 'profile.invalid', params: { detail: String(error?.message ?? error) } });
            return;
          }
          let doc = null;
          try {
            doc = JSON.parse(text);
          } catch (error) {
            setLastNotice({ kind: 'error', key: 'profile.invalid', params: { detail: String(error?.message ?? error) } });
            return;
          }
          await runImport(doc);
        };

        const onPanelKeyDown = (event) => {
          if (!(event.ctrlKey || event.metaKey) || event.key !== 's') return;
          event.preventDefault();
          if (readonlyMode) return;
          const role = (roles ?? []).find((entry) => entry.id === focusedCardId);
          if (role) save(role);
        };

        const messageText = (message) => (message.key === 'error.raw' ? message.params.detail : t(message.key, message.params));

        const renderField = (label, help, control) => h('div', { style: { minWidth: 0 } },
          h('div', { style: fieldLabelStyle }, label),
          control,
          h('div', { style: fieldHelpStyle }, help));

        const statusOf = (role) => (role.disabled === true ? 'disabled' : role.provider && role.model && role.model !== 'inherit' ? 'routed' : 'inherit');
        const STATUS_RANKS = { name: null, routedFirst: { routed: 0, inherit: 1, disabled: 2 }, inheritsFirst: { inherit: 0, disabled: 1, routed: 2 } };
        const byName = (left, right) => left.name.localeCompare(right.name);
        const sortRoles = (list) => {
          const rank = STATUS_RANKS[sortMode];
          if (!rank) return [...list].sort(byName);
          return [...list].sort((left, right) => (rank[statusOf(left)] - rank[statusOf(right)]) || byName(left, right));
        };
        const query = search.toLowerCase();
        const matchesSearch = (role) => query === '' || role.name.toLowerCase().includes(query) || [role.description, describe(role)].some((text) => typeof text === 'string' && text.toLowerCase().includes(query));
        const matchesStatus = (role) => statusFilter === 'all' || statusOf(role) === statusFilter;
        const visibleRoles = (list) => sortRoles(list.filter((role) => matchesSearch(role) && matchesStatus(role)));

        const baseSections = roles ? groupRoles(roles) : [];
        const sections = baseSections.map((section) => ({ ...section, roles: visibleRoles(section.roles) }));
        const total = roles?.length ?? 0;
        const routedCount = roles?.filter((role) => role.provider && role.model && role.model !== 'inherit').length ?? 0;
        const disabledCount = roles?.filter((role) => role.disabled === true).length ?? 0;
        const noFallbackCount = roles?.filter((role) => statusOf(role) === 'routed' && !role.fallbackProvider).length ?? 0;
        const countOf = (id) => baseSections.find((section) => section.id === id)?.roles.length ?? 0;

        const breakdownOf = (id) => {
          const list = id === 'all' ? (roles ?? []) : (baseSections.find((section) => section.id === id)?.roles ?? []);
          return {
            routed: list.filter((role) => statusOf(role) === 'routed').length,
            inherit: list.filter((role) => statusOf(role) === 'inherit').length,
            disabled: list.filter((role) => statusOf(role) === 'disabled').length
          };
        };
        const breakdownText = (id) => { const counts = breakdownOf(id); return `${counts.routed}/${counts.inherit}/${counts.disabled}`; };

        const renderCard = (role, compact = false) => {
          const draft = drafts?.[role.id] ?? normalizeDraft(role);
          const base = normalizeDraft(role);
          const message = messages[role.id];
          const state = evaluateDraftState(draft, base, catalogEmpty);
          const busy = roles === null || drafts === null || savingId !== null || undoingId !== null || refreshing;
          const isInherit = state.isInherit;
          const effortEntry = !isInherit ? effortsCache.get(effortKeyOf(draft.provider, draft.model)) : null;
          const effortLoading = effortEntry?.status === 'loading';
          const efforts = effortEntry?.efforts ?? [];
          const providerMissing = draft.provider !== '' && !groups.some((group) => group.provider === draft.provider);
          const providerModels = modelsOf(draft.provider);
          const modelMissing = draft.model !== '' && !providerModels.some((model) => model.id === draft.model);
          const fallbackProviderMissing = draft.fallbackProvider !== '' && !groups.some((group) => group.provider === draft.fallbackProvider);
          const fallbackModels = modelsOf(draft.fallbackProvider);
          const fallbackModelMissing = draft.fallbackModel !== '' && !fallbackModels.some((model) => model.id === draft.fallbackModel);
          const effortMissing = draft.reasoningEffort !== '' && !efforts.some((effort) => effort.id === draft.reasoningEffort);
          const effortDisabled = busy || readonlyMode || isInherit || (effortLoading && draft.reasoningEffort === '') || (!effortLoading && efforts.length === 0 && draft.reasoningEffort === '');
          const saveDisabled = busy || readonlyMode || state.saveBlocked;
          const tone = statusTone(draft.disabled, isInherit);
          const phaseTone = PHASE_TONE[phaseOf(role.id)] ?? PHASE_TONE.other;
          const dirty = state.dirty;
          const inheritHint = isInherit && catalog?.default?.provider && catalog?.default?.model
            ? t('card.inheritHint', { provider: catalog.default.provider, model: catalog.default.model })
            : null;
          const sealDot = sessionChangedIds.has(role.id) && !dirty
            ? h('span', { title: t('card.sealTitle'), style: dotStyle('var(--dsw-alias-state-info-primary, #4f8cff)') })
            : null;
          const tierTone = Object.hasOwn(TIER_TONE, role.recommendedTier ?? '') ? TIER_TONE[role.recommendedTier] : null;
          const tierBadge = tierTone && h('span', { title: t('tier.title'), style: statusBadgeStyle({ background: tierTone + '1f' }) }, h('span', { style: dotStyle(tierTone) }), t('tier.' + role.recommendedTier));
          const cardAccent = {
            ...(dirty ? { borderColor: 'var(--dsw-alias-state-warning-primary, #f59e0b)' } : {}),
            ...(highlightId === role.id ? { borderColor: 'var(--dsw-alias-state-success-primary, #22c55e)' } : {})
          };
          const compactControlStyle = { ...controlStyle, width: 'auto', flex: '1 1 140px', minWidth: 0 };
          const providerSelect = h('select', {
            value: draft.provider,
            disabled: busy || readonlyMode || catalogEmpty,
            style: compact ? compactControlStyle : controlStyle,
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
            groups.map((group) => h('option', { key: group.provider, value: group.provider }, group.name)));
          const modelSelect = h('select', {
            value: draft.model,
            disabled: busy || readonlyMode || catalogEmpty || draft.provider === '',
            style: compact ? compactControlStyle : controlStyle,
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
            providerModels.map((model) => h('option', { key: model.id, value: model.id }, model.name === model.id ? model.name : t('option.withId', { name: model.name, id: model.id }))));
          const effortSelect = h('select', {
            value: isInherit ? '' : draft.reasoningEffort,
            disabled: effortDisabled,
            style: compact ? compactControlStyle : controlStyle,
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
              effort.name === effort.id ? effort.name : t('option.withId', { name: effort.name, id: effort.id }))));
          const fallbackProviderSelect = h('select', {
            value: draft.fallbackProvider,
            disabled: busy || readonlyMode || catalogEmpty,
            style: controlStyle,
            'aria-label': t('field.fallbackProviderAria', { name: role.name }),
            onChange: (event) => {
              const provider = event.target.value;
              if (provider === '') {
                setDraft(role.id, { fallbackProvider: '', fallbackModel: '' });
                return;
              }
              const keepsModel = modelsOf(provider).some((model) => model.id === draft.fallbackModel);
              setDraft(role.id, { fallbackProvider: provider, fallbackModel: keepsModel ? draft.fallbackModel : '' });
            }
          },
            h('option', { value: '' }, t('fallback.none')),
            fallbackProviderMissing ? h('option', { value: draft.fallbackProvider }, t('option.unavailable', { name: draft.fallbackProvider })) : null,
            groups.map((group) => h('option', { key: group.provider, value: group.provider }, group.name)));
          const fallbackModelSelect = h('select', {
            value: draft.fallbackModel,
            disabled: busy || readonlyMode || catalogEmpty || draft.fallbackProvider === '',
            style: controlStyle,
            'aria-label': t('field.fallbackModelAria', { name: role.name }),
            onChange: (event) => setDraft(role.id, { fallbackModel: event.target.value })
          },
            h('option', { value: '' }, t('fallback.none')),
            fallbackModelMissing ? h('option', { value: draft.fallbackModel }, t('option.unavailable', { name: draft.fallbackModel })) : null,
            fallbackModels.map((model) => h('option', { key: model.id, value: model.id }, model.name === model.id ? model.name : t('option.withId', { name: model.name, id: model.id }))));
          const undoButton = undoEntryFor(role) && !readonlyMode ? h('button', {
            type: 'button',
            onClick: () => undo(role),
            disabled: busy || undoingId !== null,
            style: buttonStyle,
            'aria-label': t('undo.aria', { name: role.name })
          }, undoingId === role.id ? t('undo.busy') : t('undo.label')) : null;
          const saveButton = h('button', {
            type: 'button',
            onClick: () => save(role),
            disabled: saveDisabled,
            style: saveDisabled ? { ...buttonStyle, opacity: 0.5 } : primaryButtonStyle,
            'aria-label': t('save.aria', { name: role.name })
          }, savingId === role.id ? t('save.busy') : t('save'));
          const disabledControl = h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', cursor: busy || readonlyMode ? 'default' : 'pointer', padding: '4px 0' } },
            h('input', {
              type: 'checkbox',
              checked: draft.disabled,
              disabled: busy || readonlyMode,
              'aria-label': t('disabled.aria', { name: role.name }),
              onChange: (event) => setDraft(role.id, { disabled: event.target.checked })
            }),
            t('disabled.label'));
          const messageBlock = message ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, ...(compact ? { flexBasis: '100%' } : {}), color: message.kind === 'ok' ? 'var(--dsw-alias-state-success-primary, #22c55e)' : 'var(--dsw-alias-state-error-primary, #ef4444)' } },
            messageText(message),
            message.key === 'error.conflict' ? h('button', { type: 'button', onClick: () => retryAfterConflict(role.id), style: { ...buttonStyle, fontSize: 11, padding: '4px 8px', alignSelf: 'flex-start' }, 'aria-label': t('error.action.regetAria', { name: role.name }) }, t('error.action.reget')) : null,
            message.key === 'error.conflict' && message.params?.effortHint ? h('div', { style: { fontSize: 11 } }, t('error.hint.effort')) : null) : null;
          const copySources = (roles ?? []).filter((entry) => entry.id !== role.id).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
          const copyRouteSelect = copySources.length > 0 ? h('select', {
            value: '',
            disabled: busy || readonlyMode,
            style: { ...controlStyle, width: 'auto', fontSize: 11 },
            'aria-label': t('copyRoute.aria', { name: role.name }),
            onChange: (event) => {
              const source = copySources.find((entry) => entry.id === event.target.value);
              if (!source) return;
              const from = drafts?.[source.id] ?? normalizeDraft(source);
              setDraft(role.id, { provider: from.provider, model: from.model, reasoningEffort: from.reasoningEffort, fallbackProvider: from.fallbackProvider, fallbackModel: from.fallbackModel });
              setMessages((current) => ({ ...current, [role.id]: { kind: 'ok', key: 'copyRoute.done', params: { name: source.name } } }));
            }
          },
            h('option', { value: '' }, t('copyRoute.placeholder')),
            ...copySources.map((entry) => h('option', { value: entry.id }, entry.name))) : null;
          const noFallbackBadge = !isInherit && !draft.disabled && draft.fallbackProvider === ''
            ? h('span', { title: t('field.fallbackHelp'), style: statusBadgeStyle({ background: '#f59e0b1f' }) }, h('span', { style: dotStyle('#f59e0b') }), t('card.noFallback'))
            : null;
          const fallbackSameHint = state.fallbackSame
            ? h('span', { role: 'status', style: { fontSize: 11, color: 'var(--dsw-alias-state-warning-primary, #f59e0b)' } }, t('card.fallbackSame'))
            : null;
          const nameChildren = [role.name, draft.disabled ? t('card.disabledSuffix') : '', dirty ? t('card.dirtySuffix') : ''];

          if (compact) {
            return h('div', {
              key: role.id,
              style: { ...cardStyle, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 8, opacity: draft.disabled ? 0.7 : 1, ...cardAccent },
              onFocusCapture: () => { focusedCardId = role.id; }
            },
              h('span', { title: describe(role) ?? role.name, style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, ...nameChildren),
              inheritHint ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flex: 'none' } }, inheritHint) : null,
              fallbackSameHint,
              tierBadge,
              noFallbackBadge,
              sealDot,
              h('span', { style: statusBadgeStyle(tone) }, h('span', { style: dotStyle(tone.dot) }), t(tone.key)),
              providerSelect,
              modelSelect,
              effortSelect,
              disabledControl,
              undoButton,
              saveButton,
              messageBlock);
          }
          return h('div', {
            key: role.id,
            style: { ...cardStyle, opacity: draft.disabled ? 0.7 : 1, contentVisibility: 'auto', containIntrinsicSize: 'auto 220px', ...cardAccent },
            onFocusCapture: () => { focusedCardId = role.id; }
          },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
                h('span', { style: dotStyle(phaseTone) }),
                h('span', { title: role.name, style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ...nameChildren)),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 'none' } },
                tierBadge,
                noFallbackBadge,
                sealDot,
                h('span', { style: statusBadgeStyle(tone) }, h('span', { style: dotStyle(tone.dot) }), t(tone.key)))),
            describe(role) ? renderDescription(describe(role), phaseTone) : null,
            inheritHint ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, inheritHint) : null,
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              renderField(t('field.provider'), t('field.providerHelp'), providerSelect),
              renderField(t('field.model'), t('field.modelHelp'), modelSelect),
              renderField(t('field.effort'), t('field.effortHelp'), effortSelect),
              renderField(t('field.fallback'), t('field.fallbackHelp'), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } }, fallbackProviderSelect, fallbackModelSelect)),
              fallbackSameHint),
            effortEntry?.status === 'error' ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, t('effort.errorLine', { error: effortEntry.error })) : null,
            messageBlock,
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 12 } },
              disabledControl,
              copyRouteSelect,
              undoButton,
              saveButton));
        };

        const onboardSection = h('div', { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: '12px 16px', background: 'var(--dsw-alias-bg-base)', display: 'flex', flexDirection: 'column', gap: 8 } },
          h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', cursor: teamDefault === null || savingTeamDefault || readonlyMode ? 'default' : 'pointer' } },
            h('input', { type: 'checkbox', checked: teamDefault === true, disabled: teamDefault === null || savingTeamDefault || readonlyMode, 'aria-label': t('team.defaultAria'), onChange: (event) => saveTeamDefault(event.target.checked) }),
            t('team.defaultLabel')),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '18px' } }, t('onboard.presetHint')),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '18px' } }, t('onboard.teamHint')),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '18px' } }, t('onboard.rolesHint')));

        const tabs = [
          { id: 'all', labelKey: 'tab.all', count: total },
          ...PHASE_SECTIONS.map((phase) => ({ id: phase.id, labelKey: 'phase.' + phase.id, count: countOf(phase.id) })),
          { id: 'other', labelKey: 'phase.other', count: countOf('other') }
        ];
        const visibleSections = activeTabState === 'all' ? sections : sections.filter((section) => section.id === activeTabState);
        const activeIndex = tabs.findIndex((tab) => tab.id === activeTabState);
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

        return h('div', { 'data-dsh-orchestrator-kit-settings': '', style: { display: 'flex', flexDirection: 'column', gap: 16 }, onKeyDown: onPanelKeyDown },
          h('style', null, SUPPORT_STYLES + '\n' + UPDATE_STYLES),
          h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 } },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, t('header.title')),
              h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', title: t('header.countsTitle'), style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } },
                h('span', { style: statStyle }, String(total)), t('header.countRoles'),
                h('span', { style: statStyle }, String(routedCount)), t('header.countRouted'),
                h('span', { style: statStyle }, String(total - routedCount)), t('header.countInherit'),
                h('span', { style: statStyle }, String(disabledCount)), t('header.countDisabled'),
                noFallbackCount > 0 ? h('span', { style: { color: 'var(--dsw-alias-state-warning-primary, #f59e0b)' } }, t('header.countNoFallback', { n: String(noFallbackCount) })) : null)),
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
              disabled: refreshing || savingId !== null || undoingId !== null,
              style: { ...buttonStyle, flex: 'none', opacity: refreshing || savingId !== null ? 0.5 : 1 },
              'aria-label': t('refresh.aria')
            }, refreshing ? t('refresh.busy') : t('refresh'))),
          onboardSection,
          supportBanner,
          UpdateSettings({ updater, whatsNew, t }),
          messages.__load ? h('div', { style: bannerStyle('error') }, messageText(messages.__load)) : null,
          readonlyMode ? h('div', { style: bannerStyle('warning') },
            h('div', { style: { fontWeight: 600 } }, t('readonly.title')),
            t('readonly.notice')) : null,
          messages.__catalog ? h('div', { style: bannerStyle('error') }, messageText(messages.__catalog)) : null,
          messages.__invalid ? h('div', { style: bannerStyle('warning') }, messageText(messages.__invalid)) : null,
          catalogPartialWarning
            ? h('div', { style: bannerStyle('warning') },
                catalog.failedProviders?.length > 0
                  ? t('banner.partialCatalog', { providers: catalog.failedProviders.join(', ') })
                  : t('banner.partialCatalogGeneric'))
            : null,
          catalogEmpty ? h('div', { style: bannerStyle('neutral') }, t('banner.catalogEmpty')) : null,
          h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', style: srOnlyStyle },
            lastNotice ? messageText(lastNotice) : ''),
          h('details', { open: legendOpen, onToggle: (event) => { setLegendOpen(event.target.open); storedPrefs = { ...storedPrefs, legend: event.target.open }; writeStoredPrefs(storedPrefs); }, style: legendStyle },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontSize: 12 } }, t('legend.summary')),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 8, marginTop: 8 } },
              h('div', {}, h('span', { style: legendTermStyle }, t('legend.provider')), t('legend.providerText')),
              h('div', {}, h('span', { style: legendTermStyle }, t('legend.model')), t('legend.modelText')),
              h('div', {}, h('span', { style: legendTermStyle }, t('legend.effort')), t('legend.effortText')),
              h('div', {}, h('span', { style: legendTermStyle }, t('legend.disabled')), t('legend.disabledText')),
              h('div', {}, h('span', { style: legendTermStyle }, t('legend.inherit')), t('legend.inheritText')),
              h('div', {}, t('legend.subagent')),
              h('div', {}, t('legend.apply')),
              lastServerTiming ? h('div', {}, t('legend.timing', { reads: lastServerTiming.reads ?? '—', catalog: lastServerTiming.catalog ?? '—' })) : null),
            h('div', { style: { marginTop: 12, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 } },
              h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, t('profile.summary')),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } },
                h('button', { type: 'button', onClick: exportProfile, disabled: refreshing, style: { ...buttonStyle, fontSize: 11, padding: '4px 8px' } }, t('profile.export')),
                h('button', { type: 'button', onClick: importProfile, disabled: refreshing || importing || readonlyMode, style: { ...buttonStyle, fontSize: 11, padding: '4px 8px' } }, importing ? t('refresh.busy') : t('profile.import')),
                h('input', { type: 'file', accept: 'application/json', style: srOnlyStyle, 'aria-hidden': 'true', disabled: readonlyMode, onChange: onImportFile, ref: (node) => { profileFileInputRef.current = node; } })),
              profileExportText !== null
                ? h('textarea', { readOnly: true, rows: 6, value: profileExportText, onChange: () => {}, style: { ...controlStyle, fontFamily: 'monospace', fontSize: 11, marginTop: 8 } })
                : null,
              groups.length > 0 ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 } },
                h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, t('preset.title')),
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } },
                  h('select', { value: preset.goal, 'aria-label': t('preset.title'), style: { ...controlStyle, width: 'auto', fontSize: 11 }, onChange: (event) => setPreset((current) => ({ ...current, goal: event.target.value, pending: null })) },
                    ...['economy', 'balanced', 'rigorous'].map((goal) => h('option', { value: goal }, t('preset.' + goal)))),
                  ...['fast', 'deep'].map((slot) => h('select', { key: slot, value: preset[slot], 'aria-label': t('preset.' + slot), style: { ...controlStyle, width: 'auto', fontSize: 11 }, onChange: (event) => setPreset((current) => ({ ...current, [slot]: event.target.value, pending: null })) },
                    h('option', { value: '' }, t('preset.' + slot)), ...presetPairOptions)),
                  h('button', { type: 'button', disabled: preset.fast === '' || preset.deep === '' || readonlyMode || importing || !roles, onClick: () => setPreset((current) => ({ ...current, pending: presetDocOf(current.goal, current.fast, current.deep) })), style: { ...buttonStyle, fontSize: 11, padding: '4px 8px' } }, t('preset.review'))),
                preset.pending !== null ? h('div', { role: 'status', style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                  h('span', {}, t('preset.confirm', { goal: t('preset.' + preset.goal), count: String(Object.keys(preset.pending.roles).length) })),
                  h('button', { type: 'button', disabled: readonlyMode || importing, onClick: () => { const doc = preset.pending; setPreset((current) => ({ ...current, pending: null })); runImport(doc); }, style: { ...buttonStyle, fontSize: 11, padding: '4px 8px' } }, t('preset.apply')),
                  h('button', { type: 'button', onClick: () => setPreset((current) => ({ ...current, pending: null })), style: { ...buttonStyle, fontSize: 11, padding: '4px 8px' } }, t('batch.cancel'))) : null) : null,
              h('details', {
                onToggle: (event) => { if (!event.target.open) setEventsState((current) => ({ ...current, open: false })); else if (eventsState.open === false) loadEvents(); },
                style: { marginTop: 4 }
              },
                h('summary', { style: { cursor: 'pointer', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('events.summary')),
                h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 } },
                  eventsState.loading
                    ? h('div', {}, t('refresh.busy'))
                    : eventsState.error !== null
                      ? h('div', {}, t('events.loadError', { error: eventsState.error }))
                      : eventsState.events.length === 0
                        ? h('div', {}, t('events.empty'))
                        : eventsState.events.map((record, index) => h('div', { key: index }, t('events.entry', {
                            time: record.at ?? '—',
                            id: record.id ?? '—',
                            summary: eventSummaryOf(record)
                          }))))),
              h('details', {
                onToggle: (event) => { if (!event.target.open) setDiagnosticsState((current) => ({ ...current, open: false })); else if (diagnosticsState.open === false) loadDiagnostics(); },
                style: { marginTop: 4 }
              },
                h('summary', { style: { cursor: 'pointer', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('diagnostics.summary')),
                h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 } },
                  diagnosticsState.loading
                    ? h('div', {}, t('refresh.busy'))
                    : diagnosticsState.error !== null
                      ? h('div', {}, t('diagnostics.loadError', { error: diagnosticsState.error }))
                      : diagnosticsState.report !== null && !diagnosticsState.report.craftAvailable
                        ? h('div', {}, t('diagnostics.craftMissing'))
                        : null,
                  diagnosticsState.report !== null && diagnosticsState.error === null
                    ? [
                        ...diagnosticsLinesOf(diagnosticsState.report).map(([key, line]) => h('div', { key }, line)),
                        h('div', { key: 'copy', style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } },
                          h('button', { type: 'button', onClick: copyDiagnostics, style: { ...buttonStyle, fontSize: 11, padding: '4px 8px' } }, t('diagnostics.copy')),
                          diagCopy !== null ? h('span', { role: 'status' }, t(diagCopy.copied ? 'diagnostics.copied' : 'diagnostics.copyFallback')) : null),
                        diagCopy !== null && !diagCopy.copied
                          ? h('textarea', { key: 'copyText', readOnly: true, rows: 6, value: diagCopy.text, onChange: () => {}, style: { ...controlStyle, fontFamily: 'monospace', fontSize: 11 } })
                          : null
                      ]
                    : null)))),
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
              h('option', { value: 'compact' }, t('density.compact')))),
          h('div', { role: 'tablist', 'aria-label': t('tablist.aria'), style: tabRowStyle, onKeyDown: onTabListKeyDown },
            tabs.map((tab, index) => h('button', {
              key: tab.id,
              id: `orch-tab-${index}`,
              type: 'button',
              role: 'tab',
              'aria-selected': activeTabState === tab.id,
              'aria-controls': 'orch-role-panel',
              tabIndex: activeTabState === tab.id ? 0 : -1,
              onClick: () => setActiveTab(tab.id),
              style: tabStyle(activeTabState === tab.id)
            }, t(tab.labelKey), h('span', { style: { marginLeft: 8, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' } }, tab.count), h('span', { title: t('tab.breakdownTitle'), style: { marginLeft: 8, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums', fontSize: 11 } }, breakdownText(tab.id))))),
          h('div', { role: 'tabpanel', id: 'orch-role-panel', 'aria-labelledby': `orch-tab-${activeIndex}`, style: { display: 'flex', flexDirection: 'column', gap: 16 } },
            roles === null
              ? (messages.__load ? null : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, t('empty.loading')))
              : roles.length === 0
                ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, t('empty.noRoles'))
                : (activeTabState === 'all' ? sections.reduce((sum, section) => sum + section.roles.length, 0) : (sections.find((section) => section.id === activeTabState)?.roles.length ?? 0)) === 0 && (activeTabState === 'all' ? total : countOf(activeTabState)) > 0
                  ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, t('empty.noMatch'))
                  : visibleSections.length === 0
                    ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' } }, t('empty.noGroup'))
                    : visibleSections.map((section) => {
                        const batchTarget = batchSourceOf(section.roles);
                        const batchBusy = batchPhase === section.id;
                        return h('div', { key: section.id, style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                        h('div', { style: sectionTitleStyle },
                          h('span', { style: dotStyle(PHASE_TONE[section.id] ?? PHASE_TONE.other) }),
                          t('phase.' + section.id),
                          h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' } }, section.roles.length),
                          activeTabState !== 'all' ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' } },
                            batchBusy
                              ? [
                                  h('span', { key: 'busy', style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, t('batch.busy')),
                                  h('button', { key: 'cancel', type: 'button', onClick: () => { cancelRef.current = true; }, style: { ...buttonStyle, fontSize: 11, padding: '4px 8px' } }, t('batch.cancel'))
                                ]
                              : h('button', {
                                  type: 'button',
                                  onClick: () => runBatch(section, batchTarget),
                                  disabled: batchTarget === null || batchPhase !== null || readonlyMode,
                                  style: batchTarget === null ? { ...buttonStyle, fontSize: 11, padding: '4px 8px', opacity: 0.5 } : { ...buttonStyle, fontSize: 11, padding: '4px 8px' },
                                  'aria-label': t('batch.applyAria', { phase: t('phase.' + section.id) })
                                }, t('batch.apply')))
                            : null),
                        h('div', { style: gridStyle }, section.roles.map((role) => renderCard(role, density === 'compact'))));
                      })));
      };
    }

    const updater = createUpdater();
    const whatsNew = createWhatsNew();

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const injectScope = (deps, setup) => {
          if (ctx.inject === undefined) return [];
          const fiber = ctx.inject(deps, setup);
          return [() => fiber.dispose()];
        };
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
        for (const off of injectScope(['remote.pluginManager'], (scope) => {
          updater.manager = scope.remote?.pluginManager;
          scope.effect(() => () => { updater.manager = undefined; }, 'update: manager binding');
        })) ctx.effect(() => off, 'update: plugin manager scope');
        ctx.effect(() => {
          const timerId = window.setTimeout(() => { updater.check(); }, 15000);
          timerId.unref?.(); // Node test runs only; a browser timer is a number
          whatsNew.load();
          return () => window.clearTimeout(timerId);
        }, 'update: auto-check');
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: NS,
          order: 96,
          label: () => ctx.locale.bind(NS)('nav.label'),
          locale: NS
        }, createSettings(ctx)));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'whats-new',
          locale: NS
        }, createWhatsNewDialog(ctx, whatsNew)));
      }
    };
  }
});
