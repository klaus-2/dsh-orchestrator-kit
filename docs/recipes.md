# Budget recipes

Three ready-to-adapt routing budgets for the installed role cards. Each recipe pins only the roles named in its YAML; every other role keeps `model: inherit` and follows the chat default. The identifiers below are placeholders in the `example-hub/flash-a` style, and the effort levels (`low`, `medium`, `high`) are illustrative too — replace them with provider, model and effort ids that your live catalog and model metadata actually list. No credentials belong in these files; the panel never stores or displays a key.

The server validates any pinned route against the live catalog before it writes, and it validates any pinned reasoning effort against the model's own metadata. A route that is not listed is rejected with 409; an unavailable catalog is rejected with 503 and nothing is written.

Source: `index.js:805-816` (catalog validation), `index.js:818-837` (effort validation), `index.js:204` (`inherit` cannot carry a provider), `client.js:971-984` (which fields the panel sends).

## 1. Economical

Pin only the two roles that shape the plan before implementation: `arch-advisor` and `planner`. All other roles inherit the chat default. This is the lowest-cost way to keep planning quality deliberate while letting the remaining roles use whatever the session already provides.

```yaml
#arch-advisor.md — cheap, fast planning checks
---
name: arch-advisor
description: "[Planning] Does: review architecture decisions / Skip: no design choice is pending"
provider: example-hub
model: flash-a
#reasoning_effort omitted: the model default is used
---
```

```yaml
#planner.md — cheap, fast task decomposition
---
name: planner
description: "[Planning] Does: turn a goal into a verifiable plan / Skip: scope is already explicit"
provider: example-hub
model: flash-a
---
```

Rationale by phase: Discovery and Verification stay on the chat default, so their cost is whatever the host already selected. Only Planning carries a pinned route, and only for the two roles whose output every later phase consumes.

## 2. Balanced

Pin the four advisory and planning roles: `repo-scout`, `docs-scout`, `arch-advisor` and `planner`. Leave execution and review roles on inherit. This spends more up front to reduce rework, while implementation and verification still follow the session default.

```yaml
#repo-scout.md — stronger local analysis
---
name: repo-scout
description: "[Discovery] Does: search the local codebase / Skip: the answer is already in context"
provider: example-hub
model: quality-a
reasoning_effort: medium
---
```

```yaml
#docs-scout.md — stronger external research
---
name: docs-scout
description: "[Discovery] Does: read external docs and examples / Skip: no external source is needed"
provider: example-hub
model: quality-a
reasoning_effort: medium
---
```

```yaml
#arch-advisor.md and planner.md — same pinned pair as the economical recipe
---
name: arch-advisor
description: "[Planning] Does: review architecture decisions / Skip: no design choice is pending"
provider: example-hub
model: quality-a
reasoning_effort: medium
---
```

Rationale by phase: Discovery and Planning are pinned, so the two phases that decide what gets built use a stronger route. Planning & Execution's remaining roles and the whole Verification, QA & Docs phase inherit, keeping the per-turn cost close to the economical recipe.

## 3. Max quality

Pin all twenty installed roles to the same strong route. This removes inherit entirely and makes behavior reproducible across machines and sessions, at the highest cost.

```yaml
#Applied to every installed role card, one at a time
---
name: implementer
description: "[Planning] Does: write the scoped implementation / Skip: no code change is requested"
provider: example-hub
model: quality-a
reasoning_effort: high
disabled: false
---
```

Rationale by phase: Discovery, Planning & Execution, and Verification, QA & Docs all use the same pinned route, so results no longer depend on the chat default. Note that a `disabled: false` line is equivalent to omitting the key — the canonical enabled state is no `disabled` key at all. To disable a role, use the batch/phase controls or set `disabled: true`; the server removes the key again when the role is re-enabled.

Source: `client.js:1077-1155` (batch apply to phase), `index.js:274-278` (`disabled` true sets the key, false removes it), `index.js:211` (enabled is the absence of a true flag).
