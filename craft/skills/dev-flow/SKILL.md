---
name: dev-flow
description: "End-to-end Craft implementation pipeline across 20 phase-grouped roles and .devflow/ state. Clarifies ambiguous scope with grilling + ask_user_question, selects Route A (direct), B (standard: repo-scout -> scope-analyst -> planner -> plan-auditor -> run-conductor), C (adversarial hyperplan), or D (deepwork painted passes), enforces Contract-First freeze, Post-Parallel reconciliation, deterministic preflight, anti-flake test gate, delta re-verification, circuit breakers, corps review loop, security gate, and PR or atomic delivery. Triggers: 'dev-flow', 'full pipeline', 'end to end', 'implement properly', 'deepwork', 'pipeline completo', 'fluxo completo'."
---

# Dev Flow — Craft Implementation Pipeline

Select the minimum route that delivers a verified, reviewable change, then run every gate in order.

<harness-adaptation>
- **Harness & model neutrality**: Execute exclusively on the current host using its native tools. Follow the host and role-card routing; omit model selection from prompts and dispatches.
- **Team-first dispatch**: When Agent Teams is active (`subagent_role` + `subagent-catalog`), spawn Craft roles as durable Team members via `subagent_role` (the card body loads as their system prompt; pass only the concrete assignment, active peer names from `list_agents`, and disjoint write scope).
- **Fallback dispatch**: When `subagent_role` or the catalog is unavailable, read `agents/<role>.md` next to this `SKILL.md` for any of the **20 Craft roles** and pass its body + task context to `subagent` (or `subagent_fork` when inheriting current turns). If a card file is missing, brief the subagent with that role's duty from the roster below rather than skipping the gate.
- **Unified state**: Store pipeline artifacts under `.devflow/` (`plans/`, `drafts/`, `notes/`, `evidence/`, `runs/`, `maps/`).
- **Composition**: Read `playbooks/<name>.md` next to this `SKILL.md` when a step names one, and invoke sister skills (`grilling`, `hyperplan`, `review-loop`, `code-review-checklist`, `code-review-excellence`, `security-research`, `work-with-pr`, `github-triage`, `git-commit`, plus language test skills) by name without duplicating their internals.
- **External verification**: When docs, APIs, or error behavior are uncertain, check active search/docs MCP tools first (e.g., TinyFish, Context7), then native web search/fetch.
</harness-adaptation>

---

## STEP 0 — Clarify, Then Decide the Route

**0.1 — Clarify scope (`grilling` + `ask_user_question`).** When requirements leave room for interpretation (vague scope, undefined acceptance criteria, hidden assumptions, unstated constraints), load `grilling` and interrogate the request against the codebase before planning. Skip `grilling` when scope, inputs, and criteria are already concrete. Ask every user question anywhere in this pipeline via `ask_user_question` (or the host's structured-question tool) — never plain prose.

**0.2 — Choose and announce the route.** Pick the minimum route matching the task, announce task, chosen route, and rationale in one sentence, and proceed immediately (re-route aloud if mid-execution complexity shifts; feed matching `github-triage` output when starting from a backlog sweep):

| Situation | Route |
|---|---|
| **Trivial**: single file, `< ~10` lines, zero ambiguity | **A — DIRECT** |
| **Standard**: bounded feature, bugfix, or refactor with clear requirements | **B — STANDARD** |
| **High-stakes**: architecture decision, new subsystem, multi-system impact, contested scope, or public API/schema/behavior change | **C — ADVERSARIAL** |
| **Large multi-pass**: whole product/subsystem, cross-cutting architecture, unsafe-to-partially-ship migration, or sustained multi-lane effort | **D — DEEPWORK** |
| Touches a **security-sensitive surface** (auth, secrets, payments, file/subprocess handling, untrusted input parsing, permissions) | **B / C / D + SECURITY GATE** |

---

## IRON LAWS (Propagate Verbatim Into Every Worker & Reviewer Brief)

1. **Zero Deliberate Technical Debt**: Implement the definitive solution now with production-grade handling of edge cases, concurrency, memory, security, and observability. Replace deferral comments ("consider later") and unfinished placeholders with complete fixes — or escalate genuinely blocked work explicitly with its blocker — and limit code comments to the *why* of non-obvious decisions.
2. **Evidence Before Claims**: Run the full proving command fresh and read its output plus exit code in the current turn before claiming done, fixed, or passing. Replace hedging with fresh output, and verify every delegated worker's output independently via VCS/file diffs and test runs.
3. **Deanchor (`playbooks/deanchor.md`)**: Treat examples and templates as evidence of intent and constraints, never copyable form unless explicitly requested; derive original work from the underlying principle.
4. **Structured User Gates**: Route every question to the user through `ask_user_question` (or the host's structured-question tool).

---

## 20 CRAFT ROLES ACROSS 3 PHASES

| Phase | Role | Card (`agents/<role>.md`) | Write Scope | Duty |
|---|---|---|---|---|
| Discovery & Advisory | `repo-scout` | `agents/repo-scout.md` | read-only | Local codebase mapping & parallel search (`file:line` evidence) |
| Discovery & Advisory | `docs-scout` | `agents/docs-scout.md` | read-only | External docs, library/API verification, OSS examples, citations |
| Discovery & Advisory | `media-analyst` | `agents/media-analyst.md` | read-only | Screenshots, PDFs, diagrams, UI visual inspection |
| Discovery & Advisory | `arch-advisor` | `agents/arch-advisor.md` | read-only | Architecture tradeoffs, Deepwork pass gates, `3-Strike` debug escalation |
| Planning & Execution | `scope-analyst` | `agents/scope-analyst.md` | read-only | Pre-plan gap, hidden constraint, AI-slop, and ambiguity analysis |
| Planning & Execution | `planner` | `agents/planner.md` | `.devflow/plans/*.md`, `.devflow/drafts/*.md` | Formal executable plans with contracts, dependencies, and `verify` criteria |
| Planning & Execution | `plan-auditor` | `agents/plan-auditor.md` | read-only | Strict audit of `.devflow/plans/*.md`; returns binary `OKAY` or `REJECT` |
| Planning & Execution | `run-conductor` | `agents/run-conductor.md` | orchestrates execution | Executes `.devflow/plans/*.md` via flat 1-hop delegation, contract freeze, reconciliation & fresh `Verify` |
| Planning & Execution | `implementer` | `agents/implementer.md` | assigned disjoint scope | Scoped code/config changes under the Iron Laws |
| Planning & Execution | `debugger` | `agents/debugger.md` | assigned disjoint scope | Root-cause isolation & surgical fixes (`3-Strike` -> `arch-advisor`) |
| Verification, QA & Docs | `diff-reviewer` | `agents/diff-reviewer.md` | read-only | Merge-readiness review (`review-loop` + `code-review-checklist` + `code-review-excellence`, `Score: N/10`) |
| Verification, QA & Docs | `test-auditor` | `agents/test-auditor.md` | read-only | Behavioral coverage mapping, `1–10` regression risk gaps, weak/flaky test detection |
| Verification, QA & Docs | `test-writer` | `agents/test-writer.md` | test files + `.devflow/evidence/` | Failure-reproducing tests (loads matching test skill) & multi-run anti-flake checks |
| Verification, QA & Docs | `browser-qa` | `agents/browser-qa.md` | `.devflow/evidence/` | Live browser/UI/desktop QA (`playwright`/`chrome-devtools` MCP, `agent-desktop`); keeps browser tabs open unless told otherwise |
| Verification, QA & Docs | `error-auditor` | `agents/error-auditor.md` | read-only | Silent-failure, retry, and error-path audit (`CONFIRMED DEFECT` / `REQUIRES JUSTIFICATION` / `JUSTIFIED EXCEPTION`) |
| Verification, QA & Docs | `security-auditor` | `agents/security-auditor.md` | read-only | Trust-model security review (credible attack paths, violated invariant, smallest fix) |
| Verification, QA & Docs | `perf-auditor` | `agents/perf-auditor.md` | read-only | Latency, N+1, allocation, timer/process/listener leak, and hot-path audit |
| Verification, QA & Docs | `debt-auditor` | `agents/debt-auditor.md` | read-only | High-ROI maintainability audit (duplication, dead paths, tangled ownership) |
| Verification, QA & Docs | `docs-sync` | `agents/docs-sync.md` | docs-only | Fast reconciliation of behavior, config, and interface docs against verified source |
| Verification, QA & Docs | `tech-writer` | `agents/tech-writer.md` | docs-only | Durable README, architecture, API reference, changelog, and migration guides (source-grounded) |

---

## PIPELINE EXECUTION INVARIANTS (Applied Across Routes A–D)

1. **Contract-First Interface/Spec Freeze**: Before dispatching parallel implementation lanes (Routes B–D), `planner` defines and `run-conductor` freezes shared interfaces, data schemas, API contracts, file paths, and **disjoint write scopes**. Concurrent writers work strictly inside their frozen boundary.
2. **Post-Parallel Reconciliation**: Immediately after parallel writers finish, `run-conductor` (or the Lead in multi-lane direct runs) inspects all produced diffs against the frozen contract — verifying imports, types, signatures, and scope adherence — before running tests or semantic corps review.
3. **Deterministic Preflight**: Run cheap deterministic checks first — syntax checks, typecheck, lint, unit/parity tests, and build — and confirm **exit `0`** BEFORE dispatching any semantic review corps (`diff-reviewer`, `test-auditor`, `error-auditor`, `security-auditor`, `perf-auditor`, `debt-auditor`).
4. **Anti-Flake Multi-Run Test Verification Gate**:
   - **Discover**: Enumerate existing project test suites, scripts, and CI checks covering changed paths.
   - **Create when missing**: Dispatch `test-writer` (loading the matching language/framework test skill first) to write failure-reproducing tests for uncovered behavior; dispatch `browser-qa` for live UI/browser/desktop changes (logging evidence under `.devflow/evidence/` and keeping browser tabs open unless told otherwise).
   - **Run consecutively**: Execute affected suites back-to-back across multiple consecutive runs (e.g., 5–10x on behavioral or concurrent suites) to expose intermittent flakiness; fix root causes rather than masking failures with retries.
   - **Audit log**: Version new/updated tests with the code and record exact commands, run counts, outcomes, and diff links under `.devflow/evidence/`.
5. **Delta-Scoped Re-verification**: When fixes land after a review or gate finding, re-run only the affected deterministic checks, targeted anti-flake runs, and the impacted review lens(es) over the fix diff (`git diff` / changed files), avoiding redundant full passes while closing with one clean final run.
6. **Circuit Breakers**:
   - **Plan Review (`max 2 REJECTs`)**: Halt the `planner <-> plan-auditor` loop after **2 `REJECT` verdicts** and escalate the unresolved contention via `ask_user_question`.
   - **Review Loop (`single-pass clean exit`)**: Skip the mandatory 2nd `review-loop` round when Deterministic Preflight exits `0` AND a single-pass `workflow` (or corps) review yields **zero surviving Critical or Important findings**.
   - **Step-Back (`playbooks/step-back.md`)**: Trigger `playbooks/step-back.md` immediately after **2 misses from the same lane**, when patches/workarounds/shims start stacking, or on `3-Strike` debug failures (`debugger` -> `arch-advisor` -> propose cleaner direction via `ask_user_question`).

---

## Route A — DIRECT

1. Implement directly under the Iron Laws (apply `playbooks/deanchor.md` if working from examples/templates).
2. Run **Deterministic Preflight** + affected tests (and multi-run **Anti-Flake** checks when tests cover behavioral changes); log evidence to `.devflow/evidence/` for behavioral fixes.
3. Deliver (see Delivery). Re-route aloud to Route B if scope grows beyond trivial; trigger `playbooks/step-back.md` if fixes stack.

---

## Route B — STANDARD

1. **Discover (`repo-scout` + `codemap`)**: Fan out parallel `repo-scout` lanes (+ `docs-scout` / `media-analyst` when external docs or media are involved) for `file:line` evidence. Read existing `codemap.md` first, or build one via `playbooks/codemap.md` when the repo is unfamiliar and broad.
2. **Gap Analysis (`scope-analyst`)**: Identify hidden requirements, unstated constraints, AI-slop risks, and blocking questions. Resolve every open question via `ask_user_question` before planning.
3. **Formal Plan (`planner`)**: Save `.devflow/plans/<slug>.md` with **Contract-First** interface freeze, disjoint write scopes, task dependencies, parallel lanes, per-task `verify` commands, and an evidence path (`playbooks/verification-planning.md`).
4. **Plan Gate (`plan-auditor`)**: Audit `.devflow/plans/<slug>.md` for clarity, verifiability, and context completeness. Only `OKAY` unlocks execution. On `REJECT`, verify each finding, have `planner` revise, and re-audit (**Circuit Breaker**: max `2` `REJECT`s -> escalate via `ask_user_question`). Attach an AI-era estimate (`playbooks/ai-estimates.md`) after `OKAY`.
5. **Execute (`run-conductor`)**:
   - Surface any remaining plan `ask_user_question` gates first.
   - Lock frozen interfaces and disjoint write scopes (**Contract-First**), then fan out scoped `implementer` / `debugger` lanes (`<=4` concurrent; use `playbooks/clonedeps.md` with `ask_user_question` approval when dependency internals require source inspection; trigger `playbooks/step-back.md` on 2 lane misses or stacking patches).
   - Run **Post-Parallel Reconciliation** across all writer diffs, then **Deterministic Preflight** (exit `0`), then the **Anti-Flake Test Verification Gate** (`test-writer` / `browser-qa` as needed, evidence logged to `.devflow/evidence/`).
6. **Verification Corps & Review Loop**: Run Adversarial Verification (`workflow`) + Corps over the preflight-clean diff (`diff-reviewer` mandatory; `test-auditor`, `error-auditor`, `security-auditor`, `perf-auditor`, `debt-auditor` as surface dictates; optional `playbooks/simplify.md` strictly on newly written code). Apply **Delta-Scoped Re-verification** on fixes and **Review-Loop Circuit Breaker** when single-pass clean.
7. **Delivery** (see Delivery).

---

## Route C — ADVERSARIAL (`hyperplan` Replaces `scope-analyst` + Initial Draft)

1. **Discover**: Same as Route B step 1 (`repo-scout` / `codemap`).
2. **`hyperplan`**: Invoke the `hyperplan` skill. Its 5-member cross-critique debate subsumes `scope-analyst` — avoid running `scope-analyst` separately. `hyperplan` ends by handing off to `planner` to save `.devflow/plans/<slug>.md` with **Contract-First** freeze and disjoint write scopes.
3. **Plan Gate (`plan-auditor`)**: Hard `OKAY`/`REJECT` gate with max-`2` `REJECT` circuit breaker, followed by `playbooks/ai-estimates.md`.
4. **Execute (`run-conductor`)**: Same as Route B step 5 (contract freeze, parallel lanes, reconciliation, deterministic preflight, anti-flake test gate).
5. **Verification Corps & Review Loop**: Same as Route B step 6.
6. **Delivery** (see Delivery).

---

## Route D — DEEPWORK (`playbooks/deepwork.md`)

1. **Discover**: `repo-scout` + `playbooks/codemap.md` (mandatory before Pass 1).
2. **Direction & Pass-1 Plan**: Run `hyperplan` on architectural direction, then `planner` formalizes only the Pass-1 plan in `.devflow/plans/<slug>.md`.
3. **Painted Passes** (`Sketch -> Structure -> Detail`): Track resume state in `.devflow/runs/` (`<session-id>.md` head + `<task-slug>/progress.md` `<=40` lines). Per pass:
   - Freeze pass interfaces and disjoint write scopes (**Contract-First**); run one short `arch-advisor` review when lanes touch persistent state, money, concurrency, or crash recovery.
   - Fan out `<=4` disjoint lanes (`implementer`, `debugger`, `test-writer`, `browser-qa`).
   - Run **Post-Parallel Reconciliation** -> **Deterministic Preflight** -> broad validation + **Anti-Flake** checks (evidence under `.devflow/evidence/`).
   - Run one scoped `arch-advisor` pass exit gate (max 3 attempts) + per-pass Corps review (`diff-reviewer` mandatory; others by surface), commit the pass, then step back and re-plan the next pass (`playbooks/step-back.md` on 2x expected effort or 2 lane misses). Never defer security or money/data correctness.
4. **Completion & Delivery**: Reconcile documentation (`docs-sync` / `tech-writer`), hand over remaining known issues explicitly, close `.devflow/runs/` tombstone, and deliver.

---

## ADVERSARIAL VERIFICATION (`workflow`) & REVIEW LOOP

For code-touching tasks (bugfix, feature, refactor), run `workflow` before the first `review-loop` round (`docs-only` and pure-diagnostic tasks skip `workflow` and use `review-loop` / Corps directly):

1. **Phase `"Review"`**: Dispatch one read-only structured child per task-matched lens with full self-contained context (`file:line` anchors + concrete failure scenario required):
   - *Bugfix*: lifecycle/state machine, error paths & retry loops, test sufficiency, security of new channels, performance/maintainability, docs accuracy.
   - *Feature*: contracts & API surface, error paths, test sufficiency, security (when new trust boundary appears), performance/maintainability, docs accuracy.
   - *Refactor*: behavior preservation, dead paths & regression risk, test coverage, performance/maintainability.
   - Always include a security lens on security-sensitive surfaces.
2. **Phase `"Verify"`**: Spawn two refutation children per finding (plus a third verifier for any security finding) — one refuting the failure path in code, one refuting scope/consequence. Confirm ONLY when all verifiers vote real.
3. **Phase `"Critic"`**: One completeness child inspecting confirmed findings and coverage notes for missed gaps (`file:line` anchored).
4. **DSH `workflow` script rules**: Pass `meta` as plain JSON beside a plain JS script body (NO `export const meta`, ending in `return`); `agent()` accepts only `{ label, phase, schema, provider, model }`; filter `null` failed children before reading fields.
5. **Corps `review-loop`**: Feed surviving findings into `review-loop` via `diff-reviewer` (applying `review-loop` + `code-review-checklist` + `code-review-excellence`; `Score >= 8/10`, max 4 loops) alongside relevant Corps auditors (`test-auditor`, `error-auditor`, `perf-auditor`, `debt-auditor`). Fixes re-enter **Delta-Scoped Re-verification**; skip the 2nd `review-loop` pass when **Review-Loop Circuit Breaker** holds.

---

## SECURITY GATE (Conditional, Before Delivery)

When changes touch auth, secrets, payments, file/subprocess handling, untrusted input parsing, or permissions:
- **Focused diff review**: Dispatch `security-auditor` (trust-model-aware, credible attack paths only).
- **Broad audit / new trust boundaries / threat model**: Run the `security-research` skill scoped to the branch/diff before merge or delivery.
- `BLOCK` re-enters implementation and **Delta-Scoped Re-verification**; `PASS` / `PASS WITH FINDINGS` goes into `.devflow/evidence/` and the delivery report. Route audit constraints through `ask_user_question`.

---

## DELIVERY

- **PR repositories**: Hand off to `work-with-pr` (plan `.devflow/plans/<slug>.md`, tests, and `.devflow/evidence/` travel with the PR).
- **No-PR repositories** (ask via `ask_user_question` when uncertain): Make one atomic delivery on the current branch including implementation, tests, `.devflow/plans/<slug>.md` (Routes B–D), and `.devflow/evidence/` logs. When committing, execute the `git-commit` skill — never a bare `git commit`.
- **Docs reconciliation (conditional, before merge/close)**: Whenever behavior, setup, configuration, or public interfaces changed, dispatch `docs-sync` (focused updates) or `tech-writer` (durable README, API reference, architecture, changelog, migration guides) — docs-only writes, strictly source-grounded.
- **Retrospective (on request or repeated friction)**: Run `playbooks/reflect.md` and ask via `ask_user_question` before creating new workflow assets.
- **Consolidated Delivery Report**: State what shipped and where, exact verification commands with fresh outputs and `.devflow/evidence/` links, `workflow` confirmed vs refuted counts and final corps score, remaining risks, and any decision reserved for the human.

---

## Anti-Patterns

| Violation | Consequence |
|---|---|
| Asking questions in plain prose instead of `ask_user_question` | Ambiguities go unanswered and force rework |
| Asking the user to pick the route or model | Conductor owns route selection; host/cards own model selection |
| Running `hyperplan` and `scope-analyst` on the same task | Redundant planning cost (`hyperplan` already subsumes gap analysis) |
| Executing after `plan-auditor` `REJECT` or exceeding 2 `REJECT`s silently | Unverified plans ship defects; escalate contention at the 2-`REJECT` breaker |
| Dispatching parallel writers before Contract-First freeze or skipping reconciliation | Interface drift, merge conflicts, and silent signature mismatches |
| Dispatching semantic corps before Deterministic Preflight exits `0` | Burns review cycles on broken syntax, types, or failing unit tests |
| Masking flaky tests with retries or delivering without multi-run evidence | Intermittent bugs ship to users without root-cause fixes |
| Skipping `playbooks/step-back.md` after 2 lane misses or stacking patches | Compounds architectural drift instead of taking the cleaner path |
| Trusting a worker report without reading diffs and fresh command output | Unverified regressions reach delivery |
| Copying examples verbatim instead of applying `playbooks/deanchor.md` | Anchors output to sample quirks instead of underlying constraints |
| Writing deferral comments, unfinished placeholders, or letting docs drift | Deliberate tech debt and stale user/developer documentation |
