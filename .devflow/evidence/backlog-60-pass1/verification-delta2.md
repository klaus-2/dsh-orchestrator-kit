# Verification delta 2 — security-gate BLOCK remediation (lead edit)

Date: 2026-11-19. Owner: lead (small remediation edit under deepwork autonomy;
full context held). Trigger: security-auditor delta re-review verdict BLOCK —
one HIGH finding: the credential-URL scheme prefix `[a-z][a-z0-9+.-]*` is
unbounded; a dot-run restarts the scheme scan at every word boundary and
backtracks quadratically (inherited from the frozen 3.3 pattern; D-5's
linearity claim covered only the userinfo class). Also fixed the gate's LOW
item 1 (escaped quote inside a quoted value leaks the tail) in the same edit.

## Lead firsthand verification (before fix)

- redactText('a.'.repeat(30000)) → 3945.1 ms blocking (probe, OS temp).
- redactText('{"api_key":"abc\"def"}') → '{"api_key":"[redacted]"def"}' (tail leak).

## Fix (index.js only, lead edit)

- Scheme quantifier bounded: `[a-z][a-z0-9+.-]{0,31}:\/\/` (no real URI scheme
  approaches 32 chars; auditor probe-verified linear). WHY comment updated.
- Quoted-value patterns: disjoint escape alternatives `"(?:[^"\\]|\\.)*"` and
  `'(?:[^'\\]|\\.)*'` consume escaped quotes whole without backtracking
  ambiguity. WHY comment updated.
- scripts/test.mjs N14 extended (label unchanged, suite stays 55): dot-run
  completion + idempotence (NO stopwatch assertion), escaped double/single
  quote full redaction + idempotence, compound scheme (git+ssh://) preservation.

## Red proof (temp mutant, deleted after)

Mutant = current index.js with the scheme bound reverted to `*` and the escape
alternatives reverted to plain `[^"]*` / `[^']*'` (placed temporarily under
.devflow/maps/ for node_modules resolution; deleted immediately after):
- MUTANT_DOTRUN_MS=3301.8 (quadratic stall present)
- MUTANT_ESCAPED={"api_key":"[redacted]"def"} (tail leak present)
Fixed repo: FIXED_DOTRUN_MS=10.6, FIXED_COLONRUN_MS=0.9,
ESCAPED_D={"api_key":"[redacted]"}, ESCAPED_S=password='[redacted]',
COMPOUND=git+ssh://[redacted]@example.invalid/x,
SIMPLE=https://[redacted]@example.invalid/v1,
ATPASS=https://[redacted]@api.example.invalid/v1,
PLAIN=https://host/home/guide (unchanged). Mutant deleted: True.

## Green + anti-flake

- node --check index.js / client.js / scripts/test.mjs → all exit 0
  (node-check-delta2.log).
- 5 consecutive full-suite runs: 5/5 green, each exit 0, 55 ok / 0 FAIL,
  final line ALL TESTS PASSED (test-run-delta2-1.log … test-run-delta2-5.log,
  green-only). No retry masking; no timing assertions added.

## Gate status

Security delta re-review requested on this fix (auditor retains prior context).
Review loop round 1 (diff-reviewer) in flight; round 2 will cover the final
diff including this remediation. Deferred LOW items (unterminated quotes,
fragment-@ false positives, GET symlink channel, whole-file size pre-guard,
requester-echo consistency, YAML excerpt first-line) remain recorded in D-5.