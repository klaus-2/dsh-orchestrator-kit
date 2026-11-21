# API reference

The plugin registers six routes on the host connection. All responses are JSON with `content-type: application/json; charset=utf-8` and `cache-control: no-store`; successful reads may also carry a `server-timing` header with `reads`, `catalog` or `write` metrics. Every response is an object with an `ok` boolean. Errors set `ok: false` and include a human-readable `error` string; some errors also include a machine-readable `code`.

Source: `index.js:462-469` (response helper), `index.js:482-954` (route registration), `client.js:8-13` (client route constants).

## Route summary

| Path | Method | Section |
| --- | --- | --- |
| `/api/dsh-orchestrator-kit.roles` | GET | [Roles](#get-roles) |
| `/api/dsh-orchestrator-kit.catalog` | GET | [Catalog](#get-catalog) |
| `/api/dsh-orchestrator-kit.efforts` | GET | [Efforts](#get-efforts) |
| `/api/dsh-orchestrator-kit.route` | POST | [Route](#post-route) |
| `/api/dsh-orchestrator-kit.events` | GET | [Events](#get-events) |
| `/api/dsh-orchestrator-kit.diagnostics` | GET | [Diagnostics](#get-diagnostics) |

Source: `index.js:483`, `index.js:537`, `index.js:555`, `index.js:701`, `index.js:587`, `index.js:622`.

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
| `roles[].disabled` | `true` only when the card sets `disabled: true`. |
| `roles[].mtimeMs` | Card modification time; the client reuses it as `expectedMtimeMs`. |
| `invalid[]` | Cards that failed strict parsing, as `{ id, error }`. |
| `readOnly` | Mirrors the server's read-only flag. |

If the roles directory does not exist, the route still returns 200 with empty `roles` and `invalid` arrays. If it exists but cannot be read, the route returns 500 with `ok: false` and an error. Unreadable or unparsable individual cards go into `invalid[]` rather than failing the request.

Source: `index.js:482-534` (handler), `index.js:448-459` (role summary shape), `index.js:492` and `index.js:532` (envelope), `client.js:769-781` (client consumption).

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

Source: `index.js:536-552` (handler), `index.js:387-446` (catalog construction).

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

Source: `index.js:554-584` (handler and statuses), `index.js:331-385` (effort normalization), `client.js:885-897` (client query construction).

## POST route

Validates and atomically saves routing settings for one role. This is the only write route.

Request body — at least one of `provider`/`model`, `disabled` or `reasoningEffort` must be present:

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `id` | yes | entry name | Target card id. |
| `provider` | no | string or `null` | New provider; must be paired with `model`. Both `null` reset the route to inherit. |
| `model` | no | string or `null` | New model; `inherit` as a literal is rejected here. |
| `reasoningEffort` | no | string or `null` | Effort id; `null` clears it. Cannot be set while resetting the route. |
| `disabled` | no | boolean | `true` disables the role; `false` removes the flag. |
| `expectedMtimeMs` | no | finite number >= 0 | Stale-draft guard from the roles response. |

```json
{ "id": "arch-advisor", "provider": "example-hub", "model": "flash-a", "reasoningEffort": null, "disabled": false, "expectedMtimeMs": 123 }
```

Success responses:

```json
{ "ok": true, "role": { "id": "arch-advisor", "name": "arch-advisor", "description": null, "provider": "example-hub", "model": "flash-a", "reasoningEffort": null, "disabled": false, "mtimeMs": 124 } }
```

```json
{ "ok": true, "unchanged": true, "role": { "id": "arch-advisor", "name": "arch-advisor", "description": null, "provider": "example-hub", "model": "flash-a", "reasoningEffort": null, "disabled": false, "mtimeMs": 123 } }
```

| Status | Condition |
| --- | --- |
| 200 | Saved, or `unchanged: true` when the computed card text is identical. |
| 403 | Read-only mode; body is `{ ok: false, code: "readonly", error }`. |
| 404 | No card with the given id. |
| 409 | Stale `expectedMtimeMs`, provider or model absent from the live catalog, unknown route for effort validation, or unsupported effort. |
| 413 | Body exceeds 65536 bytes, by declared length or measured byte length. |
| 400 | Invalid JSON, non-object body, unknown field, invalid id, mismatched route pair, invalid flag types, or a strict-mode frontmatter violation. |
| 503 | Model catalog unavailable, model resolver unavailable, or lock timeout with `code: "lock-timeout"`. |
| 500 | Card unreadable, path validation failure, write or read-back failure, or post-write validation failure. |

**Read-only rule.** Read-only mode is checked first in this handler and returns 403 before the body is parsed. No other route returns that 403; the roles response instead reports the same state as `readOnly: true`, and the panel uses that field to present the controls as read-only. Read-only mode is enabled by `DSH_ORCHESTRATOR_READONLY` set to `1` or `true`.

Source: `index.js:18` (allowed body fields), `index.js:700-762` (validation), `index.js:764-798` (path, read, strict parse), `index.js:805-841` (catalog, effort, patch), `index.js:845-952` (write path and responses), `index.js:27-32` and `index.js:705-707` (read-only), `client.js:540-548` and `client.js:769-773` (client handling).

## GET events

Reads the audit trail. No query parameters.

```json
{
  "ok": true,
  "events": [
    {
      "at": "2026-01-01T00:00:00.000Z",
      "id": "arch-advisor",
      "previous": { "provider": null, "model": "inherit", "reasoningEffort": null, "disabled": false },
      "next": { "provider": "example-hub", "model": "flash-a", "reasoningEffort": null, "disabled": false },
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

Source: `index.js:586-619` (handler), `index.js:471` (audit file path), `index.js:592` and `index.js:601-616` (cap and projection), `client.js:1236-1248` (client consumption).

## GET diagnostics

Compares installed cards with the bundled sources and the live catalog. No query parameters.

```json
{
  "ok": true,
  "missing": [],
  "invalid": [],
  "outsideCatalog": [],
  "drift": [],
  "craftAvailable": true
}
```

| Field | Meaning |
| --- | --- |
| `missing` | Bundled role ids with no installed card; empty when craft sources are unavailable. |
| `invalid` | Installed cards that failed strict parsing, as `{ id, error }`. |
| `outsideCatalog` | Installed roles whose pinned pair is absent from the live catalog. |
| `drift` | Installed roles whose Markdown body differs from the bundled source. |
| `craftAvailable` | `true` only when the bundled craft source directory was readable. |

`craftAvailable` starts as `false`. It becomes `true` only when the source directory resolves and can be read; if reading it fails, it is set back to `false` and drift checking is skipped. `outsideCatalog` is only populated when the catalog reports `available: true`. An unreadable roles directory returns 500; a missing one is treated as empty.

Source: `index.js:621-698` (handler), `index.js:627` (initial report), `index.js:654-680` (craft checks), `index.js:682-695` (catalog cross-check), `client.js:1251-1266` (client consumption).
