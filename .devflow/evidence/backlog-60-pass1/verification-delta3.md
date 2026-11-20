# Verification delta 3 — D-6 review-round-1 remediation (lead edit)

Date: 2026-11-19. Owner: lead. Trigger: diff-reviewer round 1 Score 7/10
CHANGES REQUESTED — IMPORTANT-1 (authorization pattern misses JSON-quoted and
quoted-multi-word forms, the D-5 F2 class), MINOR-1 (evidence references
gitignored notes; redundant root .ignore), MINOR-2 (C15 markup fixture absent),
MINOR-3 (delta2 amendment unrecorded). Trail: decisions.md D-6.

## Fixes

- index.js: AUTH_PREFIX shared source (optional quote after keyword; bearer/
  basic non-capturing) + quoted-double/quoted-single patterns with disjoint
  escape alternatives + unquoted fallback consuming RFC 6750 token words with
  space-separated continuation words. Continuation words cannot start a POSIX
  path (charset excludes separators) or a Windows drive (lookahead), so error
  prose "Bearer <token> at <path>" keeps its path clause for the home markers.
- scripts/test.mjs: N14 extended (JSON Basic/Bearer, quoted multi-word both
  quote styles, unquoted multi-word, idempotence, prose path-clause contract);
  N17 added (C15/item-22: markup/quotes in role name/description, invalid
  id/error, catalog + effort names render as literal text children; zero
  HTML-injection props). Suite 55→56.
- .devflow/.gitignore: notes/ un-ignored (amendment trail ships with evidence).
  Root .ignore deleted (redundant; .devflow tracked, nested ignore covers
  transient dirs). decisions.md D-6 records delta2 retroactively (MINOR-3).

## Design iterations (recorded for the reviewer)

1. First fallback attempt consumed to end-of-line: N5's frozen catalog fixture
   ("...Bearer <token> at <home-path>") lost its [home] marker because the path
   clause was swallowed — frozen-test violation, rejected.
2. Second attempt (non-whitespace first char, rest-of-line) corrupted already
   redacted quoted forms: the fallback re-matched the lone space before
   '"[redacted]"' via \s* backtracking (probe: 'Authorization:[redacted]"[redacted]"').
3. Final: token-charset first word + continuation words with drive/path
   lookahead — probes show all quoted/JSON/multi-word forms exact, prose keeps
   [home] + path tail, idempotence holds, frozen N4/N5 expectations byte-exact.

## Verify (fresh, lead-run)

- Probes: 5 authorization shapes byte-exact + idempotent; prose shape
  'upstream failed: Authorization: [redacted] [home]\...planner.md' with token
  gone, marker present, tail present (PROSE_OK=true, ALL_SHAPES_OK=true).
- node --check index.js / scripts/test.mjs → exit 0.
- 5 consecutive full-suite runs: 5/5 green, each exit 0, 56 ok / 0 FAIL,
  ALL TESTS PASSED (test-run-delta3-1..5.log, green-only). No retry masking.
  One intermediate red run (N5, iteration 1) was root-caused and fixed before
  the green sequence; no failure logs retained per the green-only rule.

## Gate status

Review loop round 2 (diff-reviewer) and security delta3 confirmation requested
on the final diff. Deferred items unchanged (D-5/D-6).