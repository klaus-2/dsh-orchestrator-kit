# Architecture

The kit is a plugin with two parts: `index.js` registers seven HTTP routes on the host connection and owns all validation and persistence; `client.js` is the settings panel that calls those routes. There is no separate server process and no database — the role cards on disk are the state.

Source: `index.js:581-1100` (route registration entry point), `client.js:9-20` (the seven route constants).

## Trust boundary

Authentication and per-user authorization are not implemented in this plugin. Every handler is registered through `ctx.connection?.fetch?.register`, so the host connection is the trust fence: it decides which callers may reach these paths. The plugin adds one application-level gate, read-only mode, driven by the `DSH_ORCHESTRATOR_READONLY` environment flag. When that flag is `1` or `true`, the write route returns 403 before touching the body; read routes keep working and the roles response reports `readOnly: true`.

Source: `index.js:43-47` (read-only flag), `index.js:603`, `index.js:657`, `index.js:675`, `index.js:707`, `index.js:742`, `index.js:844` (host registration), `index.js:848-850` (write gate).

## The save sequence, in execution order

This is the order the write route actually follows. Steps 10a-10f run inside one `withFileLock` critical section.

1. **Read-only gate.** If read-only mode is on, return 403 with `code: "readonly"`. Nothing else runs.
2. **Body limits and shape.** Reject a declared or measured body above 65536 bytes with 413, a non-JSON body with 400, and a non-object body with 400. Unknown top-level fields are rejected with 400; the accepted set is `id`, `provider`, `model`, `disabled`, `reasoningEffort`, `expectedMtimeMs`.
3. **Field validation.** `id` must be a valid entry name. `provider` and `model` must be supplied together, both non-empty, or both `null` to reset; `disabled` must be a boolean; `reasoningEffort` must be null or a non-empty string; `expectedMtimeMs` must be a finite number at least 0. At least one setting must change, and an effort cannot be set while resetting the route.
4. **Path containment, pass one.** Resolve the card path under the roles directory, then verify containment with `realpath` and reject any symbolic link in the path with 400.
5. **Read the card.** `lstat` rejects symbolic links; the file is read as UTF-8. A missing card is 404, an unsafe path is 400, any other read failure is 500.
6. **Modification-time guard.** When `expectedMtimeMs` was supplied and does not equal the card's current `mtimeMs`, return 409. This is the stale-draft guard; no write is attempted.
7. **Strict parse.** The existing frontmatter is parsed in strict mode. If the request does not reset the route or set an effort, the whole card is also parsed as a role card. A strict-mode violation is 400.
8. **Live validation.** A pinned route is checked against the live model catalog: an unavailable catalog is 503, a missing provider or model is 409. A pinned effort is checked against the model's own advertised efforts: an unavailable resolver is 503, an unknown route or unsupported effort is 409.
9. **Compute and reparse.** `applyCardSettings` produces the new card text and the result is reparsed in strict mode. If the text is identical, the card's modification time is rechecked and a `unchanged: true` response is returned with no lock and no write. Otherwise the path containment check runs again before locking.
10. **Critical section, inside `withFileLock`:**
    a. Path containment is checked again, then the card is `lstat`-checked once more (404/400/500 on failure).
    b. The modification time is compared with the baseline — `expectedMtimeMs` when supplied, otherwise the `mtimeMs` read in step 5. A difference is 409.
    c. `writeFileAtomic` writes the new text with mode `0o644` and directory mode `0o700`; a failure is 500.
    d. The card is read back with `lstat` and `readFile` for its new modification time and text; a failure is 500.
    e. The audit record is appended **inside the same lock**, immediately after the read-back.
    f. The section returns status 200 with the read-back time and text.
11. **Lock failure mapping.** A lock timeout is mapped to 503 with `code: "lock-timeout"` and operator guidance. Any other lock or write failure is 500.
12. **Post-write validation, outside the lock.** The read-back text is parsed in strict mode and converted to a role summary. A failure here is 500; the file has already been written and there is no rollback.
13. **Response.** Status 200 with `{ ok: true, role }`, plus `server-timing` entries for the catalog lookup and the write when applicable.

Source: `index.js:848-905` (steps 1-3), `index.js:907-941` (steps 4-7), `index.js:948-995` (steps 8-9), `index.js:996-1018` (unchanged branch and pre-lock recheck), `index.js:1025-1065` (step 10), `index.js:1071-1084` (step 11), `index.js:1087-1095` (steps 12-13).

The audit append is best-effort. If it fails, the server writes a redacted warning to its log and still returns 200: the saved card is not rolled back and the failure is not surfaced to the panel. The difference between the read-back in step 10d and the parse in step 12 is deliberate — only the raw read and the audit record are inside the lock.

Source: `index.js:1045-1065` (read-back and best-effort append), `index.js:1087-1094` (post-write parse).

## Audit trail

The audit file is `<agent home>/agents/.orchestrator-audit.jsonl`, where `<agent home>` is `DSH_AGENTS_HOME` when set and the host's default agent home otherwise. Each line is one JSON record with `at` (an ISO timestamp), `id`, `previous` and `next` routing summaries, and `origin: "panel"`. The events route reads this file, returns the last 50 non-empty lines, and returns an empty list when the file does not exist. Malformed or non-object lines are counted in `skipped` rather than failing the request.

Source: `index.js:37-41` (agent home resolution), `index.js:591` (roles directory and audit path), `index.js:231-240` and `index.js:1049-1058` (record shape), `index.js:713` and `index.js:722-737` (50-line cap and skip counting), `index.js:718` (missing file branch).

## Route surface

| Path | Method | Purpose |
| --- | --- | --- |
| `/api/dsh-orchestrator-kit.roles` | GET | List installed role cards and invalid cards; report read-only state. |
| `/api/dsh-orchestrator-kit.catalog` | GET | Report the live provider/model catalog. |
| `/api/dsh-orchestrator-kit.efforts` | GET | Resolve supported reasoning efforts for one provider/model pair. |
| `/api/dsh-orchestrator-kit.route` | POST | Validate and atomically save routing settings for one role. |
| `/api/dsh-orchestrator-kit.events` | GET | Read the last 50 audit records. |
| `/api/dsh-orchestrator-kit.diagnostics` | GET | Compare installed cards with craft sources and the live catalog. |
| `/api/dsh-orchestrator-kit.update` | GET | Compare the running version with the latest GitHub release (npm-gated). |

Source: `index.js:603`, `index.js:657`, `index.js:675`, `index.js:844`, `index.js:707`, `index.js:742`, `index.js:821` (registered paths and methods); `scripts/test.mjs:2198-2203` (route-surface contract).

## Update checking

The seventh route, `GET /api/dsh-orchestrator-kit.update`, compares the running version with the latest GitHub release and double-gates the result against the npm registry before the panel may advertise an install. Both outbound requests are read-only GETs without credentials, on a 10-second timeout; the check reads nothing the read-only flag protects and runs regardless of it. Installing is not a server operation: the panel asks the host's plugin manager client-side, so no install request ever passes through this plugin's server code.

Source: `index.js:547-579` (GitHub/npm probe), `index.js:821-841` (route), `client.js:590-659` (updater store and install flow).
