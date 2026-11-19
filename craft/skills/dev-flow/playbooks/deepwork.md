---
name: deepwork
description: "High-cost orchestrator workflow for large, high-risk, multi-phase coding efforts with meaningful dependencies and review gates. Do not activate for routine multi-file changes."
---

> dev-flow suite playbook — harness-neutral. State lives at `.devflow/runs/`. Execution lanes use `implementer`, `debugger`, `test-writer`, and `browser-qa` with disjoint write scopes; static visual checks use `media-analyst`; architecture & pass gates use `arch-advisor`.

# Deepwork

Deepwork is an orchestrator workflow for heavy coding sessions: a whole
product or subsystem, cross-cutting architectural change, unsafe-to-partially-
ship migration, or sustained coordination across specialist lanes. Select it
only for efforts that outgrow a single Route B or C plan; skip it for trivial
edits, quick docs updates, simple bug fixes, or routine bounded features.

## Work Like a Painter

A painter does not finish one finger before sketching the hand. Build the
whole picture in passes, each at a higher fidelity, keeping it easy to adjust:

1. **Sketch** — every major flow works end to end, thinly. Rough is fine;
   faked or hidden is not.
2. **Structure** — real data model, real module boundaries, the main failure
   paths.
3. **Detail** — hardening, crash recovery, edge cases, polish. Repeat as
   needed.

Every pass ends with a committed, usable product and a ranked known-issues
list. Work is never finished: there will always be more to harden and more
bugs to fix. Stop when the task's goal is met at a fidelity that serves it,
and hand the remaining known issues over — leftovers are expected, not
failure.

Two things are never deferred to a later pass: security and money/data
correctness. Everything else is judged against the current pass.

## Autonomy

Run end-to-end without pausing by default. Make reasonable decisions yourself,
record them in the progress file, and keep moving. Ask the user only when
truly blocked: credentials, paid commitments, irreversible or public external
actions, or a decision with no safe default. If the task asks for check-ins
(for example, after each pass), honor that. Every user question goes through
`ask_user_question` (or the host's structured-question tool), never plain text.

## Role

Act as scheduler and integrator, not the default implementation worker. Make
small integration and remediation edits yourself when you already hold the
context. Value productivity: a working whole picture beats a perfect corner.

## Planning a Pass

- Define the pass goal in one or two lines: what the whole product does at
  this fidelity.
- Freeze shared lane interfaces, schemas, and disjoint write scopes before
  dispatching parallel writers — only as firmly as this pass needs; expect them
  to move later.
- Plan execution lanes (`implementer`, `debugger`, `test-writer`, `browser-qa`)
  as separate lanes from the start: `browser-qa` / UI lanes own live UI &
  visual checks (with `media-analyst` for static media/screenshot inspection);
  wiring lanes own code, types, tests, and failure reproduction.
- If the pass touches persistent state, money, concurrency, crash recovery, or
  destructive operations, get one short `arch-advisor` design review of the pass
  plan before dispatch. Design flaws are cheap to fix before implementation.
- Record the pass plan in the progress file; give the user a compact version.

## Running a Pass

- Every delegation states scope, frozen interfaces it relies on, and acceptance
  evidence. Every lane report must list changed files, exact commands run with
  their exit codes, and what remains unverified.
- Accept a lane after checking one decisive artifact — source for interfaces,
  real output for runtime, opened screenshots or live QA evidence for UI. A
  build passing proves neither behavior nor visual quality.
- After two misses from a lane, run `playbooks/step-back.md` or change the
  boundary or specialist instead of sending a longer version of the same prompt.
- Lanes run focused checks for their own scope. Reconcile interfaces and diffs
  across all parallel writers, run deterministic preflight (syntax, typecheck,
  lint, unit tests), then run the broad suite + anti-flake checks once per pass;
  reuse evidence while it stays valid.
- If the pass runs about twice its expected effort, trigger
  `playbooks/step-back.md` and re-plan instead of pushing on.

## Gate and Step Back

At the end of each pass:

1. Reconcile parallel diffs, run deterministic preflight, and execute the broad
   validation once on the reconciled state (log evidence under `.devflow/evidence/`).
2. Request one `arch-advisor` gate scoped to this pass: is the whole picture
   right at this fidelity? Findings that belong to a later pass go to the
   known-issues list rather than entering a fix loop. Fix blockers in one
   bounded delta pass; at most two re-reviews, each only for materially changed
   risks (delta-scoped). State the attempt in every gate prompt, e.g.
   `Pass 2 gate — attempt 2 of 3`.
3. Run pass-scoped review corps (`diff-reviewer` mandatory; `test-auditor`,
   `error-auditor`, `security-auditor`, `perf-auditor` by surface), then commit
   the pass.
4. Step back: run the product as a whole, look at it, and re-plan the next
   pass from what you see rather than from the original plan. Review code
   organization too — if files grew huge or module boundaries blurred, make
   reorganization part of the next pass before it becomes unmaintainable.
   Likewise, if slow tests or builds noticeably dragged this pass, make
   speeding them up part of the next pass while keeping essential state,
   security, and real-service evidence intact.

## State

`.devflow/runs/` is the resume index for run-owned state, not a second
workspace for process documents. Keep it small and current; it exists to
resume after compaction, not to log activity.

- **Router head** `.devflow/runs/<session-id>.md`, pinned by the activation
  prompt and reused on re-run: `status: active` (or `status: completed`) and
  `slug:` — nothing else. Never modify another session's head.
- **Progress file** `.devflow/runs/<task-slug>/progress.md`, rewritten in
  place, at most 40 lines of plain prose: status, pass and its goal, next step,
  constraints and decisions, running lanes (one line each), a concise
  References list of project files (with an optional `sha`), and the ranked
  known-issues list. Keep durable verdicts, research, and decisions at tracked
  project paths (`.devflow/plans/`, `.devflow/evidence/`, or existing docs)
  rather than turning progress into an activity log.
- Generated assets stay where their producing script or path contract requires
  them.
- Update state at pass transitions, decisions, and blockers — not after every
  lane.

Setup: before creating any run file, ensure `.devflow/.gitignore` ignores
transient folders (`runs/`, `notes/`, `drafts/`, `maps/`, `backups/`) while
keeping `plans/` and `evidence/` tracked, and ensure root `.ignore` contains
`!.devflow/` plus `!.devflow/**`, adding only missing entries. Claim a new task
by creating `.devflow/runs` if absent and creating `.devflow/runs/<task-slug>`
atomically (`mkdir .devflow/runs/<task-slug>`); if it already exists and another
session's `status: active` head names that slug, pick another slug, otherwise
adopt it. Write the `slug:` into your head before working.

Resume: read your head, then its progress file, then only the References it
points to. Nothing else.

## Completion

Rewrite the progress file as a tombstone of at most 15 lines: first line
`status: completed`, then the final outcome, pointers to key deliverables,
the remaining known issues, and the date. Flip the head to
`status: completed`. Reconcile documentation via `docs-sync` / `tech-writer` when
interfaces or behavior changed, then delete only the run-owned head and progress
state under `.devflow/runs/` when no longer needed (or follow the project's
tombstone convention). Preserve `.devflow/plans/`, `.devflow/evidence/`, and
producer-owned asset directories. Finish with final validation and a concise
summary.
