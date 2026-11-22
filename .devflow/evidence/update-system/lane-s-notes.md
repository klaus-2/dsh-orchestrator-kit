# Lane S notes — Task S1 (server route + update helpers)

All decisions below follow the frozen contract C1 semantics; they are recorded because the
contract text left the detail open. Implementation lives in `index.js` only.

1. **`latest` is the bare npm version.** A release tag like `v0.2.0` is validated with the
   strict `^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$` regex and then has the leading `v` stripped
   before it is returned as `latest`. Rationale: the npm gate URL, the client's
   `dsh-orchestrator-kit@<latest>` install spec, and the exact-tarball fallback name all
   require the bare version; the raw tag is never exposed.
2. **Default-route `notes` is the GitHub release body excerpt.** `releaseNotes` cuts the
   release body at the `## Install` heading and caps it at `NOTES_MAX` (20000 chars, literal
   slice, no trim or ellipsis added). The `?current=1` mode exists specifically to serve the
   shipped per-language notes, so the default envelope's optional `notes` field carries the
   release-body text instead.
3. **npm failure closes the gate; GitHub failure fails the route.** GitHub non-OK responses
   throw (route answers `502 { ok: false, error }`), as do missing/invalid `tag_name` and
   unparseable release JSON. A thrown or non-OK npm registry call sets the gate closed
   (`newer: false`) instead of failing the check: GitHub is the data source, npm is only the
   installability double-gate, so an npm flake must not advertise an uninstallable release
   and must not hard-fail an otherwise informative check.
4. **`shippedNotes(data = SHIPPED_NOTES)` takes an injectable payload.** The module-scope
   `SHIPPED_NOTES` cache is only the default argument, so unit tests can feed crafted data.
   Non-string note values are skipped alongside non-BCP-47-shaped keys
   (`NOTES_LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/`), and `undefined` is returned when
   no valid key remains — the route then omits `notes` instead of sending an empty object.
   The regex filter is applied before any key is copied into a fresh object, which blocks
   `__proto`-style keys (JSON.parse produces them as own properties).
5. **`checkUpdate` returns the full envelope payload.** `{ name?, current?, latest, managed,
   newer, url?, notes? }` derived from `pkg`, so the route spreads it once; optional fields
   are omitted (not `undefined`) so JSON serialization stays clean. `managed` is
   `pkg.name === NPM_NAME && current !== undefined`; `newer` is
   `npmOk && newer(latest, current)`.
6. **No `server-timing` on the update route.** The frozen envelope does not include it;
   `json()` supports a timing array if Wave 3 reconciliation wants one added.
7. **`installedUpdate()` re-reads package.json on every call.** The drift between disk and
   the running `PACKAGE` is the signal ("updated without restart"), so a cached read would
   defeat it. Read/parse failure or a non-newer version returns `undefined`.

## Verify (Wave 1, fresh runs)

- `node --check index.js` — exit 0.
- Module import smoke (`node --input-type=module -e`, importing the built file URL, printing
  `typeof` of the six exports) — exit 0, prints `function function function function
  function function`.
- Functional smoke via mocked fetch (parseVersion/newer/releaseNotes/shippedNotes/
  installedUpdate/checkUpdate: strict-tag rejection, downgrade rejection, `## Install` cut,
  NOTES_MAX cap, shipped-file language resolution, computed-`__proto__` key filtering,
  v-tag normalization to the bare npm version, npm-gate URL shape, npm 404 and npm-throw
  closing the gate, GitHub 500 and bad tag throwing, non-github `html_url` dropped,
  pre-aborted signal propagation into both fetches, unmanaged copy) — exit 0.
- `node scripts/test.mjs` intentionally not run as a gate: route-surface expectations
  (6 -> 7 routes) land with Lane T in Wave 2, per plan.

Line accounting: 137 insertions, 1 modification (export list) in `index.js`.
