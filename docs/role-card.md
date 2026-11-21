# Role card frontmatter reference

Role cards are Markdown files with a leading YAML frontmatter block. The panel reads a small, fixed set of frontmatter keys and writes back only the routing keys it owns. The Markdown body after the frontmatter is free-form and is preserved unchanged.

The two functions that define this contract are `parseRoleCard` (read) and `applyCardSettings` (write); `summarizeMeta` builds the before/after routing summaries stored in the audit trail.

Source: `index.js:13` (frontmatter grammar), `index.js:14` (byte limit), `index.js:165-213` (parsing), `index.js:238-300` (writing), `index.js:215-224` (summaries).

## Fields the writer reads

| Field | Type | Behavior |
| --- | --- | --- |
| `name` | non-empty string | Display name of the role. Read for the summary; never rewritten by the routing writer. |
| `description` | non-empty string | Short description shown in the panel. Read for the summary; never rewritten by the routing writer. |
| `provider` | non-empty string | Provider id of the pinned route. Written only as part of a route change. |
| `model` | non-empty string, or `inherit` | Model id of the pinned route. `inherit` means no route: follow the chat default, and no `provider` may be present. |
| `reasoning_effort` | non-empty string | Canonical snake-case key for the reasoning effort. Written only when an effort is set. |
| `disabled` | boolean | Present with value `true` when the role is disabled; absent means enabled. |

`name` and `description` are required by the bundled role-card contract; the parser treats them as optional scalars but the panel cannot display a meaningful entry without them. Any present value must be a non-empty string or the card is reported as invalid.

Source: `index.js:128-133` (optional scalar rule), `index.js:192-213` (field parsing), `index.js:448-459` (role summary), `index.js:215-224` (summary of the routing keys).

## Field rules

- **Route pair.** `provider` and `model` are set together. `model: inherit` cannot be combined with a `provider`; the server rejects such a card with 400. Resetting a route deletes `provider`, `reasoning_effort` and the camel-case alias, and sets `model: inherit`.
- **Effort key.** `reasoning_effort` is canonical. `reasoningEffort` is accepted as a read alias only. If both are present with different values the card is invalid. The writer removes the alias and emits only `reasoning_effort`.
- **Effort dependency.** A reasoning effort cannot be set when the effective route is `inherit` or otherwise incomplete. The server also checks the value against the model's advertised effort ids before writing.
- **Disabled flag.** Setting it to `true` writes `disabled: true`; setting it to `false` removes the key. There is no `disabled: false` in the canonical form. A missing key and any non-`true` value both mean enabled.

Source: `index.js:198-212` (effort alias and conflict), `index.js:204` (inherit/provider conflict), `index.js:258-293` (write rules), `index.js:274-278` (disabled flag), `scripts/test.mjs:242-245` (bundled card name/description contract).

## Strict parsing and limits

The panel reads and writes cards in strict mode. The frontmatter must be a YAML object, at most 65536 bytes, and must not contain aliases, anchors, custom tags, or a nesting depth greater than 24. Invalid YAML, a non-object frontmatter, or any of those constructs makes the card uneditable in the panel; it is listed under `invalid` in the roles response and under `invalid` in diagnostics.

A leading byte-order mark is stripped before parsing and is not re-emitted on save. The dominant line ending of the card is detected and reused for the rewritten frontmatter, so a card that used CRLF stays CRLF. Only the frontmatter text is regenerated; the body after the closing delimiter is copied byte for byte.

Source: `index.js:14-15` (byte and depth limits), `index.js:109-113` (line-ending detection), `index.js:165-190` (strict document rules), `index.js:253-299` (BOM, EOL and verbatim body), `index.js:520-526` (invalid card list), `index.js:641-646` (diagnostics invalid list).

## What a save changes

A save recomputes the frontmatter from the parsed document, applies only the requested routing patch, and reparses the result in strict mode before it is accepted. If the computed text equals the original, the server returns `unchanged: true` and writes nothing. The response always carries the full role summary, including the card's modification time, which the client uses as `expectedMtimeMs` on the next save.

Source: `index.js:839-867` (patch, reparse, unchanged branch), `index.js:944-952` (post-write validation and response), `client.js:971-974` (client sends the modification time).
