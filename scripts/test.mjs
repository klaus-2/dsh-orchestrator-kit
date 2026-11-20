import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { parseDocument } from 'yaml';
import {
  agentsRootOf,
  apply,
  applyCardSettings,
  applyRouteToCard,
  cardPathOf,
  isEntryName,
  parseRoleCard
} from '../index.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

const NS = 'dsh-orchestrator-kit';
const EXAMPLE_HUB = 'example-hub';
const EXAMPLE_CLOUD = 'example-cloud';
const EXAMPLE_OPEN = 'example-open';

const source = readFileSync(path.join(packageDir, 'client.js'), 'utf8');

const LF_CARD = `---
name: reviewer
description: >
  Review plans for clarity and verifiability
model: inherit
# a comment the round-trip must keep
---

Body line
`;

const CRLF_CARD = LF_CARD.replace(/\n/g, '\r\n');
const BOM_CARD = `\uFEFF${LF_CARD}`;
const NO_FRONTMATTER_CARD = 'just a body, no frontmatter\n';
const FRONTMATTER = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const STRICT_LF_FRONTMATTER = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

const EXAMPLE_ROUTED_ROLES = {
  'repo-scout': { provider: EXAMPLE_HUB, model: 'flash-a' },
  'test-auditor': { provider: EXAMPLE_HUB, model: 'flash-b' },
  'arch-advisor': { provider: EXAMPLE_CLOUD, model: 'reasoner-b' },
  'plan-auditor': { provider: EXAMPLE_CLOUD, model: 'reasoner-b' },
  'run-conductor': { provider: EXAMPLE_CLOUD, model: 'reasoner-c' },
  'diff-reviewer': { provider: EXAMPLE_CLOUD, model: 'reasoner-c' },
  planner: { provider: EXAMPLE_OPEN, model: 'base-c' },
  'error-auditor': { provider: EXAMPLE_OPEN, model: 'base-d' },
  'security-auditor': { provider: EXAMPLE_CLOUD, model: 'reasoner-d' }
};

const CRAFT_ROLES = [
  'repo-scout',
  'docs-scout',
  'media-analyst',
  'arch-advisor',
  'scope-analyst',
  'planner',
  'plan-auditor',
  'run-conductor',
  'implementer',
  'debugger',
  'diff-reviewer',
  'test-auditor',
  'test-writer',
  'browser-qa',
  'error-auditor',
  'security-auditor',
  'perf-auditor',
  'debt-auditor',
  'docs-sync',
  'tech-writer'
];

const CRAFT_PLAYBOOKS = [
  'ai-estimates.md',
  'clonedeps.md',
  'codemap.md',
  'deanchor.md',
  'deepwork.md',
  'reflect.md',
  'simplify.md',
  'step-back.md',
  'verification-planning.md'
];

const LEGACY_ROLES = [
  'momus',
  'paladin',
  'prometheus',
  'metis',
  'proctor',
  'multimodal-looker',
  'chronicler',
  'janitor'
];

const LEGACY_WORD_RE = new RegExp(`\\b(?:${LEGACY_ROLES.join('|')})\\b`, 'i');
const FORBIDDEN_SYSTEM_LEAK_RE = /\bspawn_teammate\b|grill-me|\.sisyphus\b|\.omo\b/i;

const ADMIN_TOKEN = ['admin', 'istrator'].join('');
const WIN_HOME_TOKEN = ['c:', String.fromCharCode(92), 'users'].join('');
const POSIX_HOME_TOKEN = ['c:/u', 'sers'].join('');
const FORBIDDEN_TOKENS = [
  ADMIN_TOKEN,
  WIN_HOME_TOKEN,
  POSIX_HOME_TOKEN,
  ['mag', 'pie'].join(''),
  ['agy', '-cli'].join(''),
  ['nous', '-portal'].join(''),
  ['work', 'buddy'].join(''),
  ['minimax', '-code-global'].join(''),
  ['deepseek', '-rotation'].join(''),
  ['long', 'cat'].join(''),
  ['hy', '4'].join(''),
  ['auto', '/', 'glm'].join(''),
  ['auto', 'claw'].join(''),
  ['arroto', 'feroz'].join('')
];
const BAK_LITERAL = ['.b', 'ak'].join('');
const BAK_SUFFIX_RE = new RegExp(`${BAK_LITERAL}(?:-|$)`);
const OLD_PLUGIN_NAME = ['dsh-main-agent', '-preset'].join('');
const OLD_PLUGIN_SCOPE = ['@lo', 'cal/'].join('');

const repoFiles = (root = packageDir) => {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  visit(root);
  return files.sort();
};

let failures = 0;

async function test(label, run) {
  try {
    await run();
    console.log(`ok ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${label}`);
    console.error(error);
  }
}

function parseRouteText(text) {
  const match = FRONTMATTER.exec(text.replace(/^\uFEFF/, ''));
  assert.ok(match !== null, 'the rewritten card must keep a frontmatter block');
  const doc = parseDocument(match[1]);
  if (doc.errors.length > 0) throw new Error(doc.errors[0].message ?? String(doc.errors[0]));
  return doc.toJS();
}

async function withMockHost({ agentsHome, llm, defaultSelection, config = {} }, run) {
  const previousHome = process.env.DSH_AGENTS_HOME;
  process.env.DSH_AGENTS_HOME = agentsHome;
  const routes = new Map();
  const ctx = {
    get(service) {
      if (service === 'llm') return llm;
      if (service === 'agentDefaultModel') return defaultSelection ? { currentSelection: () => defaultSelection } : undefined;
      return undefined;
    },
    connection: {
      fetch: {
        register(spec) {
          routes.set(spec.path, spec);
        }
      }
    }
  };
  try {
    await apply(ctx, config);
    const call = async (routePath, options = {}) => {
      const url = new URL(routePath, 'http://localhost');
      const spec = routes.get(url.pathname);
      assert.ok(spec, `route ${url.pathname} must be registered`);
      const method = options.method ?? 'GET';
      assert.ok(spec.methods.includes(method), `route ${url.pathname} must allow ${method}`);
      const request = new Request(url.toString(), options);
      const response = await spec.fetch(request);
      const data = await response.json();
      return { status: response.status, data };
    };
    return await run({ call, routes });
  } finally {
    if (previousHome === undefined) delete process.env.DSH_AGENTS_HOME;
    else process.env.DSH_AGENTS_HOME = previousHome;
  }
}

function assertCleanLfCard(filePath) {
  const raw = readFileSync(filePath);
  assert.ok(!raw.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), `${filePath} must not carry a UTF-8 BOM`);
  const text = raw.toString('utf8');
  assert.ok(!text.includes('\r\n'), `${filePath} must use pure LF`);
  const match = STRICT_LF_FRONTMATTER.exec(text);
  assert.ok(match !== null, `${filePath} must start with --- on line 1`);
  const doc = parseDocument(match[1]);
  assert.equal(doc.errors.length, 0, `${filePath} frontmatter must parse cleanly`);
  const meta = doc.toJS();
  assert.ok(meta && typeof meta === 'object' && !Array.isArray(meta), `${filePath} frontmatter must be an object`);
  return { text, meta, body: text.slice(match[0].length) };
}

function assertNoLeaks(text, label) {
  assert.doesNotMatch(text, LEGACY_WORD_RE, `${label} must not leak legacy role names`);
  assert.doesNotMatch(text, FORBIDDEN_SYSTEM_LEAK_RE, `${label} must not leak removed tool or system tokens`);
  for (const token of FORBIDDEN_TOKENS) {
    assert.ok(!text.toLowerCase().includes(token.toLowerCase()), `${label} must not contain the machine token ${JSON.stringify(token)}`);
  }
}

function validateCraftCard(cardsDir, role) {
  const card = assertCleanLfCard(path.join(cardsDir, `${role}.md`));
  assert.equal(card.meta.name, role, `craft/agents/${role}.md name must equal ${role}`);
  assert.equal(typeof card.meta.description, 'string', `craft/agents/${role}.md must define description`);
  assert.ok(card.meta.description.length > 0 && card.meta.description.length <= 500, `craft/agents/${role}.md description must be 1..500 chars`);
  assert.match(card.meta.description, /^\[[^\]]+\]\s*Does:\s*[\s\S]+\/\s*Skip:\s*[\s\S]+/, `craft/agents/${role}.md description must follow [Phase] Does: ... / Skip: ...`);
  assert.equal(card.meta.provider, undefined, `craft/agents/${role}.md must not declare a provider`);
  assert.equal(card.meta.model, 'inherit', `craft/agents/${role}.md must use model: inherit`);
  assert.equal(card.meta.tools, undefined, `craft/agents/${role}.md must not declare ignored tools: key`);
  assert.equal(card.meta.hooks, undefined, `craft/agents/${role}.md must not declare ignored hooks: key`);
  assert.equal(card.meta.reasoningEffort, undefined, `craft/agents/${role}.md must not emit camelCase reasoningEffort`);
  assert.equal(card.meta.reasoning_effort, undefined, `craft/agents/${role}.md must not emit reasoning_effort`);
  assert.ok(card.body.trim().length > 0, `craft/agents/${role}.md must have a non-empty body`);
  assert.doesNotMatch(card.body, /send_message\s*\(\s*\{[^}]*\btarget\s*:/, `craft/agents/${role}.md must use agent:, never target:`);
  assertNoLeaks(card.text, `craft/agents/${role}.md`);
  return card;
}

function validateCraftParity(craftAgentsDir, mirrorDir) {
  for (const role of CRAFT_ROLES) {
    const card = validateCraftCard(craftAgentsDir, role);
    const mirrorPath = path.join(mirrorDir, `${role}.md`);
    assert.ok(existsSync(mirrorPath), `craft/skills/dev-flow/agents/${role}.md mirror must exist`);
    const mirror = assertCleanLfCard(mirrorPath);
    assert.equal(mirror.meta.name, role, `craft/skills/dev-flow/agents/${role}.md name must equal ${role}`);
    assert.equal(mirror.meta.model, 'inherit', `craft/skills/dev-flow/agents/${role}.md must use model: inherit`);
    assert.equal(mirror.meta.provider, undefined, `craft/skills/dev-flow/agents/${role}.md must not declare a provider`);
    assert.equal(mirror.body, card.body, `craft/skills/dev-flow/agents/${role}.md Markdown body must be byte-identical to craft/agents/${role}.md`);
    assertNoLeaks(mirror.text, `craft/skills/dev-flow/agents/${role}.md`);
  }
}

function validateCraftPlaybooks(playbooksDir) {
  const files = readdirSync(playbooksDir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name).sort();
  assert.deepEqual(files, [...CRAFT_PLAYBOOKS].sort(), 'craft/skills/dev-flow/playbooks must hold the exact 9 Craft playbooks');
  for (const file of files) {
    const raw = readFileSync(path.join(playbooksDir, file));
    assert.ok(!raw.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), `playbook ${file} must not carry a BOM`);
    const text = raw.toString('utf8');
    assert.ok(!text.includes('\r\n'), `playbook ${file} must use pure LF`);
    const match = STRICT_LF_FRONTMATTER.exec(text);
    assert.ok(match !== null, `playbook ${file} must start with --- on line 1`);
    const doc = parseDocument(match[1]);
    assert.equal(doc.errors.length, 0, `playbook ${file} frontmatter must parse cleanly`);
    assertNoLeaks(text, `playbook ${file}`);
  }
}

function validateCraftSkill(skillDir, label) {
  const parsed = assertCleanLfCard(path.join(skillDir, 'SKILL.md'));
  assert.equal(typeof parsed.meta.name, 'string', `${label}/SKILL.md must declare name`);
  assert.equal(typeof parsed.meta.description, 'string', `${label}/SKILL.md must declare description`);
  assertNoLeaks(parsed.text, `${label}/SKILL.md`);
}

await test('applyRouteToCard: set writes provider and model', () => {
  const out = applyRouteToCard(LF_CARD, { provider: EXAMPLE_HUB, model: 'flash-a' });
  const meta = parseRouteText(out);
  assert.equal(meta.provider, EXAMPLE_HUB);
  assert.equal(meta.model, 'flash-a');
  assert.equal(meta.name, 'reviewer');
});

await test('applyRouteToCard: reset restores model inherit and removes provider', () => {
  const set = applyRouteToCard(LF_CARD, { provider: EXAMPLE_HUB, model: 'flash-a' });
  const out = applyRouteToCard(set, null);
  const meta = parseRouteText(out);
  assert.equal(meta.provider, undefined);
  assert.equal(meta.model, 'inherit');
  assert.equal(meta.name, 'reviewer');
});

await test('applyRouteToCard: half-written route throws', () => {
  assert.throws(() => applyRouteToCard(LF_CARD, { provider: EXAMPLE_HUB, model: '' }), /needs a non-empty provider and model/);
  assert.throws(() => applyRouteToCard(LF_CARD, { provider: '', model: 'flash-a' }), /needs a non-empty provider and model/);
  assert.throws(() => applyRouteToCard(LF_CARD, { provider: EXAMPLE_HUB }), /needs a non-empty provider and model/);
});

await test('applyRouteToCard: round-trip preserves comments and unknown keys', () => {
  const out = applyRouteToCard(LF_CARD, { provider: EXAMPLE_HUB, model: 'flash-a' });
  assert.match(out, /# a comment the round-trip must keep/);
  const meta = parseRouteText(out);
  assert.equal(meta.model, 'flash-a');
  const set = applyRouteToCard(LF_CARD, { provider: 'p', model: 'm' });
  const reset = applyRouteToCard(set, null);
  assert.match(reset, /# a comment the round-trip must keep/);
});

await test('applyRouteToCard: card without frontmatter throws a clear message', () => {
  assert.throws(() => applyRouteToCard(NO_FRONTMATTER_CARD, { provider: 'p', model: 'm' }), /no frontmatter block/);
  assert.throws(() => applyRouteToCard(NO_FRONTMATTER_CARD, null), /no frontmatter block/);
});

await test('applyRouteToCard: CRLF card keeps CRLF and a byte-identical body', () => {
  const out = applyRouteToCard(CRLF_CARD, { provider: EXAMPLE_HUB, model: 'flash-a' });
  assert.ok(out.includes('\r\n'), 'frontmatter must keep CRLF');
  assert.ok(out.includes('# a comment the round-trip must keep\r\n'));
  const originalBody = CRLF_CARD.slice(CRLF_CARD.indexOf('---\r\n\r\n'));
  assert.ok(out.endsWith(originalBody), 'body must be byte-identical');
  assert.ok(!out.slice(0, out.indexOf('---\r\n\r\n')).includes('Body line'));
  const meta = parseRouteText(out);
  assert.equal(meta.model, 'flash-a');
});

await test('applyRouteToCard: LF card keeps LF', () => {
  const out = applyRouteToCard(LF_CARD, { provider: EXAMPLE_HUB, model: 'flash-a' });
  assert.ok(!out.includes('\r\n'), 'an LF card must not grow CRLF');
  const meta = parseRouteText(out);
  assert.equal(meta.model, 'flash-a');
});

await test('applyRouteToCard: BOM card parses and the result has no BOM', () => {
  const out = applyRouteToCard(BOM_CARD, { provider: EXAMPLE_HUB, model: 'flash-a' });
  assert.ok(!out.startsWith('\uFEFF'), 'BOM must not be re-emitted');
  const meta = parseRouteText(out);
  assert.equal(meta.model, 'flash-a');
  assert.equal(meta.name, 'reviewer');
});

await test('isEntryName: accepts plain ids and rejects traversal, uppercase, backslash, empty', () => {
  assert.equal(isEntryName('momus'), true);
  assert.equal(isEntryName('suite/momus'), true);
  assert.equal(isEntryName('plan-auditor'), true);
  assert.equal(isEntryName('..'), false);
  assert.equal(isEntryName('a/../b'), false);
  assert.equal(isEntryName('Reviewer'), false);
  assert.equal(isEntryName('x\\y'), false);
  assert.equal(isEntryName(''), false);
  assert.equal(isEntryName(undefined), false);
});

await test('cardPathOf: id with .. is barred before touching the disk', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'map-cards-'));
  try {
    assert.throws(() => cardPathOf(dir, '..'), /invalid entry name/);
    assert.throws(() => cardPathOf(dir, 'a/../b'), /invalid entry name/);
    assert.throws(() => cardPathOf(dir, '../outside'), /invalid entry name/);
    const inside = cardPathOf(dir, 'plan-auditor');
    assert.equal(path.resolve(inside), path.resolve(path.join(dir, 'plan-auditor.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('parseRoleCard: disabled coercion, reasoning_effort, alias, and conflict detection', () => {
  const absent = parseRoleCard('---\nname: A\n---\nbody\n');
  assert.equal(absent.disabled, false);
  assert.equal(absent.name, 'A');
  assert.equal(absent.reasoningEffort, undefined);
  const truthy = parseRoleCard('---\ndisabled: true\n---\nbody\n');
  assert.equal(truthy.disabled, true);
  const wrongType = parseRoleCard('---\ndisabled: "sim"\n---\nbody\n');
  assert.equal(wrongType.disabled, false);
  const route = parseRoleCard(`---\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nreasoning_effort: high\n---\n`);
  assert.equal(route.provider, EXAMPLE_HUB);
  assert.equal(route.model, 'flash-a');
  assert.equal(route.reasoningEffort, 'high');
  const aliasOnly = parseRoleCard('---\nprovider: p\nmodel: m\nreasoningEffort: medium\n---\n');
  assert.equal(aliasOnly.reasoningEffort, 'medium');
  const equalBoth = parseRoleCard('---\nprovider: p\nmodel: m\nreasoning_effort: xhigh\nreasoningEffort: xhigh\n---\n');
  assert.equal(equalBoth.reasoningEffort, 'xhigh');
  assert.throws(
    () => parseRoleCard('---\nprovider: p\nmodel: m\nreasoning_effort: high\nreasoningEffort: low\n---\n', 'test.md'),
    /test\.md: reasoning_effort and reasoningEffort conflict/
  );
  assert.throws(() => parseRoleCard('---\nreasoning_effort: ""\n---\n', 'test.md'), /must be a non-empty string/);
  assert.throws(() => parseRoleCard('---\nreasoningEffort: 42\n---\n', 'test.md'), /must be a non-empty string/);
  assert.throws(() => parseRoleCard(NO_FRONTMATTER_CARD), /no frontmatter/);
  assert.throws(() => parseRoleCard('---\nmodel: inherit\nprovider: p\n---\n'), /inherit cannot specify a provider/);
  assert.throws(() => parseRoleCard(null), TypeError);
  assert.throws(() => parseRoleCard('---\n- item\n---\n'), /YAML object/);
  assert.throws(() => parseRoleCard('---\nname: [unterminated\n---\n'), /not valid YAML/);
  assert.throws(() => parseRoleCard('---\nreasoning_effort: "   "\n---\n'), /must be a non-empty string/);
  const emptyMeta = parseRoleCard('---\n# comment only\n---\nbody\n');
  assert.equal(emptyMeta.disabled, false);
  assert.equal(emptyMeta.name, undefined);
});

await test('applyCardSettings: canonical reasoning_effort, reset cleanup, route-change cleanup, disabled, CRLF/BOM', () => {
  const withAlias = `---\nname: reviewer\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nreasoningEffort: medium\n# keep comment\ncustomKey: 42\n---\n\nBody text\n`;
  const canonicalized = applyCardSettings(withAlias, { reasoningEffort: 'high' });
  const meta1 = parseRouteText(canonicalized);
  assert.equal(meta1.reasoning_effort, 'high');
  assert.equal(meta1.reasoningEffort, undefined);
  assert.equal(meta1.customKey, 42);
  assert.match(canonicalized, /# keep comment/);

  const switchedRoute = applyCardSettings(canonicalized, { route: { provider: EXAMPLE_CLOUD, model: 'reasoner-b' } });
  const meta2 = parseRouteText(switchedRoute);
  assert.equal(meta2.provider, EXAMPLE_CLOUD);
  assert.equal(meta2.model, 'reasoner-b');
  assert.equal(meta2.reasoning_effort, undefined);

  const switchedFromAlias = applyCardSettings(withAlias, { route: { provider: EXAMPLE_CLOUD, model: 'reasoner-b' } });
  const metaAliasSwitched = parseRouteText(switchedFromAlias);
  assert.equal(metaAliasSwitched.reasoning_effort, undefined);
  assert.equal(metaAliasSwitched.reasoningEffort, undefined);

  const sameRouteToggled = applyCardSettings(canonicalized, { route: { provider: EXAMPLE_HUB, model: 'flash-a' }, disabled: true });
  const metaSame = parseRouteText(sameRouteToggled);
  assert.equal(metaSame.reasoning_effort, 'high');
  assert.equal(metaSame.disabled, true);

  const enabledAgain = applyCardSettings(sameRouteToggled, { disabled: false });
  assert.equal(parseRouteText(enabledAgain).disabled, undefined);

  const clearedEffort = applyCardSettings(canonicalized, { reasoningEffort: null });
  assert.equal(parseRouteText(clearedEffort).reasoning_effort, undefined);

  const reset = applyCardSettings(withAlias, { route: null, reasoningEffort: null });
  const metaReset = parseRouteText(reset);
  assert.equal(metaReset.provider, undefined);
  assert.equal(metaReset.model, 'inherit');
  assert.equal(metaReset.reasoning_effort, undefined);
  assert.equal(metaReset.reasoningEffort, undefined);

  assert.throws(() => applyCardSettings(LF_CARD, { reasoningEffort: 'high' }), /inherit/);
  assert.throws(() => applyCardSettings('---\nmodel: flash-a\n---\n', { reasoningEffort: 'high' }), /inherit or route is incomplete/);
  assert.throws(() => applyCardSettings(withAlias, { route: null, reasoningEffort: 'high' }), /resetting route to inherit/);
  assert.throws(() => applyCardSettings(LF_CARD, { route: { provider: 'p', model: 'inherit' } }), /inherit cannot specify a provider/);
  assert.throws(() => applyCardSettings(LF_CARD, null), /settings object/);
  assert.throws(() => applyCardSettings(LF_CARD, { disabled: 'true' }), /disabled must be a boolean/);
  assert.throws(() => applyCardSettings(LF_CARD, { reasoningEffort: '' }), /non-empty string/);

  const crlfOut = applyCardSettings(CRLF_CARD, { route: { provider: 'p', model: 'm' }, reasoningEffort: 'low', disabled: true });
  assert.ok(crlfOut.includes('\r\n'));
  assert.ok(crlfOut.endsWith('---\r\n\r\nBody line\r\n'));
  const bomOut = applyCardSettings(BOM_CARD, { disabled: true });
  assert.ok(!bomOut.startsWith('\uFEFF'));
  assert.equal(parseRouteText(bomOut).disabled, true);
});

await test('agentsRootOf: DSH_AGENTS_HOME wins, blank means unset, default is the home agents dir', () => {
  const sandboxHome = path.join(tmpdir(), 'agents-home-probe');
  assert.equal(path.resolve(agentsRootOf({ DSH_AGENTS_HOME: sandboxHome })), path.resolve(sandboxHome));
  assert.equal(agentsRootOf({ DSH_AGENTS_HOME: '' }), path.join(homedir(), '.agents'));
  assert.equal(agentsRootOf({}), agentsRootOf());
  assert.ok(agentsRootOf({}).endsWith('.agents'));
});

await test('HTTP API: GET .roles handles ENOENT, omits invalid cards, sorts alphabetically, returns reasoningEffort and mtimeMs', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-roles-'));
  try {
    await withMockHost({ agentsHome: tmpHome }, async ({ call }) => {
      const empty = await call(`/api/${NS}.roles`);
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.data.roles, []);
    });

    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'docs-scout.md'), '---\nname: docs-scout\ndescription: Docs\nmodel: inherit\ndisabled: true\n---\n\nBody\n', 'utf8');
    writeFileSync(path.join(dir, 'arch-advisor.md'), `---\nname: arch-advisor\ndescription: Advisory\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nreasoning_effort: high\n---\n\nBody\n`, 'utf8');
    writeFileSync(path.join(dir, 'broken-card.md'), `---\nname: broken\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nreasoning_effort: high\nreasoningEffort: low\n---\n\nBody\n`, 'utf8');

    await withMockHost({ agentsHome: tmpHome }, async ({ call }) => {
      const prevWarn = console.warn;
      const warns = [];
      console.warn = (...a) => warns.push(a.join(' '));
      try {
        const { status, data } = await call(`/api/${NS}.roles`);
        assert.equal(status, 200);
        assert.equal(data.ok, true);
        assert.deepEqual(data.roles.map((r) => r.id), ['arch-advisor', 'docs-scout']);
        assert.ok(warns.some((w) => w.includes('broken-card')), 'omitted conflicting card must log console.warn');
        const arch = data.roles[0];
        const docs = data.roles[1];
        assert.equal(arch.reasoningEffort, 'high');
        assert.equal(typeof arch.mtimeMs, 'number');
        assert.ok(arch.mtimeMs > 0);
        assert.equal(docs.reasoningEffort, null);
        assert.equal(docs.disabled, true);
      } finally {
        console.warn = prevWarn;
      }
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: GET .catalog handles partial provider timeouts, degraded flag, failedProviders, llm:undefined default, and throwing currentSelection', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-catalog-'));
  const prevAgentsHome = process.env.DSH_AGENTS_HOME;
  try {
    const llm = {
      listProviders: () => [{ id: EXAMPLE_HUB, name: 'Example Hub' }, { id: EXAMPLE_CLOUD, name: 'Example Cloud' }],
      listModels: async (providerId) => {
        if (providerId === EXAMPLE_CLOUD) return new Promise(() => {});
        return [{ id: 'flash-a', name: 'Flash A' }];
      }
    };
    const throwingDefault = { currentSelection: () => { throw new Error('broken selection'); } };
    const prevWarn = console.warn;
    console.warn = () => {};
    try {
      const ctxRoutes = new Map();
      process.env.DSH_AGENTS_HOME = tmpHome;
      await apply({
        get(service) {
          if (service === 'llm') return llm;
          if (service === 'agentDefaultModel') return throwingDefault;
          return undefined;
        },
        connection: { fetch: { register(spec) { ctxRoutes.set(spec.path, spec); } } }
      }, { catalogTimeoutMs: 30 });

      const catRes = await ctxRoutes.get(`/api/${NS}.catalog`).fetch(new Request(`http://localhost/api/${NS}.catalog`));
      const catJson = await catRes.json();
      assert.equal(catRes.status, 200);
      assert.equal(catJson.ok, true);
      assert.equal(catJson.available, true);
      assert.equal(catJson.degraded, true);
      assert.deepEqual(catJson.failedProviders, [EXAMPLE_CLOUD]);
      assert.equal(catJson.default, null);
      assert.deepEqual(catJson.groups.map((g) => g.provider), [EXAMPLE_HUB]);
    } finally {
      console.warn = prevWarn;
    }

    await withMockHost({ agentsHome: tmpHome, llm: undefined, defaultSelection: { provider: EXAMPLE_OPEN, model: 'base-c' } }, async ({ call }) => {
      const noLlmCat = await call(`/api/${NS}.catalog`);
      assert.equal(noLlmCat.status, 200);
      assert.equal(noLlmCat.data.available, false);
      assert.equal(noLlmCat.data.degraded, true);
      assert.deepEqual(noLlmCat.data.failedProviders, []);
      assert.deepEqual(noLlmCat.data.default, { provider: EXAMPLE_OPEN, model: 'base-c' });
      assert.deepEqual(noLlmCat.data.groups, []);
    });
  } finally {
    if (prevAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME;
    else process.env.DSH_AGENTS_HOME = prevAgentsHome;
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: GET .efforts validates params, handles 502/503/409/504 and returns efforts', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-efforts-'));
  const prevWarn = console.warn;
  console.warn = () => {};
  try {
    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      const missing = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}`);
      assert.equal(missing.status, 400);
      const missingProvider = await call(`/api/${NS}.efforts?model=flash-a`);
      assert.equal(missingProvider.status, 400);
      const noLlm = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=flash-a`);
      assert.equal(noLlm.status, 503);
    });

    await withMockHost({ agentsHome: tmpHome, llm: {} }, async ({ call }) => {
      const noResolver = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=flash-a`);
      assert.equal(noResolver.status, 503);
    });

    let capturedSignal;
    const llm = {
      listProviders: () => [{ id: EXAMPLE_HUB, name: 'Example Hub' }],
      listModels: async () => [{ id: 'flash-a', name: 'Flash A' }],
      resolveModelInfo: async (provider, model, signal) => {
        capturedSignal = signal;
        if (model === 'unknown') {
          const err = new Error('unknown model');
          err.code = 'UNKNOWN_MODEL';
          throw err;
        }
        if (model === 'server-down') {
          const err = new Error('upstream 502');
          err.code = 'SERVER';
          throw err;
        }
        if (model === 'plain-error') {
          throw new Error('transient network failure');
        }
        if (model === 'null-result') return null;
        if (model === 'bad-reasoning-shape') return { provider, id: model, name: model, reasoning: 'bad' };
        if (model === 'bad-efforts-shape') return { provider, id: model, name: model, reasoning: { efforts: 'high' } };
        if (model === 'bad-reasoning') {
          const err = new Error('invalid reasoning');
          err.code = 'INVALID_MODEL_REASONING';
          throw err;
        }
        if (model === 'hang') {
          return new Promise(() => {});
        }
        return {
          provider,
          id: model,
          name: 'Flash A',
          reasoning: {
            defaultEffort: 'medium',
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'medium', name: 'Medium', description: 'Balanced' },
              { id: 'high', name: 'High' },
              { id: '', name: 'Bad' }
            ]
          }
        };
      }
    };

    await withMockHost({ agentsHome: tmpHome, llm, config: { catalogTimeoutMs: 40 } }, async ({ call }) => {
      const okRes = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=flash-a`);
      assert.equal(okRes.status, 200);
      assert.equal(okRes.data.ok, true);
      assert.equal(okRes.data.defaultEffort, 'medium');
      assert.equal(okRes.data.efforts.length, 3);
      assert.equal(okRes.data.efforts[1].description, 'Balanced');

      const unknownRes = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=unknown`);
      assert.equal(unknownRes.status, 409);

      const serverDownRes = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=server-down`);
      assert.equal(serverDownRes.status, 503, 'operational SERVER error must return 503, not 409');

      const plainErrRes = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=plain-error`);
      assert.equal(plainErrRes.status, 503, 'unclassified runtime error must return 503, not 409');

      const nullRes = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=null-result`);
      assert.equal(nullRes.status, 502);

      const badShapeRes = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=bad-reasoning-shape`);
      assert.equal(badShapeRes.status, 502);

      const badEffortsRes = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=bad-efforts-shape`);
      assert.equal(badEffortsRes.status, 502);

      const badMetaRes = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=bad-reasoning`);
      assert.equal(badMetaRes.status, 502);

      const timeoutRes = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=hang`);
      assert.equal(timeoutRes.status, 504);
      assert.equal(capturedSignal?.aborted, true, 'AbortController must abort timed-out resolveModelInfo call');
    });
  } finally {
    console.warn = prevWarn;
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: POST .route decoupled disabled, validation, effort 400/409/503, expectedMtimeMs 409 and TOCTOU 409', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-post-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const cardFile = path.join(dir, 'planner.md');
    writeFileSync(cardFile, `---\nname: planner\ndescription: Plans\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nreasoningEffort: medium\n---\n\nPlan body\n`, 'utf8');
    const inheritFile = path.join(dir, 'implementer.md');
    writeFileSync(inheritFile, '---\nname: implementer\ndescription: Writes\nmodel: inherit\n---\n\nImpl body\n', 'utf8');

    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      const roles0 = await call(`/api/${NS}.roles`);
      const planner0 = roles0.data.roles.find((r) => r.id === 'planner');
      const toggleOff = await call(`/api/${NS}.route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'planner', disabled: true, expectedMtimeMs: planner0.mtimeMs })
      });
      assert.equal(toggleOff.status, 200);
      assert.equal(toggleOff.data.role.disabled, true);
      assert.equal(toggleOff.data.role.provider, EXAMPLE_HUB);
      assert.equal(toggleOff.data.role.model, 'flash-a');
      assert.equal(toggleOff.data.role.reasoningEffort, 'medium');

      const route503 = await call(`/api/${NS}.route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'planner', provider: EXAMPLE_HUB, model: 'flash-a' })
      });
      assert.equal(route503.status, 503);

      const effort503 = await call(`/api/${NS}.route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'planner', reasoningEffort: 'high' })
      });
      assert.equal(effort503.status, 503);

      const effortInherit400 = await call(`/api/${NS}.route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'implementer', reasoningEffort: 'high' })
      });
      assert.equal(effortInherit400.status, 400);
    });

    let toctouHook = null;
    const llm = {
      listProviders: () => [{ id: EXAMPLE_HUB, name: 'Example Hub' }],
      listModels: async () => [{ id: 'flash-a', name: 'Flash A' }, { id: 'flash-b', name: 'Flash B' }],
      resolveModelInfo: async (provider, model) => {
        if (toctouHook) await toctouHook();
        return {
          provider,
          id: model,
          name: model,
          reasoning: { defaultEffort: 'medium', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }
        };
      }
    };

    await withMockHost({ agentsHome: tmpHome, llm }, async ({ call }) => {
      assert.equal((await call(`/api/${NS}.route`, { method: 'POST', body: 'not-json' })).status, 400);
      assert.equal((await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner' }) })).status, 400);
      assert.equal((await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', provider: EXAMPLE_HUB }) })).status, 400);
      assert.equal((await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', disabled: 'yes' }) })).status, 400);
      assert.equal((await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', disabled: false, expectedMtimeMs: -1 }) })).status, 400);
      assert.equal((await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'missing-role', disabled: true }) })).status, 404);

      assert.equal((await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', reasoningEffort: 'ultra' }) })).status, 409);
      assert.equal((await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', provider: EXAMPLE_HUB, model: 'unlisted' }) })).status, 409);

      const currentMtime = statSync(cardFile).mtimeMs;
      const saved = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', provider: EXAMPLE_HUB, model: 'flash-b', disabled: false, reasoningEffort: 'high', expectedMtimeMs: currentMtime })
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.role.model, 'flash-b');
      assert.equal(saved.data.role.disabled, false);
      assert.equal(saved.data.role.reasoningEffort, 'high');
      const rawDisk = readFileSync(cardFile, 'utf8');
      assert.doesNotMatch(rawDisk, /reasoningEffort:/);
      assert.match(rawDisk, /reasoning_effort:\s*high/);

      const stale = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', disabled: true, expectedMtimeMs: currentMtime - 5000 })
      });
      assert.equal(stale.status, 409);

      const mtimeBeforeRace = statSync(cardFile).mtimeMs;
      const externalContent = `---\nname: planner\ndescription: External edit\nprovider: ${EXAMPLE_HUB}\nmodel: flash-b\nreasoning_effort: low\n---\n\nExternal body\n`;
      toctouHook = async () => {
        writeFileSync(cardFile, externalContent, 'utf8');
        const bumped = new Date(mtimeBeforeRace + 2000);
        utimesSync(cardFile, bumped, bumped);
      };
      const raceRes = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', reasoningEffort: 'high', expectedMtimeMs: mtimeBeforeRace })
      });
      toctouHook = null;
      assert.equal(raceRes.status, 409);
      assert.equal(readFileSync(cardFile, 'utf8'), externalContent, 'TOCTOU guard must preserve the concurrent external edit');

      const mtimeBeforeOmitted = statSync(cardFile).mtimeMs;
      toctouHook = async () => {
        const bumped = new Date(mtimeBeforeOmitted + 4000);
        utimesSync(cardFile, bumped, bumped);
      };
      const omittedRaceRes = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', reasoningEffort: 'high' })
      });
      toctouHook = null;
      assert.equal(omittedRaceRes.status, 409);

      const clearEffortRes = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', reasoningEffort: 'high' })
      });
      assert.equal(clearEffortRes.status, 200);
      assert.equal(clearEffortRes.data.role.reasoningEffort, 'high');

      const nulledEffortRes = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', reasoningEffort: null })
      });
      assert.equal(nulledEffortRes.status, 200);
      assert.equal(nulledEffortRes.data.role.reasoningEffort, null);

      await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', reasoningEffort: 'high' })
      });
      const switchedRouteRes = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', provider: EXAMPLE_HUB, model: 'flash-a' })
      });
      assert.equal(switchedRouteRes.status, 200);
      assert.equal(switchedRouteRes.data.role.reasoningEffort, null);

      const unknownProvRes = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', provider: 'no-such', model: 'flash-a' })
      });
      assert.equal(unknownProvRes.status, 409);

      const externalDir = mkdtempSync(path.join(tmpdir(), 'map-escape-'));
      try {
        writeFileSync(path.join(externalDir, 'secret.md'), '---\nname: secret\ndescription: Outside\nmodel: inherit\n---\n\nOutside\n', 'utf8');
        symlinkSync(externalDir, path.join(dir, 'linked'), 'junction');
        const escapeRes = await call(`/api/${NS}.route`, {
          method: 'POST',
          body: JSON.stringify({ id: 'linked/secret', disabled: true })
        });
        assert.equal(escapeRes.status, 400);
        assert.match(escapeRes.data.error, /symbolic link|escapes/);
      } finally {
        rmSync(externalDir, { recursive: true, force: true });
      }
    });

    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      const resetRes = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', provider: null, model: null })
      });
      assert.equal(resetRes.status, 200);
      assert.equal(resetRes.data.role.provider, null);
      assert.equal(resetRes.data.role.model, 'inherit');
      assert.equal(resetRes.data.role.reasoningEffort, null);

      writeFileSync(path.join(dir, 'conflict.md'), `---\nname: conflict\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nreasoning_effort: high\nreasoningEffort: low\n---\n\nBody\n`, 'utf8');
      const blockedToggle = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'conflict', disabled: true })
      });
      assert.equal(blockedToggle.status, 400);

      const badInheritPath = path.join(dir, 'bad-inherit.md');
      writeFileSync(badInheritPath, `---\nname: bad-inherit\nprovider: ${EXAMPLE_HUB}\nmodel: inherit\nreasoning_effort: high\n---\n\nBody\n`, 'utf8');
      const badInheritRes = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'bad-inherit', reasoningEffort: null })
      });
      assert.equal(badInheritRes.status, 400, 'invalid provider+inherit card must reject 400 before writing');
      assert.match(readFileSync(badInheritPath, 'utf8'), /reasoning_effort: high/, 'rejected write must leave disk untouched');

      const repaired = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'conflict', provider: null, model: null })
      });
      assert.equal(repaired.status, 200);
    });

    const prevWarn = console.warn;
    console.warn = () => {};
    try {
      const partialLlm = {
        listProviders: () => [{ id: EXAMPLE_HUB, name: 'OK' }, { id: EXAMPLE_CLOUD, name: 'Down' }, { id: EXAMPLE_OPEN, name: 'Hang' }],
        listModels: async (p) => {
          if (p === EXAMPLE_CLOUD) throw new Error('upstream down');
          if (p === EXAMPLE_OPEN) return new Promise(() => {});
          return [{ id: 'flash-a', name: 'Flash A' }];
        },
        resolveModelInfo: async (_p, m) => {
          if (m === 'hang') return new Promise(() => {});
          if (m === 'server-err') {
            const err = new Error('upstream 502');
            err.code = 'SERVER';
            throw err;
          }
          if (m === 'unknown') {
            const err = new Error('unknown');
            err.code = 'UNKNOWN_MODEL';
            throw err;
          }
          return { provider: EXAMPLE_HUB, id: m, name: m, reasoning: { efforts: [{ id: 'high', name: 'High' }] } };
        }
      };
      await withMockHost({ agentsHome: tmpHome, llm: partialLlm, config: { catalogTimeoutMs: 30 } }, async ({ call }) => {
        const failedProv = await call(`/api/${NS}.route`, {
          method: 'POST',
          body: JSON.stringify({ id: 'planner', provider: EXAMPLE_CLOUD, model: 'flash-a' })
        });
        assert.equal(failedProv.status, 503);

        const hungProv = await call(`/api/${NS}.route`, {
          method: 'POST',
          body: JSON.stringify({ id: 'planner', provider: EXAMPLE_OPEN, model: 'flash-a' })
        });
        assert.equal(hungProv.status, 503);

        await call(`/api/${NS}.route`, {
          method: 'POST',
          body: JSON.stringify({ id: 'planner', provider: EXAMPLE_HUB, model: 'flash-a' })
        });

        writeFileSync(cardFile, `---\nname: planner\ndescription: Plans\nprovider: ${EXAMPLE_HUB}\nmodel: hang\n---\n\nPlan body\n`, 'utf8');
        const effortTimeout = await call(`/api/${NS}.route`, {
          method: 'POST',
          body: JSON.stringify({ id: 'planner', reasoningEffort: 'high' })
        });
        assert.equal(effortTimeout.status, 503);

        writeFileSync(cardFile, `---\nname: planner\ndescription: Plans\nprovider: ${EXAMPLE_HUB}\nmodel: server-err\n---\n\nPlan body\n`, 'utf8');
        const effortServerErr = await call(`/api/${NS}.route`, {
          method: 'POST',
          body: JSON.stringify({ id: 'planner', reasoningEffort: 'high' })
        });
        assert.equal(effortServerErr.status, 503);

        writeFileSync(cardFile, `---\nname: planner\ndescription: Plans\nprovider: ${EXAMPLE_HUB}\nmodel: unknown\n---\n\nPlan body\n`, 'utf8');
        const effortUnknown = await call(`/api/${NS}.route`, {
          method: 'POST',
          body: JSON.stringify({ id: 'planner', reasoningEffort: 'high' })
        });
        assert.equal(effortUnknown.status, 409);
      });
    } finally {
      console.warn = prevWarn;
    }
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

const SYNTHETIC_KEY = ['sk-', 'testonly', '0123456789abcdef'].join('');
const SYNTHETIC_WIN_PATH = [WIN_HOME_TOKEN, String.fromCharCode(92), 'fixture-user', String.fromCharCode(92), '.agents', String.fromCharCode(92), 'agents', String.fromCharCode(92), 'planner.md'].join('');
const SYNTHETIC_POSIX_PATH = ['/home/', 'fixture-user', '/.agents/agents/planner.md'].join('');
const SYNTHETIC_CRED_URL = 'https://fixture-user:fixture-pass@example.invalid/v1';
const SYNTHETIC_AUTH_HEADER = 'Authorization: Bearer fixture0123456789abcdef';

const flashCatalogLlm = () => ({
  listProviders: () => [{ id: EXAMPLE_HUB, name: 'Example Hub' }],
  listModels: async () => [{ id: 'flash-a', name: 'Flash A' }, { id: 'flash-b', name: 'Flash B' }],
  resolveModelInfo: async (provider, model) => ({
    provider,
    id: model,
    name: model,
    reasoning: { defaultEffort: 'medium', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }
  })
});

await test('strict frontmatter: parseRoleCard strict mode rejects anchors, aliases, explicit tags, deep nesting and oversized blocks; lenient mode unchanged', () => {
  const anchorCard = '---\nname: anchored\nprovider: &p example-hub\nmodel: flash-a\n---\n\nBody\n';
  const aliasCard = '---\nname: aliased\nmodel: *p\n---\n\nBody\n';
  const tagCard = '---\nname: tagged\nmodel: !!str flash-a\n---\n\nBody\n';
  const deepCard = `---\nname: deep\ncustom: ${'['.repeat(25)}x${']'.repeat(25)}\n---\n\nBody\n`;
  const moderateCard = '---\nname: moderate\ncustom: {a: {b: 1}}\n---\n\nBody\n';
  const oversizedCard = `---\nkey: ${'v'.repeat(65537)}\n---\n\nBody\n`;

  assert.throws(() => parseRoleCard(anchorCard, 'anchored.md', { strict: true }), /anchored\.md: frontmatter anchors are not allowed/);
  assert.equal(parseRoleCard(anchorCard).provider, EXAMPLE_HUB);

  assert.throws(() => parseRoleCard(aliasCard, 'aliased.md', { strict: true }), /aliased\.md: frontmatter aliases are not allowed/);
  assert.throws(() => parseRoleCard(aliasCard), /alias/i);

  assert.throws(() => parseRoleCard(tagCard, 'tagged.md', { strict: true }), /tagged\.md: frontmatter custom tags are not allowed/);
  assert.equal(parseRoleCard(tagCard).model, 'flash-a');

  assert.throws(() => parseRoleCard(deepCard, 'deep.md', { strict: true }), /deep\.md: frontmatter nesting is too deep/);
  assert.equal(parseRoleCard(deepCard).name, 'deep');

  assert.equal(parseRoleCard(moderateCard, 'moderate.md', { strict: true }).name, 'moderate');

  assert.throws(() => parseRoleCard(oversizedCard, 'oversized.md', { strict: true }), /oversized\.md: frontmatter exceeds the 65536-byte limit/);
  assert.throws(() => parseRoleCard(oversizedCard, 'oversized.md'), /oversized\.md: frontmatter exceeds the 65536-byte limit/);

  assert.throws(() => applyCardSettings(anchorCard, { disabled: true }), /anchors are not allowed/);
});

await test('HTTP API: GET .roles surfaces parse-failed cards in invalid[] with redacted errors and keeps valid roles sorted', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-invalid-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'zeta-valid.md'), '---\nname: zeta-valid\ndescription: Z\nmodel: inherit\n---\n\nBody\n', 'utf8');
    writeFileSync(path.join(dir, 'alpha-valid.md'), `---\nname: alpha-valid\ndescription: A\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\n---\n\nBody\n`, 'utf8');
    writeFileSync(path.join(dir, 'broken-card.md'), '---\nname: [unterminated\n---\n\nBody\n', 'utf8');
    writeFileSync(path.join(dir, 'aliased-card.md'), '---\nname: aliased-card\nmodel: *p\n---\n\nBody\n', 'utf8');

    await withMockHost({ agentsHome: tmpHome }, async ({ call }) => {
      const prevWarn = console.warn;
      const warns = [];
      console.warn = (...a) => warns.push(a.join(' '));
      try {
        const { status, data } = await call(`/api/${NS}.roles`);
        assert.equal(status, 200);
        assert.equal(data.ok, true);
        assert.deepEqual(data.roles.map((r) => r.id), ['alpha-valid', 'zeta-valid']);
        assert.ok(Array.isArray(data.invalid), 'GET .roles must always carry an invalid array');
        assert.deepEqual(data.invalid.map((entry) => entry.id), ['aliased-card', 'broken-card']);
        for (const entry of data.invalid) {
          assert.equal(typeof entry.error, 'string');
          assert.ok(entry.error.length > 0, `invalid entry ${entry.id} must carry a non-empty error`);
        }
        assert.ok(warns.some((w) => w.includes('broken-card')), 'the broken-YAML card must still log console.warn');
        assert.ok(warns.some((w) => w.includes('aliased-card')), 'the aliased card must still log console.warn');
        const mod = await import('../index.js');
        assert.equal(typeof mod.redactText, 'function');
        for (const entry of data.invalid) {
          assert.equal(mod.redactText(entry.error), entry.error, `invalid error for ${entry.id} must already be redacted (idempotent)`);
        }
      } finally {
        console.warn = prevWarn;
      }
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: POST .route refuses anchored, aliased, tagged, deep or oversized frontmatter with 400 before any write', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-strict-post-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const fixtures = [
      { id: 'anchored', text: '---\nname: anchored\nprovider: &p example-hub\nmodel: flash-a\n---\n\nBody\n', message: /anchored\.md: frontmatter anchors are not allowed/ },
      { id: 'aliased', text: '---\nname: aliased\nmodel: *p\n---\n\nBody\n', message: /aliased\.md: frontmatter aliases are not allowed/ },
      { id: 'tagged', text: '---\nname: tagged\nmodel: !!str flash-a\n---\n\nBody\n', message: /tagged\.md: frontmatter custom tags are not allowed/ },
      { id: 'deep', text: `---\nname: deep\ncustom: ${'['.repeat(25)}x${']'.repeat(25)}\n---\n\nBody\n`, message: /deep\.md: frontmatter nesting is too deep/ },
      { id: 'oversized', text: `---\nkey: ${'v'.repeat(65537)}\n---\n\nBody\n`, message: /oversized\.md: frontmatter exceeds the 65536-byte limit/ }
    ];
    for (const fixture of fixtures) {
      writeFileSync(path.join(dir, `${fixture.id}.md`), fixture.text, 'utf8');
    }
    writeFileSync(path.join(dir, 'clean.md'), '---\nname: clean\ndescription: Clean\nmodel: inherit\n# keep this comment\ncustom:\n  nested: value\n---\n\nBody\n', 'utf8');

    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      for (const fixture of fixtures) {
        const file = path.join(dir, `${fixture.id}.md`);
        const before = readFileSync(file, 'utf8');
        const res = await call(`/api/${NS}.route`, {
          method: 'POST',
          body: JSON.stringify({ id: fixture.id, disabled: true })
        });
        assert.equal(res.status, 400, `${fixture.id} must be refused with 400`);
        assert.match(res.data.error, fixture.message);
        assert.equal(readFileSync(file, 'utf8'), before, `${fixture.id} must be byte-identical after the refused write`);
      }

      const cleanRes = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'clean', disabled: true })
      });
      assert.equal(cleanRes.status, 200);
      const cleanNext = readFileSync(path.join(dir, 'clean.md'), 'utf8');
      assert.match(cleanNext, /# keep this comment/);
      assert.match(cleanNext, /nested: value/);
      assert.match(cleanNext, /disabled: true/);

      const prevWarn = console.warn;
      console.warn = () => {};
      try {
        const listed = await call(`/api/${NS}.roles`);
        assert.equal(listed.status, 200);
        const listedIds = listed.data.roles.map((r) => r.id);
        for (const id of ['anchored', 'tagged', 'deep', 'clean']) {
          assert.ok(listedIds.includes(id), `${id} must stay listable in the lenient GET`);
        }
        assert.deepEqual(listed.data.invalid.map((entry) => entry.id), ['aliased', 'oversized']);
      } finally {
        console.warn = prevWarn;
      }
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('redactText: credential URLs, authorization headers, key assignments, key shapes and home paths become markers; codes and plain URLs survive', async () => {
  const mod = await import('../index.js');
  const redactText = mod.redactText;
  assert.equal(typeof redactText, 'function', 'index.js must export redactText');

  const winOut = redactText(SYNTHETIC_WIN_PATH);
  assert.ok(winOut.startsWith('[home]'), 'the Windows home prefix must become the [home] marker');
  assert.ok(winOut.includes('planner.md'), 'the path tail must survive redaction');
  assert.ok(!winOut.includes('fixture-user'), 'the username must not survive redaction');
  assert.ok(!winOut.toLowerCase().includes(WIN_HOME_TOKEN), 'no Windows home token may survive');
  assert.ok(!winOut.toLowerCase().includes(POSIX_HOME_TOKEN), 'no POSIX home token may survive');

  assert.equal(redactText(SYNTHETIC_POSIX_PATH), '[home]/.agents/agents/planner.md');
  assert.equal(redactText(SYNTHETIC_CRED_URL), 'https://[redacted]@example.invalid/v1');
  assert.equal(redactText(redactText(SYNTHETIC_CRED_URL)), redactText(SYNTHETIC_CRED_URL), 'redaction must be idempotent');
  assert.equal(redactText(SYNTHETIC_AUTH_HEADER), 'Authorization: [redacted]');
  assert.equal(redactText('api_key=fixturevalue123'), 'api_key=[redacted]');
  assert.equal(redactText(SYNTHETIC_KEY), '[redacted]');

  const fsError = redactText(`EACCES: permission denied, open ${SYNTHETIC_WIN_PATH}`);
  assert.ok(fsError.startsWith('EACCES'), 'error codes must survive redaction');
  assert.ok(fsError.includes('[home]'), 'the home prefix in fs errors must become the marker');

  assert.equal(redactText('https://example.invalid/home/guide'), 'https://example.invalid/home/guide', 'URL interiors must not be treated as home paths');
  const realHomePath = redactText(path.join(homedir(), 'agents', 'x.md'));
  assert.ok(!realHomePath.includes(homedir()), 'the real home directory must never survive redaction');
  assert.equal(redactText('provider: example-hub\nmodel: flash-a'), 'provider: example-hub\nmodel: flash-a', 'plain card frontmatter must pass through unchanged');
});

await test('HTTP API: catalog failures and unreadable-directory errors redact secrets and home paths in bodies and logs', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-redact-'));
  const prevWarn = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const throwingCatalogLlm = {
      listProviders: () => { throw new Error(`upstream failed: ${SYNTHETIC_AUTH_HEADER} at ${SYNTHETIC_WIN_PATH}`); },
      listModels: async () => []
    };
    await withMockHost({ agentsHome: tmpHome, llm: throwingCatalogLlm }, async ({ call }) => {
      const cat = await call(`/api/${NS}.catalog`);
      assert.equal(cat.status, 200);
      assert.equal(cat.data.degraded, true);
    });
    const catalogWarn = warns.join('\n');
    assert.ok(catalogWarn.includes('[redacted]'), 'catalog failure logs must redact secrets');
    assert.ok(catalogWarn.includes('[home]'), 'catalog failure logs must redact home paths');
    assert.ok(!catalogWarn.includes('fixture-user'), 'no fixture username may survive in logs');
    assert.ok(!catalogWarn.includes('fixture0123456789abcdef'), 'no fixture bearer token may survive in logs');
    for (const token of [WIN_HOME_TOKEN, POSIX_HOME_TOKEN]) {
      assert.ok(!catalogWarn.toLowerCase().includes(token), 'no home token may survive in logs');
    }

    warns.length = 0;
    const throwingEffortLlm = {
      resolveModelInfo: async () => { throw new Error(`lookup failed ${SYNTHETIC_CRED_URL}`); }
    };
    await withMockHost({ agentsHome: tmpHome, llm: throwingEffortLlm }, async ({ call }) => {
      const eff = await call(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=flash-a`);
      assert.equal(eff.status, 503);
      assert.ok(eff.data.error.includes('[redacted]'), 'effort error bodies must redact credential URLs');
      assert.ok(!eff.data.error.includes('fixture-pass'), 'no fixture password may survive in the body');
    });

    warns.length = 0;
    const fileHome = mkdtempSync(path.join(tmpdir(), 'map-http-redact-file-'));
    try {
      writeFileSync(path.join(fileHome, 'agents'), 'not a directory\n', 'utf8');
      await withMockHost({ agentsHome: fileHome }, async ({ call }) => {
        const roles = await call(`/api/${NS}.roles`);
        assert.equal(roles.status, 500);
        assert.ok(roles.data.error.includes('unreadable'), 'the unreadable-directory error must keep its context');
        for (const token of [WIN_HOME_TOKEN, POSIX_HOME_TOKEN]) {
          assert.ok(!roles.data.error.toLowerCase().includes(token), 'no home token may survive in the error body');
        }
        if (process.platform === 'win32') {
          assert.ok(roles.data.error.includes('[home]'), 'real fs errors must carry the [home] marker on win32');
        }
      });
      const dirWarn = warns.join('\n');
      assert.ok(dirWarn.includes('unreadable'), 'the unreadable-directory warn must keep its context');
      for (const token of [WIN_HOME_TOKEN, POSIX_HOME_TOKEN]) {
        assert.ok(!dirWarn.toLowerCase().includes(token), 'no home token may survive in the warn');
      }
      if (process.platform === 'win32') {
        assert.ok(dirWarn.includes('[home]'), 'real fs warns must carry the [home] marker on win32');
      }
    } finally {
      rmSync(fileHome, { recursive: true, force: true });
    }
  } finally {
    console.warn = prevWarn;
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: POST .route enforces the 65536-byte body cap and rejects unknown fields', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-limits-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const cardFile = path.join(dir, 'planner.md');
    const cardText = '---\nname: planner\ndescription: Plans\nmodel: inherit\n---\n\nPlan body\n';
    writeFileSync(cardFile, cardText, 'utf8');

    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      const unknown = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', disabled: true, surprise: 'x' })
      });
      assert.equal(unknown.status, 400);
      assert.match(unknown.data.error, /unknown field/);
      assert.equal(readFileSync(cardFile, 'utf8'), cardText, 'an unknown-field refusal must not touch the disk');

      const padded = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', disabled: true, padding: 'x'.repeat(70000) })
      });
      assert.equal(padded.status, 413);
      assert.match(padded.data.error, /exceeds the 65536-byte limit/);
      assert.equal(readFileSync(cardFile, 'utf8'), cardText, 'an oversized body must be refused before any write');

      const keyField = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', disabled: true, [SYNTHETIC_KEY]: 'x' })
      });
      assert.equal(keyField.status, 400);
      assert.ok(keyField.data.error.includes('[redacted]'), 'unknown field names must be redacted');
      assert.ok(!keyField.data.error.includes(SYNTHETIC_KEY), 'the raw key shape must not be echoed');
      assert.equal(readFileSync(cardFile, 'utf8'), cardText);
    });

    const longProvider = 'p'.repeat(32000);
    const longModel = 'm'.repeat(32000);
    const bigBody = JSON.stringify({ id: 'planner', provider: longProvider, model: longModel });
    const bigBytes = Buffer.byteLength(bigBody, 'utf8');
    assert.ok(bigBytes > 60000 && bigBytes < 65536, 'the under-cap body must sit just below the limit');
    const bigLlm = {
      listProviders: () => [{ id: longProvider, name: 'Long Provider' }],
      listModels: async () => [{ id: longModel, name: 'Long Model' }]
    };
    await withMockHost({ agentsHome: tmpHome, llm: bigLlm }, async ({ call }) => {
      const saved = await call(`/api/${NS}.route`, { method: 'POST', body: bigBody });
      assert.equal(saved.status, 200, 'a known-fields-only body under the cap must save normally');
      assert.equal(saved.data.role.provider, longProvider);
      assert.equal(saved.data.role.model, longModel);
    });

    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ routes }) => {
      const before = readFileSync(cardFile, 'utf8');
      const res = await routes.get(`/api/${NS}.route`).fetch(new Request(`http://localhost/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', disabled: true }),
        headers: { 'content-type': 'application/json', 'content-length': '70000' }
      }));
      const data = await res.json();
      assert.equal(res.status, 413, 'an oversized content-length must be refused before the body is read');
      assert.match(data.error, /exceeds the 65536-byte limit/);
      assert.equal(readFileSync(cardFile, 'utf8'), before, 'the pre-check refusal must not touch the disk');
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: POST .route identical payload answers unchanged:true without a write; stale expectedMtimeMs still 409 first', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-noop-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const cardFile = path.join(dir, 'planner.md');
    const cardText = `---\nname: planner\ndescription: Plans\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nreasoning_effort: high\n---\n\nPlan body\n`;
    writeFileSync(cardFile, cardText, 'utf8');

    await withMockHost({ agentsHome: tmpHome, llm: flashCatalogLlm() }, async ({ call }) => {
      const roles0 = await call(`/api/${NS}.roles`);
      const planner0 = roles0.data.roles.find((r) => r.id === 'planner');
      const identicalPayload = { id: 'planner', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: 'high', expectedMtimeMs: planner0.mtimeMs };

      const unchanged = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify(identicalPayload) });
      assert.equal(unchanged.status, 200);
      assert.equal(unchanged.data.unchanged, true, 'an identical payload must answer unchanged:true');
      assert.deepEqual(unchanged.data.role, planner0, 'the unchanged response must carry the GET summary at read-time mtime');
      assert.equal(readFileSync(cardFile, 'utf8'), cardText, 'an unchanged save must not rewrite the card bytes');
      assert.equal(statSync(cardFile).mtimeMs, planner0.mtimeMs, 'an unchanged save must not bump the mtime');

      const stale = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ ...identicalPayload, expectedMtimeMs: planner0.mtimeMs - 5000 }) });
      assert.equal(stale.status, 409, 'the stale-mtime check must fire before the no-op branch');

      const changed = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', provider: EXAMPLE_HUB, model: 'flash-b', expectedMtimeMs: planner0.mtimeMs }) });
      assert.equal(changed.status, 200);
      assert.equal(changed.data.unchanged, undefined, 'a real write must not carry unchanged');
      assert.equal(changed.data.role.model, 'flash-b');
      assert.equal(changed.data.role.reasoningEffort, null, 'a route change clears the effort');

      const roles1 = await call(`/api/${NS}.roles`);
      const planner1 = roles1.data.roles.find((r) => r.id === 'planner');
      const disable = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', disabled: true, expectedMtimeMs: planner1.mtimeMs }) });
      assert.equal(disable.status, 200);
      assert.equal(disable.data.unchanged, undefined);

      const roles2 = await call(`/api/${NS}.roles`);
      const planner2 = roles2.data.roles.find((r) => r.id === 'planner');
      const disabledNoop = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', disabled: true, expectedMtimeMs: planner2.mtimeMs }) });
      assert.equal(disabledNoop.status, 200);
      assert.equal(disabledNoop.data.unchanged, true, 'a disabled-only no-op must answer unchanged:true');
      assert.equal(statSync(cardFile).mtimeMs, planner2.mtimeMs);
    });

    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      const mtime = statSync(cardFile).mtimeMs;
      const res = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', provider: EXAMPLE_HUB, model: 'flash-b', disabled: true, expectedMtimeMs: mtime }) });
      assert.equal(res.status, 503, 'a no-op must NOT bypass fail-closed catalog validation');
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: simultaneous POST .route on one role serializes to one 200 and one 409 with card integrity', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-race-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const cardFile = path.join(dir, 'planner.md');
    writeFileSync(cardFile, `---\nname: planner\ndescription: Plans\nprovider: ${EXAMPLE_HUB}\nmodel: flash-start\n---\n\nPlan body\n`, 'utf8');
    const past = new Date(Date.now() - 60000);
    utimesSync(cardFile, past, past);

    await withMockHost({ agentsHome: tmpHome, llm: flashCatalogLlm() }, async ({ call }) => {
      const roles0 = await call(`/api/${NS}.roles`);
      const planner0 = roles0.data.roles.find((r) => r.id === 'planner');
      const [resA, resB] = await Promise.all([
        call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', provider: EXAMPLE_HUB, model: 'flash-a', expectedMtimeMs: planner0.mtimeMs }) }),
        call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', provider: EXAMPLE_HUB, model: 'flash-b', expectedMtimeMs: planner0.mtimeMs }) })
      ]);
      assert.deepEqual([resA.status, resB.status].sort(), [200, 409], 'exactly one writer must win the lock');
      const loser = resA.status === 409 ? resA : resB;
      const winner = resA.status === 200 ? resA : resB;
      assert.match(loser.data.error, /changed on disk/);
      const diskMeta = parseRouteText(readFileSync(cardFile, 'utf8'));
      assert.equal(diskMeta.model, winner.data.role.model, 'the disk must hold the winner\'s model');
      const roles1 = await call(`/api/${NS}.roles`);
      const planner1 = roles1.data.roles.find((r) => r.id === 'planner');
      assert.equal(planner1.model, winner.data.role.model, 'GET must reflect the winner');
      assert.equal(planner1.mtimeMs, winner.data.role.mtimeMs);
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: a held writer lock yields 503 lock-timeout with a relative lock name and is never auto-recovered', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-lock-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const cardFile = path.join(dir, 'planner.md');
    writeFileSync(cardFile, '---\nname: planner\ndescription: Plans\nmodel: inherit\n---\n\nPlan body\n', 'utf8');
    const lockFile = `${cardFile}.lock`;
    writeFileSync(lockFile, '0\n', 'utf8');

    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      const prevWarn = console.warn;
      const warns = [];
      console.warn = (...a) => warns.push(a.join(' '));
      let busy;
      try {
        busy = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', disabled: true }) });
      } finally {
        console.warn = prevWarn;
      }
      assert.equal(busy.status, 503, 'a held writer lock must answer 503, not a generic 500');
      assert.equal(busy.data.code, 'lock-timeout');
      assert.ok(busy.data.error.includes('agents/planner.md.lock'), 'the error must name the relative lock file');
      assert.ok(busy.data.error.includes('operator'), 'the error must carry operator recovery guidance');
      assert.ok(!busy.data.error.includes(tmpHome), 'the error must never carry the absolute tmp path');
      assert.ok(existsSync(lockFile), 'the plugin must never auto-remove a lock it did not create');
      const lockWarn = warns.join('\n');
      for (const token of [WIN_HOME_TOKEN, POSIX_HOME_TOKEN]) {
        assert.ok(!lockWarn.toLowerCase().includes(token), 'the lock-timeout warn must not leak home tokens');
      }

      rmSync(lockFile);
      const retry = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', disabled: true }) });
      assert.equal(retry.status, 200, 'after the operator removes the lock the save must succeed');
      assert.equal(retry.data.role.disabled, true);
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: Server-Timing on roles/catalog/route success carries durations only', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-timing-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const cardFile = path.join(dir, 'planner.md');
    writeFileSync(cardFile, `---\nname: planner\ndescription: Plans\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\n---\n\nPlan body\n`, 'utf8');

    await withMockHost({ agentsHome: tmpHome, llm: flashCatalogLlm() }, async ({ routes }) => {
      const rawGet = (routePath) => {
        const url = new URL(routePath, 'http://localhost');
        return routes.get(url.pathname).fetch(new Request(url.toString()));
      };
      const rawPost = (payload) => routes.get(`/api/${NS}.route`).fetch(new Request(`http://localhost/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' }
      }));
      const assertDurationsOnly = (header) => {
        assert.equal(typeof header, 'string', 'a success response must carry server-timing');
        assert.match(header, /^[A-Za-z0-9_-]+;dur=\d+(\.\d+)?(?:, [A-Za-z0-9_-]+;dur=\d+(\.\d+)?)*$/, 'server-timing must carry metrics and durations only');
        const metrics = [...header.matchAll(/([A-Za-z0-9_-]+);dur=([0-9]+(?:\.[0-9]+)?)/g)];
        assert.ok(metrics.length > 0, 'server-timing must carry at least one metric');
        for (const metric of metrics) {
          const value = Number(metric[2]);
          assert.ok(Number.isFinite(value) && value >= 0, 'every duration must be finite and >= 0');
        }
        assert.ok(!header.includes(tmpHome), 'server-timing must never carry paths');
        assert.ok(!header.includes('planner'), 'server-timing must never carry role ids');
      };

      const rolesRes = await rawGet(`/api/${NS}.roles`);
      assert.equal(rolesRes.status, 200);
      const rolesTiming = rolesRes.headers.get('server-timing');
      assert.ok(typeof rolesTiming === 'string' && /^reads;dur=\d+(\.\d+)?$/.test(rolesTiming), 'GET .roles must carry exactly reads;dur=<ms>');
      assertDurationsOnly(rolesTiming);

      const catalogRes = await rawGet(`/api/${NS}.catalog`);
      assert.equal(catalogRes.status, 200);
      const catalogTiming = catalogRes.headers.get('server-timing');
      assert.ok(typeof catalogTiming === 'string' && /^catalog;dur=\d+(\.\d+)?$/.test(catalogTiming), 'GET .catalog must carry exactly catalog;dur=<ms>');
      assertDurationsOnly(catalogTiming);

      const mtime0 = statSync(cardFile).mtimeMs;
      const writeRes = await rawPost({ id: 'planner', provider: EXAMPLE_HUB, model: 'flash-b', expectedMtimeMs: mtime0 });
      assert.equal(writeRes.status, 200);
      const writeTiming = writeRes.headers.get('server-timing');
      assert.ok(typeof writeTiming === 'string' && writeTiming.includes('catalog;dur=') && writeTiming.includes('write;dur='), 'a route-changing success must carry catalog and write metrics');
      assertDurationsOnly(writeTiming);

      const staleRes = await rawPost({ id: 'planner', disabled: true, expectedMtimeMs: mtime0 - 5000 });
      assert.equal(staleRes.status, 409);
      assert.equal(staleRes.headers.get('server-timing'), null, 'error responses must carry no timing header');

      const mtime1 = statSync(cardFile).mtimeMs;
      const unchangedRes = await rawPost({ id: 'planner', provider: EXAMPLE_HUB, model: 'flash-b', expectedMtimeMs: mtime1 });
      assert.equal(unchangedRes.status, 200);
      const unchangedData = await unchangedRes.json();
      assert.equal(unchangedData.unchanged, true);
      const unchangedTiming = unchangedRes.headers.get('server-timing');
      assert.ok(typeof unchangedTiming === 'string' && unchangedTiming.includes('catalog;dur='), 'the unchanged response keeps the catalog metric when validation ran');
      assert.ok(!unchangedTiming.includes('write;dur='), 'the unchanged response must never carry a write metric');
      assertDurationsOnly(unchangedTiming);

      const effortsRes = await rawGet(`/api/${NS}.efforts?provider=${EXAMPLE_HUB}&model=flash-b`);
      assert.equal(effortsRes.status, 200);
      assert.equal(effortsRes.headers.get('server-timing'), null, 'GET .efforts must carry no timing header');
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: GET .roles with 40 cards returns every card sorted (bounded parallel reads)', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-forty-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const expectedIds = Array.from({ length: 40 }, (_, i) => `role-${String(i).padStart(2, '0')}`);
    for (const id of expectedIds) {
      writeFileSync(path.join(dir, `${id}.md`), `---\nname: ${id}\nmodel: inherit\n---\n\nBody\n`, 'utf8');
    }
    await withMockHost({ agentsHome: tmpHome }, async ({ call }) => {
      const { status, data } = await call(`/api/${NS}.roles`);
      assert.equal(status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.roles.length, 40);
      assert.deepEqual(data.roles.map((r) => r.id), expectedIds, 'every card must appear exactly once, sorted by id');
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('no-op save detects an external edit during the validation window', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-noop-toctou-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const cardFile = path.join(dir, 'planner.md');
    const cardText = `---\nname: planner\ndescription: Plans\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nreasoning_effort: high\n---\n\nPlan body\n`;
    writeFileSync(cardFile, cardText, 'utf8');

    let toctouHook = null;
    const baseLlm = flashCatalogLlm();
    const llm = {
      ...baseLlm,
      resolveModelInfo: async (provider, model) => {
        if (toctouHook) await toctouHook();
        return baseLlm.resolveModelInfo(provider, model);
      }
    };

    await withMockHost({ agentsHome: tmpHome, llm }, async ({ call }) => {
      const roles0 = await call(`/api/${NS}.roles`);
      const readMtime = roles0.data.roles.find((r) => r.id === 'planner').mtimeMs;
      const externalContent = `---\nname: planner\ndescription: External edit\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nreasoning_effort: low\n---\n\nPlan body\n`;
      toctouHook = async () => {
        writeFileSync(cardFile, externalContent, 'utf8');
        const bumped = new Date(readMtime + 2000);
        utimesSync(cardFile, bumped, bumped);
      };
      const res = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'planner', reasoningEffort: 'high', expectedMtimeMs: readMtime })
      });
      toctouHook = null;
      assert.equal(res.status, 409, 'an external edit during the validation window must conflict even when the rendered save is a no-op');
      assert.match(res.data.error, /changed on disk/);
      assert.equal(readFileSync(cardFile, 'utf8'), externalContent, 'the external edit must be preserved, never overwritten');
      assert.ok(!existsSync(`${cardFile}.lock`), 'the conflicted no-op must not acquire or orphan a lock');
      assert.notEqual(res.data.unchanged, true, 'a conflicted no-op must not answer unchanged:true');
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('redaction: adversarial secret shapes are fully redacted and linear', async () => {
  const mod = await import('../index.js');
  const redactText = mod.redactText;
  assert.equal(typeof redactText, 'function', 'index.js must export redactText');

  const hex32 = '0123456789abcdef'.repeat(2);
  for (const key of ['api_key', 'token', 'password']) {
    const jsonShape = `{"${key}":"${hex32}"}`;
    const out = redactText(jsonShape);
    assert.ok(out.includes('[redacted]'), `the JSON ${key} value must be redacted`);
    assert.ok(!out.includes(hex32), `the JSON ${key} value must not survive redaction`);
    assert.equal(redactText(out), out, `JSON ${key} redaction must be idempotent`);
  }

  const atUrl = 'https://svcuser:Sup3r@Secret@api.example.invalid/v1';
  assert.equal(redactText(atUrl), 'https://[redacted]@api.example.invalid/v1', 'a password containing @ must be consumed whole, with no tail');
  assert.equal(redactText(redactText(atUrl)), redactText(atUrl), 'the @-password redaction must be idempotent');

  const quoted = 'password="correct horse battery staple"';
  assert.equal(redactText(quoted), 'password="[redacted]"', 'a double-quoted multi-word secret must leave no trailing words');
  const singleQuoted = "password='correct horse battery staple'";
  assert.equal(redactText(singleQuoted), "password='[redacted]'", 'a single-quoted multi-word secret must leave no trailing words');
  assert.equal(redactText(redactText(quoted)), redactText(quoted), 'the quoted redaction must be idempotent');
  assert.equal(redactText(redactText(singleQuoted)), redactText(singleQuoted), 'the single-quoted redaction must be idempotent');

  const googleKey = ['AI', 'za', 'FixtureKey0123456789abcdef'].join('');
  const keyUrl = `https://api.example.invalid/v1/models?key=${googleKey}`;
  const keyOut = redactText(keyUrl);
  assert.equal(keyOut, 'https://api.example.invalid/v1/models?key=[redacted]', 'the AIza key must become the marker with host and path intact');
  assert.ok(!keyOut.includes(googleKey), 'the raw AIza key must not survive');
  assert.equal(redactText(keyOut), keyOut, 'the AIza redaction must be idempotent');

  const colonRun = 'a://' + ':'.repeat(60000);
  const colonOut = redactText(colonRun);
  assert.equal(typeof colonOut, 'string', 'the colon-run input must return a string');
  assert.equal(redactText(colonOut), colonOut, 'the colon-run output must be idempotent');

  const dotRun = 'a.'.repeat(30000);
  const dotOut = redactText(dotRun);
  assert.equal(typeof dotOut, 'string', 'the dot-run input must return a string');
  assert.equal(redactText(dotOut), dotOut, 'the dot-run output must be idempotent');

  const escapedDouble = '{"api_key":"abc\\"def"}';
  assert.equal(redactText(escapedDouble), '{"api_key":"[redacted]"}', 'an escaped quote inside a double-quoted secret must not leak the tail');
  const escapedSingle = "password='abc\\'def'";
  assert.equal(redactText(escapedSingle), "password='[redacted]'", 'an escaped quote inside a single-quoted secret must not leak the tail');
  assert.equal(redactText(redactText(escapedDouble)), redactText(escapedDouble), 'the escaped-quote redaction must be idempotent');

  assert.equal(redactText('git+ssh://u:p@example.invalid/x'), 'git+ssh://[redacted]@example.invalid/x', 'a compound scheme must still redact its userinfo');

  const basicB64 = 'dXNlcjpwYXNzMTIzNDU2';
  const jsonAuth = `{"Authorization": "Basic ${basicB64}"}`;
  const jsonAuthOut = redactText(jsonAuth);
  assert.equal(jsonAuthOut, '{"Authorization": "[redacted]"}', 'a JSON-quoted Basic authorization header must redact whole');
  assert.ok(!jsonAuthOut.includes(basicB64), 'the Basic credential must not survive');
  const jsonBearer = '{"Authorization": "Bearer fixture0123456789abcdef"}';
  assert.equal(redactText(jsonBearer), '{"Authorization": "[redacted]"}', 'a JSON-quoted Bearer authorization header must redact whole');
  const quotedAuth = 'Authorization: "Bearer abc def ghi"';
  assert.equal(redactText(quotedAuth), 'Authorization: "[redacted]"', 'a quoted multi-word authorization value must leave no trailing words');
  const multiAuth = 'Authorization: Bearer abc def';
  assert.equal(redactText(multiAuth), 'Authorization: [redacted]', 'an unquoted multi-word authorization value must leave no tail');
  assert.equal(redactText(redactText(jsonAuth)), redactText(jsonAuth), 'authorization redaction must be idempotent (JSON form)');
  assert.equal(redactText(redactText(quotedAuth)), redactText(quotedAuth), 'authorization redaction must be idempotent (quoted form)');
  assert.equal(redactText(redactText(multiAuth)), redactText(multiAuth), 'authorization redaction must be idempotent (unquoted form)');
  const proseAuth = redactText(`upstream failed: Authorization: Bearer fixture0123456789abcdef at ${SYNTHETIC_WIN_PATH}`);
  assert.ok(proseAuth.includes('[redacted]'), 'the token in error prose must redact');
  assert.ok(proseAuth.includes('[home]'), 'the path clause in error prose must survive to the home marker');
  assert.ok(proseAuth.includes('planner.md'), 'the path tail must survive');
  assert.ok(!proseAuth.includes('fixture0123456789abcdef'), 'the token must not survive prose redaction');

  assert.equal(redactText(SYNTHETIC_CRED_URL), 'https://[redacted]@example.invalid/v1');
  assert.equal(redactText('api_key=fixturevalue123'), 'api_key=[redacted]');
  assert.equal(redactText(SYNTHETIC_AUTH_HEADER), 'Authorization: [redacted]');
  assert.equal(redactText('Bearer fixture0123456789abcdef'), 'Bearer [redacted]');
  assert.equal(redactText(SYNTHETIC_KEY), '[redacted]');
  const winOut = redactText(SYNTHETIC_WIN_PATH);
  assert.ok(winOut.startsWith('[home]'), 'the Windows home prefix must still become the marker');
  assert.ok(winOut.includes('planner.md'), 'the path tail must still survive');
  assert.ok(!winOut.includes('fixture-user'), 'the fixture username must still be redacted');
  assert.equal(redactText(SYNTHETIC_POSIX_PATH), '[home]/.agents/agents/planner.md');
  assert.equal(redactText('https://host/home/guide'), 'https://host/home/guide', 'plain URL interiors must stay unchanged');
});

await test('request and frontmatter caps enforce UTF-8 bytes at the exact boundary', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-byte-caps-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const cardFile = path.join(dir, 'planner.md');
    const cardText = '---\nname: planner\ndescription: Plans\nmodel: inherit\n---\n\nPlan body\n';
    writeFileSync(cardFile, cardText, 'utf8');
    const past = new Date(Date.now() - 60000);
    utimesSync(cardFile, past, past);
    const baselineMtime = statSync(cardFile).mtimeMs;

    const astralBody = JSON.stringify({ id: 'planner', provider: '\u{1F600}'.repeat(60000), model: 'flash-a' });
    assert.ok(Buffer.byteLength(astralBody, 'utf8') > 65536, 'the astral body must exceed the byte cap');
    const bmpBody = JSON.stringify({ id: 'planner', provider: '\u4E00'.repeat(30000), model: 'flash-a' });
    assert.ok(bmpBody.length < 65536 && Buffer.byteLength(bmpBody, 'utf8') > 65536, 'the BMP body must be under the cap in UTF-16 units but over in bytes');

    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      for (const [label, body] of [['astral', astralBody], ['bmp', bmpBody]]) {
        const res = await call(`/api/${NS}.route`, { method: 'POST', body });
        assert.equal(res.status, 413, `the ${label} multibyte body must be refused by the byte cap`);
        assert.match(res.data.error, /exceeds the 65536-byte limit/);
        assert.equal(readFileSync(cardFile, 'utf8'), cardText, `the ${label} refusal must not touch the disk`);
        assert.equal(statSync(cardFile).mtimeMs, baselineMtime, `the ${label} refusal must not bump the mtime`);
      }

      const skeleton = (pad) => JSON.stringify({ id: 'absent-role', provider: pad, model: 'flash-a' });
      const padLen = 65536 - Buffer.byteLength(skeleton(''), 'utf8');
      const exactBody = skeleton('p'.repeat(padLen));
      const overBody = skeleton('p'.repeat(padLen + 1));
      assert.equal(Buffer.byteLength(exactBody, 'utf8'), 65536, 'the exact-cap body must measure exactly 65536 bytes');
      assert.equal(Buffer.byteLength(overBody, 'utf8'), 65537, 'the over-cap body must measure exactly 65537 bytes');
      const exactRes = await call(`/api/${NS}.route`, { method: 'POST', body: exactBody });
      assert.notEqual(exactRes.status, 413, 'a body of exactly 65536 bytes must pass the cap');
      assert.equal(exactRes.status, 404, 'the exact-cap body must reach card lookup (absent card)');
      const overRes = await call(`/api/${NS}.route`, { method: 'POST', body: overBody });
      assert.equal(overRes.status, 413, 'a body of 65537 bytes must be refused');
      assert.match(overRes.data.error, /exceeds the 65536-byte limit/);
      assert.equal(readFileSync(cardFile, 'utf8'), cardText);
      assert.equal(statSync(cardFile).mtimeMs, baselineMtime);
    });

    const fmBlock = (filler) => `name: wide\ndescription: ${filler}\nmodel: inherit\ndisabled: true`;
    const need = 65536 - Buffer.byteLength(fmBlock(''), 'utf8');
    const filler = '\u00E9'.repeat(Math.floor(need / 2)) + (need % 2 === 1 ? 'x' : '');
    const exactBlock = fmBlock(filler);
    const overBlock = fmBlock(filler + 'x');
    assert.equal(Buffer.byteLength(exactBlock, 'utf8'), 65536, 'the exact-cap frontmatter must measure exactly 65536 bytes');
    assert.equal(Buffer.byteLength(overBlock, 'utf8'), 65537, 'the over-cap frontmatter must measure exactly 65537 bytes');
    assert.ok(exactBlock.length < 65536 && overBlock.length < 65536, 'the multibyte blocks must be under the cap in UTF-16 units');
    const wideText = `---\n${exactBlock}\n---\n\nBody\n`;
    const wideOverText = `---\n${overBlock}\n---\n\nBody\n`;
    writeFileSync(path.join(dir, 'wide.md'), wideText, 'utf8');
    writeFileSync(path.join(dir, 'wide-over.md'), wideOverText, 'utf8');

    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      const prevWarn = console.warn;
      console.warn = () => {};
      let listed;
      try {
        listed = await call(`/api/${NS}.roles`);
      } finally {
        console.warn = prevWarn;
      }
      assert.equal(listed.status, 200);
      assert.ok(listed.data.roles.some((r) => r.id === 'wide'), 'the exact-cap frontmatter must stay listable in the lenient GET');
      const invalidEntry = listed.data.invalid.find((entry) => entry.id === 'wide-over');
      assert.ok(invalidEntry, 'the 65537-byte frontmatter must surface in invalid[]');
      assert.match(invalidEntry.error, /exceeds the 65536-byte limit/);

      const wideRes = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'wide', disabled: false }) });
      assert.equal(wideRes.status, 200, 'the exact-cap frontmatter must not be cap-rejected on the write path');
      assert.equal(wideRes.data.unchanged, undefined, 'removing the disabled key is a real write');
      assert.ok(!readFileSync(path.join(dir, 'wide.md'), 'utf8').includes('disabled: true'), 'the write must have removed the disabled key');

      const overRes = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'wide-over', disabled: true }) });
      assert.equal(overRes.status, 400, 'the 65537-byte frontmatter must be refused on the write path');
      assert.match(overRes.data.error, /wide-over\.md: frontmatter exceeds the 65536-byte limit/);
      assert.equal(readFileSync(path.join(dir, 'wide-over.md'), 'utf8'), wideOverText, 'the refused oversized frontmatter must stay byte-identical');
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('no-op save honors CRLF cards and the depth cap boundary', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-crlf-depth-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const crlfFile = path.join(dir, 'crlf.md');
    const crlfText = `---\r\nname: crlf\r\ndescription: Plans\r\nprovider: ${EXAMPLE_HUB}\r\nmodel: flash-a\r\nreasoning_effort: high\r\n---\r\n\r\nPlan body\r\n`;
    writeFileSync(crlfFile, crlfText, 'utf8');
    const past = new Date(Date.now() - 60000);
    utimesSync(crlfFile, past, past);

    const deepCard = (levels) => `---\nname: deep\ncustom: ${'['.repeat(levels)}x${']'.repeat(levels)}\n---\n\nBody\n`;
    const deep21Text = deepCard(21);
    const deep22Text = deepCard(22);
    writeFileSync(path.join(dir, 'deep21.md'), deep21Text, 'utf8');
    writeFileSync(path.join(dir, 'deep22.md'), deep22Text, 'utf8');
    assert.equal(parseRoleCard(deep21Text, 'deep21.md', { strict: true }).name, 'deep', '21 nested collections must pass the strict parser');
    assert.throws(() => parseRoleCard(deep22Text, 'deep22.md', { strict: true }), /deep22\.md: frontmatter nesting is too deep/);

    await withMockHost({ agentsHome: tmpHome, llm: flashCatalogLlm() }, async ({ call }) => {
      const roles0 = await call(`/api/${NS}.roles`);
      const crlf0 = roles0.data.roles.find((r) => r.id === 'crlf');
      assert.ok(crlf0, 'the CRLF card must be listable');
      const res = await call(`/api/${NS}.route`, {
        method: 'POST',
        body: JSON.stringify({ id: 'crlf', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: 'high', expectedMtimeMs: crlf0.mtimeMs })
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.unchanged, true, 'an identical POST on a CRLF card must answer unchanged:true');
      assert.deepEqual(res.data.role, crlf0, 'the unchanged response must carry the GET summary at read-time mtime');
      assert.equal(readFileSync(crlfFile, 'utf8'), crlfText, 'the CRLF bytes must stay identical');
      assert.equal(statSync(crlfFile).mtimeMs, crlf0.mtimeMs, 'the CRLF no-op must not bump the mtime');
      assert.ok(!existsSync(`${crlfFile}.lock`), 'the CRLF no-op must not create a lock file');

      const accepted = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'deep21', disabled: true }) });
      assert.equal(accepted.status, 200, '21 nested collections (path length 24) must pass the strict write gate');
      assert.equal(accepted.data.unchanged, undefined, 'the depth-boundary save is a real write');
      assert.match(readFileSync(path.join(dir, 'deep21.md'), 'utf8'), /disabled: true/);

      const refused = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'deep22', disabled: true }) });
      assert.equal(refused.status, 400, '22 nested collections (path length 25) must be refused');
      assert.match(refused.data.error, /deep22\.md: frontmatter nesting is too deep/);
      assert.equal(readFileSync(path.join(dir, 'deep22.md'), 'utf8'), deep22Text, 'the refused deep card must stay byte-identical');
    });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('yaml-ok: cordis.patch.yml parses with the plugin row, preset row, portable customSkillDirs, and fixed subagent config', () => {
  const rawYaml = readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8');
  assert.doesNotMatch(rawYaml, new RegExp(OLD_PLUGIN_NAME), 'cordis.patch.yml must not keep the old local plugin id');
  assert.ok(!rawYaml.includes(OLD_PLUGIN_SCOPE), 'cordis.patch.yml must not reference the removed local scope');
  const doc = parseDocument(rawYaml);
  assert.equal(doc.errors.length, 0, 'cordis.patch.yml must parse without errors');
  const data = doc.toJS();
  const insert = data[0].insert;
  assert.equal(insert[0].id, PKG.name);
  assert.equal(insert[0].name, PKG.name);
  assert.deepEqual(insert[0].config, {});
  assert.equal(insert[1].id, 'preset-orchestrator');
  assert.equal(insert[1].config.id, 'orchestrator');
  assert.equal(insert[1].config.name, 'Orchestrator');
  assert.equal(insert[1].config.order, 4);

  const skillFs = insert[1].config.plugins.find((plugin) => plugin.id === 'skill-filesystem');
  assert.ok(Array.isArray(skillFs.config.customSkillDirs) && skillFs.config.customSkillDirs.length === 1);
  assert.match(skillFs.config.customSkillDirs[0], /createRequire\(baseUrl\)\.resolve\('@deepseek-ai\/dsh-agent-preset\/package\.json'\)/);

  const rootPair = doc.contents.items[0].items.find((p) => p.key.value === 'insert');
  const presetItem = rootPair.value.items.find((item) => item.items.some((p) => p.key.value === 'id' && p.value.value === 'preset-orchestrator'));
  const pluginsSeq = presetItem.items.find((p) => p.key.value === 'config').value.items.find((p) => p.key.value === 'plugins').value;
  const skillFsAst = pluginsSeq.items.find((item) => item.items.some((p) => p.key.value === 'id' && p.value.value === 'skill-filesystem'));
  const customDirsAst = skillFsAst.items.find((p) => p.key.value === 'config').value.items.find((p) => p.key.value === 'customSkillDirs').value;
  const exprNode = customDirsAst.items[0];
  assert.equal(exprNode.tag, 'tag:yaml.org,2002:js', 'customSkillDirs[0] must preserve the !!js YAML tag');
  const evaluatedDir = new Function('process', 'baseUrl', `return (${exprNode.value});`)({
    getBuiltinModule(mod) {
      if (mod === 'node:path') return path;
      if (mod === 'node:module') {
        return {
          createRequire(u) {
            assert.equal(u, 'file:///mock-profile/cordis.yml');
            return { resolve: (id) => (id === '@deepseek-ai/dsh-agent-preset/package.json' ? '/mock/pkg/package.json' : '') };
          }
        };
      }
      throw new Error(`unexpected module ${mod}`);
    }
  }, 'file:///mock-profile/cordis.yml');
  assert.equal(path.normalize(evaluatedDir), path.normalize('/mock/pkg/skills'));

  const delegation = insert[1].config.plugins.find((plugin) => plugin.id === 'delegation');
  const toolSubagent = delegation.config.find((plugin) => plugin.id === 'tool-subagent');
  assert.deepEqual(toolSubagent.config, { provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: true });
  const fork = delegation.config.find((plugin) => plugin.id === 'tool-subagent-fork');
  assert.equal(fork.config.modelSelection, undefined);
  assert.equal(fork.config.modelDiscovery, undefined);
});

await test('preset rows: interrupt stays disabled and the Office row mirrors the shipped standard preset', () => {
  const doc = parseDocument(readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8'));
  const insert = doc.toJS()[0].insert;
  const plugins = insert[1].config.plugins;
  const delegation = plugins.find((plugin) => plugin.id === 'delegation');
  const control = delegation.config.find((plugin) => plugin.id === 'tool-subagent-control');
  assert.deepEqual(control.config, { interrupt: false }, 'interrupt_agent must stay off, as in every built-in configuration since 0.2.2-rc.1');
  const office = plugins.find((plugin) => plugin.id === 'tool-office');
  assert.ok(office, 'the preset must declare tool-office like the shipped standard preset does');
  assert.equal(office.name, '@deepseek-ai/dsh-tool-office');
  const fsPlugin = plugins.find((plugin) => plugin.id === 'tool-fs');
  assert.deepEqual(fsPlugin.config, { applyPatch: false }, 'the apply_patch toggle must match the shipped standard preset');
});

await test('persona: the team API matches DSH 0.2.2-rc.2+ (no removed teammate tools)', () => {
  const doc = parseDocument(readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8'));
  const insert = doc.toJS()[0].insert;
  const persona = insert[1].config.plugins.find((plugin) => plugin.id === 'persona');
  const prefix = persona.config.prefix;
  const negationSentence = /There is no spawn_teammate[^\n]*?command\./;
  assert.match(prefix, negationSentence, 'the persona must state the removed teammate tools as a negation');
  const withoutNegation = prefix.replace(negationSentence, '');
  assert.doesNotMatch(withoutNegation, /spawn_teammate/, 'the persona must not present a removed teammate tool as live');
  assert.match(withoutNegation, /subagent_role/, 'the persona must dispatch role members with subagent_role');
  assert.match(withoutNegation, /subagent_fork/, 'the persona must name subagent_fork for inherited-context lanes');
  assert.match(withoutNegation, /send_message/, 'the persona must keep send_message for peer coordination');
  assert.match(withoutNegation, /wait_agent/, 'the persona must keep wait_agent for the Lead to await members');
});

await test('persona: interrupt_agent is described accurately (present in the host, not mounted here)', () => {
  const doc = parseDocument(readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8'));
  const insert = doc.toJS()[0].insert;
  const persona = insert[1].config.plugins.find((plugin) => plugin.id === 'persona');
  const prefix = persona.config.prefix;
  const mountedNote = /interrupt_agent still exists in the host[^\n]*?catalog\./;
  assert.match(prefix, mountedNote, 'the persona must explain that interrupt_agent is not mounted in this composition');
  assert.match(prefix, /interrupt: false/, 'the persona must name the configuration that keeps interrupt_agent out of the catalog');
  const withoutMountedNote = prefix.replace(mountedNote, '');
  assert.doesNotMatch(withoutMountedNote, /interrupt_agent/, 'the persona must not offer interrupt_agent as an action');
});

await test('persona: the shared task board is conditional on Team mode being enabled', () => {
  const doc = parseDocument(readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8'));
  const insert = doc.toJS()[0].insert;
  const persona = insert[1].config.plugins.find((plugin) => plugin.id === 'persona');
  const prefix = persona.config.prefix;
  assert.match(prefix, /Use Agent Teams/, 'the persona must name the switch that enables Team mode');
  assert.match(prefix, /OFF by default/, 'the persona must state that Team mode is off by default');
  assert.match(prefix, /When Team mode is OFF, there is no task board/, 'the persona must give the Lead a fallback when the board is absent');
});

await test('persona: an explicit child route is bounded by the session model-selection policy', () => {
  const doc = parseDocument(readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8'));
  const insert = doc.toJS()[0].insert;
  const persona = insert[1].config.plugins.find((plugin) => plugin.id === 'persona');
  const prefix = persona.config.prefix;
  assert.match(prefix, /model-selection policy/, 'the persona must state that a route override is policy-bounded');
});

await test('persona: the final-stage adversarial verification workflow is task-type branched and DSH-compatible', () => {
  const doc = parseDocument(readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8'));
  const insert = doc.toJS()[0].insert;
  const persona = insert[1].config.plugins.find((plugin) => plugin.id === 'persona');
  const prefix = persona.config.prefix;
  assert.match(prefix, /ADVERSARIAL VERIFICATION WORKFLOW/, 'the persona must carry the adversarial verification workflow');
  assert.match(prefix, /Phase "Review"/, 'the workflow pattern must declare the Review phase');
  assert.match(prefix, /Phase "Verify"/, 'the workflow pattern must declare the Verify phase');
  assert.match(prefix, /Phase "Critic"/, 'the workflow pattern must declare the Critic phase');
  assert.match(prefix, /BOTH vote real/, 'a finding survives only when both refutation verifiers confirm it');
  assert.match(prefix, /never agentType, effort or isolation/, 'the persona must teach the DSH agent() option set, not the Claude one');
  assert.match(prefix, /NO export const meta/, 'the persona must teach the script-body spelling the tool requires');
  assert.match(prefix, /docs-only and pure-diagnostic tasks skip it/, 'docs-only tasks must not pay the workflow cost');
  assert.match(prefix, /bugfix: lifecycle\/state machine/, 'the lens set must branch on task type');
  assert.match(prefix, /refactor: behavior preservation/, 'the refactor lens set must differ from the bugfix set');
  assert.doesNotMatch(prefix, /agentType:/, 'the persona must never present agentType as a live option');
  assert.match(prefix, /TEST VERIFICATION GATE/);
  assert.match(prefix, /SECURITY AND DELIVERY/);
  assert.match(prefix, /DESKTOP CONTROL/);
  assert.match(prefix, /TURN-END SUGGESTIONS/);
});

await test('persona: Craft 20 roles, .devflow/ state, grilling, and zero legacy role or path leaks', () => {
  const doc = parseDocument(readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8'));
  const insert = doc.toJS()[0].insert;
  const prefix = insert[1].config.plugins.find((plugin) => plugin.id === 'persona').config.prefix;
  for (const role of CRAFT_ROLES) {
    assert.ok(prefix.includes(role), `persona.prefix must reference Craft role ${role}`);
  }
  assert.match(prefix, /\.devflow\/plans\/<slug>\.md/);
  assert.match(prefix, /\.devflow\/evidence\//);
  assert.match(prefix, /\bgrilling\b/);
  assert.doesNotMatch(prefix, /\.sisyphus/);
  assert.doesNotMatch(prefix, /grill-me/);
  assert.doesNotMatch(prefix, LEGACY_WORD_RE, 'persona.prefix must not contain legacy role names');
});

await test('client.js registers under the exact package name (web-boot row id)', () => {
  const source = readFileSync(path.join(packageDir, 'client.js'), 'utf8');
  const ids = [...source.matchAll(/__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'(?:\s*,)?/g)].map((match) => match[1]);
  assert.ok(ids.length > 0, 'client.js must register its factory via __ModuleLoader__.load');
  for (const id of ids) {
    assert.equal(id, PKG.name, 'registration id must equal the package name: boot graph rows key on the package name, and a mismatch makes the loader fall back and re-execute the bundle, which fails the whole web boot with a duplicate factory registration');
  }
});

await test('server and client agree on the /api/<name>.* route surface', () => {
  const routeRe = /\/api\/dsh-orchestrator-kit\.(roles|catalog|efforts|route)/g;
  const serverRoutes = [...readFileSync(path.join(packageDir, 'index.js'), 'utf8').matchAll(routeRe)].map((m) => m[0]).sort();
  const clientRoutes = [...readFileSync(path.join(packageDir, 'client.js'), 'utf8').matchAll(routeRe)].map((m) => m[0]).sort();
  assert.equal(serverRoutes.length, 4, 'index.js must register exactly the 4 namespaced routes');
  assert.deepEqual(serverRoutes, clientRoutes, 'client.js must call exactly the routes index.js registers');
});

await test('package.json: public npm contract (name, exports, files, dsh manifest, no private)', () => {
  assert.equal(PKG.name, 'dsh-orchestrator-kit');
  assert.equal(PKG.version, '0.1.0');
  assert.equal(PKG.type, 'module');
  assert.equal(PKG.license, 'MIT');
  assert.equal(typeof PKG.description, 'string');
  assert.ok(PKG.description.startsWith('DeepSeek Harness (dsh) plugin:'), 'description must start with the DeepSeek Harness marker');
  assert.ok(PKG.description.length <= 140, 'description must fit npm one-liner limits');
  assert.equal(PKG.private, undefined, 'the package is public: no private field');
  assert.deepEqual(PKG.publishConfig, { access: 'public' });
  assert.deepEqual(PKG.engines, { node: '>=22' });
  assert.deepEqual(PKG.exports, {
    '.': './index.js',
    './client': './client.js',
    './locale/*.json': './locale/*.json',
    './icon': './icon.svg',
    './package.json': './package.json'
  });
  assert.deepEqual(PKG.files, [
    'index.js',
    'client.js',
    'cordis.patch.yml',
    'locale/',
    'docs/',
    'icon.svg',
    'craft/',
    'scripts/',
    'README.md',
    'CHANGELOG.md',
    'LICENSE'
  ]);
  assert.equal(PKG.scripts.test, 'node scripts/test.mjs');
  assert.equal(PKG.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(PKG.dsh.client.platform, 'web');
  assert.deepEqual(PKG.dsh.client.inject, []);
  assert.ok(PKG.dependencies.yaml, 'yaml must be a dependency');
  assert.ok(PKG.dependencies['@deepseek-ai/dsh-atomic-write'], 'dsh-atomic-write must be a dependency');
});

await test('client.js static contract: phase grouping, save flow markers, and no old-name leftovers', () => {
  const clientText = readFileSync(path.join(packageDir, 'client.js'), 'utf8');
  assert.ok(clientText.includes("id: 'discovery'"));
  assert.ok(clientText.includes("id: 'planning'"));
  assert.ok(clientText.includes("id: 'verification'"));
  assert.ok(clientText.includes("id: 'other'"));
  assert.ok(clientText.includes('locale: NS'));
  assert.ok(clientText.includes("inject: ['slots', 'locale']"));
  assert.ok(clientText.includes('expectedMtimeMs'), 'client.js must send expectedMtimeMs');
  assert.ok(clientText.includes(`/api/${NS}.efforts`), 'client.js must query .efforts');
  assert.ok(clientText.includes('data-dsh-orchestrator-kit-settings'), 'client.js must keep its settings mount marker');
  assert.doesNotMatch(clientText, /spawn_teammate\b/, 'client.js must not name the removed spawn_teammate tool');
  assert.ok(!clientText.includes(OLD_PLUGIN_NAME), 'client.js must not keep the old local plugin identity');
  assert.ok(!clientText.includes(OLD_PLUGIN_SCOPE), 'client.js must not reference the removed local scope');
  assert.ok(!readFileSync(path.join(packageDir, 'index.js'), 'utf8').includes(OLD_PLUGIN_NAME), 'index.js must not keep the old local plugin identity');
  assert.ok(!readFileSync(path.join(packageDir, 'index.js'), 'utf8').includes('failsafe'), 'index.js must never use the failsafe YAML schema');
});

await test('node --check passes on the shipped files', () => {
  for (const relative of ['index.js', 'client.js', 'scripts/test.mjs']) {
    const result = spawnSync(process.execPath, ['--check', path.join(packageDir, relative)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative} failed node --check: ${result.stderr}`);
  }
});

await test('all shipped files exist with UTF-8 no BOM and pure LF', () => {
  for (const file of ['package.json', 'cordis.patch.yml', 'index.js', 'client.js', 'scripts/test.mjs', 'locale/en.json', 'locale/pt-BR.json', 'locale/zh.json']) {
    const bytes = readFileSync(path.join(packageDir, file));
    assert.ok(!bytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), `${file} must not carry a BOM`);
    assert.ok(!bytes.toString('utf8').includes('\r\n'), `${file} must use pure LF`);
  }
});

function mountVmClient(fetchHandler, options = {}) {
  let registeredModule = null;
  let injectedFactory = null;
  const slotsSection = [];
  const fetchCalls = [];
  const pluginDisposers = [];
  const inflight = new Set();
  const track = (promise) => {
    inflight.add(promise);
    return promise.finally(() => inflight.delete(promise));
  };

  const storageMap = options.storageMap instanceof Map ? options.storageMap : new Map();
  const storageThrows = options.storage === 'throw';
  const localeState = { active: options.active ?? 'en', revision: 0, registrations: [], languages: [], faces: new Map(), listeners: new Set() };
  const notifyLocale = () => { localeState.revision += 1; for (const fn of [...localeState.listeners]) fn(); };
  const lookupRegistered = (ns, key, params) => {
    let template;
    for (const locale of [localeState.active.toLowerCase(), 'en']) {
      const dict = localeState.faces.get(`${ns}:${locale}`);
      if (dict && dict[key] !== undefined) { template = dict[key]; break; }
    }
    if (template === undefined) template = key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  };
  const boundFns = new Map();
  const localeStub = {
    register(ns, locale, dict) {
      localeState.registrations.push({ ns, locale, dict });
      localeState.faces.set(`${ns}:${locale.toLowerCase()}`, dict);
      notifyLocale();
      return () => { localeState.registrations.pop(); localeState.faces.delete(`${ns}:${locale.toLowerCase()}`); };
    },
    addLanguage(input) {
      if (options.addLanguageThrows) throw new Error('language already registered');
      localeState.languages.push(input);
      notifyLocale();
      return () => { localeState.languages.pop(); };
    },
    getSnapshot() {
      return { active: localeState.active, locales: [{ id: 'en', label: 'English' }, { id: 'zh', label: '中文' }, ...localeState.languages.map((l) => ({ id: l.id, label: l.label }))], revision: localeState.revision };
    },
    subscribe(fn) { localeState.listeners.add(fn); return () => { localeState.listeners.delete(fn); }; },
    setLocale(id) { localeState.active = id; notifyLocale(); },
    bind(ns) {
      if (options.sentinelBind) return (key) => `⟦${key}⟧`;
      if (!boundFns.has(ns)) boundFns.set(ns, (key, params) => lookupRegistered(ns, key, params));
      return boundFns.get(ns);
    }
  };

  const sandbox = createContext({
    window: {
      __ModuleLoader__: {
        load(mod) { registeredModule = mod; }
      },
      localStorage: {
        getItem(key) {
          if (storageThrows) throw new Error('storage disabled');
          return storageMap.has(key) ? storageMap.get(key) : null;
        },
        setItem(key, value) {
          if (storageThrows) throw new Error('storage disabled');
          storageMap.set(key, String(value));
        },
        removeItem(key) {
          if (storageThrows) throw new Error('storage disabled');
          storageMap.delete(key);
        }
      }
    },
    fetch: (url, opts) => track(Promise.resolve().then(() => {
      fetchCalls.push({ url, opts });
      return fetchHandler(url, opts);
    })),
    encodeURIComponent,
    JSON,
    Map,
    Set,
    Array,
    Object,
    Promise,
    Number,
    String,
    Symbol,
    Error
  });
  runInContext(source, sandbox);
  assert.equal(registeredModule.id, PKG.name);

  let stateSlots = [];
  let hookCursor = 0;
  let pendingEffects = [];
  const plugin = registeredModule.factory((dep) => {
    assert.equal(dep, 'react');
    return {
      createElement(type, props, ...children) {
        return { type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) };
      },
      useState(initial) {
        const idx = hookCursor++;
        if (!(idx in stateSlots)) stateSlots[idx] = typeof initial === 'function' ? initial() : initial;
        return [stateSlots[idx], (updater) => {
          stateSlots[idx] = typeof updater === 'function' ? updater(stateSlots[idx]) : updater;
        }];
      },
      useEffect(effect, deps) {
        pendingEffects.push({ idx: hookCursor++, effect, deps });
      }
    };
  });
  plugin.apply({
    slots: {
      inject(slot, factory) {
        assert.equal(slot, 'settings.section');
        injectedFactory = factory;
      },
      register(meta, component) {
        slotsSection.push({ meta, component });
        return meta;
      }
    },
    locale: localeStub,
    effect(fn) {
      const dispose = fn();
      pluginDisposers.push(dispose);
      return dispose;
    }
  });
  injectedFactory();
  const Component = slotsSection[0].component;
  const sectionMeta = slotsSection[0].meta;

  const runPluginDisposers = () => {
    for (const dispose of pluginDisposers.splice(0)) {
      if (typeof dispose === 'function') dispose();
    }
  };

  function mountInstance() {
    const instanceSlots = [];
    const effectRecords = [];
    stateSlots = instanceSlots;

    const depsChanged = (prev, next) => {
      if (prev === undefined || next === undefined) return true;
      if (prev.length !== next.length) return true;
      return next.some((v, i) => !Object.is(v, prev[i]));
    };

    const renderCycle = () => {
      stateSlots = instanceSlots;
      hookCursor = 0;
      pendingEffects = [];
      const tree = Component();
      for (const item of pendingEffects) {
        const prev = effectRecords[item.idx];
        if (!prev || depsChanged(prev.deps, item.deps)) {
          if (typeof prev?.cleanup === 'function') prev.cleanup();
          const cleanup = item.effect();
          effectRecords[item.idx] = { deps: item.deps, cleanup };
        }
      }
      return tree;
    };

    const settle = async (waitForInflight = true) => {
      let tree = renderCycle();
      for (let step = 0; step < 12; step++) {
        if (waitForInflight && inflight.size > 0) {
          await Promise.all([...inflight]);
        }
        await new Promise((r) => setTimeout(r, 0));
        const hadInflight = waitForInflight && inflight.size > 0;
        tree = renderCycle();
        if (!hadInflight && (!waitForInflight || inflight.size === 0) && step > 0) {
          await new Promise((r) => setTimeout(r, 0));
          if (!waitForInflight || inflight.size === 0) break;
        }
      }
      return renderCycle();
    };

    const unmount = () => {
      for (const rec of effectRecords) {
        if (typeof rec?.cleanup === 'function') rec.cleanup();
      }
    };

    return { renderCycle, settle, unmount, meta: sectionMeta };
  }

  return { mountInstance, fetchCalls, locale: localeState, storage: storageMap, runPluginDisposers };
}

const collectText = (node, acc = []) => {
  if (typeof node === 'string') acc.push(node);
  else if (node && typeof node === 'object') {
    for (const child of node.children ?? []) collectText(child, acc);
  }
  return acc;
};
const findNodes = (node, pred, acc = []) => {
  if (node && typeof node === 'object') {
    if (pred(node)) acc.push(node);
    for (const child of node.children ?? []) findNodes(child, pred, acc);
  }
  return acc;
};

await test('client.js: runtime module registration, phase grouping, save, 409, refresh failure retention, remount efforts, and catalog failure fallback', async () => {
  const mockRoles = [
    ...CRAFT_ROLES.map((id) => ({
      id,
      name: id,
      description: `Role ${id}`,
      provider: EXAMPLE_ROUTED_ROLES[id]?.provider ?? null,
      model: EXAMPLE_ROUTED_ROLES[id]?.model ?? 'inherit',
      reasoningEffort: id === 'security-auditor' ? 'high' : null,
      disabled: false,
      mtimeMs: 1000
    })),
    { id: 'zeta-custom', name: 'zeta-custom', description: 'Custom Z', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 1000 },
    { id: 'alpha-custom', name: 'alpha-custom', description: 'Custom A', provider: null, model: 'inherit', reasoningEffort: null, disabled: true, mtimeMs: 1000 }
  ];
  const mockCatalog = {
    ok: true,
    available: true,
    degraded: false,
    default: { provider: EXAMPLE_CLOUD, model: 'reasoner-d' },
    groups: [
      { provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }, { id: 'flash-b', name: 'Flash B' }] },
      { provider: EXAMPLE_CLOUD, name: 'Example Cloud', models: [{ id: 'reasoner-b', name: 'Reasoner B' }, { id: 'reasoner-c', name: 'Reasoner C' }, { id: 'reasoner-d', name: 'Reasoner D' }] },
      { provider: EXAMPLE_OPEN, name: 'Example Open', models: [{ id: 'base-c', name: 'Base C' }, { id: 'base-d', name: 'Base D' }] }
    ]
  };

  let failRolesNext = false;
  let invalidJsonRolesNext = false;
  let holdRolesResolver = null;
  let routeResponseMode = 'ok';
  const vm1 = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) {
      if (holdRolesResolver) {
        return new Promise((resolve) => {
          holdRolesResolver = () => resolve(new Response(JSON.stringify({ ok: true, roles: mockRoles }), { status: 200 }));
        });
      }
      if (invalidJsonRolesNext) return new Response('<html>proxy</html>', { status: 200 });
      if (failRolesNext) return new Response(JSON.stringify({ ok: false, error: 'roles boom' }), { status: 500 });
      return new Response(JSON.stringify({ ok: true, roles: mockRoles }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(mockCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) {
      return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    }
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      if (routeResponseMode === '409') return new Response(JSON.stringify({ ok: false, error: 'stale mtime' }), { status: 409 });
      if (routeResponseMode === '500') return new Response(JSON.stringify({ ok: false, error: 'write failed upstream trace-id-42' }), { status: 500 });
      const base = mockRoles.find((r) => r.id === payload.id);
      const nextProvider = payload.provider === null ? null : (payload.provider ?? base.provider);
      const nextModel = payload.model === null ? 'inherit' : (payload.model ?? base.model);
      const routeChanged = payload.provider !== undefined || payload.model !== undefined;
      const nextEffort = payload.model === null
        ? null
        : payload.reasoningEffort === null
          ? null
          : (payload.reasoningEffort ?? (routeChanged ? null : base.reasoningEffort));
      return new Response(JSON.stringify({
        ok: true,
        role: {
          ...base,
          provider: nextProvider,
          model: nextModel,
          reasoningEffort: nextEffort,
          disabled: payload.disabled ?? base.disabled,
          mtimeMs: base.mtimeMs + 10
        }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });

  const app1 = vm1.mountInstance();
  assert.equal(app1.meta.id, NS);
  assert.equal(app1.meta.label(), 'Orchestrator');

  let tree = await app1.settle();
  const texts = collectText(tree);
  const sectionTitles = findNodes(tree, (n) => n.type === 'div' && n.props.style?.fontSize === 13 && n.props.style?.fontWeight === 600).map((n) => n.children[1]);
  for (const heading of ['Discovery & Advisory', 'Planning & Execution', 'Verification, QA & Docs', 'Other']) {
    assert.ok(sectionTitles.includes(heading), `rendered settings must include section title node ${heading}`);
  }
  assert.ok(texts.includes('Refresh'));
  assert.ok(texts.indexOf('alpha-custom') < texts.indexOf('zeta-custom'), 'Other roles must sort alphabetically');

  const effortCalls = vm1.fetchCalls.filter((c) => c.url.startsWith(`/api/${NS}.efforts`));
  const uniquePairs = new Set(
    Object.values(EXAMPLE_ROUTED_ROLES).map((route) => JSON.stringify([route.provider, route.model]))
  );
  assert.equal(effortCalls.length, uniquePairs.size, 'exactly one .efforts fetch per unique routed (provider, model) pair must be issued');
  assert.ok(texts.includes('High (high)'), 'rendered effort select must include resolved effort option High (high)');
  assert.ok(texts.includes('Default (medium)'), 'rendered effort select must include defaultEffort label');
  assert.equal(findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').length, 22);

  const secProviderSelect = findNodes(tree, (n) => n.type === 'select' && n.props['aria-label'] === 'Provider for security-auditor')[0];
  secProviderSelect.props.onChange({ target: { value: '' } });
  tree = app1.renderCycle();
  const secSaveBtn = findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save security-auditor settings')[0];
  assert.equal(secSaveBtn.props.disabled, false, 'resetting a role with saved reasoningEffort to inherit must keep Save enabled');
  await secSaveBtn.props.onClick();
  tree = app1.renderCycle();
  const secResetPost = vm1.fetchCalls.filter((c) => c.url === `/api/${NS}.route`).at(-1);
  assert.deepEqual(JSON.parse(secResetPost.opts.body), { id: 'security-auditor', expectedMtimeMs: 1000, provider: null, model: null });

  findNodes(tree, (n) => n.type === 'select' && n.props['aria-label'] === 'Provider for implementer')[0].props.onChange({ target: { value: EXAMPLE_CLOUD } });
  tree = app1.renderCycle();
  assert.equal(findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save implementer settings')[0].props.disabled, true, 'incomplete route without model must keep Save disabled');
  findNodes(tree, (n) => n.type === 'select' && n.props['aria-label'] === 'Model for implementer')[0].props.onChange({ target: { value: 'reasoner-d' } });
  tree = await app1.settle();
  findNodes(tree, (n) => n.type === 'select' && n.props['aria-label'] === 'Reasoning effort for implementer')[0].props.onChange({ target: { value: 'high' } });
  tree = app1.renderCycle();
  const implSave = findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save implementer settings')[0];
  assert.equal(implSave.props.disabled, false);
  await implSave.props.onClick();
  tree = app1.renderCycle();
  const implPost = vm1.fetchCalls.filter((c) => c.url === `/api/${NS}.route`).at(-1);
  assert.deepEqual(JSON.parse(implPost.opts.body), {
    id: 'implementer',
    expectedMtimeMs: 1000,
    provider: EXAMPLE_CLOUD,
    model: 'reasoner-d',
    reasoningEffort: 'high'
  });

  const alphaCheckbox = findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable alpha-custom')[0];
  alphaCheckbox.props.onChange({ target: { checked: false } });
  tree = app1.renderCycle();
  const alphaSave = findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save alpha-custom settings')[0];
  assert.equal(alphaSave.props.disabled, false);
  await alphaSave.props.onClick();
  tree = app1.renderCycle();
  const routePost = vm1.fetchCalls.filter((c) => c.url === `/api/${NS}.route`).at(-1);
  assert.deepEqual(JSON.parse(routePost.opts.body), { id: 'alpha-custom', expectedMtimeMs: 1000, disabled: false });
  assert.ok(collectText(tree).some((t) => t.includes('Saved — applies')));

  failRolesNext = true;
  const refreshBtn = findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Refresh roles and catalog')[0];
  refreshBtn.props.onClick();
  tree = await app1.settle();
  assert.ok(collectText(tree).some((t) => t.includes('roles boom')));
  assert.equal(findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').length, 22, 'failed refresh must keep all 22 rows');

  failRolesNext = false;
  invalidJsonRolesNext = true;
  findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Refresh roles and catalog')[0].props.onClick();
  tree = await app1.settle();
  assert.ok(collectText(tree).some((t) => t.includes('Invalid JSON response (HTTP 200)')));
  assert.equal(findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').length, 22);
  invalidJsonRolesNext = false;

  const zetaCheckbox = findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable zeta-custom')[0];
  zetaCheckbox.props.onChange({ target: { checked: true } });
  tree = app1.renderCycle();
  await findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save zeta-custom settings')[0].props.onClick();
  tree = app1.renderCycle();
  assert.equal(findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').length, 22, 'save after failed refresh must preserve all 22 rows');

  holdRolesResolver = true;
  findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable zeta-custom')[0].props.onChange({ target: { checked: false } });
  tree = app1.renderCycle();
  findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Refresh roles and catalog')[0].props.onClick();
  tree = await app1.settle(false);
  assert.equal(findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save zeta-custom settings')[0].props.disabled, true, 'Save must stay disabled while refresh is in flight');
  holdRolesResolver();
  holdRolesResolver = null;
  tree = await app1.settle(true);

  routeResponseMode = '409';
  findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable zeta-custom')[0].props.onChange({ target: { checked: true } });
  tree = app1.renderCycle();
  const zeta409Save = findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save zeta-custom settings')[0];
  assert.equal(zeta409Save.props.disabled, false);
  await zeta409Save.props.onClick();
  tree = app1.renderCycle();
  assert.ok(collectText(tree).some((t) => t.includes('Conflict/validation error (409)')));

  routeResponseMode = 'ok';
  const vmRaw = mountVmClient(async (url, opts) => {
    if (url.startsWith(/api/ + NS + '.roles')) return new Response(JSON.stringify({ ok: true, roles: [mockRoles.find((r) => r.id === 'zeta-custom')] }), { status: 200 });
    if (url.startsWith(/api/ + NS + '.catalog')) return new Response(JSON.stringify(mockCatalog), { status: 200 });
    if (url === /api/ + NS + '.route') return new Response(JSON.stringify({ ok: false, error: 'write failed upstream trace-id-42' }), { status: 500 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const appRaw = vmRaw.mountInstance();
  let treeRaw = await appRaw.settle();
  findNodes(treeRaw, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable zeta-custom')[0].props.onChange({ target: { checked: true } });
  treeRaw = appRaw.renderCycle();
  const rawSave = findNodes(treeRaw, (n) => n.type === 'button' && n.props['aria-label'] === 'Save zeta-custom settings')[0];
  assert.equal(rawSave.props.disabled, false);
  await rawSave.props.onClick();
  treeRaw = appRaw.renderCycle();
  assert.ok(collectText(treeRaw).some((t) => t.includes('write failed upstream') && t.includes('trace-id-42')), 'a non-409 save failure must render the raw server detail as data via error.raw');
  appRaw.unmount();

  failRolesNext = false;
  routeResponseMode = 'ok';
  const callsBeforeRefresh = vm1.fetchCalls.length;
  findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Refresh roles and catalog')[0].props.onClick();
  tree = await app1.settle();
  const postRefreshEfforts = vm1.fetchCalls.slice(callsBeforeRefresh).filter((c) => c.url.startsWith(`/api/${NS}.efforts`));
  assert.equal(postRefreshEfforts.length, uniquePairs.size, 'successful refresh must clear effortsCache and re-fetch every distinct route');

  const halfCard = { id: 'half-card', name: 'half-card', description: 'Half', provider: null, model: 'orphan-model', reasoningEffort: null, disabled: false, mtimeMs: 1000 };
  const vm2 = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: [halfCard] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: false, error: 'catalog offline' }), { status: 500 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app2 = vm2.mountInstance();
  let tree2 = await app2.settle();
  const texts2 = collectText(tree2);
  assert.ok(texts2.some((t) => t.includes('catalog offline')), 'catalog error must render warning');
  assert.ok(texts2.includes('orphan-model (unavailable)'), 'half-written model-only card must show fallback label');
  findNodes(tree2, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable half-card')[0].props.onChange({ target: { checked: true } });
  tree2 = app2.renderCycle();
  assert.equal(findNodes(tree2, (n) => n.type === 'button' && n.props['aria-label'] === 'Save half-card settings')[0].props.disabled, false);

  const vm2b = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: [halfCard] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) {
      return new Response(JSON.stringify({
        ok: true,
        available: true,
        degraded: true,
        failedProviders: ['example-down'],
        groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const tree2b = await vm2b.mountInstance().settle();
  assert.ok(collectText(tree2b).some((t) => t.includes('Partial catalog') && t.includes('example-down')), 'partial degraded catalog must surface failedProviders banner');

  let resolveSlowEffort;
  let slowEffortStarted;
  const slowReady = new Promise((r) => { slowEffortStarted = r; });
  let effortReqCount = 0;
  let unknownEffortReqCount = 0;
  const vm3 = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) {
      return new Response(JSON.stringify({
        ok: true,
        roles: [
          { id: 'planner', name: 'planner', description: 'P', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1 },
          { id: 'docs-scout', name: 'docs-scout', description: 'D', provider: EXAMPLE_HUB, model: 'unknown-m', reasoningEffort: null, disabled: false, mtimeMs: 1 }
        ]
      }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) {
      if (url.includes('unknown-m')) {
        unknownEffortReqCount += 1;
        return new Response(JSON.stringify({ ok: false, error: 'unknown model' }), { status: 409 });
      }
      effortReqCount += 1;
      if (effortReqCount === 1) {
        return new Promise((r) => {
          resolveSlowEffort = r;
          slowEffortStarted();
        });
      }
      return new Response(JSON.stringify({ ok: true, defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app3a = vm3.mountInstance();
  await app3a.settle(false);
  await slowReady;
  app3a.unmount();

  const app3b = vm3.mountInstance();
  let tree3b = await app3b.settle(false);
  assert.ok(collectText(tree3b).includes('Loading levels…'));
  resolveSlowEffort(new Response(JSON.stringify({ ok: false, error: 'temp down' }), { status: 503 }));
  tree3b = await app3b.settle(true);
  assert.ok(collectText(tree3b).includes('Effort unavailable'));
  app3b.unmount();

  const app3c = vm3.mountInstance();
  const tree3c = await app3c.settle();
  assert.equal(effortReqCount, 2, 'transient 503 effort failure must retry on remount');
  assert.equal(unknownEffortReqCount, 1, 'non-transient 409 effort failure must stay cached across remounts');
  assert.ok(collectText(tree3c).includes('Default (high)'));

  const vm4 = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: mockRoles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(mockCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app4 = vm4.mountInstance();
  let tree4 = await app4.settle();
  const tabButtons = () => findNodes(tree4, (n) => n.type === 'button' && n.props.role === 'tab');
  const checkboxNames = (tree) => findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').map((n) => n.props['aria-label'].replace('Disable ', ''));
  assert.ok(collectText(tree4).includes('What these settings do'), 'legend must explain what each setting does');
  assert.ok(collectText(tree4).includes('Members created with plain subagent always inherit the Lead.'), 'legend must keep the plain-subagent inherit fact');
  assert.ok(collectText(tree4).includes('Routed'), 'routed status badge must render');
  assert.ok(collectText(tree4).includes('Inherits chat'), 'inherit status badge must render');
  assert.ok(findNodes(tree4, (n) => n.type === 'span' && n.props.style?.background === 'rgba(239,68,68,0.12)').length >= 1, 'disabled status badge tint must render for a disabled role');
  const routed4 = mockRoles.filter((r) => r.provider && r.model && r.model !== 'inherit').length;
  const disabled4 = mockRoles.filter((r) => r.disabled === true).length;
  assert.ok(collectText(tree4).join('').includes(`${mockRoles.length} roles · ${routed4} routed · ${mockRoles.length - routed4} inherit · ${disabled4} disabled`), 'header summary must report saved-state counts');
  assert.equal(tabButtons().length, 5, 'segmented control must offer all roles plus three phases plus other');
  assert.equal(tabButtons().find((b) => b.props['aria-selected'] === true).children[0], 'All roles', 'default tab must show every role');
  assert.equal(checkboxNames(tree4).length, 22);
  const clickTab = (label) => {
    tabButtons().find((b) => b.children[0] === label).props.onClick();
    tree4 = app4.renderCycle();
  };
  clickTab('Discovery & Advisory');
  assert.deepEqual(checkboxNames(tree4), ['repo-scout', 'docs-scout', 'media-analyst', 'arch-advisor'], 'phase tab must filter the grid to that phase');
  clickTab('Planning & Execution');
  assert.equal(checkboxNames(tree4).length, 6);
  clickTab('Verification, QA & Docs');
  assert.equal(checkboxNames(tree4).length, 10);
  clickTab('Other');
  assert.deepEqual(checkboxNames(tree4), ['alpha-custom', 'zeta-custom']);
  clickTab('All roles');
  assert.equal(checkboxNames(tree4).length, 22);
  const tablist = findNodes(tree4, (n) => n.props.role === 'tablist')[0];
  assert.ok(tabButtons().every((b) => b.props['aria-controls'] === 'orch-role-panel'), 'every tab must control the role panel');
  assert.equal(tabButtons().filter((b) => b.props.tabIndex === 0).length, 1, 'roving tabindex must keep a single tab stop');
  assert.equal(findNodes(tree4, (n) => n.props.role === 'tabpanel').length, 1, 'a single labelled tabpanel must wrap the grid');
  const focusableTabs = tabButtons().map((b) => ({ ...b, focus() {} }));
  tablist.props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, currentTarget: { querySelectorAll: () => focusableTabs }, target: focusableTabs[0] });
  tree4 = app4.renderCycle();
  assert.equal(tabButtons().find((b) => b.props['aria-selected'] === true).children[0], 'Discovery & Advisory', 'ArrowRight must move selection to the next tab');
  assert.equal(tabButtons().filter((b) => b.props.tabIndex === 0).length, 1);
  app4.unmount();

  const vm5 = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: [mockRoles.find((r) => r.id === 'planner')] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(mockCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app5 = vm5.mountInstance();
  let tree5 = await app5.settle();
  findNodes(tree5, (n) => n.type === 'button' && n.props.role === 'tab' && n.children[0] === 'Other')[0].props.onClick();
  tree5 = app5.renderCycle();
  assert.ok(collectText(tree5).some((t) => t.includes('No roles in this group yet.')), 'empty group must show an empty state with the next step');
  app5.unmount();
});

await test('client.js: unchanged notice, invalid-card warning banner and server-timing legend line render through the VM harness', async () => {
  const baseRoles = [
    { id: 'planner', name: 'planner', description: 'Plans', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 },
    { id: 'alpha-custom', name: 'alpha-custom', description: 'Custom A', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 1000 }
  ];
  const catalogReply = {
    ok: true,
    available: true,
    degraded: false,
    default: null,
    groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }, { id: 'flash-b', name: 'Flash B' }] }]
  };
  let routeMode = 'unchanged';
  const vm = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) {
      return new Response(JSON.stringify({ ok: true, roles: baseRoles, invalid: [{ id: 'broken-card', error: 'bad yaml' }] }), {
        status: 200,
        headers: { 'server-timing': 'reads;dur=12.3' }
      });
    }
    if (url.startsWith(`/api/${NS}.catalog`)) {
      return new Response(JSON.stringify(catalogReply), { status: 200, headers: { 'server-timing': 'catalog;dur=45.6' } });
    }
    if (url.startsWith(`/api/${NS}.efforts`)) {
      return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    }
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const base = baseRoles.find((r) => r.id === payload.id);
      if (routeMode === 'unchanged') {
        return new Response(JSON.stringify({ ok: true, unchanged: true, role: { ...base, disabled: payload.disabled ?? base.disabled } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, role: { ...base, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  let tree = await app.settle();

  const bannerTexts = collectText(tree).filter((t) => t.includes('invalid frontmatter'));
  assert.ok(bannerTexts.length > 0, 'the invalid-card warning banner must render');
  assert.ok(bannerTexts.some((t) => t.includes('broken-card')), 'the banner must name the invalid card');
  const legendTexts = collectText(tree).filter((t) => t.includes('Server timing'));
  assert.ok(legendTexts.length > 0, 'the server-timing legend line must render');
  assert.ok(legendTexts.some((t) => t.includes('12.3') && t.includes('45.6')), 'the legend must show the captured reads and catalog durations');

  findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable alpha-custom')[0].props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  const alphaSave = findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save alpha-custom settings')[0];
  assert.equal(alphaSave.props.disabled, false);
  await alphaSave.props.onClick();
  tree = app.renderCycle();
  const unchangedPost = vm.fetchCalls.filter((c) => c.url === `/api/${NS}.route`).at(-1);
  assert.deepEqual(JSON.parse(unchangedPost.opts.body), { id: 'alpha-custom', expectedMtimeMs: 1000, disabled: true }, 'the unchanged save must still carry expectedMtimeMs');
  assert.ok(collectText(tree).some((t) => t.includes('Already up to date — nothing was written.')), 'the unchanged notice must render');
  assert.equal(findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable alpha-custom')[0].props.checked, true, 'the returned role must be applied to the row');
  assert.equal(findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save alpha-custom settings')[0].props.disabled, true, 'the applied role must leave the draft clean');

  routeMode = 'ok';
  findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable planner')[0].props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  await findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save planner settings')[0].props.onClick();
  tree = app.renderCycle();
  assert.ok(collectText(tree).some((t) => t.includes('Saved — applies on the next turn / next subagent_role.')), 'a normal save must still render SAVE_NOTICE');
  app.unmount();
});

await test('client.js: untrusted catalog and card strings render as text, never as HTML', async () => {
  const markup = '<img src=x onerror=alert(1)>"\'&';
  const vm = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) {
      return new Response(JSON.stringify({
        ok: true,
        roles: [{ id: 'markup-role', name: markup, description: markup, provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 }],
        invalid: [{ id: markup, error: markup }]
      }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.catalog`)) {
      return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: markup, models: [{ id: 'flash-a', name: markup }] }] }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.efforts`)) {
      return new Response(JSON.stringify({ ok: true, defaultEffort: null, efforts: [{ id: 'high', name: markup, description: markup }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  const tree = await app.settle();
  const texts = collectText(tree);
  assert.ok(texts.some((t) => t.includes('<img src=x onerror=alert(1)>')), 'markup in role/catalog strings must survive as literal text');
  assert.ok(texts.some((t) => t.includes('invalid frontmatter') && t.includes('<img src=x onerror=alert(1)>')), 'the invalid banner must render the markup id as text');
  const htmlProps = findNodes(tree, (n) => n.props && (n.props.dangerouslySetInnerHTML !== undefined || n.props.innerHTML !== undefined));
  assert.equal(htmlProps.length, 0, 'no node may carry an HTML-injection prop');
  app.unmount();
});

const PANEL_KEYS = [
  'nav.label',
  'header.title',
  'header.countsTitle',
  'header.countRoles',
  'header.countRouted',
  'header.countInherit',
  'header.countDisabled',
  'refresh',
  'refresh.busy',
  'refresh.aria',
  'tab.all',
  'phase.discovery',
  'phase.planning',
  'phase.verification',
  'phase.other',
  'tablist.aria',
  'status.routed',
  'status.inherit',
  'status.disabled',
  'card.disabledSuffix',
  'field.provider',
  'field.providerHelp',
  'field.providerAria',
  'field.model',
  'field.modelHelp',
  'field.modelAria',
  'field.effort',
  'field.effortHelp',
  'field.effortAria',
  'inherit.label',
  'effort.auto',
  'effort.loading',
  'effort.unavailable',
  'effort.default',
  'effort.none',
  'effort.savedUnavailable',
  'option.unavailable',
  'option.withId',
  'effort.errorLine',
  'disabled.label',
  'disabled.aria',
  'save',
  'save.busy',
  'save.aria',
  'notice.saved',
  'notice.unchanged',
  'error.conflict',
  'banner.loadError',
  'banner.catalogError',
  'banner.invalidCards',
  'banner.partialCatalog',
  'banner.partialCatalogGeneric',
  'banner.catalogEmpty',
  'legend.summary',
  'legend.provider',
  'legend.providerText',
  'legend.model',
  'legend.modelText',
  'legend.effort',
  'legend.effortText',
  'legend.disabled',
  'legend.disabledText',
  'legend.inherit',
  'legend.inheritText',
  'legend.subagent',
  'legend.apply',
  'legend.timing',
  'empty.loading',
  'empty.noRoles',
  'empty.noGroup',
  'locale.auto',
  'locale.aria'
];

const FROZEN_PACK_FILES = [
  'CHANGELOG.md',
  'client.js',
  'cordis.patch.yml',
  'craft/agents/arch-advisor.md',
  'craft/agents/browser-qa.md',
  'craft/agents/debt-auditor.md',
  'craft/agents/debugger.md',
  'craft/agents/diff-reviewer.md',
  'craft/agents/docs-scout.md',
  'craft/agents/docs-sync.md',
  'craft/agents/error-auditor.md',
  'craft/agents/implementer.md',
  'craft/agents/media-analyst.md',
  'craft/agents/perf-auditor.md',
  'craft/agents/plan-auditor.md',
  'craft/agents/planner.md',
  'craft/agents/repo-scout.md',
  'craft/agents/run-conductor.md',
  'craft/agents/scope-analyst.md',
  'craft/agents/security-auditor.md',
  'craft/agents/tech-writer.md',
  'craft/agents/test-auditor.md',
  'craft/agents/test-writer.md',
  'craft/README.md',
  'craft/skills/dev-flow/agents/arch-advisor.md',
  'craft/skills/dev-flow/agents/browser-qa.md',
  'craft/skills/dev-flow/agents/debt-auditor.md',
  'craft/skills/dev-flow/agents/debugger.md',
  'craft/skills/dev-flow/agents/diff-reviewer.md',
  'craft/skills/dev-flow/agents/docs-scout.md',
  'craft/skills/dev-flow/agents/docs-sync.md',
  'craft/skills/dev-flow/agents/error-auditor.md',
  'craft/skills/dev-flow/agents/implementer.md',
  'craft/skills/dev-flow/agents/media-analyst.md',
  'craft/skills/dev-flow/agents/perf-auditor.md',
  'craft/skills/dev-flow/agents/plan-auditor.md',
  'craft/skills/dev-flow/agents/planner.md',
  'craft/skills/dev-flow/agents/repo-scout.md',
  'craft/skills/dev-flow/agents/run-conductor.md',
  'craft/skills/dev-flow/agents/scope-analyst.md',
  'craft/skills/dev-flow/agents/security-auditor.md',
  'craft/skills/dev-flow/agents/tech-writer.md',
  'craft/skills/dev-flow/agents/test-auditor.md',
  'craft/skills/dev-flow/agents/test-writer.md',
  'craft/skills/dev-flow/playbooks/ai-estimates.md',
  'craft/skills/dev-flow/playbooks/clonedeps.md',
  'craft/skills/dev-flow/playbooks/codemap.md',
  'craft/skills/dev-flow/playbooks/codemap/scripts/codemap.mjs',
  'craft/skills/dev-flow/playbooks/deanchor.md',
  'craft/skills/dev-flow/playbooks/deepwork.md',
  'craft/skills/dev-flow/playbooks/reflect.md',
  'craft/skills/dev-flow/playbooks/simplify.md',
  'craft/skills/dev-flow/playbooks/step-back.md',
  'craft/skills/dev-flow/playbooks/verification-planning.md',
  'craft/skills/dev-flow/SKILL.md',
  'docs/DETAIL.md',
  'docs/preview.svg',
  'docs/showcase.svg',
  'icon.svg',
  'index.js',
  'LICENSE',
  'locale/en.json',
  'locale/pt-BR.json',
  'locale/zh.json',
  'package.json',
  'README.md',
  'README.pt-BR.md',
  'README.zh-CN.md',
  'scripts/test.mjs'
];

const localePanelOf = (lang) => JSON.parse(readFileSync(path.join(packageDir, 'locale', `${lang}.json`), 'utf8')).panel;

await test('locale parity: en/pt-BR/zh panel key sets identical, values non-empty, frozen 72-key schema, meta preserved', () => {
  const langs = ['en', 'pt-BR', 'zh'];
  const docs = langs.map((lang) => JSON.parse(readFileSync(path.join(packageDir, 'locale', `${lang}.json`), 'utf8')));
  for (const [index, doc] of docs.entries()) {
    const lang = langs[index];
    assert.ok(doc.panel && typeof doc.panel === 'object' && !Array.isArray(doc.panel), `locale/${lang}.json must carry a panel object`);
    assert.deepEqual(Object.keys(doc.panel).sort(), [...PANEL_KEYS].sort(), `locale/${lang}.json panel keys must match the frozen 72-key schema`);
    for (const key of PANEL_KEYS) {
      assert.equal(typeof doc.panel[key], 'string', `locale/${lang}.json panel.${key} must be a string`);
      assert.ok(doc.panel[key].trim().length > 0, `locale/${lang}.json panel.${key} must be non-empty`);
    }
    assert.equal(typeof doc.meta?.title, 'string', `locale/${lang}.json meta.title must stay a string`);
    assert.ok(doc.meta.title.length > 0, `locale/${lang}.json meta.title must be non-empty`);
    assert.equal(typeof doc.meta?.description, 'string', `locale/${lang}.json meta.description must stay a string`);
    assert.ok(doc.meta.description.length > 0, `locale/${lang}.json meta.description must be non-empty`);
    assert.equal(doc.meta.detail, 'docs/DETAIL.md', `locale/${lang}.json meta.detail must stay docs/DETAIL.md`);
  }
  const enPanel = docs[0].panel;
  assert.equal(enPanel['notice.saved'], 'Saved — applies on the next turn / next subagent_role.');
  assert.equal(enPanel['error.conflict'], 'Conflict/validation error (409): {detail}. Click "Refresh" to reload the latest state before saving.');
  assert.equal(enPanel['header.countRoles'], ' roles · ');
  assert.equal(enPanel['legend.timing'], 'Server timing — roles: {reads} ms · catalog: {catalog} ms');
});

await test('locale registration: embedded dictionaries sync with locale JSON panel sections; pt mirrors pt-BR; addLanguage pt-BR; inject slots+locale', async () => {
  let probeModule = null;
  const probeStorage = new Map();
  const probeSandbox = createContext({
    window: {
      __ModuleLoader__: {
        load(mod) { probeModule = mod; }
      },
      localStorage: {
        getItem: (key) => (probeStorage.has(key) ? probeStorage.get(key) : null),
        setItem: (key, value) => { probeStorage.set(key, String(value)); },
        removeItem: (key) => { probeStorage.delete(key); }
      }
    }
  });
  runInContext(source, probeSandbox);
  const probePlugin = probeModule.factory(() => ({ createElement() {}, useState() {}, useEffect() {} }));
  assert.deepEqual([...probePlugin.inject], ['slots', 'locale'], 'the plugin must inject slots and locale');

  const registrationHandler = async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) {
      return new Response(JSON.stringify({ ok: true, roles: [{ id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 }] }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.catalog`)) {
      return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };
  const vm = mountVmClient(registrationHandler);
  const realmNormalize = (value) => JSON.parse(JSON.stringify(value ?? null));
  const registrations = vm.locale.registrations.filter((entry) => entry.ns === NS);
  assert.equal(registrations.length, 4, 'the plugin must register exactly 4 faces for its namespace');
  assert.deepEqual(registrations.map((entry) => entry.locale).sort(), ['en', 'pt', 'pt-BR', 'zh'], 'the registered locales must be en, pt-BR, pt and zh');
  const faceOf = (locale) => registrations.find((entry) => entry.locale === locale)?.dict;
  assert.deepEqual(realmNormalize(faceOf('en')), localePanelOf('en'), 'the registered en face must equal the en JSON panel');
  assert.deepEqual(realmNormalize(faceOf('pt-BR')), localePanelOf('pt-BR'), 'the registered pt-BR face must equal the pt-BR JSON panel');
  assert.deepEqual(realmNormalize(faceOf('pt')), localePanelOf('pt-BR'), 'the pt face must mirror the pt-BR panel');
  assert.deepEqual(realmNormalize(faceOf('zh')), localePanelOf('zh'), 'the registered zh face must equal the zh JSON panel');
  assert.deepEqual(realmNormalize(vm.locale.languages.find((entry) => entry.id === 'pt-BR')), { id: 'pt-BR', label: 'Português (BR)', fallback: 'en' }, 'addLanguage must offer pt-BR with an en fallback');
  const app = vm.mountInstance();
  const tree = await app.settle();
  assert.ok(collectText(tree).includes(localePanelOf('en')['header.title']), 'the panel must mount and render with the locale stub');
  app.unmount();

  const vmDegraded = mountVmClient(registrationHandler, { addLanguageThrows: true });
  assert.equal(vmDegraded.locale.registrations.filter((entry) => entry.ns === NS).length, 4, 'addLanguage failure must not drop dictionary registrations');
  assert.equal(vmDegraded.locale.languages.length, 0, 'a throwing addLanguage must record no language');
  const appDegraded = vmDegraded.mountInstance();
  const treeDegraded = await appDegraded.settle();
  assert.ok(collectText(treeDegraded).includes(localePanelOf('en')['header.title']), 'the panel must still render when addLanguage throws');
  appDegraded.unmount();
});

await test('i18n structural gate: every panel string renders through t (sentinel bind) and all 72 keys are covered across driven states', async () => {
  const enDoc = JSON.parse(readFileSync(path.join(packageDir, 'locale', 'en.json'), 'utf8'));
  assert.ok(enDoc.panel && typeof enDoc.panel === 'object' && !Array.isArray(enDoc.panel), 'locale/en.json must carry a panel object for the key-coverage gate');
  const requiredKeys = Object.keys(enDoc.panel);

  const gateRoles = [
    { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 },
    { id: 'alpha-custom', name: 'alpha-custom', description: 'Custom A', provider: null, model: 'inherit', reasoningEffort: null, disabled: true, mtimeMs: 1000 },
    { id: 'zeta-custom', name: 'zeta-custom', description: 'Custom Z', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 1000 }
  ];
  const gateCatalog = { ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }, { id: 'flash-b', name: 'Flash B' }] }] };
  const gateEfforts = { ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] };
  const allowedData = new Set([
    'planner', 'alpha-custom', 'zeta-custom', 'ghost-role',
    'Plans the work', 'Custom A', 'Custom Z', 'Ghost route',
    EXAMPLE_HUB, 'Example Hub', 'flash-a', 'flash-b', 'Flash A', 'Flash B', 'high', 'High',
    'English', 'Português (BR)', '简体中文',
    '—', '', '0', '1', '2', '3'
  ]);
  const observedKeys = new Set();
  const sentinelRe = /^⟦([A-Za-z][A-Za-z0-9.]*)⟧$/;
  const checkValue = (value) => {
    const match = sentinelRe.exec(value);
    if (match) {
      observedKeys.add(match[1]);
      return;
    }
    assert.ok(allowedData.has(value), `raw UI string ${JSON.stringify(value)} must render through t or be exact fixture data`);
  };
  const scanTree = (node) => {
    if (typeof node === 'string' || typeof node === 'number') {
      checkValue(String(node));
      return;
    }
    if (node && typeof node === 'object') {
      for (const prop of ['aria-label', 'title']) {
        const value = node.props?.[prop];
        if (typeof value === 'string') checkValue(value);
      }
      for (const child of node.children ?? []) scanTree(child);
    }
  };
  const cardOf = (tree, id) => findNodes(tree, (n) => n.props?.key === id)[0];
  const checkboxOf = (card) => findNodes(card, (n) => n.type === 'input' && n.props.type === 'checkbox')[0];
  const saveOf = (card) => findNodes(card, (n) => n.type === 'button' && n.props['aria-label'] === '⟦save.aria⟧')[0];

  let routeMode = 'ok';
  let holdRoute = null;
  let holdRoles = null;
  const gateHandler = async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) {
      if (holdRoles) {
        return new Promise((resolve) => {
          holdRoles = () => resolve(new Response(JSON.stringify({ ok: true, roles: gateRoles }), { status: 200 }));
        });
      }
      return new Response(JSON.stringify({ ok: true, roles: gateRoles }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify(gateEfforts), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const base = gateRoles.find((role) => role.id === payload.id);
      if (holdRoute) {
        return new Promise((resolve) => {
          holdRoute = () => resolve(new Response(JSON.stringify({ ok: true, role: { ...base, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 }));
        });
      }
      if (routeMode === '409') return new Response(JSON.stringify({ ok: false, error: 'stale mtime' }), { status: 409 });
      if (routeMode === 'unchanged') return new Response(JSON.stringify({ ok: true, unchanged: true, role: { ...base, disabled: payload.disabled ?? base.disabled } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, role: { ...base, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };

  const vm1 = mountVmClient(gateHandler, { sentinelBind: true });
  const app1 = vm1.mountInstance();
  assert.equal(app1.meta.label(), '⟦nav.label⟧', 'the nav label must resolve through bind');
  checkValue(app1.meta.label());
  let tree1 = await app1.settle();
  scanTree(tree1);

  checkboxOf(cardOf(tree1, 'zeta-custom')).props.onChange({ target: { checked: true } });
  tree1 = app1.renderCycle();
  holdRoute = true;
  const savePending = saveOf(cardOf(tree1, 'zeta-custom')).props.onClick();
  tree1 = await app1.settle(false);
  scanTree(tree1);
  assert.ok(collectText(tree1).includes('⟦save.busy⟧'), 'an in-flight save must render save.busy through t');
  holdRoute();
  holdRoute = null;
  await savePending;
  tree1 = await app1.settle();
  scanTree(tree1);
  assert.ok(collectText(tree1).includes('⟦notice.saved⟧'), 'a successful save must render notice.saved through t');

  holdRoles = true;
  findNodes(tree1, (n) => n.type === 'button' && n.props['aria-label'] === '⟦refresh.aria⟧')[0].props.onClick();
  tree1 = await app1.settle(false);
  scanTree(tree1);
  assert.ok(collectText(tree1).includes('⟦refresh.busy⟧'), 'an in-flight refresh must render refresh.busy through t');
  holdRoles();
  holdRoles = null;
  tree1 = await app1.settle();
  scanTree(tree1);

  routeMode = '409';
  checkboxOf(cardOf(tree1, 'zeta-custom')).props.onChange({ target: { checked: true } });
  tree1 = app1.renderCycle();
  await saveOf(cardOf(tree1, 'zeta-custom')).props.onClick();
  tree1 = app1.renderCycle();
  scanTree(tree1);
  assert.ok(collectText(tree1).includes('⟦error.conflict⟧'), 'a 409 save must render error.conflict through t');

  routeMode = 'unchanged';
  await saveOf(cardOf(tree1, 'zeta-custom')).props.onClick();
  tree1 = app1.renderCycle();
  scanTree(tree1);
  assert.ok(collectText(tree1).includes('⟦notice.unchanged⟧'), 'an unchanged save must render notice.unchanged through t');
  app1.unmount();

  const vmTiming = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: gateRoles }), { status: 200, headers: { 'server-timing': 'reads;dur=12.3' } });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200, headers: { 'server-timing': 'catalog;dur=45.6' } });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify(gateEfforts), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }, { sentinelBind: true });
  const appTiming = vmTiming.mountInstance();
  const treeTiming = await appTiming.settle();
  scanTree(treeTiming);
  assert.ok(collectText(treeTiming).includes('⟦legend.timing⟧'), 'server-timing responses must render legend.timing through t');
  appTiming.unmount();

  let resolveEffort = null;
  let effortStarted = null;
  const effortReady = new Promise((resolve) => { effortStarted = resolve; });
  const vmEffort = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: [gateRoles[0]] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) {
      return new Promise((resolve) => {
        resolveEffort = resolve;
        effortStarted();
      });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }, { sentinelBind: true });
  const appEffort = vmEffort.mountInstance();
  await appEffort.settle(false);
  await effortReady;
  let treeEffort = appEffort.renderCycle();
  scanTree(treeEffort);
  assert.ok(collectText(treeEffort).includes('⟦effort.loading⟧'), 'a held efforts fetch must render effort.loading through t');
  resolveEffort(new Response(JSON.stringify({ ok: false, error: 'temp down' }), { status: 503 }));
  treeEffort = await appEffort.settle();
  scanTree(treeEffort);
  assert.ok(collectText(treeEffort).includes('⟦effort.unavailable⟧'), 'a failed efforts fetch must render effort.unavailable through t');
  assert.ok(collectText(treeEffort).includes('⟦effort.errorLine⟧'), 'a failed efforts fetch must render effort.errorLine through t');
  appEffort.unmount();

  const vmStates = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) {
      return new Response(JSON.stringify({
        ok: true,
        roles: [
          { ...gateRoles[0], reasoningEffort: 'xhigh' },
          { id: 'ghost-role', name: 'ghost-role', description: 'Ghost route', provider: 'ghost', model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 },
          gateRoles[2]
        ]
      }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: null, efforts: [] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }, { sentinelBind: true });
  const appStates = vmStates.mountInstance();
  const treeStates = await appStates.settle();
  scanTree(treeStates);
  for (const key of ['effort.none', 'effort.auto', 'effort.savedUnavailable', 'option.unavailable']) {
    assert.ok(collectText(treeStates).includes(`⟦${key}⟧`), `${key} must render through t in the effort/provider edge states`);
  }
  appStates.unmount();

  const vmEmpty = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: [] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }, { sentinelBind: true });
  const appEmpty = vmEmpty.mountInstance();
  const treeInitial = appEmpty.renderCycle();
  scanTree(treeInitial);
  assert.ok(collectText(treeInitial).includes('⟦empty.loading⟧'), 'the initial render must show empty.loading through t');
  const treeEmpty = await appEmpty.settle();
  scanTree(treeEmpty);
  assert.ok(collectText(treeEmpty).includes('⟦empty.noRoles⟧'), 'an empty role list must render empty.noRoles through t');
  appEmpty.unmount();

  const vmGroup = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: [gateRoles[0]] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify(gateEfforts), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }, { sentinelBind: true });
  const appGroup = vmGroup.mountInstance();
  let treeGroup = await appGroup.settle();
  findNodes(treeGroup, (n) => n.type === 'button' && n.props.role === 'tab' && n.children[0] === '⟦phase.discovery⟧')[0].props.onClick();
  treeGroup = appGroup.renderCycle();
  scanTree(treeGroup);
  assert.ok(collectText(treeGroup).includes('⟦empty.noGroup⟧'), 'an empty phase group must render empty.noGroup through t');
  appGroup.unmount();

  const okRolesReply = () => new Response(JSON.stringify({ ok: true, roles: gateRoles }), { status: 200 });
  const bannerCases = [
    {
      roles: () => new Response(JSON.stringify({ ok: false, error: 'roles boom' }), { status: 500 }),
      catalog: () => new Response(JSON.stringify({ ok: false, error: 'catalog boom' }), { status: 500 }),
      keys: ['banner.loadError', 'banner.catalogError']
    },
    {
      roles: () => new Response(JSON.stringify({ ok: true, roles: gateRoles, invalid: [{ id: 'broken-card', error: 'bad yaml' }] }), { status: 200 }),
      catalog: () => new Response(JSON.stringify({ ...gateCatalog, degraded: true, failedProviders: ['ghost'] }), { status: 200 }),
      keys: ['banner.invalidCards', 'banner.partialCatalog']
    },
    {
      roles: okRolesReply,
      catalog: () => new Response(JSON.stringify({ ...gateCatalog, degraded: true, failedProviders: [] }), { status: 200 }),
      keys: ['banner.partialCatalogGeneric']
    },
    {
      roles: okRolesReply,
      catalog: () => new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [] }), { status: 200 }),
      keys: ['banner.catalogEmpty']
    }
  ];
  for (const bannerCase of bannerCases) {
    const vmBanner = mountVmClient(async (url) => {
      if (url.startsWith(`/api/${NS}.roles`)) return bannerCase.roles();
      if (url.startsWith(`/api/${NS}.catalog`)) return bannerCase.catalog();
      if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify(gateEfforts), { status: 200 });
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }, { sentinelBind: true });
    const appBanner = vmBanner.mountInstance();
    const treeBanner = await appBanner.settle();
    scanTree(treeBanner);
    for (const key of bannerCase.keys) {
      assert.ok(collectText(treeBanner).includes(`⟦${key}⟧`), `${key} must render through t in the banner states`);
    }
    appBanner.unmount();
  }

  const missingKeys = requiredKeys.filter((key) => !observedKeys.has(key));
  assert.deepEqual(missingKeys, [], 'every panel dictionary key must render through t in at least one driven state');
});

const PANEL_RENDERABLE_KEYS = new Set([
  'header.title', 'header.countsTitle', 'header.countRouted', 'header.countInherit', 'header.countDisabled', 'header.countRoles',
  'refresh', 'refresh.aria',
  'tab.all', 'tablist.aria',
  'phase.discovery', 'phase.planning', 'phase.verification', 'phase.other',
  'status.routed', 'status.inherit', 'status.disabled',
  'field.provider', 'field.providerHelp', 'field.model', 'field.modelHelp', 'field.effort', 'field.effortHelp', 'disabled.label', 'save',
  'inherit.label', 'effort.auto',
  'locale.auto', 'locale.aria',
  'legend.provider', 'legend.providerText', 'legend.model', 'legend.modelText', 'legend.effort', 'legend.effortText', 'legend.disabled', 'legend.disabledText', 'legend.inherit', 'legend.inheritText', 'legend.subagent', 'legend.apply', 'legend.summary'
]);

await test('panel language switch: override renders pt-BR/zh from dictionaries, Auto follows host, best-effort localStorage persists and restores, storage failure degrades to host language', async () => {
  const switchRoles = [
    { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 },
    { id: 'zeta-custom', name: 'zeta-custom', description: 'Custom Z', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 1000 }
  ];
  const switchCatalog = { ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }, { id: 'flash-b', name: 'Flash B' }] }] };
  const switchHandler = async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: switchRoles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(switchCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };
  const languageSelectOf = (tree, aria) => findNodes(tree, (n) => n.type === 'select' && n.props['aria-label'] === aria)[0];

  const vm = mountVmClient(switchHandler);
  const app = vm.mountInstance();
  let tree = await app.settle();
  assert.ok(languageSelectOf(tree, 'Panel language'), 'the header must render a panel language select labelled by locale.aria');
  const enPanel = localePanelOf('en');
  const ptPanel = localePanelOf('pt-BR');
  const zhPanel = localePanelOf('zh');
  assert.ok(collectText(tree).includes(enPanel['header.title']), 'the default render must use the host language (en)');

  languageSelectOf(tree, enPanel['locale.aria']).props.onChange({ target: { value: 'pt-BR' } });
  tree = app.renderCycle();
  assert.ok(collectText(tree).includes(ptPanel['header.title']), 'the pt-BR override must render the pt-BR dictionary header');
  assert.ok(findNodes(tree, (n) => n.type === 'button' && n.children[0] === ptPanel['save']).length > 0, 'the pt-BR override must render translated save buttons');
  assert.equal(findNodes(tree, (n) => n.type === 'button' && n.props.role === 'tab' && n.children[0] === ptPanel['phase.discovery']).length, 1, 'the pt-BR override must translate the discovery phase tab');
  assert.ok(languageSelectOf(tree, ptPanel['locale.aria']), 'the pt-BR override must translate the select aria-label');
  assert.equal(vm.storage.get('dsh-orchestrator-kit.locale'), 'pt-BR', 'the override must persist to localStorage');

  app.unmount();
  const appRemount = vm.mountInstance();
  let treeRemount = await appRemount.settle();
  assert.ok(collectText(treeRemount).includes(ptPanel['header.title']), 'a fresh instance on the same vm must restore the stored override');
  const remountSelect = languageSelectOf(treeRemount, ptPanel['locale.aria']);
  assert.ok(remountSelect, 'the restored override must keep the translated select aria-label');
  assert.equal(remountSelect.props.value, 'pt-BR', 'the restored override must select pt-BR');

  remountSelect.props.onChange({ target: { value: '' } });
  treeRemount = appRemount.renderCycle();
  assert.ok(collectText(treeRemount).includes(enPanel['header.title']), 'Auto must return to the host language');
  assert.equal(vm.storage.has('dsh-orchestrator-kit.locale'), false, 'Auto must clear the stored override');

  vm.locale.active = 'zh';
  vm.locale.revision += 1;
  for (const fn of [...vm.locale.listeners]) fn();
  treeRemount = appRemount.renderCycle();
  assert.ok(collectText(treeRemount).includes(zhPanel['header.title']), 'Auto must follow a host language switch to zh');
  const autoSelect = languageSelectOf(treeRemount, zhPanel['locale.aria']);
  assert.ok(autoSelect, 'Auto must translate the select aria-label with the host language');

  autoSelect.props.onChange({ target: { value: 'zh' } });
  treeRemount = appRemount.renderCycle();
  assert.ok(collectText(treeRemount).includes(zhPanel['header.title']), 'the zh override must render the zh dictionary');
  assert.equal(vm.storage.get('dsh-orchestrator-kit.locale'), 'zh', 'the zh override must persist to localStorage');
  appRemount.unmount();

  const vmThrow = mountVmClient(switchHandler, { storage: 'throw' });
  const appThrow = vmThrow.mountInstance();
  const treeThrow = await appThrow.settle();
  assert.ok(collectText(treeThrow).includes(enPanel['header.title']), 'storage failure must degrade to the host language without crashing');
  const throwSelect = languageSelectOf(treeThrow, enPanel['locale.aria']);
  assert.ok(throwSelect, 'the language select must still render when storage throws');
  assert.equal(throwSelect.props.value, '', 'storage failure must leave the override unset');
  throwSelect.props.onChange({ target: { value: 'pt-BR' } });
  const treeThrowSwitched = appThrow.renderCycle();
  assert.ok(collectText(treeThrowSwitched).includes(ptPanel['header.title']), 'a manual switch must still work in memory when storage throws');
  appThrow.unmount();

  const storageSeed = new Map([['dsh-orchestrator-kit.locale', 'zh']]);
  const vmRestore = mountVmClient(switchHandler, { storageMap: storageSeed });
  const appRestore = vmRestore.mountInstance();
  const treeRestore = await appRestore.settle();
  assert.ok(collectText(treeRestore).includes(zhPanel['header.title']), 'a fresh module load must restore the override from pre-seeded localStorage');
  assert.equal(languageSelectOf(treeRestore, zhPanel['locale.aria']).props.value, 'zh', 'the restored select must show the seeded override');
  appRestore.unmount();

  const vmInterp = mountVmClient(switchHandler);
  const appInterp = vmInterp.mountInstance();
  let treeInterp = await appInterp.settle();
  const interpSelect = languageSelectOf(treeInterp, enPanel['locale.aria']);
  interpSelect.props.onChange({ target: { value: 'pt-BR' } });
  treeInterp = appInterp.renderCycle();
  assert.ok(collectText(treeInterp).includes('Padrão (medium)'), 'the makeT interpolation must render the {effort} param through the pt-BR effort.default template');
  const interpNode = findNodes(treeInterp, (n) => n.type === 'option' && n.children[0] === 'Flash A (flash-a)')[0];
  assert.ok(interpNode, 'the makeT interpolation must render the {id} param in the pt-BR model option');
  appInterp.unmount();
  vmInterp.runPluginDisposers();
  assert.equal(vmInterp.locale.registrations.length, 0, 'plugin disposal must unregister every dictionary face');
  assert.equal(vmInterp.locale.languages.length, 0, 'plugin disposal must remove the added pt-BR language');

  const vmEnValues = mountVmClient(switchHandler);
  const appEnValues = vmEnValues.mountInstance();
  const treeEnValues = await appEnValues.settle();
  const enDict = localePanelOf('en');
  const scanEnValues = (node, acc) => {
    if (typeof node === 'string' || typeof node === 'number') { acc.push(String(node)); return acc; }
    if (node && typeof node === 'object') {
      for (const prop of ['aria-label', 'title']) {
        const value = node.props?.[prop];
        if (typeof value === 'string') acc.push(value);
      }
      for (const child of node.children ?? []) scanEnValues(child, acc);
    }
    return acc;
  };
  const renderedStrings = scanEnValues(treeEnValues, []).join('\n');
  for (const [key, value] of Object.entries(enDict)) {
    if (!PANEL_RENDERABLE_KEYS.has(key)) continue;
    assert.ok(renderedStrings.includes(value), 'the en value for ' + key + ' must render in the driven panel state');
  }
  appEnValues.unmount();
  vmEnValues.runPluginDisposers();
});

await test('npm pack: dry-run file list matches the frozen 69-entry contract and packed content passes the forbidden-token scan', () => {
  const dryRun = spawnSync('npm pack --dry-run --json', { cwd: packageDir, encoding: 'utf8', shell: true });
  assert.equal(dryRun.status, 0, `npm pack --dry-run must succeed: ${dryRun.stderr}`);
  const parsed = JSON.parse(dryRun.stdout);
  assert.equal(parsed[0].filename, `${PKG.name}-${PKG.version}.tgz`);
  assert.equal(parsed[0].entryCount, 69);
  assert.deepEqual(parsed[0].files.map((entry) => entry.path).sort(), [...FROZEN_PACK_FILES].sort(), 'the packed file set must match the frozen 69-entry contract');

  const tmp = mkdtempSync(path.join(tmpdir(), 'pack-scan-'));
  try {
    const packed = spawnSync('npm pack --pack-destination ' + JSON.stringify(tmp), { cwd: packageDir, encoding: 'utf8', shell: true });
    assert.equal(packed.status, 0, `npm pack must succeed: ${packed.stderr}`);
    const tarball = path.join(tmp, `${PKG.name}-${PKG.version}.tgz`);
    const extracted = spawnSync('tar', ['-xzf', tarball, '-C', tmp], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, `tar extraction must succeed: ${extracted.stderr}`);
    const packedRoot = path.join(tmp, 'package');
    const packedFiles = [];
    const visit = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile()) packedFiles.push(full);
      }
    };
    visit(packedRoot);
    const relPaths = packedFiles.map((file) => path.relative(packedRoot, file).split(path.sep).join('/')).sort();
    assert.deepEqual(relPaths, [...FROZEN_PACK_FILES].sort(), 'the extracted tarball content must match the frozen 69-entry contract');
    for (const file of packedFiles) {
      const rel = path.relative(packedRoot, file).split(path.sep).join('/');
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const token of FORBIDDEN_TOKENS) {
        assert.ok(!text.includes(token.toLowerCase()), `packed ${rel} must not contain a forbidden machine token`);
      }
      assert.ok(!text.includes(BAK_LITERAL.toLowerCase()), `packed ${rel} must not reference backup artifacts`);
    }
    const packedPkg = JSON.parse(readFileSync(path.join(packedRoot, 'package.json'), 'utf8'));
    assert.equal(packedPkg.name, PKG.name);
    assert.equal(packedPkg.version, PKG.version);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

const codemapScript = path.join(packageDir, 'craft', 'skills', 'dev-flow', 'playbooks', 'codemap', 'scripts', 'codemap.mjs');

await test('codemap.mjs: CLI/API init, changes, update, removed files, gitignore, legacy migration, symlink rejection, error propagation, and ReDoS guard', async () => {
  assert.ok(existsSync(codemapScript), `codemap.mjs must exist at ${codemapScript}`);
  const {
    PatternMatcher,
    cmdInit,
    cmdChanges,
    cmdUpdate,
    computeFileHash,
    loadState
  } = await import(pathToFileURL(codemapScript).href);

  const startMs = Date.now();
  const redosMatcher = new PatternMatcher(['**/**/**/**/**/**/**/**/**/**/**/**/**/**/**/**z']);
  assert.equal(redosMatcher.matches(`${'a/'.repeat(25)}y`), false);
  assert.ok(Date.now() - startMs < 250, 'PatternMatcher must not suffer exponential ReDoS backtracking');

  const matcher = new PatternMatcher(['**/*.md', '/root.txt', 'dist/', 'a**/b', 'x?y']);
  assert.equal(matcher.matches('docs/guide.md'), true);
  assert.equal(matcher.matches('root.txt'), true);
  assert.equal(matcher.matches('sub/root.txt'), false);
  assert.equal(matcher.matches('dist/bundle.js'), true);
  assert.equal(matcher.matches('src/dist.js'), false);
  assert.equal(matcher.matches('ab'), false);
  assert.equal(matcher.matches('x/y'), false);
  assert.equal(matcher.matches('xzy'), true);

  const repo = mkdtempSync(path.join(tmpdir(), 'craft-codemap-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'craft-codemap-out-'));
  const prevLog = console.log;
  const prevErr = console.error;
  const logs = [];
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    assert.equal(spawnSync(process.execPath, [codemapScript, 'changes', '--root', repo], { encoding: 'utf8' }).status, 1);
    assert.equal(spawnSync(process.execPath, [codemapScript, 'bogus', '--root', repo], { encoding: 'utf8' }).status, 1);

    mkdirSync(path.join(repo, 'src'), { recursive: true });
    writeFileSync(path.join(repo, '.gitignore'), 'ignored.js\n', 'utf8');
    writeFileSync(path.join(repo, 'src', 'app.js'), 'console.log(1);\n', 'utf8');
    writeFileSync(path.join(repo, 'src', 'ignored.js'), 'console.log("ign");\n', 'utf8');
    writeFileSync(path.join(repo, 'src', 'skip.js'), 'console.log("skip");\n', 'utf8');
    writeFileSync(path.join(repo, 'src', 'keep-exc.js'), 'console.log("exc");\n', 'utf8');

    const cliInit = spawnSync(
      process.execPath,
      [codemapScript, 'init', '--root', repo, '--include', 'src/**/*.js', '--exclude', 'src/skip.js', '--exclude', 'src/keep-exc.js', '--exception', 'src/keep-exc.js'],
      { encoding: 'utf8' }
    );
    assert.equal(cliInit.status, 0, `codemap CLI init failed: ${cliInit.stderr}`);
    assert.equal(existsSync(path.join(repo, '.devflow', 'maps', 'codemap.json')), true);
    assert.equal(existsSync(path.join(repo, '.codemap')), false);
    assert.match(readFileSync(path.join(repo, 'src', 'codemap.md'), 'utf8'), /implementer \/ repo-scout/);
    const initState = loadState(repo);
    assert.ok('src/app.js' in initState.file_hashes);
    assert.ok('src/keep-exc.js' in initState.file_hashes, '--exception must override --exclude');
    assert.ok(!('src/ignored.js' in initState.file_hashes), '.gitignore must exclude ignored.js');
    assert.ok(!('src/skip.js' in initState.file_hashes), '--exclude must exclude skip.js');

    const cliClean = spawnSync(process.execPath, [codemapScript, 'changes', '--root', repo], { encoding: 'utf8' });
    assert.equal(cliClean.status, 0);
    assert.match(cliClean.stdout, /No changes detected/);

    writeFileSync(path.join(repo, 'src', 'extra.js'), 'export const x = 1;\n', 'utf8');
    writeFileSync(path.join(repo, 'src', 'app.js'), 'console.log(2);\n', 'utf8');
    rmSync(path.join(repo, 'src', 'keep-exc.js'));
    const cliDiff = spawnSync(process.execPath, [codemapScript, 'changes', '--root', repo], { encoding: 'utf8' });
    assert.equal(cliDiff.status, 0);
    assert.match(cliDiff.stdout, /\+ src\/extra\.js/);
    assert.match(cliDiff.stdout, /~ src\/app\.js/);
    assert.match(cliDiff.stdout, /- src\/keep-exc\.js/);
    assert.equal(spawnSync(process.execPath, [codemapScript, 'update', '--root', repo], { encoding: 'utf8' }).status, 0);
    assert.equal(cmdChanges({ root: repo }), 0);

    assert.throws(() => computeFileHash(path.join(repo, 'does-not-exist.js')), /Cannot read file/);
    writeFileSync(path.join(repo, '.devflow', 'maps', 'codemap.json'), JSON.stringify({ metadata: { include_patterns: 'bad' } }), 'utf8');
    assert.throws(() => loadState(repo), /include_patterns must be an array/);
    writeFileSync(path.join(repo, '.devflow', 'maps', 'codemap.json'), '{broken', 'utf8');
    assert.throws(() => loadState(repo), /Failed to load/);

    const legacyRepo = mkdtempSync(path.join(tmpdir(), 'craft-codemap-legacy-'));
    try {
      mkdirSync(path.join(legacyRepo, '.codemap'), { recursive: true });
      writeFileSync(path.join(legacyRepo, '.codemap', 'codemap.json'), JSON.stringify({ metadata: { include_patterns: ['**/*'] }, file_hashes: {}, folder_hashes: {} }), 'utf8');
      writeFileSync(path.join(legacyRepo, '.codemap', 'keep.txt'), 'keep', 'utf8');
      assert.equal(cmdChanges({ root: legacyRepo }), 0);
      assert.equal(existsSync(path.join(legacyRepo, '.devflow', 'maps', 'codemap.json')), true);
      assert.equal(existsSync(path.join(legacyRepo, '.codemap', 'keep.txt')), true);
    } finally {
      rmSync(legacyRepo, { recursive: true, force: true });
    }

    const legacyEmptyRepo = mkdtempSync(path.join(tmpdir(), 'craft-codemap-empty-'));
    try {
      mkdirSync(path.join(legacyEmptyRepo, '.codemap'), { recursive: true });
      writeFileSync(path.join(legacyEmptyRepo, '.codemap', 'codemap.json'), JSON.stringify({ metadata: { include_patterns: ['**/*'] }, file_hashes: {}, folder_hashes: {} }), 'utf8');
      assert.equal(cmdChanges({ root: legacyEmptyRepo }), 0);
      assert.equal(existsSync(path.join(legacyEmptyRepo, '.devflow', 'maps', 'codemap.json')), true);
      assert.equal(existsSync(path.join(legacyEmptyRepo, '.codemap')), false);
    } finally {
      rmSync(legacyEmptyRepo, { recursive: true, force: true });
    }

    const symRepo = mkdtempSync(path.join(tmpdir(), 'craft-codemap-sym-'));
    try {
      writeFileSync(path.join(outside, 'pwn.json'), '{}', 'utf8');
      symlinkSync(outside, path.join(symRepo, '.devflow'), 'junction');
      assert.throws(() => loadState(symRepo), /symbolic link|outside repository/);
    } finally {
      rmSync(symRepo, { recursive: true, force: true });
    }
  } finally {
    console.log = prevLog;
    console.error = prevErr;
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

const craftAgentsDir = path.join(packageDir, 'craft', 'agents');
const craftMirrorDir = path.join(packageDir, 'craft', 'skills', 'dev-flow', 'agents');
const craftDevflowDir = path.join(packageDir, 'craft', 'skills', 'dev-flow');
const craftPlaybooksDir = path.join(craftDevflowDir, 'playbooks');

await test('craft-repo: 20 Craft role cards ship clean frontmatter, model: inherit on line 4, zero provider routing', () => {
  assert.ok(existsSync(craftAgentsDir), 'craft/agents must exist; the suite requires the complete craft/ tree');
  const listed = readdirSync(craftAgentsDir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name.slice(0, -3)).sort();
  assert.deepEqual(listed, [...CRAFT_ROLES].sort(), 'craft/agents must hold the exact 20 canonical Craft roles');
  for (const role of CRAFT_ROLES) {
    const card = validateCraftCard(craftAgentsDir, role);
    const lines = card.text.split('\n');
    assert.equal(lines[3], 'model: inherit', `craft/agents/${role}.md line 4 must be model: inherit`);
  }
});

await test('craft-repo: craft/agents and craft/skills/dev-flow/agents mirror bodies byte-identically (20 roles)', () => {
  assert.ok(existsSync(craftMirrorDir), 'craft/skills/dev-flow/agents must exist; the suite requires the complete craft/ tree');
  validateCraftParity(craftAgentsDir, craftMirrorDir);
});

await test('craft-repo: dev-flow SKILL.md frontmatter and the exact 9 playbooks, zero leaks', () => {
  validateCraftSkill(craftDevflowDir, 'craft/skills/dev-flow');
  validateCraftPlaybooks(craftPlaybooksDir);
  assert.ok(existsSync(path.join(craftPlaybooksDir, 'codemap', 'scripts', 'codemap.mjs')), 'the codemap playbook must ship its script');
});

await test('craft-validators: fixture pass and negative drift/legacy/provider detection', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'craft-validator-'));
  try {
    const agentsDir = path.join(root, 'agents');
    const devflowAgentsDir = path.join(root, 'mirror');
    const playbooksDir = path.join(root, 'playbooks');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(devflowAgentsDir, { recursive: true });
    mkdirSync(playbooksDir, { recursive: true });

    for (const role of CRAFT_ROLES) {
      const source = readFileSync(path.join(craftAgentsDir, `${role}.md`), 'utf8');
      writeFileSync(path.join(agentsDir, `${role}.md`), source, 'utf8');
      writeFileSync(path.join(devflowAgentsDir, `${role}.md`), source, 'utf8');
    }
    for (const playbook of CRAFT_PLAYBOOKS) {
      writeFileSync(path.join(playbooksDir, playbook), readFileSync(path.join(craftPlaybooksDir, playbook), 'utf8'), 'utf8');
    }
    validateCraftParity(agentsDir, devflowAgentsDir);
    validateCraftPlaybooks(playbooksDir);

    const drifted = readFileSync(path.join(agentsDir, 'planner.md'), 'utf8').replace('model: inherit', `provider: ${EXAMPLE_HUB}\nmodel: flash-a`);
    writeFileSync(path.join(agentsDir, 'planner.md'), drifted, 'utf8');
    assert.throws(() => validateCraftCard(agentsDir, 'planner'), /must not declare a provider/);
    writeFileSync(path.join(agentsDir, 'planner.md'), readFileSync(path.join(craftAgentsDir, 'planner.md'), 'utf8'), 'utf8');

    writeFileSync(path.join(devflowAgentsDir, 'planner.md'), `${readFileSync(path.join(devflowAgentsDir, 'planner.md'), 'utf8')}extra\n`, 'utf8');
    assert.throws(() => validateCraftParity(agentsDir, devflowAgentsDir), /byte-identical/);
    writeFileSync(path.join(devflowAgentsDir, 'planner.md'), readFileSync(path.join(craftAgentsDir, 'planner.md'), 'utf8'), 'utf8');

    const leaked = `${readFileSync(path.join(agentsDir, 'repo-scout.md'), 'utf8')}Consult Momus.\n`;
    writeFileSync(path.join(agentsDir, 'repo-scout.md'), leaked, 'utf8');
    assert.throws(() => validateCraftCard(agentsDir, 'repo-scout'), /legacy role names/);
    writeFileSync(path.join(agentsDir, 'repo-scout.md'), readFileSync(path.join(craftAgentsDir, 'repo-scout.md'), 'utf8'), 'utf8');

    const toolLeak = `${readFileSync(path.join(playbooksDir, 'reflect.md'), 'utf8')}Call spawn_teammate first.\n`;
    writeFileSync(path.join(playbooksDir, 'reflect.md'), toolLeak, 'utf8');
    assert.throws(() => validateCraftPlaybooks(playbooksDir), /removed tool or system tokens/);
    writeFileSync(path.join(playbooksDir, 'reflect.md'), readFileSync(path.join(craftPlaybooksDir, 'reflect.md'), 'utf8'), 'utf8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test('repo hygiene: no backup artifacts and zero machine tokens in any repo file', () => {
  const files = repoFiles();
  assert.ok(files.length > 0, 'the repo must contain files to scan');
  for (const file of files) {
    const rel = path.relative(packageDir, file);
    assert.ok(!BAK_SUFFIX_RE.test(rel), `${rel} must not be a backup artifact`);
    const text = readFileSync(file, 'utf8');
    if (path.basename(file) !== '.gitignore') {
      assert.ok(!text.includes(BAK_LITERAL), `${rel} must not reference backup artifacts`);
    }
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!text.toLowerCase().includes(token.toLowerCase()), `${rel} must not contain the machine token ${JSON.stringify(token)}`);
    }
  }
});

await test('rename completeness: no removed local plugin identity anywhere in the repo', () => {
  for (const file of repoFiles()) {
    const rel = path.relative(packageDir, file);
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes(OLD_PLUGIN_NAME), `${rel} must not contain the removed local plugin name`);
    assert.ok(!text.includes(OLD_PLUGIN_SCOPE), `${rel} must not reference the removed local scope`);
  }
});

console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
