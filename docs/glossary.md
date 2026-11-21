# Glossary

This page maps the vocabulary of the settings panel to the strings that actually ship in the locale files. Every localized term below is copied verbatim from the `panel` object of `locale/en.json`, `locale/pt-BR.json` and `locale/zh.json`; no new translation is introduced. Terms that have no panel key are listed separately and are left untranslated on purpose.

## Localized terms

| English term (panel key value) | Panel key | pt-BR | zh-CN | Meaning |
| --- | --- | --- | --- | --- |
| All roles | `tab.all` | Todos os papéis | 全部角色 | A role is one installed role-card entry listed in the panel. |
| Filter roles by phase | `tablist.aria` | Filtrar papéis por fase | 按阶段筛选角色 | A phase is one of the grouped role stages used to filter the card list. |
| Failed to load model catalog: {error} | `banner.catalogError` | Falha ao carregar o catálogo de modelos: {error} | 加载模型目录失败：{error} | The model catalog, also called the harness catalog, is the live provider/model inventory used for validation. |
| Reasoning effort | `field.effort` | Esforço de raciocínio | 推理强度 | How long the model thinks before answering. |
| Chat default (inherit) | `inherit.label` | Padrão do chat (herdar) | 对话默认（继承） | Inherit removes the saved route and follows the chat default. |
| Role routing | `header.title` | Roteamento por papel | 角色路由 | A route is the provider/model pair assigned to a role. |
| — skip the role when dispatching work. | `legend.disabledText` | — ignora o papel ao despachar trabalho. | — 分派工作时跳过此角色。 | Dispatch is the act of handing work to a role; a disabled role is skipped. |
| Apply to phase | `batch.apply` | Aplicar à fase | 应用到阶段 | A batch applies the current draft route to every role in one phase. |
| Routing profiles | `profile.summary` | Perfis de roteamento | 路由配置集 | A profile is an exportable set of per-role routing settings. |
| Failed to load the change log: {error} | `events.loadError` | Falha ao carregar o histórico: {error} | 加载更改日志失败：{error} | The change log, or audit trail, records saved route changes. |
| Read-only mode | `readonly.title` | Modo somente leitura | 只读模式 | In read-only mode the server refuses all writes; controls are shown for reference. |

Source: `locale/en.json:9` (`header.title`), `locale/en.json:18` (`tab.all`), `locale/en.json:23` (`tablist.aria`), `locale/en.json:34` (`field.effort`), `locale/en.json:37` (`inherit.label`), `locale/en.json:56` (`banner.catalogError`), `locale/en.json:69` (`legend.disabledText`), `locale/en.json:103` (`batch.apply`), `locale/en.json:110` (`profile.summary`), `locale/en.json:118` (`events.loadError`), `locale/en.json:128` (`readonly.title`); the same keys in `locale/pt-BR.json` and `locale/zh.json` (Portuguese and Chinese values).

## Code identifiers (no panel key)

These two terms appear in the implementation and in the design documents but have no translated panel string. They are used verbatim in every locale, so no pt-BR or zh-CN form is invented here.

| Identifier | Localized form | Meaning |
| --- | --- | --- |
| `content-visibility` | none; identifier used verbatim | A layout reservation applied to comfortable grid cards so scrolling stays smooth. |
| `expectedMtimeMs` | none; identifier used verbatim | The modification time a client sends with a save; the server rejects the save with 409 when the card changed on disk. |

Source: `index.js:18` (`expectedMtimeMs` request field), `index.js:751-754` (validation), `index.js:786-788` and `index.js:893-895` (mtime guard); `client.js:972-974` (client sends the value); `README.md:65` (`content-visibility` layout note).
