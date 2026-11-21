# Troubleshooting

Every corrective action below is safe to repeat: the write path is fail-closed and either writes the card completely or leaves it untouched. Never delete a lock file automatically — an orphaned lock must be removed by an operator after confirming that no writer is active.

Source: `index.js:882-941` (locked write and failure mapping), `scripts/install-craft.js:106-108` (installer lock guidance).

## Save and validation failures

| Symptom | Cause | Corrective action |
| --- | --- | --- |
| 409 "role card changed on disk; refresh before saving" | The card's `mtimeMs` no longer matches `expectedMtimeMs`, either before locking or after acquiring the lock. | Click Refresh to reload the saved state, reapply the intended change, then save again. |
| 503 with `code: "lock-timeout"` and "another writer holds" | Another writer holds the card's lock file. | Retry in a moment. If the lock is orphaned because its owner crashed, an operator must remove that lock file manually. Do not script automatic lock removal. |
| 500 "writing the role card failed" or "reading back the rewritten role card failed" | `writeFileAtomic` failed, or the post-write `lstat`/`readFile` failed inside the lock. | Check that the roles directory is writable and that no process is replacing the file. Read the card back before retrying; a failed post-write parse is also 500 with no rollback. |
| Save returns 200 but the log shows a redacted "appending the audit record ... failed" warning | The audit file could not be appended to. This is **not** an HTTP 500: the append is best-effort, the warning is redacted, and the save survives unchanged. | Check write access to the audit file under the roles directory. The card is already saved; do not resave to repair the log. |
| 403 with `code: "readonly"` | `DSH_ORCHESTRATOR_READONLY` is `1` or `true`. | This is a server configuration choice, not a transient error. Ask whoever manages the host to change the flag; GET routes and the read-only controls still work. |
| 400 "the request contains an unknown field" | The POST body has a key outside `id`, `provider`, `model`, `disabled`, `reasoningEffort`, `expectedMtimeMs`. | Remove the extra key and resend. |
| 400 frontmatter error, or the card appears in `invalid[]` | The YAML does not parse, the frontmatter is not an object, or it uses an alias, anchor, custom tag, excessive nesting, or exceeds the byte cap. | Edit the card source so the frontmatter is a plain YAML object with only supported keys; the panel cannot rewrite an invalid card. |
| 404 "no role card named ..." | The requested card does not exist, or it disappeared before the lock was acquired. | Refresh the role list and confirm the card is installed in the roles directory. |
| 409 "the provider is not in the live catalog" or "the model is not listed ..." | The pinned route is not offered by the live catalog. | Choose a provider/model pair that appears in the catalog, or reset the route to inherit. |
| 409 "reasoningEffort ... is not supported" / "cannot validate reasoningEffort" | The chosen effort is absent from the model metadata, or the effective route is `inherit`/incomplete. | Pin a valid route first, then pick an effort offered by that model, or clear the effort. |
| 503 "the model catalog is unavailable; the route was not written" / "the LLM model resolver is unavailable" | The host adapter did not return a usable catalog or resolver within the timeout. | Retry after the adapter recovers. The panel disables provider/model switching while the catalog is empty, but the Disabled toggle still works. |
| 504 on the efforts route | Model-info resolution timed out. | Retry; if it persists, check the host model adapter for the requested pair. |

Source: `index.js:786-788`, `index.js:893-895` (stale mtime), `index.js:930-937` (lock timeout), `index.js:897-921` (write, read-back, audit), `index.js:705-707` (read-only), `index.js:720-722` (unknown field), `index.js:790-798` (strict parse), `index.js:780` and `index.js:888` (missing card), `index.js:810-816` (catalog), `index.js:818-837` (effort), `index.js:566-581` (efforts statuses).

## Batch, profile and diagnostics failures

| Symptom | Cause | Corrective action |
| --- | --- | --- |
| Batch reports conflicts or failures | Some cards changed on disk between the batch snapshot and each save. | Refresh and apply the phase batch again; already-applied roles are reported in the summary. |
| "Invalid profile: {detail}" or "Nothing was written: {count} entries failed" | The imported profile failed client-side validation, for example an effort without a route. | Fix the profile entries so every effort has a provider and model, then import again; nothing is written on rejection. |
| Diagnostics `invalid[]` is non-empty | Installed cards have frontmatter that fails strict parsing. | Repair or reinstall those cards; they cannot be edited in the panel until they parse. |
| Diagnostics `craftAvailable: false` | The bundled craft source directory is unavailable or unreadable, so drift checking is skipped. | Ensure the installed package includes its craft sources. The other diagnostics fields are still reported. |
| Diagnostics `outsideCatalog[]` is non-empty | A pinned provider/model pair is not in the live catalog. | Repin those roles to a listed pair or reset them to inherit. |
| Diagnostics `drift[]` is non-empty | A card's Markdown body differs from its craft source. | Reinstall the craft card bundle if you want the shipped body back; the panel only writes frontmatter, never the body. |

Source: `index.js:641-646` and `index.js:654-680` (diagnostics fields), `index.js:682-695` (catalog cross-check), `client.js:579-626` (profile validation), `client.js:1077-1155` (batch apply), `locale/en.json:107-115` (batch and profile messages).

## Installer and verification gates

| Symptom | Cause | Corrective action |
| --- | --- | --- |
| Installer prints "the writer lock is held" | The atomic writer timed out waiting for a card's lock file. | Retry in a moment; if the owner crashed, an operator must remove that lock file manually. |
| Coverage gate prints `COVERAGE FAILED` | The aggregated own-source statement or function ratio is below the configured floor, or no own-source entry was collected. | Confirm the emit step ran first and that the report step receives the external data directory, then inspect the reported ratios. |
| Report mode exits 1 with "coverage root is missing" | The report step was invoked without `--coverage-dir=<dir>`. | Pass the external coverage data directory explicitly; an environment variable alone is not accepted in report mode. |
| Test suite fails repo hygiene during coverage runs | Coverage JSON was written inside the checkout and contains absolute host URLs. | Keep both coverage directories outside the checkout, as the documented commands do; do not weaken the hygiene scan. |
| Byte-budget assertion fails | `client.js` grew past the versioned 112640-byte ceiling. | Either reduce the panel bundle or raise the ceiling in an explicit commit with a measured rationale; the assertion never self-adjusts. |

Source: `scripts/install-craft.js:8`, `scripts/install-craft.js:106-108` (installer lock), `.devflow/plans/backlog-60-pass5.md:242-253` (external coverage directories), `.devflow/plans/backlog-60-pass5.md:321-325` (thresholds and failure output), `.devflow/plans/backlog-60-pass5.md:337-349` (byte budget).
