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
  for (const phaseTitle of ['Discovery & Advisory', 'Planning & Execution', 'Verification, QA & Docs', 'Other']) {
    assert.ok(clientText.includes(phaseTitle), `client.js must group roles into ${phaseTitle}`);
  }
  assert.ok(clientText.includes('Refresh'), 'client.js must render Refresh button');
  assert.ok(clientText.includes('expectedMtimeMs'), 'client.js must send expectedMtimeMs');
  assert.ok(clientText.includes(`/api/${NS}.efforts`), 'client.js must query .efforts');
  assert.ok(clientText.includes('Saved — applies on the next turn / next subagent_role.'));
  assert.ok(clientText.includes('data-dsh-orchestrator-kit-settings'), 'client.js must keep its settings mount marker');
  assert.doesNotMatch(clientText, /spawn_teammate\b/, 'client.js must not name the removed spawn_teammate tool');
  assert.ok(!clientText.includes(OLD_PLUGIN_NAME), 'client.js must not keep the old local plugin identity');
  assert.ok(!clientText.includes(OLD_PLUGIN_SCOPE), 'client.js must not reference the removed local scope');
  const PT_BR_WORD_RE = /\b(desativado|desativar|provedor|modelo de|esforço|salvar|salvando|atualizar|atualizando|carregando|herdar|configuração|indisponível|padrão)\b/i;
  assert.doesNotMatch(clientText, PT_BR_WORD_RE, 'client.js UI strings must stay in English (panel ships to every locale)');
  assert.ok(!readFileSync(path.join(packageDir, 'index.js'), 'utf8').includes(OLD_PLUGIN_NAME), 'index.js must not keep the old local plugin identity');
});

await test('node --check passes on the shipped files', () => {
  for (const relative of ['index.js', 'client.js', 'scripts/test.mjs']) {
    const result = spawnSync(process.execPath, ['--check', path.join(packageDir, relative)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative} failed node --check: ${result.stderr}`);
  }
});

await test('all shipped files exist with UTF-8 no BOM and pure LF', () => {
  for (const file of ['package.json', 'cordis.patch.yml', 'index.js', 'client.js', 'scripts/test.mjs']) {
    const bytes = readFileSync(path.join(packageDir, file));
    assert.ok(!bytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), `${file} must not carry a BOM`);
    assert.ok(!bytes.toString('utf8').includes('\r\n'), `${file} must use pure LF`);
  }
});

await test('client.js: runtime module registration, phase grouping, save, 409, refresh failure retention, remount efforts, and catalog failure fallback', async () => {
  const source = readFileSync(path.join(packageDir, 'client.js'), 'utf8');

  function mountVmClient(fetchHandler) {
    let registeredModule = null;
    let injectedFactory = null;
    const slotsSection = [];
    const fetchCalls = [];
    const inflight = new Set();
    const track = (promise) => {
      inflight.add(promise);
      return promise.finally(() => inflight.delete(promise));
    };

    const sandbox = createContext({
      window: {
        __ModuleLoader__: {
          load(mod) { registeredModule = mod; }
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
      }
    });
    injectedFactory();
    const Component = slotsSection[0].component;
    const sectionMeta = slotsSection[0].meta;

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

    return { mountInstance, fetchCalls };
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
  for (const heading of ['Discovery & Advisory', 'Planning & Execution', 'Verification, QA & Docs', 'Other']) {
    assert.ok(texts.includes(heading), `rendered settings must include section heading ${heading}`);
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
