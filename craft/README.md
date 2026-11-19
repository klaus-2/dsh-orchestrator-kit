# Craft bundle — dev-flow skill + 20 role cards

This folder is the portable payload of the kit: the Craft dev-flow pipeline
skill, its nine playbooks plus the codemap script, and the twenty role cards
that the Orchestrator panel routes.

## Layout

```
craft/
├── agents/            20 role cards (one .md per role)
└── skills/
    └── dev-flow/      SKILL.md + playbooks/*.md + playbooks/codemap/scripts/codemap.mjs
```

## Install

Copy the two trees to the agent home directory (`~` = your OS user home):

| Source | Destination |
| --- | --- |
| `craft/agents/*` | `<agents home>/agents/` |
| `craft/skills/dev-flow/*` | `<agents home>/skills/dev-flow/` |

`<agents home>` is `$DSH_AGENTS_HOME` when the host environment defines it,
otherwise `~/.agents` — the same resolution the plugin applies
(index.js `agentsRootOf`: env override, then `~/.agents`). No
`$DSH_SKILLS_HOME` equivalent is honored by this kit; skills always install
under the resolved `<agents home>/skills/`.

Keep the inner structure of `craft/skills/dev-flow/` intact — `SKILL.md`
references its `playbooks/` subfolder by relative path.

PowerShell:

```powershell
$home_ = if ($env:DSH_AGENTS_HOME) { $env:DSH_AGENTS_HOME } else { "$HOME\.agents" }
New-Item -ItemType Directory -Force -Path "$home_\agents","$home_\skills" | Out-Null
Copy-Item -Path "<kit>/craft/agents/*" -Destination "$home_\agents\" -Recurse -Force
Copy-Item -Path "<kit>/craft/skills/dev-flow/*" -Destination "$home_\skills\dev-flow\" -Recurse -Force
```

POSIX shell:

```sh
agents_home="${DSH_AGENTS_HOME:-$HOME/.agents}"
mkdir -p "$agents_home/agents" "$agents_home/skills"
cp -r craft/agents/. "$agents_home/agents/"
cp -r craft/skills/dev-flow/. "$agents_home/skills/dev-flow/"
```

The install destination matches the plugin's own resolution; there is no
separate environment override for the skills root.

## Role cards and model routing

Every card ships with `model: inherit` and no `provider:` line. That is
deliberate: the bundle stays harness- and provider-neutral, and the plugin
panel (Settings → Orchestrator in DeepSeek Harness) configures the actual
provider, model and reasoning-effort route per role after installation —
written to the *installed* copies under the resolved agents home, never to
these sources. Do not hardcode routes in the cards; a host that supports
overrides reads them from its own configuration.

## Update

Re-copying over an existing install overwrites cards and playbooks in place.
Nothing else is written outside the two destination folders.
