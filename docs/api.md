# API reference

The plugin registers eight routes on the host connection (the settings route answers GET and POST). All responses are JSON with `content-type: application/json; charset=utf-8` and `cache-control: no-store`; successful reads may also carry a `server-timing` header with `reads`, `catalog` or `write` metrics. Every response is an object with an `ok` boolean. Errors set `ok: false` and include a human-readable `error` string; some errors also include a machine-readable `code`.

Source: `index.js:652-680` (response helper), `index.js:685-1360` (route registration), `client.js:9-21` (client route constants).

## Route summary

| Path | Method | Section |
| --- | --- | --- |
| `/api/dsh-orchestrator-kit.roles` | GET | [Roles](#get-roles) |
| `/api/dsh-orchestrator-kit.catalog` | GET | [Catalog](#get-catalog) |
| `/api/dsh-orchestrator-kit.efforts` | GET | [Efforts](#get-efforts) |
| `/api/dsh-orchestrator-kit.route` | POST | [Route](#post-route) |
| `/api/dsh-orchestrator-kit.events` | GET | [Events](#get-events) |
| `/api/dsh-orchestrator-kit.settings` | GET, POST | [Settings](#settings) |
| `/api/dsh-orchestrator-kit.diagnostics` | GET | [Diagnostics](#get-diagnostics) |
| `/api/dsh-orchestrator-kit.update` | GET | [Update](#get-update) |

Source: `index.js:603`, `index.js:657`, `index.js:675`, `index.js:844`, `index.js:707`, `index.js:742`, `index.js:821`.

## GET roles

Lists installed role cards. No query parameters and no request body.

```json
{
  "ok": true,
  "roles": [
    {
      "id": "arch-advisor",
      "name": "arch-advisor",
      "description": null,
      "provider": null,
      "model": "inherit",
      "reasoningEffort": null,
      "fallbackProvider": null,
      "fallbackModel": null,
      "disabled": false,
      "mtimeMs": 123
    }
  ],
  "invalid": [],
  "readOnly": false
}
```

| Field | Meaning |
| --- | --- |
| `roles[].id` | File name of the card without its `.md` suffix. |
| `roles[].name` | Card `name`, or the id when the card has no name. |
| `roles[].description` | Card `description`, or `null`. |
| `roles[].provider` | Pinned provider, or `null`. |
| `roles[].model` | Pinned model, or the literal `inherit`. |
| `roles[].reasoningEffort` | Configured effort, or `null`. |
| `roles[].fallbackProvider` | Fallback-route provider, or `null`. |
| `roles[].fallbackModel` | Fallback-route model, or `null`. |
| `roles[].disabled` | `true` only when the card sets `disabled: true`. |
| `roles[].mtimeMs` | Card modification time; the client reuses it as `expectedMtimeMs`. |
| `invalid[]` | Cards that failed strict parsing, as `{ id, error }`. |
| `readOnly` | Mirrors the server's read-only flag. |

If the roles directory does not exist, the route still returns 200 with empty `roles` and `invalid` arrays. If it exists but cannot be read, the route returns 500 with `ok: false` and an error. Unreadable or unparsable individual cards go into `invalid[]` rather than failing the request.

Source: `index.js:603-655` (handler), `index.js:464-475` (role summary shape), `index.js:613` and `index.js:653` (envelope), `client.js:1130-1142` (client consumption).

## GET catalog

Reports the live provider/model inventory. No query parameters.

```json
{
  "ok": true,
  "available": true,
  "degraded": false,
  "failedProviders": [],
  "default": null,
  "groups": [
    {
      "provider": "example-hub",
      "name": "example-hub",
      "models": [{ "id": "flash-a", "name": "flash-a" }]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `available` | `true` when the host adapter exposes provider and model listing. |
| `degraded` | `true` when at least one provider failed to list its models. |
| `failedProviders` | Ids of providers whose model listing failed. |
| `default` | Chat default as `{ provider, model }`, or `null`. |
| `groups[]` | Per-provider entries with `provider`, `name` and `models`. |
| `groups[].models[]` | Model entries with `id` and `name`. |

The route always returns 200; availability is reported in the body, not in the status code. If the adapter cannot provide listing functions, `available` is `false`, `degraded` is `true` and `groups` is empty.

Source: `index.js:657-673` (handler), `index.js:403-462` (catalog construction).

## GET efforts

Resolves the reasoning efforts supported by one provider/model pair.

Request query parameters: `provider` and `model`, both non-empty.

```json
{
  "ok": true,
  "provider": "example-hub",
  "model": "flash-a",
  "defaultEffort": null,
  "efforts": [{ "id": "low", "name": "low" }]
}
```

| Field | Meaning |
| --- | --- |
| `defaultEffort` | The model's advertised default effort id, or `null`. |
| `efforts[].id` | Effort id to send back as `reasoningEffort`. |
| `efforts[].name` | Display name, falling back to the id. |
| `efforts[].description` | Optional description when the adapter supplies one. |

| Status | Condition |
| --- | --- |
| 200 | Route resolved; `efforts` may be empty. |
| 400 | `provider` or `model` query parameter is missing or empty. |
| 503 | The host model resolver is unavailable, or the lookup failed upstream. |
| 502 | The adapter returned invalid model metadata. |
| 504 | Model-info resolution timed out. |
| 409 | The route is unknown or unresolvable. |

Source: `index.js:675-705` (handler and statuses), `index.js:347-401` (effort normalization), `client.js:1254-1258` (client query construction).

## POST route

Validates and atomically saves routing settings for one role. This is the only write route.

Request body — at least one of `provider`/`model`, `disabled`, `reasoningEffort` or `fallback` must be present:

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `id` | yes | entry name | Target card id. |
| `provider` | no | string or `null` | New provider; must be paired with `model`. Both `null` reset the route to inherit. |
| `model` | no | string or `null` | New model; `inherit` as a literal is rejected here. |
| `fallback` | no | `{ provider, model }` or `null` | One-shot retry route for model-availability failures. `null` clears it; resetting the route never touches it. |
| `reasoningEffort` | no | string or `null` | Effort id; `null` clears it. Cannot be set while resetting the route. |
| `disabled` | no | boolean | `true` disables the role; `false` removes the flag. |
| `expectedMtimeMs` | no | finite number >= 0 | Stale-draft guard from the roles response. |

```json
{ "id": "arch-advisor", "provider": "example-hub", "model": "flash-a", "fallback": { "provider": "example-cloud", "model": "reasoner-b" }, "reasoningEffort": null, "disabled": false, "expectedMtimeMs": 123 }
```

Success responses:

```json
{ "ok": true, "role": { "id": "arch-advisor", "name": "arch-advisor", "description": null, "provider": "example-hub", "model": "flash-a", "reasoningEffort": null, "fallbackProvider": "example-cloud", "fallbackModel": "reasoner-b", "disabled": false, "mtimeMs": 124 } }
```

```json
{ "ok": true, "unchanged": true, "role": { "id": "arch-advisor", "name": "arch-advisor", "description": null, "provider": "example-hub", "model": "flash-a", "reasoningEffort": null, "fallbackProvider": "example-cloud", "fallbackModel": "reasoner-b", "disabled": false, "mtimeMs": 123 } }
```

| Status | Condition |
| --- | --- |
| 200 | Saved, or `unchanged: true` when the computed card text is identical. |
| 403 | Read-only mode; body is `{ ok: false, code: "readonly", error }`. |
| 404 | No card with the given id. |
| 409 | Stale `expectedMtimeMs`, provider or model (route or fallback) absent from the live catalog, unknown route for effort validation, or unsupported effort. |
| 413 | Body exceeds 65536 bytes, by declared length or measured byte length. |
| 400 | Invalid JSON, non-object body, unknown field, invalid id, mismatched route pair, half-written fallback, `fallback.model: inherit`, invalid flag types, or a strict-mode frontmatter violation. |
| 503 | Model catalog unavailable, model resolver unavailable, or lock timeout with `code: "lock-timeout"`. |
| 500 | Card unreadable, path validation failure, write or read-back failure, or post-write validation failure. |

**Read-only rule.** Read-only mode is checked first in this handler and returns 403 before the body is parsed. No other route returns that 403; the roles response instead reports the same state as `readOnly: true`, and the panel uses that field to present the controls as read-only. Read-only mode is enabled by `DSH_ORCHESTRATOR_READONLY` set to `1` or `true`.

Source: `index.js:19` (allowed body fields), `index.js:844-905` (validation), `index.js:907-941` (path, read, strict parse), `index.js:948-984` (catalog, effort, patch), `index.js:988-1095` (write path and responses), `index.js:43-47` and `index.js:848-850` (read-only), `client.js:870-879` and `client.js:1358-1360` (client handling).

## GET events

Reads the audit trail. No query parameters.

```json
{
  "ok": true,
  "events": [
    {
      "at": "2026-01-01T00:00:00.000Z",
      "id": "arch-advisor",
      "previous": { "provider": null, "model": "inherit", "reasoningEffort": null, "fallback": null, "disabled": false },
      "next": { "provider": "example-hub", "model": "flash-a", "reasoningEffort": null, "fallback": { "provider": "example-cloud", "model": "reasoner-b" }, "disabled": false },
      "origin": "panel"
    }
  ],
  "skipped": 0
}
```

| Field | Meaning |
| --- | --- |
| `events[].at` | ISO timestamp, or `null` when the record lacks a string. |
| `events[].id` | Role id, or `null` when absent. |
| `events[].previous` | Previous routing summary, or `null`. |
| `events[].next` | New routing summary, or `null`. |
| `events[].origin` | Origin string, `panel` for panel writes, or `null`. |
| `skipped` | Number of malformed or non-object lines encountered. |

At most the last 50 non-empty lines are parsed. If the audit file does not exist, the route returns 200 with `events: []` and `skipped: 0`. If it exists but cannot be read, the route returns 500.

Source: `index.js:707-740` (handler), `index.js:591` (audit file path), `index.js:713` and `index.js:722-737` (cap and projection), `client.js:1605-1619` (client consumption).

## Settings

Reads and writes the plugin's server-side preferences, stored as `.orchestrator-settings.json` beside the change log. No query parameters.

`GET` answers:

```json
{ "ok": true, "settings": { "teamModeDefault": false }, "readOnly": false }
```

| Field | Meaning |
| --- | --- |
| `settings.teamModeDefault` | Whether new root sessions start in Agent Teams mode. The server applies it on `agent/created` and only when the session carries no saved mode selection, so an explicit per-session choice always wins. |
| `readOnly` | Mirrors the server's read-only flag. |

`POST` takes `{ "teamModeDefault": boolean }` — the only accepted field — and rewrites the file atomically under the writer lock; the body echoes the stored settings on success.

| Status | Condition |
| --- | --- |
| 200 | Saved. |
| 403 | Read-only mode; body is `{ ok: false, code: "readonly", error }`. |
| 413 | Body exceeds 4096 bytes, by declared length or measured byte length. |
| 400 | Invalid JSON, non-object body, unknown field, or `teamModeDefault` is not a boolean. |
| 503 | Writer lock timeout with `code: "lock-timeout"`. |
| 500 | Write failure. |

A missing settings file answers the defaults; a corrupt one degrades to the defaults with a server warning.

Source: `index.js:152-168` (defaults and reader), `index.js:874-930` (GET and POST handlers), `client.js` (settings bootstrap and the team default toggle).

## GET diagnostics

Compares installed cards with the bundled sources and the live catalog. No query parameters.

```json
{
  "ok": true,
  "missing": [],
  "invalid": [],
  "outsideCatalog": [],
  "fallbackOutsideCatalog": [],
  "drift": [],
  "craftAvailable": true
}
```

| Field | Meaning |
| --- | --- |
| `missing` | Bundled role ids with no installed card; empty when craft sources are unavailable. |
| `invalid` | Installed cards that failed strict parsing, as `{ id, error }`. |
| `outsideCatalog` | Installed roles whose pinned pair is absent from the live catalog. |
| `fallbackOutsideCatalog` | Installed roles whose `fallback` pair is absent from the live catalog. |
| `drift` | Installed roles whose Markdown body differs from the bundled source. |
| `craftAvailable` | `true` only when the bundled craft source directory was readable. |

`craftAvailable` starts as `false`. It becomes `true` only when the source directory resolves and can be read; if reading it fails, it is set back to `false` and drift checking is skipped. `outsideCatalog` and `fallbackOutsideCatalog` are only populated when the catalog reports `available: true`. An unreadable roles directory returns 500; a missing one is treated as empty.

Source: `index.js:742-819` (handler), `index.js:748` (initial report), `index.js:775-801` (craft checks), `index.js:803-816` (catalog cross-check), `client.js:1620-1636` (client consumption).

## GET update

Compares the running version with the latest GitHub release and reports whether an installable update exists. This is the only route that talks to the network: two read-only outbound GETs, the GitHub releases API for the latest release and the npm registry as the installability gate, each on a 10-second timeout and neither carrying credentials. The check reads nothing the read-only flag protects, so it runs regardless of `DSH_ORCHESTRATOR_READONLY`.

Default shape, no query parameters:

```json
{
  "ok": true,
  "name": "dsh-orchestrator-kit",
  "current": "0.1.0",
  "latest": "0.2.0",
  "managed": true,
  "newer": true,
  "url": "https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.2.0",
  "notes": "Summary text taken from the release body.",
  "installed": "0.2.0"
}
```

| Field | Meaning |
| --- | --- |
| `name` | Package name of the running plugin; omitted when it has none. |
| `current` | Running version; omitted when unknown. |
| `latest` | Latest release tag without its `v` prefix; only strict `x.y.z` tags are accepted, anything else fails the check. |
| `managed` | `true` when the running package is the npm-published `dsh-orchestrator-kit` with a known version, i.e. installable through the host plugin manager. |
| `newer` | Double gate: `true` only when the local version parses as `x.y.z`, is strictly older than `latest`, and the npm registry confirms the release is published. A malformed tag can never push a downgrade. |
| `url` | Release page URL, kept only when it parses to the `https://github.com` origin. |
| `notes` | Human-readable part of the release body: everything before the `## Install` heading, capped at 20000 characters. |
| `installed` | Present only when the package on disk is strictly newer than the running one — the package was updated without restarting the harness. |

Any failure of the GitHub probe — a non-OK answer, a release without a usable `x.y.z` tag, a network or timeout error — is answered as:

```json
{ "ok": false, "error": "the GitHub releases API answered 404 for the latest release" }
```

with status `502`. An npm failure does not fail the route; it only closes the `newer` gate, so an unpublished release is never advertised as installable.

`?current=1` is the zero-network mode the What's-new dialog uses — the running version plus the shipped per-language notes, no GitHub/npm traffic:

```json
{
  "ok": true,
  "current": "0.1.0",
  "notes": { "en": "…", "pt-BR": "…", "zh": "…" }
}
```

`notes` comes from the shipped `release-notes.json` and is omitted when the file is missing or corrupt, or its `version` does not match the running package version. Language keys are filtered to BCP-47 shapes, which also blocks `__proto`-style keys before they reach client-side object handling.

| Status | Condition |
| --- | --- |
| 200 | The check succeeded (default shape) or the shipped-notes mode answered. |
| 502 | The GitHub releases probe failed; body is `{ ok: false, error }`. |

Source: `index.js:821-841` (handler), `index.js:547-579` (GitHub/npm probe), `index.js:532-541` (newer-on-disk check), `index.js:518-529` (shipped notes), `index.js:508-514` (release body cut), `client.js:590-759` (updater and What's-new stores).
