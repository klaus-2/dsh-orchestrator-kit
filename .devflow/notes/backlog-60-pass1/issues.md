# Open issues — backlog-60-pass1

- I-1 (T3 discovery, CLOSED): Node 26 string-body Requests expose no content-length
  header → N6's 413 exercised the post-read cap branch only. T3 added a header-driven
  pre-check case (raw Request with manual content-length: 70000 + small valid body;
  probe confirmed undici keeps the manual header). Conductor re-verified the red gate:
  41 ok / 10 FAIL, same frozen labels, +754/−132.
- I-4 (watch item, T3 cross-version note): the N6 pre-check case relies on undici
  keeping a manually-set content-length on Request. Verified on Node 26; CI matrix is
  Node 22/24. Behavior is stable across undici 6/7, but if I1/CI ever shows 200 there,
  the documented fallback is a request-like stub (real Headers + counted text/json,
  reads === 0). No action unless observed.
- I-2 (T3 discovery, informational, no action): this machine's tmpdir() is an 8.3
  short path while homedir() is long-form; real-fs-error redaction here rides the
  generic Windows home regex rather than the homedir() literal replacement. The
  frozen redactText keeps both layers; N5(c) passes via the generic pattern. T1 must
  not drop either layer.
- I-3 (T3 discovery, informational): alias fixtures must be UNRESOLVED (`model: *p`
  with no anchor) — strict visit is document-order, a preceding anchor would throw
  the anchors message first. Lenient throws at HEAD (Unresolved alias) and after T1
  (alias resolution disabled); N1 asserts /alias/i to cover both.