# C8 Live-host smoke — backlog-60 Pass 2 (panel i18n)

Date: 2026-11-19 (local, UTC-3). Owner: browser-qa.
Target: the current DSH Web GUI URL (runtime context) — Settings → Orchestrator
panel of the dsh-orchestrator-kit plugin.
Plan: `.devflow/plans/backlog-60-pass2.md` §6.3 (frozen smoke steps a–f).

## Verdict

**Live-host integration check: BLOCKED.** Two independent blockers, both
documented below. No smoke step (a–f) was executed; nothing was faked.
VM-harness semantics ARE proven by the 61-test suite: 61 ok / 0 FAIL, exit 0,
`ALL TESTS PASSED`, 5/5 consecutive anti-flake runs green
(`verification.md`, `test-run-1.log` … `test-run-5.log` in this directory).

## Contract (what the smoke would assert)

- a. Settings → Orchestrator renders in the host language.
- b. Panel select → Português (BR): translated header/tabs/fields/buttons
  (e.g. `Provedor`, `Modelo`, `Esforço de raciocínio`, `Salvar`).
- c. Panel select → 简体中文: translated strings (e.g. `角色路由`, `提供商`,
  `模型`, `推理强度`, `保存`).
- d. Back to Auto: host language returns.
- e. Reload: a non-Auto override is restored from same-session localStorage
  (key `dsh-orchestrator-kit.locale`, client.js:252).
- f. Zero uncaught console errors; zero 4xx/5xx on plugin routes during the flow.

## Blocker 1 — auth gate (decisive for this run)

- The GUI is reachable: navigation to the current DSH Web GUI URL (runtime
  context) succeeded, but a server-side fetch of the root returned **HTTP 401**.
- The browser renders the auth interstitial; verbatim page text (semantic
  snapshot and `document.body.innerText`, identical across two observations):

  > dsh web authentication required; reopen the URL printed by dsh web.

- The page exposes no interactive login form — entry requires the signed URL
  printed by `dsh web`. The agent browser instance holds no signed session
  cookie. Per the assignment, **no auth bypass was attempted** and no host
  profile state was read for credentials or modified.
- Screenshot of the blocker page: **not obtainable** — four
  `Page.captureScreenshot` CDP timeouts (full page ×2, clipped region, and
  reload-then-capture). The verbatim DOM text above is the recorded evidence in
  its place; no image file was produced. No machine tokens were captured.

## Blocker 2 — running host predates the Pass 2 code

Facts established read-only from the checkout and the host environment:

- The plugin is installed into the DSH desktop profile as a **symbolic link to
  this repository checkout** (the profile's package.json declares
  `dsh-orchestrator-kit` as a `link:` dependency; the profile's
  `node_modules/dsh-orchestrator-kit` is a symlink resolving to the checkout).
  The host therefore serves this working tree — but only what it loaded.
- The host process (product name "DeepSeek Harness") started
  **2026-11-19T11:48:18-03:00**.
- Working-tree mtimes: `client.js` **2026-11-19T22:34:56-03:00**, `index.js`
  **2026-11-19T21:26:05-03:00** — both AFTER host start. The running process
  loaded pre-Pass-2 plugin code at startup; whether the host hot-reloads plugin
  code could not be verified through the auth gate. **A host restart is
  required to guarantee the Pass 2 code is served.**
- Git state: HEAD `fe4e508` (pre-Pass-2); the Pass 2 change is uncommitted in
  the working tree (`client.js`, `locale/en.json`, `locale/pt-BR.json`,
  `locale/zh.json`, `scripts/test.mjs`, three READMEs, `CHANGELOG.md`).
- The working tree DOES contain the Pass 2 feature: `LANGUAGE_OPTIONS`
  (client.js:251), the header select's option rendering (client.js:763), and
  the best-effort persistence key `dsh-orchestrator-kit.locale` (client.js:252,
  read :263, write/remove :272–273).

## What WAS verified live

1. GUI reachability and auth-gate behavior: HTTP 401 at the root without a
   session; the exact interstitial text above (observed twice, before and after
   a reload).
2. Nothing else — the panel, its routes, and its console/network signals are
   unreachable behind the auth gate. Steps a–f: NOT RUN.

## Manual steps for the human (once the working-tree plugin is loaded)

Prerequisites (lead/user decision — not performed by browser-qa):
1. Restart the DSH host so the symlinked working-tree plugin (Pass 2) is
   loaded into the running process.
2. Open the signed URL printed by `dsh web` in the browser (this is the
   legitimate auth flow; it sets the signed session cookie).

Then execute the frozen smoke (plan §6.3):
- a. Open Settings → Orchestrator. Assert: the panel renders in the host
  language. Screenshot (panel content only).
- b. Switch the header language select to **Português (BR)**. Assert translated
  strings, e.g. header `Roteamento por papel`, tab `Todos os papéis`, fields
  `Provedor` / `Modelo` / `Esforço de raciocínio`, button `Salvar`
  (locale/pt-BR.json). Screenshot.
- c. Switch to **简体中文**. Assert e.g. header `角色路由`, fields `提供商` /
  `模型` / `推理强度`, button `保存` (locale/zh.json). Screenshot.
- d. Switch back to **Auto**. Assert: the host language returns. Screenshot.
- e. Reload the page; assert the override is restored (same-session
  localStorage). Operational note: Auto CLEARS the stored override
  (client.js:272), so to prove restoration, re-select a non-Auto language
  (e.g. Português (BR)) after step d, then reload and assert the panel is still
  pt-BR and the select still shows Português (BR). Screenshot.
- f. DevTools: zero uncaught console errors; zero 4xx/5xx responses on the
  plugin routes across the whole flow.

Record results (screenshots + per-step PASS/FAIL) in this directory, token-clean
(no usernames, home paths, machine names; panel content only; refer to the GUI
as "the current DSH Web GUI URL (runtime context)" — never write the literal
port into a repo file).

## Retry after host restart (lead, 2026-11-20)

- The DSH host was restarted between the two attempts (the runtime GUI URL
  changed, confirming a new process). Lead re-ran reachability + auth directly
  with the agent browser tooling: the root still returns the same
  authentication interstitial ("dsh web authentication required; reopen the
  URL printed by dsh web"), no login form exists, and the agent browser holds
  no signed session. Blocker 1 persists across the restart.
- Blocker 2 (host predating the Pass 2 code) is resolved by the restart: the
  restarted process loaded the symlinked working tree (Pass 2 code present).
- Smoke steps a–f remain NOT RUN: they require the signed session URL, which
  only the human can open. The manual steps above are unchanged and remain
  the complete runbook.
- Nothing was faked; no bypass attempted; no host profile read for
  credentials or modified.

## Browser state left behind

The agent browser tab remains OPEN on the auth interstitial at the current DSH
Web GUI URL (runtime context), as instructed (tabs kept open). No host profile,
plugin install, or application source/config/test file was modified by this
check; the only writes are this report under `.devflow/evidence/`.