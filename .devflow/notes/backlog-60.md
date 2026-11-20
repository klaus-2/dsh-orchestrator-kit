# Backlog-60 — the user's named request (verbatim items, condensed)

Source: direct human request in this session. All 60 items were explicitly
listed by the user. User decisions (fixed): implement everything viable in
ordered passes; panel i18n en/pt-BR/zh with manual switch (replaces the
English-only test policy); one commit per pass; low-value items may be
rejected ONLY with documented rationale. Contested deletions of user-named
items go to a user decision gate — the debate refines means and value, it
does not unilaterally delete the user's request.

## Performance / server
1. Compress read-route responses (gzip/Brotli) when client advertises support, min-size threshold.
2. Skip identical route save: compare payload vs frontmatter, respond success without lock/rewrite; response indicates no write occurred.
3. In-memory mtime index for incremental re-reads; invalidated after each successful write.
4. Read only frontmatter bytes (to closing delimiter) before YAML parse; body read only when rewrite needs it.
5. Prewarm harness catalog in background at plugin activation; panel falls back to normal load on failure.
30. Server-Timing header (catalog read, card read, atomic write durations); discreet panel legend display; no user data/local paths in values.
31. POST returns updated role; client applies only that card + header counters, no roles re-GET; full refresh reserved for mtime conflicts.
32. Bounded-concurrency parallel card reads in .roles; stable role order.
34. ETag + If-None-Match/304 on roles/catalog reads.
35. Preload efforts on model-select focus/hover before selection confirmed.
36. Memoize + single-flight efforts client AND server per provider+model.
37. Server catalog TTL cache (seconds), invalidated on harness change signal; fail-closed validation uses same catalog.

## Tests
6. npm pack --dry-run smoke test: tarball contains exactly the package.json whitelist, no local dirs; packed content passes forbidden-token scan.
7. Craft bundle consistency: 20 expected roles, names match GET .roles, unconfigured cards use model: inherit, playbooks present.
8. Locale key parity: all locale/*.json identical key sets, no empty values, every client.js string exists in files; panel labels stay English (NOTE: superseded by user i18n decision — parity remains, English-only does not).
9. Panel DOM tests (linkedom suggested) with mocked routes: card grid, Routed/Inherits/Disabled badges, phase filter, arrow-key tab navigation, 503 error state.
10. Frontmatter round-trip: save/reset with extra fields, comments, Markdown body, CRLF; byte-identical outside routing keys; return to model: inherit.
11. Deterministic harness-catalog stub: available/empty/unavailable modes; 409 unknown role/model/effort + 503 absent catalog as invalid-input table.
12. Concurrency: two simultaneous POST .route on same role; stale expectedMtimeMs save; lock serialization, 409, card integrity; external writer between read and write.
13. Minimum coverage in scripts/test.mjs (Node 22 native), configured line/branch thresholds for index.js+client.js, summary printed.
58. Performance budget in CI: stub-catalog benchmark of 20-role listing time + client.js size, fixed versioned limits adjustable by explicit commit.

## Docs
14. docs/glossary.md: role, phase, harness catalog, reasoning effort, inherit, route, dispatch — approved pt-BR/zh-CN translations; referenced from CONTRIBUTING.
15. CI step validating relative links, cited files, internal anchors in all .md (ignore external URLs); fail on missing file/section.
16. scripts/docs-parity.mjs comparing headings/tables/code blocks of the 3 READMEs; fail with divergence list; runs with test in CI.
17. docs/recipes.md: 3 commented budget configs (economic/balanced/max-quality), which roles to pin vs inherit, per-phase cost reasoning; no invented credentials/models.
18. docs/role-card.md: every frontmatter field (provider, model, reasoning effort, model: inherit), accepted values, absence semantics, full before/after example.
19. docs/architecture.md: atomic-write sequence diagram (fail-closed validation, file lock, TOCTOU guard, post-write revalidation, mtimeMs check); why route applies next turn.
20. docs/troubleshooting.md: table mapping each failure (409 unknown role/model/effort, 503 catalog, mtime conflict, busy lock) to cause + fix; linked from FAQ in 3 READMEs.
21. docs/api.md: roles/catalog/efforts/route reference, request/response examples, required fields, 200/409/503 codes; generic curl examples only.

## Security
22. No injectable HTML: node creation + textContent for provider/model/role names and error messages from catalog/disk; tests with markup/quotes strings.
23. Secret redaction in catalog error messages and plugin logs (API keys, tokens, authorization headers, credential URLs → markers); test guarantees no sensitive value in responses.
24. Read-only mode: config flag (e.g. DSH_ORCHESTRATOR_READONLY=1) → POST 403, UI read-only with disabled controls + explanatory notice.
25. Audit trail: append-only file beside cards recording each save/reset (date, role, previous/new route, request origin; never keys/tokens); panel shows recent events in collapsible section.
26. Body size limit + unknown-field rejection + per-session save rate limit (429 + Retry-After); over-limit requests aborted before disk reads.
27. Strict YAML frontmatter: only scalars on known routing keys, no anchors/aliases/custom tags, size+depth limits; out-of-schema content refused not interpreted.
28. Path confinement + symlink blocking: real path inside agents root (DSH_AGENTS_HOME respected), reject traversal/separators/outward symlinks; 409 without writing.
29. CSRF protection on save route: custom API header + Origin/Sec-Fetch-Site validation, cross-site 403; read routes reject requests without harness session.

## UX / panel
33. Mount only active-tab cards (unmount or light-cache others); segmented filter controls render cost.
38. Panel in user language: locale/ files drive labels/badges/legend/messages in en/pt-BR/zh following harness language with manual switch.
39. Accessible save confirmation: discreet success/failure notice, aria-live region, temporary highlight on saved card.
40. Remember tab + panel prefs (selected phase tab, legend state, density) in local storage; restore on reopen.
41. Compact density mode: toggle between card grid and one-line-per-role list with same selects + status badge.
42. Role description per card: short responsibility summary (tooltip or expandable) + suggested reasoning-effort range.
43. Save errors with corrective action: 409/503 translated to clear per-card messages (unknown role/model/effort, catalog unavailable) + "Reload catalog" / "Try again" buttons.
44. Installed-cards diagnostics: verification route comparing installed cards vs craft/ sources; panel lists missing roles, invalid frontmatter, routes pointing outside catalog.
45. Craft install script: Node script copying craft/agents + craft/skills/dev-flow to agents dir, respecting DSH_AGENTS_HOME, backing up overwritten cards.
46. Unsaved-changes indicator: pending state when selects change; warn on tab switch/reload; Ctrl+S saves focused card.
47. Undo last save per role: keep previous frontmatter after save; Undo button restores old value via same atomic write.
48. Exportable routing profiles: export 20-role config as JSON profile; import validates every entry before writing any card.
49. Batch apply per phase: multi-select (or whole tab) applies provider/model/effort at once via existing route with fail-closed validation.
50. Role search field: filter cards by role name or description fragment, combined with active phase tab.
51. Accessible top summary: counts as aria-live region with clear text, updated after each save.
52. Quick status filter: show only routed / inheriting / disabled roles, combined with phase tabs.
53. Side-by-side chat comparison: show effective inherited chat route on inherit-mode cards next to override option.
54. Unavailable-model visual hint: when catalog no longer lists a saved model, card warning with last known value + guidance.
55. Role sorting selector: by name, routed-first, or inherits-first.
56. Per-category route counters: each phase tab shows routed/inheriting/disabled counts beside its name.
57. Session-changed highlight: discreet border/seal on roles modified since panel opened.
59. content-visibility: auto + contain-intrinsic-size on grid cards; reserved height avoids scroll jumps.
60. On-demand panel module: split client.js so grid/filters/legend code loads dynamically when Settings → Orchestrator opens; minimal plugin registration.

## Verified already-implemented (no work): 28, 22, 31, 33, 36-client, 42, 54, 10, 11, 7.
## Host-provided (rejection rationale): 1 (host gzip middleware), 29 (host signed-cookie + owner principal + trust fences).