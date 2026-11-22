---
name: codemap
description: "Generate comprehensive hierarchical codemaps for UNFAMILIAR repositories. Expensive operation — only use when explicitly asked for codebase documentation or initial repository mapping."
---

> dev-flow suite playbook — harness-neutral. State lives at `.devflow/maps/`; mapping delegates discovery to `repo-scout` and folder documentation writes to `implementer`.

# Codemap

Understand and map repositories by creating hierarchical codemaps.

## When to Use

- User asks to understand or map a repository
- User wants codebase documentation
- Starting work on an unfamiliar codebase

## Workflow

### Step 1: Check for Existing State

First, check if `.devflow/maps/codemap.json` exists in the repo root.

- If `.devflow/maps/codemap.json` exists: Skip to Step 3 (Detect Changes) — no re-initialization needed.
- If it does not exist, check for legacy codemap state files (`codemap.json` or `cartography.json` in a legacy state directory or repo root); running `codemap.mjs changes --root ./` automatically migrates them into `.devflow/maps/codemap.json` when found.
- If no state exists anywhere: Continue to Step 2 (Initialize).

### Step 2: Initialize (Only if no state exists)

1. **Analyze the repository structure** — list files and understand directories (use `repo-scout` on large repos).
2. **Infer patterns** for **core code/config files ONLY** to include:
   - **Include**: `src/**/*.ts`, `package.json`, etc.
   - **Exclude (MANDATORY)**: Exclude tests, documentation, and translations:
     - Tests: `**/*.test.ts`, `**/*.spec.ts`, `tests/**`, `__tests__/**`
     - Docs: `docs/**`, `*.md` (except root `README.md` if needed), `LICENSE`
     - Build/Deps: `node_modules/**`, `dist/**`, `build/**`, `*.min.js`
   - Respect `.gitignore` automatically.
3. **Run `codemap.mjs init`** — the script lives in this skill at `playbooks/codemap/scripts/codemap.mjs`. Run it with cwd = the TARGET REPOSITORY and pass the repo as `--root ./` (never run `--root` against this skill's own directory):

```bash
node "<skill-dir>/playbooks/codemap/scripts/codemap.mjs" init \
  --root ./ \
  --include "src/**/*.ts" \
  --exclude "**/*.test.ts" --exclude "dist/**" --exclude "node_modules/**"
```

This creates:
- `.devflow/maps/codemap.json` — file and folder hashes for change detection
- Empty `codemap.md` files in all relevant subdirectories

4. **Delegate codemap writing to `implementer` (with `repo-scout` when discovery is needed)** — spawn one `implementer` lane per folder with a disjoint `<folder>/codemap.md` write scope to read the directory and write its `codemap.md`.

### Step 3: Detect Changes (If state already exists)

1. **Run `codemap.mjs changes`** to see what changed:

```bash
node "<skill-dir>/playbooks/codemap/scripts/codemap.mjs" changes \
  --root ./
```

2. **Review the output** — it reports added, removed, and modified files plus affected folders.
3. **Update only affected codemaps** — dispatch one `implementer` lane per affected folder (using `repo-scout` if cross-module context is needed) to update its `codemap.md`.
4. **Run `update`** to save the new state:

```bash
node "<skill-dir>/playbooks/codemap/scripts/codemap.mjs" update \
  --root ./
```

### Step 4: Finalize Root Codemap

Once all targeted subdirectories are mapped, the orchestrator (or `tech-writer` / scoped `implementer`) creates or updates the root `codemap.md`. This file serves as the **Master Entry Point** for any agent or human entering the repository.

1. **Map Root Assets**: Document root-level files (e.g., `package.json`, `index.ts`, manifest configs) and the project's overall purpose.
2. **Aggregate Sub-Maps**: Create a "Repository Directory Map" section. For every folder with a `codemap.md`, extract its **Responsibility** summary and include it in a table or list in the root map.
3. **Cross-Reference**: Ensure the root map contains relative paths to every sub-map so agents jump straight to the right module.

### Step 5: Register Codemap in AGENTS.md

The harness loads `AGENTS.md` into agent context on every session. To ensure agents automatically discover and use the codemap, update (or create) `AGENTS.md` at the repo root:

1. If `AGENTS.md` exists and already contains a `## Repository Map` section, skip this step.
2. If `AGENTS.md` exists without a `## Repository Map` section, append the section below.
3. If `AGENTS.md` does not exist, create it with the section below.

```markdown
## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:
- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`.
```

This is idempotent — repeated codemap runs detect the existing section and skip without duplication.

## Codemap Content

Each `codemap.md` uses precise technical terminology to document the implementation:

- **Responsibility** — Specific role of this directory using standard software engineering terms (e.g., "Service Layer", "Data Access Object", "Middleware").
- **Design** — Patterns and abstractions used (e.g., "Observer", "Singleton", "Factory", "Strategy") and core interfaces.
- **Flow** — Explicit data and control flow through the module, naming key functions and state transitions.
- **Integration** — Consumers and dependencies, using exact hook, event, or API names.

Example skeleton:

```markdown
# src/<dir>/
## Responsibility
<role of this directory>
## Design
<patterns and abstractions>
## Flow
<data in -> key calls -> data out>
## Integration
<consumers / dependencies>
```

For the root map, aggregate the same headings plus a Directory Map table:

| Directory | Responsibility | Link |
|-----------|----------------|------|
| `src/<dir>/` | <one-line summary> | [View Map](src/<dir>/codemap.md) |
