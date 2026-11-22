---
name: reflect
description: "Review recent work, find repeated workflow patterns, and suggest reusable skills, agents, commands, config changes, or playbooks. Use when the user asks to learn from past sessions, improve recurring workflows, or identify what should be turned into reusable agent instructions."
---

> dev-flow suite playbook — harness-neutral.
> This workflow reflects over the current project's tracked assets, `.devflow/` artifacts, and notes. Orchestrator-owned.

# Reflect

Reflect is an orchestrator-owned workflow for learning from repeated work. It
looks back over recent work in this project — task progress files, plans,
verification evidence, delivery reports, notes, and existing agent assets — then
recommends the smallest useful improvement: a skill, custom agent, command,
configuration change, prompt rule, documentation playbook, or no change.

The goal is to identify real repeated friction and suggest practical
improvements with evidence.

## When to Use

Use Reflect when the user asks to:

- run `/reflect` or `/reflect <focus>`;
- learn from recent sessions or repeated workflows;
- find work they keep doing manually;
- improve their agent setup based on actual usage;
- review whether a recurring process should become a reusable playbook;
- turn repeated workflow friction into a safer future default.

Skip Reflect for ordinary implementation work, one-off debugging, broad
architecture review, or speculative agent creation without workflow evidence.

## Core Contract

Reflect must be conservative and evidence-driven.

Required behavior:

- inspect existing assets before suggesting new ones;
- prefer recent, repeated, user-visible friction over isolated incidents;
- recommend the smallest useful form;
- treat "create nothing" as a successful result when evidence is weak;
- ask before changing prompts, skills, commands, agents, MCP access, or config
  via `ask_user_question` (or the host's structured-question tool), never plain
  text;
- reuse or extend existing assets instead of duplicating them;
- explain reload/restart requirements when a config, prompt, agent, skill, or
  plugin change needs the app to refresh.

## Evidence Sources

Use available evidence in this order:

1. Current conversation and explicit user instructions.
2. Project-local guidance and artifacts: `AGENTS.md`/`CLAUDE.md`, plans
   (`.devflow/plans/`), verification evidence (`.devflow/evidence/`), delivery
   reports, task progress files, codemaps, `.devflow/runs/` tombstones,
   `.devflow/notes/`, and git history (`git log` for repeated fix-churn on the
   same area).
3. Existing skills, commands, agents, and the current app's configuration.
4. Recent session artifacts of the current app when available and safe to
   inspect.
5. External docs only when a proposed workflow depends on a third-party tool or
   library whose behavior needs confirmation (check available search MCPs first,
   then native web search).

Respect privacy and safety boundaries. Inspect only project-relevant files;
leave unrelated personal files, credentials, private messages, and external
accounts untouched unless the user explicitly asks and the workflow requires it.

## Workflow

With no arguments, review recent work broadly. With arguments, focus the review
on that workflow area while still checking whether existing assets already cover
it.

### 1. Inventory Existing Assets

Before proposing anything, identify what already exists:

- bundled and user-installed skills;
- custom agents and their guidance;
- custom commands;
- prompt rules in `AGENTS.md`/`CLAUDE.md` and their mirrors;
- project playbooks, docs, codemaps, and local workflow notes.

If an existing asset already covers the candidate, recommend extending or using
that asset instead of creating a near-duplicate.

### 2. Find Repeated Workflow Patterns

Look across the evidence for friction that repeats:

- the same manual sequence performed multiple times;
- repeated fix-churn in the same area (`git log --oneline -- <path>` showing
  reverts and re-fixes);
- verification steps that had to be redone because they were not captured;
- questions the user had to answer more than once;
- gates that were skipped and later caused rework.

Score each candidate pattern:

- `0.7–1.0`: clear repeated pattern, strong evidence
- `0.5–0.7`: uncertain outcome, limited evidence
- `< 0.5`: skip or mark as "needs more evidence"

### 3. Propose the Smallest Useful Improvement

For each surviving pattern, recommend exactly one asset form — the smallest one
that removes the friction:

- a skill (recurring workflow with a trigger);
- a command (frequent explicit invocation);
- an agent role (recurring specialist dispatch);
- a prompt rule (always-on behavior, e.g. in `AGENTS.md`);
- a playbook/document (reference material);
- a configuration change;
- no change (the friction is not worth the asset).

Every recommendation must state: the pattern and its evidence, the proposed
asset, why the smallest form is enough, and the estimated time saved
(`High | Medium | Low`).

### 4. Output Format

Return a compact report:

```text
Reflection Report — <project> (<date>)

Findings
- <pattern>: <evidence — where it repeated, how often>.
  - Confidence: <0-1>
  - Impact: High | Medium | Low

Recommended changes
- <asset>: <purpose>
  - Smallest form: skill | command | agent | prompt rule | playbook | config
  - Confidence: <0-1>
  - Estimated time saved: High | Medium | Low

Skipped
- <candidate>: why not worth packaging now.

Needs more evidence
- <candidate>: what would make it actionable.
```

### 5. Ask Before Building

Wait for explicit confirmation before creating recommended assets. Present the
report and ask the user (via `ask_user_question` or the host's
structured-question tool) which recommendations to implement. Implemented assets
follow this suite's rules: harness-neutral, model-neutral, and portable across
environments.
