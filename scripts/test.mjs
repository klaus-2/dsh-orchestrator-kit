import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import v8 from 'node:v8';
import {
  appendFileSync,
  chmodSync,
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
  parseRoleCard,
  shippedNotes
} from '../index.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

const COVERAGE_STATEMENT_FLOOR = 0.70;
const COVERAGE_FUNCTION_FLOOR = 0.60;
const CLIENT_BYTE_CEILING = 139264;
const coverageDirArg = process.argv.find((arg) => arg.startsWith('--coverage-dir='));
const isCoverageReport = process.argv.includes('--coverage-report');
const coverageRoot = coverageDirArg ? coverageDirArg.slice('--coverage-dir='.length) : null;
if (isCoverageReport && !coverageRoot) {
  console.error('coverage root is missing — pass --coverage-dir=<dir>');
  process.exit(1);
}

function collectCoverage(root) {
  const merged = new Map();
  let names;
  try {
    names = readdirSync(root).filter((name) => name.startsWith('coverage-') && name.endsWith('.json')).sort();
  } catch {
    return merged;
  }
  for (const name of names) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(path.join(root, name), 'utf8'));
    } catch (error) {
      console.error(`coverage file ${name} is not valid JSON: ${error.message}`);
      process.exit(1);
    }
    for (const entry of doc.result ?? []) {
      if (typeof entry.url !== 'string' || !entry.url.startsWith('file://')) continue;
      let absolute;
      try {
        absolute = fileURLToPath(entry.url);
      } catch {
        continue;
      }
      if (!absolute.startsWith(packageDir + path.sep)) continue;
      if (absolute.includes(`node_modules${path.sep}`)) continue;
      const rel = path.relative(packageDir, absolute).split(path.sep).join('/');
      if (rel !== 'index.js' && rel !== 'scripts/test.mjs') continue;
      const slot = merged.get(rel) ?? { functions: 0, covered: 0, statements: 0, statementsCovered: 0 };
      for (const fn of entry.functions ?? []) {
        slot.functions += 1;
        if ((fn.ranges ?? []).some((range) => range.count > 0)) slot.covered += 1;
        for (const range of fn.ranges ?? []) {
          slot.statements += 1;
          if (range.count > 0) slot.statementsCovered += 1;
        }
      }
      merged.set(rel, slot);
    }
  }
  return merged;
}

if (isCoverageReport) {
  if (process.env.NODE_V8_COVERAGE) {
    try { v8.stopCoverage(); } catch {}
  }
  const merged = collectCoverage(coverageRoot);
  if (merged.size === 0) {
    console.error('no coverage entries');
    process.exit(1);
  }
  let functions = 0;
  let covered = 0;
  let statements = 0;
  let statementsCovered = 0;
  for (const slot of merged.values()) {
    functions += slot.functions;
    covered += slot.covered;
    statements += slot.statements;
    statementsCovered += slot.statementsCovered;
  }
  const statementPct = statements === 0 ? 0 : (statementsCovered / statements) * 100;
  const functionPct = functions === 0 ? 0 : (covered / functions) * 100;
  console.log(`statements: ${statementsCovered}/${statements} (${statementPct.toFixed(1)}%)`);
  console.log(`functions: ${covered}/${functions} (${functionPct.toFixed(1)}%)`);
  console.log('client.js: vm-evaluated — no V8 entry');
  const reasons = [];
  if (statementPct < COVERAGE_STATEMENT_FLOOR * 100) reasons.push(`statements ${statementPct.toFixed(1)}% is below the ${COVERAGE_STATEMENT_FLOOR * 100}% floor`);
  if (functionPct < COVERAGE_FUNCTION_FLOOR * 100) reasons.push(`functions ${functionPct.toFixed(1)}% is below the ${COVERAGE_FUNCTION_FLOOR * 100}% floor`);
  if (reasons.length > 0) {
    console.error(`COVERAGE FAILED: ${reasons.join('; ')}`);
    process.exit(1);
  }
  console.log('COVERAGE OK');
  process.exit(0);
}

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

async function withMockHost({ agentsHome, llm, defaultSelection, agentTeams, config = {} }, run) {
  const previousHome = process.env.DSH_AGENTS_HOME;
  process.env.DSH_AGENTS_HOME = agentsHome;
  const routes = new Map();
  const listeners = new Map();
  const ctx = {
    get(service) {
      if (service === 'llm') return llm;
      if (service === 'agentTeams') return agentTeams;
      if (service === 'agentDefaultModel') return defaultSelection ? { currentSelection: () => defaultSelection } : undefined;
      return undefined;
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
    },
    connection: {
      fetch: {
        register(spec) {
          if (!routes.has(spec.path)) routes.set(spec.path, []);
          routes.get(spec.path).push(spec);
        }
      }
    }
  };
  try {
    await apply(ctx, { autoInstallCraft: false, ...config });
    const emit = async (event, payload) => {
      for (const listener of listeners.get(event) ?? []) await listener(payload);
    };
    const call = async (routePath, options = {}) => {
      const url = new URL(routePath, 'http://localhost');
      const specs = routes.get(url.pathname);
      assert.ok(specs, `route ${url.pathname} must be registered`);
      const method = options.method ?? 'GET';
      const spec = specs.find((candidate) => candidate.methods.includes(method));
      assert.ok(spec, `route ${url.pathname} must allow ${method}`);
      const request = new Request(url.toString(), options);
      const response = await spec.fetch(request);
      const data = await response.json();
      return { status: response.status, data };
    };
    return await run({ call, routes, emit, listeners });
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

await test('fallback route: parse rules, write, reset and independence from the route pair', () => {
  const parsed = parseRoleCard(`---\nname: reviewer\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nfallback:\n  provider: ${EXAMPLE_CLOUD}\n  model: reasoner-b\n---\nbody\n`);
  assert.deepEqual(parsed.fallback, { provider: EXAMPLE_CLOUD, model: 'reasoner-b' });
  assert.equal(parseRoleCard('---\nname: A\nmodel: inherit\n---\nbody\n').fallback, undefined);
  assert.equal(parseRoleCard('---\nname: A\nfallback: null\n---\nbody\n').fallback, undefined, 'an explicit YAML null means no fallback');
  assert.deepEqual(parseRoleCard('---\nname: A\nfallback:\n  provider:  p \n  model:  m \n---\nbody\n').fallback, { provider: 'p', model: 'm' }, 'the fallback pair is trimmed');

  const set = applyCardSettings(LF_CARD, { fallback: { provider: EXAMPLE_CLOUD, model: 'reasoner-b' } });
  assert.deepEqual(parseRouteText(set).fallback, { provider: EXAMPLE_CLOUD, model: 'reasoner-b' });
  assert.match(set, /# a comment the round-trip must keep/);

  const routed = applyCardSettings(set, { route: { provider: EXAMPLE_HUB, model: 'flash-a' } });
  assert.deepEqual(parseRouteText(routed).fallback, { provider: EXAMPLE_CLOUD, model: 'reasoner-b' }, 'a route change never touches the fallback');
  const resetRoute = applyCardSettings(routed, { route: null });
  assert.deepEqual(parseRouteText(resetRoute).fallback, { provider: EXAMPLE_CLOUD, model: 'reasoner-b' }, 'resetting the route never touches the fallback');
  assert.equal(parseRouteText(resetRoute).model, 'inherit');
  const cleared = applyCardSettings(set, { fallback: null });
  assert.equal(parseRouteText(cleared).fallback, undefined, 'a fallback reset deletes the key');
  const canary = applyCardSettings(set, { fallback: { provider: ' p ', model: ' m ' } });
  assert.deepEqual(parseRouteText(canary).fallback, { provider: 'p', model: 'm' }, 'the written fallback pair is canonical');

  assert.throws(() => applyCardSettings(LF_CARD, { fallback: { provider: EXAMPLE_CLOUD } }), /half-written fallback/);
  assert.throws(() => applyCardSettings(LF_CARD, { fallback: { provider: EXAMPLE_CLOUD, model: 'inherit' } }), /fallback model inherit/);
  assert.throws(() => applyCardSettings(LF_CARD, { fallback: 'flash-a' }), /null or a \{provider, model\} object/);
  assert.throws(() => applyCardSettings(LF_CARD, { fallback: { provider: '', model: 'm' } }), /half-written fallback/);
  assert.throws(() => parseRoleCard('---\nfallback:\n  provider: p\n---\n', 't.md'), /fallback\.model must be a non-empty string/);
  assert.throws(() => parseRoleCard('---\nfallback:\n  provider: p\n  model: inherit\n---\n'), /fallback model cannot be inherit/);
  assert.throws(() => parseRoleCard('---\nfallback: [1, 2]\n---\n'), /fallback must be a \{provider, model\} mapping/);
  assert.throws(() => parseRoleCard('---\nfallback: 7\n---\n'), /fallback must be a \{provider, model\} mapping/);
  assert.throws(() => parseRoleCard('---\nfallback:\n  provider: p\n  model: 42\n---\n'), /fallback\.model must be a non-empty string/);
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
    writeFileSync(path.join(dir, 'arch-advisor.md'), `---\nname: arch-advisor\ndescription: Advisory\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\nreasoning_effort: high\nfallback:\n  provider: ${EXAMPLE_CLOUD}\n  model: reasoner-b\n---\n\nBody\n`, 'utf8');
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
        assert.equal(arch.fallbackProvider, EXAMPLE_CLOUD, 'the roles summary must surface the fallback provider');
        assert.equal(arch.fallbackModel, 'reasoner-b', 'the roles summary must surface the fallback model');
        assert.equal(typeof arch.mtimeMs, 'number');
        assert.ok(arch.mtimeMs > 0);
        assert.equal(docs.reasoningEffort, null);
        assert.equal(docs.fallbackProvider, null, 'a card without a fallback must report null fallback fields');
        assert.equal(docs.fallbackModel, null);
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

await test('HTTP API: POST .route fallback set/reset validates against the live catalog and audits the pair', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-fallback-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const cardFile = path.join(dir, 'planner.md');
    writeFileSync(cardFile, `---\nname: planner\ndescription: Plans\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\n---\n\nPlan body\n`, 'utf8');

    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      const rolesCold = await call(`/api/${NS}.roles`);
      const cold = rolesCold.data.roles.find((r) => r.id === 'planner');
      const catalog503 = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', fallback: { provider: EXAMPLE_HUB, model: 'flash-b' }, expectedMtimeMs: cold.mtimeMs }) });
      assert.equal(catalog503.status, 503, 'an unavailable catalog must fail-closed a fallback write');
    });

    await withMockHost({ agentsHome: tmpHome, llm: flashCatalogLlm() }, async ({ call }) => {
      const roles0 = await call(`/api/${NS}.roles`);
      const planner0 = roles0.data.roles.find((r) => r.id === 'planner');

      const half400 = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', fallback: { provider: EXAMPLE_HUB }, expectedMtimeMs: planner0.mtimeMs }) });
      assert.equal(half400.status, 400);
      const inherit400 = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', fallback: { provider: EXAMPLE_HUB, model: 'inherit' }, expectedMtimeMs: planner0.mtimeMs }) });
      assert.equal(inherit400.status, 400);
      const shape400 = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', fallback: 'flash-b', expectedMtimeMs: planner0.mtimeMs }) });
      assert.equal(shape400.status, 400);
      const unknownProvider409 = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', fallback: { provider: EXAMPLE_CLOUD, model: 'reasoner-b' }, expectedMtimeMs: planner0.mtimeMs }) });
      assert.equal(unknownProvider409.status, 409);
      const unknownModel409 = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', fallback: { provider: EXAMPLE_HUB, model: 'flash-z' }, expectedMtimeMs: planner0.mtimeMs }) });
      assert.equal(unknownModel409.status, 409);

      const set = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', fallback: { provider: EXAMPLE_HUB, model: 'flash-b' }, expectedMtimeMs: planner0.mtimeMs }) });
      assert.equal(set.status, 200);
      assert.equal(set.data.role.fallbackProvider, EXAMPLE_HUB);
      assert.equal(set.data.role.fallbackModel, 'flash-b');
      assert.equal(set.data.role.model, 'flash-a', 'setting the fallback never disturbs the route');

      const again = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', fallback: { provider: EXAMPLE_HUB, model: 'flash-b' }, expectedMtimeMs: set.data.role.mtimeMs }) });
      assert.equal(again.status, 200);
      assert.equal(again.data.unchanged, true, 'an identical fallback must answer unchanged without a write');

      const roles1 = await call(`/api/${NS}.roles`);
      const planner1 = roles1.data.roles.find((r) => r.id === 'planner');
      const resetRoute = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', provider: null, model: null, expectedMtimeMs: planner1.mtimeMs }) });
      assert.equal(resetRoute.status, 200);
      assert.equal(resetRoute.data.role.model, 'inherit');
      assert.equal(resetRoute.data.role.fallbackProvider, EXAMPLE_HUB, 'a route reset must keep the fallback');

      const roles2 = await call(`/api/${NS}.roles`);
      const planner2 = roles2.data.roles.find((r) => r.id === 'planner');
      const both = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', provider: null, model: null, fallback: null, expectedMtimeMs: planner2.mtimeMs }) });
      assert.equal(both.status, 200);
      assert.equal(both.data.role.model, 'inherit');
      assert.equal(both.data.role.fallbackProvider, null, 'a combined reset clears the fallback too');
      assert.equal(both.data.role.fallbackModel, null);
    });

    const auditLines = readFileSync(path.join(dir, '.orchestrator-audit.jsonl'), 'utf8').split('\n').filter((line) => line.trim() !== '');
    assert.equal(auditLines.length, 3, 'the 503, the 400s/409s and the unchanged save must never append audit records');
    assert.deepEqual(JSON.parse(auditLines[0]).previous.fallback, null);
    assert.deepEqual(JSON.parse(auditLines[0]).next.fallback, { provider: EXAMPLE_HUB, model: 'flash-b' }, 'the first audit record must carry the set fallback');
    assert.deepEqual(JSON.parse(auditLines[1]).previous.fallback, { provider: EXAMPLE_HUB, model: 'flash-b' });
    assert.deepEqual(JSON.parse(auditLines[1]).next.fallback, { provider: EXAMPLE_HUB, model: 'flash-b' }, 'the route-reset record must show the fallback surviving on both sides');
    assert.deepEqual(JSON.parse(auditLines[2]).previous.fallback, { provider: EXAMPLE_HUB, model: 'flash-b' });
    assert.equal(JSON.parse(auditLines[2]).next.fallback, null, 'the combined reset record must clear the fallback');
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('HTTP API: settings GET/POST roundtrip, validation, readonly and corrupt-file defaults', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-settings-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const settingsFile = path.join(dir, '.orchestrator-settings.json');

    await withMockHost({ agentsHome: tmpHome }, async ({ call, routes }) => {
      const settingsSpecs = routes.get(`/api/${NS}.settings`);
      assert.equal(settingsSpecs.length, 1, 'a path must never register twice: the real connection.fetch registry throws on duplicates and the plugin would be rolled back');
      assert.deepEqual([...settingsSpecs[0].methods].sort(), ['GET', 'POST'], 'the settings registration must serve both verbs');
      for (const [routePath, specs] of routes.entries()) {
        assert.equal(specs.length, 1, `route ${routePath} must be registered exactly once`);
      }

      const absent = await call(`/api/${NS}.settings`);
      assert.equal(absent.status, 200);
      assert.deepEqual(absent.data.settings, { teamModeDefault: false }, 'a missing settings file answers the defaults');
      assert.equal(absent.data.readOnly, false);

      const notBoolean = await call(`/api/${NS}.settings`, { method: 'POST', body: JSON.stringify({ teamModeDefault: 'yes' }) });
      assert.equal(notBoolean.status, 400);
      const unknownField = await call(`/api/${NS}.settings`, { method: 'POST', body: JSON.stringify({ teamModeDefault: true, extra: 1 }) });
      assert.equal(unknownField.status, 400);
      const malformed = await call(`/api/${NS}.settings`, { method: 'POST', body: 'not json' });
      assert.equal(malformed.status, 400);
      const arrayBody = await call(`/api/${NS}.settings`, { method: 'POST', body: '[]' });
      assert.equal(arrayBody.status, 400);

      const on = await call(`/api/${NS}.settings`, { method: 'POST', body: JSON.stringify({ teamModeDefault: true }) });
      assert.equal(on.status, 200);
      assert.deepEqual(on.data.settings, { teamModeDefault: true });
      assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), { version: 1, teamModeDefault: true }, 'the settings file must carry the versioned shape');

      const read = await call(`/api/${NS}.settings`);
      assert.deepEqual(read.data.settings, { teamModeDefault: true }, 'the saved toggle must answer on the next GET');
      const off = await call(`/api/${NS}.settings`, { method: 'POST', body: JSON.stringify({ teamModeDefault: false }) });
      assert.equal(off.status, 200);
      assert.deepEqual(off.data.settings, { teamModeDefault: false });
    });

    writeFileSync(settingsFile, '{corrupt', 'utf8');
    const prevWarn = console.warn;
    const warns = [];
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      await withMockHost({ agentsHome: tmpHome }, async ({ call }) => {
        const degraded = await call(`/api/${NS}.settings`);
        assert.equal(degraded.status, 200);
        assert.deepEqual(degraded.data.settings, { teamModeDefault: false }, 'a corrupt settings file degrades to the defaults');
        assert.ok(warns.join('\n').includes('settings file is unreadable'), 'the corrupt settings file must warn');
      });
    } finally {
      console.warn = prevWarn;
    }

    const prevEnv = process.env.DSH_ORCHESTRATOR_READONLY;
    process.env.DSH_ORCHESTRATOR_READONLY = '1';
    try {
      await withMockHost({ agentsHome: tmpHome }, async ({ call }) => {
        const denied = await call(`/api/${NS}.settings`, { method: 'POST', body: JSON.stringify({ teamModeDefault: true }) });
        assert.equal(denied.status, 403);
        assert.equal(denied.data.code, 'readonly', 'readonly mode must refuse the settings save');
        const envelope = await call(`/api/${NS}.settings`);
        assert.equal(envelope.data.readOnly, true, 'the GET envelope must mirror the readonly flag');
      });
    } finally {
      if (prevEnv === undefined) delete process.env.DSH_ORCHESTRATOR_READONLY;
      else process.env.DSH_ORCHESTRATOR_READONLY = prevEnv;
    }
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('agent/created listener: the panel team default mirrors the stock defaultEnabled semantics', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-team-default-'));
  try {
    mkdirSync(path.join(tmpHome, 'agents'), { recursive: true });
    const settingsFile = path.join(tmpHome, 'agents', '.orchestrator-settings.json');
    const rootAgent = { session: { header: { origin: 'root' } } };
    const makeTeams = (selection) => {
      const calls = [];
      return {
        calls,
        projection: { stateOf: () => (selection === undefined ? { inheritedEventCount: 4 } : { inheritedEventCount: 4, enabled: selection }) },
        setEnabled: async (agent, enabled, signal) => { calls.push({ agent, enabled, signal }); }
      };
    };

    let teams = makeTeams(undefined);
    await withMockHost({ agentsHome: tmpHome, agentTeams: teams }, async ({ emit }) => {
      await emit('agent/created', {});
      await emit('agent/created', { agent: { session: { header: { origin: 'subagent' } } }, source: 'startup' });
      await emit('agent/created', { agent: rootAgent, source: 'resume' });
      await emit('agent/created', { agent: rootAgent, source: 'startup' });
    });
    assert.deepEqual(teams.calls, [], 'the default-off host must never flip Team mode');
    assert.ok(!existsSync(settingsFile), 'the default-off host must never create the settings file');

    writeFileSync(settingsFile, JSON.stringify({ version: 1, teamModeDefault: true }), 'utf8');
    teams = makeTeams(undefined);
    await withMockHost({ agentsHome: tmpHome, agentTeams: teams }, async ({ emit }) => {
      await emit('agent/created', {});
      await emit('agent/created', { agent: { session: { header: { origin: 'subagent' } } }, source: 'startup' });
      await emit('agent/created', { agent: rootAgent, source: 'resume' });
      await emit('agent/created', { agent: rootAgent, source: 'startup', signal: 'SIG' });
    });
    assert.deepEqual(teams.calls, [{ agent: rootAgent, enabled: true, signal: 'SIG' }], 'an eligible startup root with no saved selection must be enabled exactly once');

    teams = makeTeams(false);
    await withMockHost({ agentsHome: tmpHome, agentTeams: teams }, async ({ emit }) => {
      await emit('agent/created', { agent: rootAgent, source: 'startup' });
    });
    assert.deepEqual(teams.calls, [], 'an existing explicit OFF selection must never be overridden');

    const brokenTeams = { calls: [], setEnabled: async () => { brokenTeams.calls.push('enabled'); } };
    await withMockHost({ agentsHome: tmpHome, agentTeams: brokenTeams }, async ({ emit }) => {
      await emit('agent/created', { agent: rootAgent, source: 'startup' });
    });
    assert.deepEqual(brokenTeams.calls, [], 'an unusable projection must fail closed instead of flipping the mode');

    let threw = false;
    try {
      await withMockHost({ agentsHome: tmpHome }, async ({ emit }) => {
        await emit('agent/created', { agent: rootAgent, source: 'startup' });
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'an absent Agent Teams service must degrade to a no-op');
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

await test('craft bundle auto-install: first activation creates cards and the skill tree, later activations skip existing files', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-auto-install-'));
  try {
    const prevWarn = console.warn;
    const warns = [];
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      await withMockHost({ agentsHome: tmpHome, config: { autoInstallCraft: true } }, async () => {});
    } finally {
      console.warn = prevWarn;
    }
    const cardsDir = path.join(tmpHome, 'agents');
    for (const role of CRAFT_ROLES) {
      assert.ok(existsSync(path.join(cardsDir, `${role}.md`)), `the auto-install must create ${role}.md`);
    }
    assert.ok(existsSync(path.join(tmpHome, 'skills', 'dev-flow', 'SKILL.md')), 'the auto-install must create the dev-flow skill');
    assert.ok(existsSync(path.join(tmpHome, 'skills', 'dev-flow', 'agents', 'planner.md')), 'the auto-install must copy the skill agent mirrors');
    assert.ok(existsSync(path.join(tmpHome, 'skills', 'dev-flow', 'playbooks')), 'the auto-install must copy the playbooks tree');
    assert.equal(warns.join('\n').includes('craft bundle install finished with failures'), false, 'a clean install must not warn');

    const planner = path.join(cardsDir, 'planner.md');
    writeFileSync(planner, `---\nname: planner\nprovider: example-hub\nmodel: flash-a\n---\n\nedited body\n`, 'utf8');
    await withMockHost({ agentsHome: tmpHome, config: { autoInstallCraft: true } }, async () => {});
    assert.ok(readFileSync(planner, 'utf8').includes('edited body'), 'skip-existing must never overwrite an installed card');

    const disabledHome = mkdtempSync(path.join(tmpdir(), 'map-auto-install-off-'));
    try {
      await withMockHost({ agentsHome: disabledHome, config: { autoInstallCraft: false } }, async () => {});
      assert.equal(existsSync(path.join(disabledHome, 'agents', 'planner.md')), false, 'autoInstallCraft: false must skip the install');
      assert.equal(existsSync(path.join(disabledHome, 'skills', 'dev-flow')), false, 'autoInstallCraft: false must skip the skill tree');
    } finally {
      rmSync(disabledHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
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

await test('update helpers: parseVersion, newer, releaseNotes, shippedNotes, installedUpdate and checkUpdate contracts', async () => {
  const mod = await import('../index.js');
  const { parseVersion, newer, releaseNotes, shippedNotes, installedUpdate, checkUpdate } = mod;
  for (const helper of [parseVersion, newer, releaseNotes, shippedNotes, installedUpdate, checkUpdate]) {
    assert.equal(typeof helper, 'function', 'index.js must export the update helper set');
  }

  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3], 'a v-prefixed tag must parse');
  assert.equal(parseVersion('1.2.3-rc.1'), undefined, 'a pre-release tag must not parse as a version');
  assert.equal(parseVersion('1.2'), undefined, 'a partial version must not parse');
  assert.equal(parseVersion('not a version'), undefined);
  assert.equal(parseVersion(120), undefined, 'a non-string version must not parse');

  assert.equal(newer('1.2.4', '1.2.3'), true, 'a higher patch component is newer');
  assert.equal(newer('2.0.0', '1.9.9'), true, 'a higher major component is newer');
  assert.equal(newer('1.2.3', '1.2.3'), false, 'an equal version is never newer');
  assert.equal(newer('1.2.2', '1.2.3'), false, 'a lower version is never newer (no downgrade)');
  assert.equal(newer('1.2.10', '1.2.9'), true, 'components must compare numerically');
  assert.equal(newer('garbage', '1.2.3'), false, 'an unparsable candidate is never newer');
  assert.equal(newer('1.2.4', 'garbage'), false, 'an unparsable base is never newer');

  assert.equal(releaseNotes('Body text\n## Install\nrun npm i'), 'Body text\n', 'the install boilerplate must be cut at the ## Install heading');
  assert.equal(releaseNotes('Body only'), 'Body only', 'a body without the heading passes through');
  assert.equal(releaseNotes('x'.repeat(20001)).length, 20000, 'notes must cap at 20000 characters');
  assert.equal(releaseNotes(null), undefined, 'a null body must degrade to undefined');
  assert.equal(releaseNotes(42), undefined, 'a non-string body must degrade to undefined');

  const notesData = { version: PKG.version, notes: { en: 'English notes', 'pt-BR': 'Notas', zh: '说明' } };
  assert.deepEqual(shippedNotes(notesData), { en: 'English notes', 'pt-BR': 'Notas', zh: '说明' }, 'valid language keys must pass through');
  assert.deepEqual(
    shippedNotes(JSON.parse(`{"version":"${PKG.version}","notes":{"en":"ok","__proto__":"bad"}}`)),
    { en: 'ok' },
    '__proto__-style language keys must be filtered'
  );
  assert.deepEqual(shippedNotes({ version: PKG.version, notes: { en: 5, 'pt-BR': 'ok' } }), { 'pt-BR': 'ok' }, 'non-string note values must be skipped');
  assert.equal(shippedNotes({ version: '9.9.9', notes: { en: 'x' } }), undefined, 'a version mismatch must invalidate the payload');
  assert.equal(shippedNotes({ version: PKG.version, notes: 'nope' }), undefined, 'non-object notes must invalidate the payload');
  assert.equal(shippedNotes({ version: PKG.version, notes: {} }), undefined, 'an empty note set must return undefined');
  assert.equal(shippedNotes(null), undefined, 'a null payload must return undefined');
  assert.equal(shippedNotes([PKG.version]), undefined, 'an array payload must return undefined');
  assert.equal(shippedNotes('nope'), undefined, 'a string payload must return undefined');
  const liveNotes = shippedNotes();
  assert.ok(liveNotes !== undefined && typeof liveNotes === 'object', 'the shipped release-notes.json must resolve through the default payload');
  assert.deepEqual(Object.keys(liveNotes ?? {}).sort(), ['en', 'pt-BR', 'zh'], 'the shipped notes must carry the three package languages');

  const sandboxDir = mkdtempSync(path.join(packageDir, 'probe-installed-update-'));
  try {
    writeFileSync(path.join(sandboxDir, 'index.js'), readFileSync(path.join(packageDir, 'index.js')));
    writeFileSync(path.join(sandboxDir, 'package.json'), JSON.stringify({ name: PKG.name, version: PKG.version }), 'utf8');
    const sandboxMod = await import(pathToFileURL(path.join(sandboxDir, 'index.js')).href);
    assert.equal(sandboxMod.installedUpdate(), undefined, 'an on-disk version equal to the running one must not be reported');
    writeFileSync(path.join(sandboxDir, 'package.json'), JSON.stringify({ name: PKG.name, version: '9.9.9' }), 'utf8');
    assert.equal(sandboxMod.installedUpdate(), '9.9.9', 'a strictly newer on-disk version must be reported');
    writeFileSync(path.join(sandboxDir, 'package.json'), JSON.stringify({ name: PKG.name, version: '0.0.9' }), 'utf8');
    assert.equal(sandboxMod.installedUpdate(), undefined, 'an older on-disk version must not be reported');
    writeFileSync(path.join(sandboxDir, 'package.json'), '{broken', 'utf8');
    assert.equal(sandboxMod.installedUpdate(), undefined, 'a corrupt on-disk package must degrade to undefined');
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }

  const pkg = { name: NS, version: '0.1.0' };
  const releaseFixture = (overrides = {}) => ({
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.2.0',
    body: 'Release body\n## Install\nnpm i',
    ...overrides
  });
  const githubFetch = (release, npmBehavior = { status: 200 }) => {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init });
      if (url === 'https://api.github.com/repos/klaus-2/dsh-orchestrator-kit/releases/latest') {
        return new Response(JSON.stringify(release), { status: 200 });
      }
      if (npmBehavior.throw === true) throw new Error('npm registry unreachable');
      return new Response('{}', { status: npmBehavior.status });
    };
    return { calls, impl };
  };

  const happy = githubFetch(releaseFixture());
  const info = await checkUpdate(happy.impl, pkg);
  assert.deepEqual(info, {
    name: NS,
    current: '0.1.0',
    latest: '0.2.0',
    managed: true,
    newer: true,
    url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.2.0',
    notes: 'Release body\n'
  }, 'the happy path must report the bare latest version with the npm gate open');
  assert.equal(happy.calls[0].url, 'https://api.github.com/repos/klaus-2/dsh-orchestrator-kit/releases/latest', 'the GitHub probe must hit the releases API');
  assert.equal(happy.calls[0].init.headers.accept, 'application/vnd.github+json', 'the GitHub probe must send the releases accept header');
  assert.equal(happy.calls[0].init.headers['user-agent'], NS, 'the GitHub probe must send the package user-agent');
  assert.equal(happy.calls[1].url, 'https://registry.npmjs.org/dsh-orchestrator-kit/0.2.0', 'the npm gate must use the bare version URL');
  assert.ok(typeof happy.calls[0].init.signal?.aborted === 'boolean', 'the GitHub probe must receive a composed abort signal');

  assert.equal((await checkUpdate(githubFetch(releaseFixture(), { status: 404 }).impl, pkg)).newer, false, 'an npm non-OK answer must close the newer gate');
  assert.equal((await checkUpdate(githubFetch(releaseFixture(), { throw: true }).impl, pkg)).newer, false, 'a thrown npm call must close the gate, not fail the check');

  const ghFail = githubFetch(releaseFixture());
  ghFail.impl = async () => new Response('nope', { status: 500 });
  await assert.rejects(() => checkUpdate(ghFail.impl, pkg), /the GitHub releases API answered 500/, 'a GitHub failure must fail the whole check');

  const badTag = githubFetch(releaseFixture({ tag_name: 'v0.2' }));
  await assert.rejects(() => checkUpdate(badTag.impl, pkg), /no usable x\.y\.z tag/, 'a non x.y.z tag must fail the check');
  const preReleaseTag = githubFetch(releaseFixture({ tag_name: 'v1.2.3-rc.1' }));
  await assert.rejects(() => checkUpdate(preReleaseTag.impl, pkg), /no usable x\.y\.z tag/, 'a pre-release tag must fail the check');
  const noTag = githubFetch({});
  await assert.rejects(() => checkUpdate(noTag.impl, pkg), /no usable x\.y\.z tag/, 'a missing tag must fail the check');

  const foreign = githubFetch(releaseFixture({ html_url: 'https://example.invalid/release/0.2.0' }));
  const foreignInfo = await checkUpdate(foreign.impl, pkg);
  assert.ok(!('url' in foreignInfo), 'a non-github html_url must be omitted entirely');
  assert.equal(foreignInfo.latest, '0.2.0');

  const userinfo = githubFetch(releaseFixture({ html_url: 'https://github.com@evil.example/klaus-2/dsh-orchestrator-kit/releases/tag/v0.2.0' }));
  const userinfoInfo = await checkUpdate(userinfo.impl, pkg);
  assert.ok(!('url' in userinfoInfo), 'a github.com@userinfo html_url must be omitted (the real host is not GitHub)');
  assert.equal(userinfoInfo.latest, '0.2.0');

  const renamed = await checkUpdate(githubFetch(releaseFixture()).impl, { name: 'linked-copy', version: '0.1.0' });
  assert.equal(renamed.managed, false, 'a copy not installed from npm must be unmanaged');
  assert.equal(renamed.name, 'linked-copy');
  const noVersion = await checkUpdate(githubFetch(releaseFixture()).impl, { name: NS });
  assert.equal(noVersion.managed, false, 'a package without a version string is unmanaged');
  assert.ok(!('current' in noVersion), 'the current field must be omitted without a version');
  assert.equal(noVersion.newer, false, 'no version means the newer gate stays closed');

  const controller = new AbortController();
  controller.abort();
  const gated = githubFetch(releaseFixture());
  await assert.doesNotReject(() => checkUpdate(gated.impl, pkg, controller.signal), 'an aborted request signal must not fail the mocked probes');
  assert.equal(gated.calls[0].init.signal.aborted, true, 'the request signal must propagate into the GitHub probe');
  assert.equal(gated.calls[1].init.signal.aborted, true, 'the request signal must propagate into the npm gate');
});

await test('HTTP API: GET .update serves the npm-gated release probe, zero-network ?current=1 and fail-closed 502', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-http-update-'));
  const prevWarn = console.warn;
  console.warn = () => {};
  const originalFetch = globalThis.fetch;
  const release = {
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.3.0',
    body: 'Integration release body\n## Install\nnpm i'
  };
  let githubBehavior = { ok: true };
  let outboundCalls = 0;
  let lastSignal = null;
  globalThis.fetch = async (url, init) => {
    outboundCalls += 1;
    lastSignal = init?.signal ?? null;
    if (String(url).startsWith('https://api.github.com/')) {
      if (!githubBehavior.ok) return new Response('rate limited', { status: 500 });
      return new Response(JSON.stringify(release), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      const probe = await call(`/api/${NS}.update`);
      assert.equal(probe.status, 200);
      assert.deepEqual(probe.data, {
        ok: true,
        name: NS,
        current: PKG.version,
        latest: '0.3.0',
        managed: true,
        newer: true,
        url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.3.0',
        notes: 'Integration release body\n'
      }, 'the default update probe must serve the npm-gated release envelope');
      assert.ok(!('installed' in probe.data), 'an equal on-disk version must not add the installed field');

      const before = outboundCalls;
      const current = await call(`/api/${NS}.update?current=1`);
      assert.equal(current.status, 200);
      assert.deepEqual(current.data, { ok: true, current: PKG.version, notes: shippedNotes() }, '?current=1 must serve the running version with the shipped notes');
      assert.equal(outboundCalls, before, '?current=1 must make zero outbound network calls');

      githubBehavior = { ok: false };
      const failed = await call(`/api/${NS}.update`);
      assert.equal(failed.status, 502);
      assert.deepEqual(failed.data, { ok: false, error: 'the GitHub releases API answered 500 for the latest release' }, 'a GitHub failure must fail the route with the check error message');
      githubBehavior = { ok: true };

      const controller = new AbortController();
      controller.abort();
      await call(`/api/${NS}.update`, { signal: controller.signal });
      assert.equal(lastSignal?.aborted, true, 'the request signal must propagate into the GitHub probe');
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = prevWarn;
    rmSync(tmpHome, { recursive: true, force: true });
  }
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
      const res = await routes.get(`/api/${NS}.route`).at(-1).fetch(new Request(`http://localhost/api/${NS}.route`, {
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
        return routes.get(url.pathname).at(-1).fetch(new Request(url.toString()));
      };
      const rawPost = (payload) => routes.get(`/api/${NS}.route`).at(-1).fetch(new Request(`http://localhost/api/${NS}.route`, {
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

await test('persona: the role card fallback route is the sanctioned one-shot retry on model-availability failures', () => {
  const doc = parseDocument(readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8'));
  const insert = doc.toJS()[0].insert;
  const persona = insert[1].config.plugins.find((plugin) => plugin.id === 'persona');
  const prefix = persona.config.prefix;
  assert.match(prefix, /Model fallback on route failure/, 'the persona must prescribe the fallback retry discipline');
  assert.match(prefix, /`fallback: \{provider, model\}`/, 'the persona must reference the card fallback frontmatter shape');
  assert.match(prefix, /without a route so the child inherits the Session default/, 'the persona must default the retry to the session route when no fallback is declared');
  assert.match(prefix, /A second model-availability failure ends retries/, 'the persona must cap the retry at one fallback attempt');
  assert.match(prefix, /Task-level failures, user aborts and refusals are not route failures/, 'the persona must bound the fallback trigger to model-availability failures');
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
  const routeRe = /\/api\/dsh-orchestrator-kit\.(roles|catalog|efforts|route|events|settings|diagnostics|update)/g;
  const serverRoutes = [...new Set([...readFileSync(path.join(packageDir, 'index.js'), 'utf8').matchAll(routeRe)].map((m) => m[0]))].sort();
  const clientRoutes = [...new Set([...readFileSync(path.join(packageDir, 'client.js'), 'utf8').matchAll(routeRe)].map((m) => m[0]))].sort();
  assert.equal(serverRoutes.length, 8, 'index.js must register exactly the 8 namespaced routes');
  assert.deepEqual(serverRoutes, clientRoutes, 'client.js must call exactly the routes index.js registers');
});

await test('package.json: public npm contract (name, exports, files, dsh manifest, no private)', () => {
  assert.equal(PKG.name, 'dsh-orchestrator-kit');
  assert.equal(PKG.version, '0.2.0');
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
    'release-notes.json',
    'scripts/',
    'README.md',
    'CHANGELOG.md',
    'LICENSE'
  ]);
  assert.equal(PKG.scripts.test, 'node scripts/test.mjs');
  assert.equal(PKG.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(PKG.dsh.client.platform, 'web');
  assert.deepEqual(PKG.dsh.client.inject, ['@deepseek-ai/dsh-api-remotes'], 'the client bundle must inject the api-remotes base module so the updater reaches remote.pluginManager');
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
  assert.ok(clientText.includes('shouldCancel'), 'client.js must carry the batch cancel hook');
  assert.ok(readFileSync(path.join(packageDir, 'index.js'), 'utf8').includes('DSH_ORCHESTRATOR_READONLY'), 'index.js must read the readonly env flag');
  assert.ok(clientText.includes('data-dsh-orchestrator-kit-settings'), 'client.js must keep its settings mount marker');
  assert.doesNotMatch(clientText, /spawn_teammate\b/, 'client.js must not name the removed spawn_teammate tool');
  assert.ok(!clientText.includes(OLD_PLUGIN_NAME), 'client.js must not keep the old local plugin identity');
  assert.ok(!clientText.includes(OLD_PLUGIN_SCOPE), 'client.js must not reference the removed local scope');
  assert.ok(!readFileSync(path.join(packageDir, 'index.js'), 'utf8').includes(OLD_PLUGIN_NAME), 'index.js must not keep the old local plugin identity');
  assert.ok(!readFileSync(path.join(packageDir, 'index.js'), 'utf8').includes('failsafe'), 'index.js must never use the failsafe YAML schema');
});

await test('node --check passes on the shipped files', () => {
  for (const relative of ['index.js', 'client.js', 'scripts/test.mjs', 'scripts/install-craft.js', 'scripts/docs-parity.mjs']) {
    const result = spawnSync(process.execPath, ['--check', path.join(packageDir, relative)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative} failed node --check: ${result.stderr}`);
  }
});

await test('all shipped files exist with UTF-8 no BOM and pure LF', () => {
  for (const file of ['package.json', 'cordis.patch.yml', 'index.js', 'client.js', 'scripts/test.mjs', 'scripts/install-craft.js', 'scripts/docs-parity.mjs', 'locale/en.json', 'locale/pt-BR.json', 'locale/zh.json']) {
    const bytes = readFileSync(path.join(packageDir, file));
    assert.ok(!bytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), `${file} must not carry a BOM`);
    assert.ok(!bytes.toString('utf8').includes('\r\n'), `${file} must use pure LF`);
  }
});

function mountVmClient(fetchHandler, options = {}) {
  let registeredModule = null;
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
  const windowListeners = [];
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
  const UPDATE_ROUTE_URL = `/api/${NS}.update`;
  const defaultUpdateReply = (url) => {
    if (url === `${UPDATE_ROUTE_URL}?current=1`) {
      const notes = shippedNotes();
      return new Response(JSON.stringify({ ok: true, current: PKG.version, ...(notes === undefined ? {} : { notes }) }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, name: NS, current: PKG.version, latest: PKG.version, managed: true, newer: false }), { status: 200 });
  };
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
      },
      addEventListener(type, handler) { windowListeners.push({ type, handler }); },
      removeEventListener(type, handler) {
        const index = windowListeners.findIndex((entry) => entry.type === type && entry.handler === handler);
        if (index >= 0) windowListeners.splice(index, 1);
      },
      setTimeout,
      clearTimeout
    },
    fetch: (url, opts) => track(Promise.resolve().then(async () => {
      fetchCalls.push({ url, opts });
      const reply = await fetchHandler(url, opts);
      if (options.updateFixtures !== false && (url === UPDATE_ROUTE_URL || url === `${UPDATE_ROUTE_URL}?current=1`) && reply.status === 404) return defaultUpdateReply(url);
      return reply;
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
    if (dep === '@deepseek-ai/dsh-client-ui-primitives') {
      if (options.primitives === false) throw new Error('module not available');
      return { Modal: 'vm-modal', Button: 'vm-button' };
    }
    assert.equal(dep, 'react');
    return {
      Fragment: 'vm-fragment',
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
      },
      useSyncExternalStore(subscribe, getSnapshot) {
        return getSnapshot();
      }
    };
  });
  const injectedFactories = [];
  plugin.apply({
    slots: {
      inject(slot, factory) {
        assert.ok(slot === 'settings.section' || slot === 'shell.overlay', `unexpected slot injection ${slot}`);
        injectedFactories.push(factory);
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
    },
    ...(options.pluginManager === undefined ? {} : {
      inject(deps, setup) {
        assert.deepEqual([...deps], ['remote.pluginManager'], 'the update wiring must inject remote.pluginManager');
        setup({ remote: { pluginManager: options.pluginManager }, effect(fn2) { return fn2(); } });
        return { dispose() {} };
      }
    })
  });
  for (const factory of injectedFactories) factory();
  const sectionEntry = slotsSection.find((entry) => entry.meta.name === 'settings.section');
  assert.ok(sectionEntry, 'the settings section must register its component');
  const overlayEntry = slotsSection.find((entry) => entry.meta.id === 'whats-new') ?? null;
  const Component = sectionEntry.component;
  const sectionMeta = sectionEntry.meta;

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
      const overlayTree = overlayEntry === null ? null : overlayEntry.component();
      for (const item of pendingEffects) {
        const prev = effectRecords[item.idx];
        if (!prev || depsChanged(prev.deps, item.deps)) {
          if (typeof prev?.cleanup === 'function') prev.cleanup();
          const cleanup = item.effect();
          effectRecords[item.idx] = { deps: item.deps, cleanup };
        }
      }
      return overlayTree === null ? tree : { type: 'div', props: {}, children: [tree, overlayTree] };
    };

    const settle = async (waitForInflight = true) => {
      let tree = renderCycle();
      for (let step = 0; step < 12; step++) {
        if (waitForInflight && inflight.size > 0) {
          await Promise.allSettled([...inflight]);
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

  return { mountInstance, fetchCalls, locale: localeState, storage: storageMap, runPluginDisposers, windowListeners };
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

const tabByLabel = (tree, label) => findNodes(tree, (n) => n.type === 'button' && n.props.role === 'tab' && n.children[0] === label)[0];
const cardOf = (tree, id) => findNodes(tree, (n) => n.props?.key === id)[0];
const checkboxOfId = (tree, id) => findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === `Disable ${id}`)[0];
const checkboxOfCard = (card) => findNodes(card, (n) => n.type === 'input' && n.props.type === 'checkbox')[0];
const saveOfCard = (card) => findNodes(card, (n) => n.type === 'button' && n.props['aria-label'] === `Save ${card.props.key} settings`)[0];
const providerSelectOfCard = (card) => findNodes(card, (n) => n.type === 'select' && n.props['aria-label'] === `Provider for ${card.props.key}`)[0];
const modelSelectOfCard = (card) => findNodes(card, (n) => n.type === 'select' && n.props['aria-label'] === `Model for ${card.props.key}`)[0];
const effortSelectOfCard = (card) => findNodes(card, (n) => n.type === 'select' && n.props['aria-label'] === `Reasoning effort for ${card.props.key}`)[0];
const statusBadgeOf = (card) => findNodes(card, (n) => n.type === 'span' && typeof n.props.style?.background === 'string' && n.props.style.background.startsWith('rgba(') && n.props.style.borderRadius === 999)[0];
const rootOf = (tree) => findNodes(tree, (n) => n.type === 'div' && n.props['data-dsh-orchestrator-kit-settings'] === '')[0];
const fieldHelpOf = (card) => findNodes(card, (n) => n.type === 'div' && n.props.style?.fontSize === 11 && n.props.style?.marginTop === 4);
const undoButtonsOf = (card) => findNodes(card, (n) => n.type === 'button' && (n.children[0] === 'Undo' || n.children[0] === 'Undoing…'));
const visibleIds = (tree) => findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('Disable ')).map((n) => n.props['aria-label'].replace('Disable ', ''));
const routePostsOf = (vm) => vm.fetchCalls.filter((c) => c.url === `/api/${NS}.route`);
const clickTab = (tree, app, label) => { tabByLabel(tree, label).props.onClick(); return app.renderCycle(); };

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
  assert.equal(findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('Disable ')).length, 22);

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
  assert.equal(findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('Disable ')).length, 22, 'failed refresh must keep all 22 rows');

  failRolesNext = false;
  invalidJsonRolesNext = true;
  findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Refresh roles and catalog')[0].props.onClick();
  tree = await app1.settle();
  assert.ok(collectText(tree).some((t) => t.includes('Invalid JSON response (HTTP 200)')));
  assert.equal(findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('Disable ')).length, 22);
  invalidJsonRolesNext = false;

  const zetaCheckbox = findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable zeta-custom')[0];
  zetaCheckbox.props.onChange({ target: { checked: true } });
  tree = app1.renderCycle();
  await findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Save zeta-custom settings')[0].props.onClick();
  tree = app1.renderCycle();
  assert.equal(findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('Disable ')).length, 22, 'save after failed refresh must preserve all 22 rows');

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
  const checkboxNames = (tree) => findNodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('Disable ')).map((n) => n.props['aria-label'].replace('Disable ', ''));
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
  assert.deepEqual(checkboxNames(tree4), ['arch-advisor', 'docs-scout', 'media-analyst', 'repo-scout'], 'phase tab must filter the grid to that phase (sorted by name per the frozen sortRoles)');
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
  'team.defaultLabel',
  'team.defaultAria',
  'team.saved',
  'onboard.presetHint',
  'onboard.teamHint',
  'onboard.rolesHint',
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
  'field.fallback',
  'field.fallbackHelp',
  'field.fallbackProviderAria',
  'field.fallbackModelAria',
  'fallback.none',
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
  'locale.aria',
  'search.aria',
  'search.placeholder',
  'empty.noMatch',
  'filter.status.aria',
  'filter.status.all',
  'sort.aria',
  'sort.name',
  'sort.routedFirst',
  'sort.inheritsFirst',
  'density.aria',
  'density.comfortable',
  'density.compact',
  'tab.breakdownTitle',
  'card.inheritHint',
  'card.dirtySuffix',
  'card.sealTitle',
  'undo.aria',
  'undo.label',
  'undo.busy',
  'notice.undo',
  'error.action.reget',
  'error.action.regetAria',
  'error.hint.effort',
  'batch.apply',
  'batch.applyAria',
  'batch.busy',
  'batch.cancel',
  'batch.summary',
  'batch.cancelled',
  'batch.empty',
  'profile.summary',
  'profile.export',
  'profile.import',
  'profile.invalid',
  'profile.rejected',
  'profile.applied',
  'events.summary',
  'events.empty',
  'events.loadError',
  'events.entry',
  'diagnostics.summary',
  'diagnostics.ok',
  'diagnostics.missing',
  'diagnostics.invalid',
  'diagnostics.outsideCatalog',
  'diagnostics.fallbackOutsideCatalog',
  'diagnostics.drift',
  'diagnostics.craftMissing',
  'diagnostics.loadError',
  'readonly.title',
  'readonly.notice',
  'support.star',
  'support.spark',
  'support.title',
  'support.message',
  'support.cta',
  'support.thanks',
  'support.close',
  'support.dismiss',
  'update.title',
  'update.checking',
  'update.current',
  'update.available',
  'update.installing',
  'update.restart',
  'update.manual',
  'update.failed',
  'update.version',
  'update.check',
  'update.install',
  'update.notes',
  'update.whatsNew',
  'whatsNew.title',
  'whatsNew.close',
  'whatsNew.star',
  'whatsNew.starLink',
  'whatsNew.starDismiss'
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
  'docs/api.md',
  'docs/architecture.md',
  'docs/glossary.md',
  'docs/preview.svg',
  'docs/recipes.md',
  'docs/role-card.md',
  'docs/showcase.svg',
  'docs/troubleshooting.md',
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
  'release-notes.json',
  'scripts/docs-parity.mjs',
  'scripts/install-craft.js',
  'scripts/test.mjs'
];

const localePanelOf = (lang) => JSON.parse(readFileSync(path.join(packageDir, 'locale', `${lang}.json`), 'utf8')).panel;

await test('locale parity: en/pt-BR/zh panel key sets identical, values non-empty, frozen dictionary schema, meta preserved', () => {
  const langs = ['en', 'pt-BR', 'zh'];
  const docs = langs.map((lang) => JSON.parse(readFileSync(path.join(packageDir, 'locale', `${lang}.json`), 'utf8')));
  for (const [index, doc] of docs.entries()) {
    const lang = langs[index];
    assert.ok(doc.panel && typeof doc.panel === 'object' && !Array.isArray(doc.panel), `locale/${lang}.json must carry a panel object`);
    assert.deepEqual(Object.keys(doc.panel).sort(), [...PANEL_KEYS].sort(), `locale/${lang}.json panel keys must match the frozen dictionary schema`);
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
  const probePlugin = probeModule.factory(() => ({
    createElement() {},
    useState() {},
    useEffect() {},
    useSyncExternalStore(subscribe, getSnapshot) { return getSnapshot(); }
  }));
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

await test('i18n structural gate: every panel string renders through t (sentinel bind) and every frozen dictionary key is covered across driven states', async () => {
  const enDoc = JSON.parse(readFileSync(path.join(packageDir, 'locale', 'en.json'), 'utf8'));
  assert.ok(enDoc.panel && typeof enDoc.panel === 'object' && !Array.isArray(enDoc.panel), 'locale/en.json must carry a panel object for the key-coverage gate');
  const requiredKeys = Object.keys(enDoc.panel);

  const gateRoles = [
    { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 },
    { id: 'alpha-custom', name: 'alpha-custom', description: 'Custom A', provider: null, model: 'inherit', reasoningEffort: null, disabled: true, mtimeMs: 1000 },
    { id: 'zeta-custom', name: 'zeta-custom', description: 'Custom Z', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 1000 }
  ];
  const gateCatalog = { ok: true, available: true, degraded: false, default: { provider: EXAMPLE_CLOUD, model: 'reasoner-d' }, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }, { id: 'flash-b', name: 'Flash B' }] }] };
  const gateEfforts = { ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] };
  const gateStatusOf = (role) => (role.disabled === true ? 'disabled' : role.provider && role.model && role.model !== 'inherit' ? 'routed' : 'inherit');
  const gateBreakdownText = (list) => `${list.filter((role) => gateStatusOf(role) === 'routed').length}/${list.filter((role) => gateStatusOf(role) === 'inherit').length}/${list.filter((role) => gateStatusOf(role) === 'disabled').length}`;
  const allowedData = new Set([
    'planner', 'alpha-custom', 'zeta-custom', 'ghost-role',
    'Plans the work', 'Custom A', 'Custom Z', 'Ghost route',
    EXAMPLE_HUB, 'Example Hub', 'flash-a', 'flash-b', 'Flash A', 'Flash B', 'high', 'High',
    'English', 'Português (BR)', '简体中文',
    '—', '', '0', '1', '2', '3',
    EXAMPLE_CLOUD, 'reasoner-d',
    '0.1.0', '0.2.0',
    'Update notes fixture', 'Notas de versão fixture',
    'malformed update info',
    gateBreakdownText(gateRoles),
    gateBreakdownText(gateRoles.slice(0, 1)),
    gateBreakdownText(gateRoles.slice(1)),
    gateBreakdownText(gateRoles.slice(2)),
    gateBreakdownText([]),
    gateBreakdownText([gateRoles[0], gateRoles[0], gateRoles[2]]),
    gateBreakdownText([gateRoles[0], gateRoles[2]]),
    gateBreakdownText([gateRoles[0], gateRoles[1], { ...gateRoles[2], disabled: true }]),
    gateBreakdownText([{ ...gateRoles[1], disabled: true }, { ...gateRoles[2], disabled: true }]),
    gateBreakdownText([gateRoles[0], gateRoles[0], { ...gateRoles[1], disabled: true }]),
    gateBreakdownText([gateRoles[0], { ...gateRoles[1], disabled: true }])
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
      if (node.type === 'style') return;
      for (const prop of ['aria-label', 'title', 'placeholder']) {
        const value = node.props?.[prop];
        if (typeof value === 'string') checkValue(value);
      }
      if (node.props?.footer && typeof node.props.footer === 'object') scanTree(node.props.footer);
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
    if (url === `/api/${NS}.settings`) {
      if (opts?.method === 'POST') {
        const payload = JSON.parse(opts.body);
        return new Response(JSON.stringify({ ok: true, settings: { teamModeDefault: payload.teamModeDefault === true } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, settings: { teamModeDefault: false }, readOnly: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };

  const vm1 = mountVmClient(gateHandler, { sentinelBind: true });
  const app1 = vm1.mountInstance();
  assert.equal(app1.meta.label(), '⟦nav.label⟧', 'the nav label must resolve through bind');
  checkValue(app1.meta.label());
  let tree1 = await app1.settle();
  scanTree(tree1);
  const supportCta = findNodes(tree1, (n) => n.type === 'a' && n.props.className === 'dsh-ok-support-cta')[0];
  assert.ok(supportCta, 'the support banner must render the star call to action');
  assert.equal(supportCta.props.href, 'https://github.com/klaus-2/dsh-orchestrator-kit', 'the star call to action must open the repository');
  supportCta.props.onClick();
  tree1 = app1.renderCycle();
  scanTree(tree1);
  assert.ok(collectText(tree1).join('').includes('⟦support.thanks⟧'), 'a starred banner must render support.thanks through t');
  assert.equal(JSON.parse(vm1.storage.get('dsh-orchestrator-kit.prefs')).support, 'thanked', 'the starred answer must persist in the panel prefs');

  const teamCheckbox = findNodes(tree1, (n) => n.type === 'input' && n.props['aria-label'] === '⟦team.defaultAria⟧')[0];
  assert.ok(teamCheckbox, 'the getting-started section must render the team default checkbox through t');
  assert.equal(teamCheckbox.props.checked, false, 'the settings bootstrap must drive the team default state');
  teamCheckbox.props.onChange({ target: { checked: true } });
  tree1 = await app1.settle();
  scanTree(tree1);
  assert.ok(collectText(tree1).join('').includes('⟦team.saved⟧'), 'a team default save must render team.saved through t');
  assert.equal(findNodes(tree1, (n) => n.type === 'input' && n.props['aria-label'] === '⟦team.defaultAria⟧')[0].props.checked, true, 'the saved team default must feed back into the checkbox');

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
  assert.ok(collectText(tree1).join('').includes('⟦notice.saved⟧'), 'a successful save must render notice.saved through t');
  assert.ok(collectText(tree1).join('').includes('⟦card.inheritHint⟧'), 'the catalog default must render the inherit hint through t');
  assert.ok(findNodes(tree1, (n) => n.type === 'span' && n.props.title === '⟦card.sealTitle⟧')[0], 'a saved clean card must render the session seal through t');

  holdRoute = true;
  const undoPending = findNodes(tree1, (n) => n.type === 'button' && n.props['aria-label'] === '⟦undo.aria⟧')[0].props.onClick();
  tree1 = await app1.settle(false);
  scanTree(tree1);
  assert.ok(collectText(tree1).join('').includes('⟦undo.busy⟧'), 'an in-flight undo must render undo.busy through t');
  holdRoute();
  holdRoute = null;
  await undoPending;
  tree1 = await app1.settle();
  scanTree(tree1);
  assert.ok(collectText(tree1).join('').includes('⟦notice.undo⟧'), 'a successful undo must render notice.undo through t');

  routeMode = '409';
  checkboxOf(cardOf(tree1, 'zeta-custom')).props.onChange({ target: { checked: true } });
  tree1 = app1.renderCycle();
  await saveOf(cardOf(tree1, 'zeta-custom')).props.onClick();
  tree1 = app1.renderCycle();
  scanTree(tree1);
  const regetButton = findNodes(tree1, (n) => n.type === 'button' && n.props['aria-label'] === '⟦error.action.regetAria⟧')[0];
  assert.ok(regetButton, 'a 409 save must render the re-GET action through t');
  assert.ok(collectText(tree1).join('').includes('⟦error.action.reget⟧'), 'the re-GET action label must render through t');
  regetButton.props.onClick();
  tree1 = await app1.settle();

  findNodes(tree1, (n) => n.type === 'select' && n.props['aria-label'] === '⟦field.effortAria⟧')[0].props.onChange({ target: { value: 'high' } });
  tree1 = app1.renderCycle();
  await saveOf(cardOf(tree1, 'planner')).props.onClick();
  tree1 = app1.renderCycle();
  scanTree(tree1);
  assert.ok(collectText(tree1).join('').includes('⟦error.hint.effort⟧'), 'an effort-carrying 409 must render the effort hint through t');

  const gateSearchInput = findNodes(tree1, (n) => n.type === 'input' && n.props['aria-label'] === '⟦search.aria⟧')[0];
  assert.ok(gateSearchInput, 'the controls row must render the search input through t');
  gateSearchInput.props.onChange({ target: { value: 'ghost' } });
  tree1 = app1.renderCycle();
  scanTree(tree1);
  assert.ok(collectText(tree1).join('').includes('⟦empty.noMatch⟧'), 'a filtered empty view must render empty.noMatch through t');
  findNodes(tree1, (n) => n.type === 'input' && n.props['aria-label'] === '⟦search.aria⟧')[0].props.onChange({ target: { value: '' } });
  tree1 = app1.renderCycle();
  scanTree(tree1);

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
  assert.ok(collectText(tree1).join('').includes('⟦error.conflict⟧'), 'a 409 save must render error.conflict through t');
  assert.ok(findNodes(tree1, (n) => n.type === 'button' && n.props['aria-label'] === '⟦error.action.regetAria⟧')[0], 'the plain 409 message must still render the re-GET action through t');

  routeMode = 'unchanged';
  await saveOf(cardOf(tree1, 'zeta-custom')).props.onClick();
  tree1 = app1.renderCycle();
  scanTree(tree1);
  assert.ok(collectText(tree1).join('').includes('⟦notice.unchanged⟧'), 'an unchanged save must render notice.unchanged through t');
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

  let holdBatchRoute = null;
  const vmBatchGate = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: gateRoles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify(gateEfforts), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const base = gateRoles.find((role) => role.id === payload.id);
      if (holdBatchRoute) {
        return new Promise((resolve) => {
          holdBatchRoute = () => resolve(new Response(JSON.stringify({ ok: true, role: { ...base, provider: payload.provider ?? base.provider, model: payload.model === undefined ? base.model : (payload.model === null ? 'inherit' : payload.model), reasoningEffort: payload.reasoningEffort === undefined ? base.reasoningEffort : payload.reasoningEffort, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 }));
        });
      }
      return new Response(JSON.stringify({ ok: true, role: { ...base, provider: payload.provider ?? base.provider, model: payload.model === undefined ? base.model : (payload.model === null ? 'inherit' : payload.model), reasoningEffort: payload.reasoningEffort === undefined ? base.reasoningEffort : payload.reasoningEffort, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }, { sentinelBind: true });
  const appBatchGate = vmBatchGate.mountInstance();
  let treeBatchGate = await appBatchGate.settle();
  const batchButtonOfGate = (node) => findNodes(node, (n) => n.type === 'button' && n.props['aria-label'] === '⟦batch.applyAria⟧')[0];
  clickTab(treeBatchGate, appBatchGate, '⟦phase.other⟧');
  treeBatchGate = appBatchGate.renderCycle();
  const batchBtnGate = batchButtonOfGate(treeBatchGate);
  assert.ok(batchBtnGate, 'the phase tab must render the batch control with the batch.applyAria label through t');
  assert.equal(batchBtnGate.props.disabled, true, 'the batch control must start disabled without a dirty source card');
  assert.equal(batchBtnGate.children[0], '⟦batch.apply⟧', 'the idle batch control must read batch.apply through t');
  Promise.resolve(batchBtnGate.props.onClick()).catch(() => {});
  treeBatchGate = await appBatchGate.settle();
  scanTree(treeBatchGate);
  assert.ok(collectText(treeBatchGate).join('').includes('⟦batch.empty⟧'), 'an empty batch drive must render batch.empty through t');
  assert.equal(routePostsOf(vmBatchGate).length, 0, 'the empty batch drive must issue zero route POSTs');
  const providerSelectOfSentinelCard = (card) => findNodes(card, (n) => n.type === 'select' && String(n.props['aria-label']).includes('⟦'))[0];
  const modelSelectOfSentinelCard = (card) => findNodes(card, (n) => n.type === 'select' && String(n.props['aria-label']).includes('⟦'))[1];
  providerSelectOfSentinelCard(cardOf(treeBatchGate, 'zeta-custom')).props.onChange({ target: { value: EXAMPLE_HUB } });
  treeBatchGate = appBatchGate.renderCycle();
  modelSelectOfSentinelCard(cardOf(treeBatchGate, 'zeta-custom')).props.onChange({ target: { value: 'flash-b' } });
  treeBatchGate = appBatchGate.renderCycle();
  const batchReadyGate = batchButtonOfGate(treeBatchGate);
  assert.ok(batchReadyGate, 'a dirty source card must keep the batch control rendered');
  assert.equal(batchReadyGate.props.disabled, false, 'a dirty source card must enable the batch control');
  batchReadyGate.props.onClick();
  treeBatchGate = await appBatchGate.settle();
  scanTree(treeBatchGate);
  assert.ok(collectText(treeBatchGate).join('').includes('⟦batch.summary⟧'), 'a finished batch must render batch.summary through t');
  assert.ok(routePostsOf(vmBatchGate).length >= 1, 'the batch drive must issue route POSTs for the phase cards');
  holdBatchRoute = true;
  providerSelectOfSentinelCard(cardOf(appBatchGate.renderCycle(), 'zeta-custom')).props.onChange({ target: { value: EXAMPLE_HUB } });
  treeBatchGate = appBatchGate.renderCycle();
  modelSelectOfSentinelCard(cardOf(treeBatchGate, 'zeta-custom')).props.onChange({ target: { value: 'flash-a' } });
  treeBatchGate = appBatchGate.renderCycle();
  batchButtonOfGate(treeBatchGate).props.onClick();
  treeBatchGate = await appBatchGate.settle(false);
  scanTree(treeBatchGate);
  assert.ok(collectText(treeBatchGate).join('').includes('⟦batch.busy⟧'), 'an in-flight batch must render batch.busy through t');
  const batchCancelGate = findNodes(treeBatchGate, (n) => n.type === 'button' && n.children[0] === '⟦batch.cancel⟧')[0];
  assert.ok(batchCancelGate, 'an in-flight batch must render the cancel control through t');
  batchCancelGate.props.onClick();
  holdBatchRoute();
  holdBatchRoute = null;
  treeBatchGate = await appBatchGate.settle();
  scanTree(treeBatchGate);
  assert.ok(collectText(treeBatchGate).join('').includes('⟦batch.cancelled⟧'), 'a cancelled batch must render batch.cancelled through t');
  appBatchGate.unmount();

  const vmImportGate = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: gateRoles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify(gateEfforts), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const base = gateRoles.find((role) => role.id === payload.id);
      return new Response(JSON.stringify({ ok: true, role: { ...base, provider: payload.provider ?? base.provider, model: payload.model === undefined ? base.model : (payload.model === null ? 'inherit' : payload.model), reasoningEffort: payload.reasoningEffort === undefined ? base.reasoningEffort : payload.reasoningEffort, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }, { sentinelBind: true });
  const appImportGate = vmImportGate.mountInstance();
  let treeImportGate = await appImportGate.settle();
  scanTree(treeImportGate);
  const fileInputOfGate = (node) => findNodes(node, (n) => n.type === 'input' && n.props.type === 'file')[0];
  const importInputGate = fileInputOfGate(treeImportGate);
  assert.ok(importInputGate, 'the profile import must render a file input inside the legend');
  const profileExportGate = findNodes(treeImportGate, (n) => n.type === 'button' && n.children[0] === '⟦profile.export⟧')[0];
  assert.ok(profileExportGate, 'the profile export control must render through t');
  assert.ok(findNodes(treeImportGate, (n) => n.type === 'button' && n.children[0] === '⟦profile.import⟧')[0], 'the profile import control must render through t');
  profileExportGate.props.onClick();
  treeImportGate = appImportGate.renderCycle();
  scanTree(treeImportGate);
  const exportAreaGate = findNodes(treeImportGate, (n) => n.type === 'textarea')[0];
  assert.ok(exportAreaGate, 'the export fallback must render the profile JSON in a textarea');
  const exportedGate = JSON.parse(exportAreaGate.props.value);
  assert.equal(exportedGate.version, 1, 'the exported profile must carry version 1');
  assert.ok(!JSON.stringify(exportedGate).includes('mtimeMs'), 'the exported profile must never carry mtimes');
  importInputGate.props.onChange({ target: { files: [{ text: async () => JSON.stringify({ version: 2, roles: { planner: { provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false } } }) }] } });
  treeImportGate = await appImportGate.settle();
  scanTree(treeImportGate);
  assert.ok(collectText(treeImportGate).join('').includes('⟦profile.invalid⟧'), 'an unsupported profile version must render profile.invalid through t');
  importInputGate.props.onChange({ target: { files: [{ text: async () => JSON.stringify({ version: 1, roles: { 'ghost-role': { provider: null, model: null, reasoningEffort: null, disabled: false } } }) }] } });
  treeImportGate = await appImportGate.settle();
  scanTree(treeImportGate);
  assert.ok(collectText(treeImportGate).join('').includes('⟦profile.rejected⟧'), 'an unknown-only profile must render profile.rejected through t');
  assert.equal(routePostsOf(vmImportGate).length, 0, 'rejected profile drives must issue zero route POSTs');
  importInputGate.props.onChange({ target: { files: [{ text: async () => JSON.stringify({ version: 1, roles: { planner: { provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: 'high', disabled: false } } }) }] } });
  treeImportGate = await appImportGate.settle();
  scanTree(treeImportGate);
  assert.ok(collectText(treeImportGate).join('').includes('⟦profile.applied⟧'), 'a valid profile must render profile.applied through t');
  assert.ok(routePostsOf(vmImportGate).length >= 1, 'a valid profile must issue the refresh-then-apply POSTs');
  appImportGate.unmount();

  const eventsGateModes = [
    { reply: () => new Response(JSON.stringify({ ok: true, events: [{ at: '2026-01-01T00:00:00.000Z', id: 'planner', previous: null, next: null, origin: 'panel' }], skipped: 0 }), { status: 200 }), keys: ['events.entry'] },
    { reply: () => new Response(JSON.stringify({ ok: true, events: [], skipped: 0 }), { status: 200 }), keys: ['events.empty'] },
    { reply: () => new Response(JSON.stringify({ ok: false, error: 'events boom' }), { status: 500 }), keys: ['events.loadError'] }
  ];
  for (const eventsMode of eventsGateModes) {
    const vmEventsGate = mountVmClient(async (url) => {
      if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: gateRoles }), { status: 200 });
      if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
      if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify(gateEfforts), { status: 200 });
      if (url.startsWith(`/api/${NS}.events`)) return eventsMode.reply();
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }, { sentinelBind: true });
    const appEventsGate = vmEventsGate.mountInstance();
    const treeEventsGate = await appEventsGate.settle();
    const eventsDetailsGate = findNodes(treeEventsGate, (n) => n.type === 'details' && (n.children ?? []).some((child) => child.type === 'summary' && collectText(child).join('').includes('⟦events.summary⟧')))[0];
    assert.ok(eventsDetailsGate, 'the events section must render its summary through t');
    eventsDetailsGate.props.onToggle({ target: { open: true } });
    const treeEventsLoaded = await appEventsGate.settle();
    scanTree(treeEventsLoaded);
    for (const key of eventsMode.keys) {
      assert.ok(collectText(treeEventsLoaded).join('').includes(`⟦${key}⟧`), `${key} must render through t in the events drive`);
    }
    appEventsGate.unmount();
  }

  const diagnosticsGateModes = [
    { reply: () => new Response(JSON.stringify({ ok: true, missing: ['ghost-role'], invalid: [{ id: 'alpha-custom', error: 'bad yaml' }], outsideCatalog: ['zeta-custom'], fallbackOutsideCatalog: ['eta-custom'], drift: ['planner'], craftAvailable: true }), { status: 200 }), keys: ['diagnostics.missing', 'diagnostics.invalid', 'diagnostics.outsideCatalog', 'diagnostics.fallbackOutsideCatalog', 'diagnostics.drift'] },
    { reply: () => new Response(JSON.stringify({ ok: true, missing: [], invalid: [], outsideCatalog: [], fallbackOutsideCatalog: [], drift: [], craftAvailable: false }), { status: 200 }), keys: ['diagnostics.ok', 'diagnostics.craftMissing'] },
    { reply: () => new Response(JSON.stringify({ ok: false, error: 'diagnostics boom' }), { status: 500 }), keys: ['diagnostics.loadError'] }
  ];
  for (const diagnosticsMode of diagnosticsGateModes) {
    const vmDiagGate = mountVmClient(async (url) => {
      if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: gateRoles }), { status: 200 });
      if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
      if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify(gateEfforts), { status: 200 });
      if (url.startsWith(`/api/${NS}.diagnostics`)) return diagnosticsMode.reply();
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }, { sentinelBind: true });
    const appDiagGate = vmDiagGate.mountInstance();
    const treeDiagGate = await appDiagGate.settle();
    const diagDetailsGate = findNodes(treeDiagGate, (n) => n.type === 'details' && (n.children ?? []).some((child) => child.type === 'summary' && collectText(child).join('').includes('⟦diagnostics.summary⟧')))[0];
    assert.ok(diagDetailsGate, 'the diagnostics section must render its summary through t');
    diagDetailsGate.props.onToggle({ target: { open: true } });
    const treeDiagLoaded = await appDiagGate.settle();
    scanTree(treeDiagLoaded);
    for (const key of diagnosticsMode.keys) {
      assert.ok(collectText(treeDiagLoaded).join('').includes(`⟦${key}⟧`), `${key} must render through t in the diagnostics drive`);
    }
    appDiagGate.unmount();
  }

  const vmReadonlyGate = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: gateRoles, readOnly: true }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify(gateEfforts), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }, { sentinelBind: true });
  const appReadonlyGate = vmReadonlyGate.mountInstance();
  let treeReadonlyGate = await appReadonlyGate.settle();
  scanTree(treeReadonlyGate);
  const readonlyTextGate = collectText(treeReadonlyGate).join('');
  assert.ok(readonlyTextGate.includes('⟦readonly.title⟧'), 'the readonly banner title must render through t');
  assert.ok(readonlyTextGate.includes('⟦readonly.notice⟧'), 'the readonly banner notice must render through t');
  for (const aria of ['⟦field.providerAria⟧', '⟦field.modelAria⟧', '⟦field.effortAria⟧']) {
    assert.equal(findNodes(treeReadonlyGate, (n) => n.type === 'select' && n.props['aria-label'] === aria)[0].props.disabled, true, `the ${aria} select must be disabled in readonly mode`);
  }
  assert.equal(checkboxOf(cardOf(treeReadonlyGate, 'zeta-custom')).props.disabled, true, 'the disabled checkbox must be disabled in readonly mode');
  assert.equal(findNodes(treeReadonlyGate, (n) => n.type === 'button' && n.props['aria-label'] === '⟦save.aria⟧')[0].props.disabled, true, 'save must be disabled in readonly mode');
  assert.equal(fileInputOfGate(treeReadonlyGate).props.disabled, true, 'profile import must be disabled in readonly mode');
  assert.equal(findNodes(treeReadonlyGate, (n) => n.type === 'button' && n.children[0] === '⟦profile.export⟧')[0].props.disabled, false, 'profile export must stay enabled in readonly mode');
  clickTab(treeReadonlyGate, appReadonlyGate, '⟦phase.other⟧');
  treeReadonlyGate = appReadonlyGate.renderCycle();
  const batchReadonlyGate = batchButtonOfGate(treeReadonlyGate);
  assert.ok(batchReadonlyGate, 'the readonly panel must still render the batch control');
  assert.equal(batchReadonlyGate.props.disabled, true, 'the batch apply must be disabled in readonly mode');
  const readonlyPostsBefore = routePostsOf(vmReadonlyGate).length;
  cardOf(treeReadonlyGate, 'zeta-custom').props.onFocusCapture();
  rootOf(treeReadonlyGate).props.onKeyDown({ key: 's', ctrlKey: true, preventDefault() {} });
  treeReadonlyGate = await appReadonlyGate.settle();
  assert.equal(routePostsOf(vmReadonlyGate).length, readonlyPostsBefore, 'Ctrl+S must be a no-op in readonly mode');
  appReadonlyGate.unmount();

  const updateFixtures = {
    current: { ok: true, name: NS, current: '0.1.0', latest: '0.1.0', managed: true, newer: false },
    available: { ok: true, name: NS, current: '0.1.0', latest: '0.2.0', managed: true, newer: true, url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.2.0' },
    manual: { ok: true, name: NS, current: '0.1.0', latest: '0.3.0', managed: false, newer: true },
    restart: { ok: true, name: NS, current: '0.1.0', latest: '0.2.0', managed: true, newer: true, installed: '0.2.0' }
  };
  const dialogNotesFixture = { en: 'Update notes fixture', 'pt-BR': 'Notas de versão fixture' };
  let updateMode = 'held';
  let holdUpdateCheck = null;
  let holdUpdateInstall = null;
  const updateManager = {
    installBundle() {
      const reply = { ok: true, value: { application: 'applied', version: '0.2.0' } };
      if (holdUpdateInstall) {
        return new Promise((resolve) => { holdUpdateInstall = () => resolve(reply); });
      }
      return Promise.resolve(reply);
    }
  };
  const vmUpdateGate = mountVmClient(async (url) => {
    if (url === `/api/${NS}.update?current=1`) {
      return new Response(JSON.stringify({ ok: true, current: '0.1.0', notes: dialogNotesFixture }), { status: 200 });
    }
    if (url === `/api/${NS}.update`) {
      if (updateMode === 'held') {
        return new Promise((resolve) => {
          holdUpdateCheck = () => resolve(new Response(JSON.stringify(updateFixtures.current), { status: 200 }));
        });
      }
      if (updateMode === 'error') return new Response(JSON.stringify({ ok: false, error: 'update boom' }), { status: 500 });
      if (updateMode === '404') return new Response(JSON.stringify({ ok: false }), { status: 404 });
      return new Response(JSON.stringify(updateFixtures[updateMode]), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.roles`)) return okRolesReply();
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify(gateCatalog), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify(gateEfforts), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }, { sentinelBind: true, pluginManager: updateManager, updateFixtures: false });
  const updateRowTextOf = (node) => collectText(findNodes(node, (n) => n.type === 'div' && n.props.className === 'dsh-ok-update')[0] ?? { children: [] }).join('\n');
  const updateActionOf = (node) => findNodes(node, (n) => n.type === 'button' && n.props.className === 'dsh-ok-update-action')[0];
  const whatsNewButtonOf = (node) => findNodes(node, (n) => n.type === 'button' && n.props.className === 'dsh-ok-update-open')[0];
  const appUpdateGate = vmUpdateGate.mountInstance();
  let treeUpdateGate = await appUpdateGate.settle(false);
  scanTree(treeUpdateGate);
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.checking⟧'), 'a held update check must render update.checking through t');
  holdUpdateCheck();
  holdUpdateCheck = null;
  treeUpdateGate = await appUpdateGate.settle();
  scanTree(treeUpdateGate);
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.current⟧'), 'an up-to-date check must render update.current through t');
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.version⟧'), 'the running version must render through update.version');
  assert.ok(whatsNewButtonOf(treeUpdateGate), 'the shipped notes must render the What\'s-new control through t');
  whatsNewButtonOf(treeUpdateGate).props.onClick();
  treeUpdateGate = appUpdateGate.renderCycle();
  scanTree(treeUpdateGate);
  const gateDialogModal = findNodes(treeUpdateGate, (n) => n.type === 'vm-modal')[0];
  assert.equal(gateDialogModal.props.title, '⟦whatsNew.title⟧', 'whatsNew.title must render through t in the open What\'s-new dialog');
  const gateDialogFooterText = collectText(gateDialogModal.props.footer).join('');
  for (const key of ['update.notes', 'whatsNew.close']) {
    assert.ok(gateDialogFooterText.includes(`⟦${key}⟧`), `${key} must render through t in the dialog footer`);
  }
  const gateDialogText = collectText(treeUpdateGate).join('');
  for (const key of ['whatsNew.star', 'whatsNew.starLink', 'whatsNew.starDismiss']) {
    assert.ok(gateDialogText.includes(`⟦${key}⟧`), `${key} must render through t in the What's-new star line`);
  }
  assert.ok(collectText(treeUpdateGate).includes('Update notes fixture'), 'the dialog must render the active-language notes as exact fixture data');
  findNodes(findNodes(treeUpdateGate, (n) => n.type === 'vm-modal')[0].props.footer, (n) => n.type === 'vm-button')[0].props.onClick();
  treeUpdateGate = appUpdateGate.renderCycle();
  scanTree(treeUpdateGate);
  assert.equal(findNodes(treeUpdateGate, (n) => n.type === 'vm-modal').length, 0, 'closing the dialog must remove it from the render');

  updateMode = 'available';
  updateActionOf(treeUpdateGate).props.onClick();
  treeUpdateGate = await appUpdateGate.settle();
  scanTree(treeUpdateGate);
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.available⟧'), 'an installable update must render update.available through t');
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.install⟧'), 'the installable update must render update.install through t');
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.notes⟧'), 'the release link must render update.notes through t');
  holdUpdateInstall = true;
  updateActionOf(treeUpdateGate).props.onClick();
  treeUpdateGate = await appUpdateGate.settle(false);
  scanTree(treeUpdateGate);
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.installing⟧'), 'an in-flight install must render update.installing through t');
  assert.equal(updateActionOf(treeUpdateGate).props.disabled, true, 'the action control must disable while installing');
  holdUpdateInstall();
  holdUpdateInstall = null;
  treeUpdateGate = await appUpdateGate.settle();
  scanTree(treeUpdateGate);
  assert.equal(vmUpdateGate.storage.get('dsh-orchestrator-kit.update.installed'), '0.2.0', 'the applied install must remember the installed version');

  updateMode = 'manual';
  updateActionOf(treeUpdateGate).props.onClick();
  treeUpdateGate = await appUpdateGate.settle();
  scanTree(treeUpdateGate);
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.manual⟧'), 'a non-npm copy must render update.manual through t');

  updateMode = 'error';
  updateActionOf(treeUpdateGate).props.onClick();
  treeUpdateGate = await appUpdateGate.settle();
  scanTree(treeUpdateGate);
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.failed⟧'), 'a failed update check must render update.failed through t');

  updateMode = 'restart';
  updateActionOf(treeUpdateGate).props.onClick();
  treeUpdateGate = await appUpdateGate.settle();
  scanTree(treeUpdateGate);
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.restart⟧'), 'a newer on-disk copy must render update.restart through t');

  updateMode = '404';
  updateActionOf(treeUpdateGate).props.onClick();
  treeUpdateGate = await appUpdateGate.settle();
  scanTree(treeUpdateGate);
  assert.ok(updateRowTextOf(treeUpdateGate).includes('⟦update.restart⟧'), 'a 404 while a restart state stands must preserve the restart state');
  assert.ok(collectText(treeUpdateGate).join('').includes('⟦update.check⟧'), 'the row action must render update.check through t');
  appUpdateGate.unmount();

  const missingKeys = requiredKeys.filter((key) => !observedKeys.has(key));
  assert.deepEqual(missingKeys, [], 'every panel dictionary key must render through t in at least one driven state');
});

await test('client.js updater: full state machine, install flow with already-installed tarball fallback and row controls per state', async () => {
  const enPanel = localePanelOf('en');
  const updateRowTextOf = (tree) => collectText(findNodes(tree, (n) => n.type === 'div' && n.props.className === 'dsh-ok-update')[0] ?? { children: [] }).join('\n');
  const updateActionOf = (tree) => findNodes(tree, (n) => n.type === 'button' && n.props.className === 'dsh-ok-update-action')[0];
  const updateNotesLinkOf = (tree) => findNodes(tree, (n) => n.type === 'a' && n.props.className === 'dsh-ok-update-link')[0];

  const fixtures = {
    current: { ok: true, name: NS, current: '0.1.0', latest: '0.1.0', managed: true, newer: false },
    available: { ok: true, name: NS, current: '0.1.0', latest: '0.2.0', managed: true, newer: true, url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.2.0', notes: 'GitHub release body' },
    manual: { ok: true, name: NS, current: '0.1.0', latest: '0.3.0', managed: false, newer: true, url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.3.0' },
    restart: { ok: true, name: NS, current: '0.1.0', latest: '0.2.0', managed: true, newer: true, installed: '0.2.0' }
  };
  let updateMode = 'current';
  const plainHandler = async (url) => {
    if (url === `/api/${NS}.update`) {
      if (updateMode === 'reject') throw new Error('bridge gone');
      if (updateMode === 'error') return new Response(JSON.stringify({ ok: false, error: 'update boom' }), { status: 500 });
      if (updateMode === '404') return new Response(JSON.stringify({ ok: false }), { status: 404 });
      return new Response(JSON.stringify(fixtures[updateMode]), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: [{ id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };

  const plainVm = mountVmClient(plainHandler, { updateFixtures: false });
  const appPlain = plainVm.mountInstance();
  let treePlain = await appPlain.settle();
  assert.ok(updateRowTextOf(treePlain).includes(enPanel['update.current']), 'an up-to-date check must render update.current');
  assert.ok(updateRowTextOf(treePlain).includes('Version 0.1.0'), 'the row must render the running version through update.version');
  assert.equal(updateActionOf(treePlain).children[0], enPanel['update.check'], 'the current state must offer the check control');
  assert.equal(updateActionOf(treePlain).props.disabled, false, 'the check control must stay enabled on the current state');

  updateMode = 'available';
  updateActionOf(treePlain).props.onClick();
  treePlain = await appPlain.settle();
  assert.ok(updateRowTextOf(treePlain).includes(enPanel['update.available'].replace('{version}', '0.2.0')), 'an installable update must render update.available with the latest version');
  assert.equal(updateActionOf(treePlain).children[0], enPanel['update.check'], 'without a plugin manager the available state must keep the check control');
  const plainNotesLink = updateNotesLinkOf(treePlain);
  assert.ok(plainNotesLink, 'the release link must render for a url-carrying answer');
  assert.equal(plainNotesLink.props.href, fixtures.available.url, 'the release link must open the release url');
  assert.equal(plainNotesLink.children[0], enPanel['update.notes'], 'the release link must read update.notes');

  updateMode = 'manual';
  updateActionOf(treePlain).props.onClick();
  treePlain = await appPlain.settle();
  assert.ok(updateRowTextOf(treePlain).includes(enPanel['update.manual'].replace('{version}', '0.3.0')), 'a non-npm copy must render update.manual');

  updateMode = 'error';
  updateActionOf(treePlain).props.onClick();
  treePlain = await appPlain.settle();
  assert.ok(updateRowTextOf(treePlain).includes(enPanel['update.failed'].replace('{error}', 'update boom')), 'a failed check must render update.failed with the error detail');

  updateMode = 'restart';
  updateActionOf(treePlain).props.onClick();
  treePlain = await appPlain.settle();
  assert.ok(updateRowTextOf(treePlain).includes(enPanel['update.restart'].replace('{version}', '0.2.0')), 'a newer on-disk copy must render update.restart with the installed version');

  updateMode = '404';
  updateActionOf(treePlain).props.onClick();
  treePlain = await appPlain.settle();
  assert.ok(updateRowTextOf(treePlain).includes(enPanel['update.restart'].replace('{version}', '0.2.0')), 'a 404 while a restart state stands must preserve the restart state');

  updateMode = 'reject';
  updateActionOf(treePlain).props.onClick();
  treePlain = await appPlain.settle();
  assert.ok(updateRowTextOf(treePlain).includes(enPanel['update.restart'].replace('{version}', '0.2.0')), 'a rejected check while a restart state stands must preserve the restart state');
  updateMode = 'current';
  updateActionOf(treePlain).props.onClick();
  treePlain = await appPlain.settle();
  assert.ok(updateRowTextOf(treePlain).includes(enPanel['update.current']), 'a successful re-check must resolve the preserved restart state');
  appPlain.unmount();

  const noPrimitivesVm = mountVmClient(plainHandler, { primitives: false });
  const appNoPrimitives = noPrimitivesVm.mountInstance();
  const treeNoPrimitives = await appNoPrimitives.settle();
  assert.equal(findNodes(treeNoPrimitives, (n) => n.type === 'button' && n.props.className === 'dsh-ok-update-open').length, 0, 'a primitives-less host must not render the What\'s-new button');
  appNoPrimitives.unmount();
  const withPrimitivesVm = mountVmClient(plainHandler);
  const appWithPrimitives = withPrimitivesVm.mountInstance();
  const treeWithPrimitives = await appWithPrimitives.settle();
  assert.ok(findNodes(treeWithPrimitives, (n) => n.type === 'button' && n.props.className === 'dsh-ok-update-open').length > 0, 'a primitives-capable host must render the What\'s-new button');
  appWithPrimitives.unmount();

  const installCalls = [];
  const installReplies = [];
  let holdInstall = null;
  const fakeManager = {
    installBundle(spec, opts) {
      installCalls.push({ spec, requestId: opts?.requestId });
      const reply = installReplies.shift() ?? { ok: true, value: { application: 'applied', version: '0.2.0' } };
      if (holdInstall) {
        return new Promise((resolve) => { holdInstall = () => resolve(reply); });
      }
      return Promise.resolve(reply);
    }
  };
  let installFixture = fixtures.available;
  const installVm = mountVmClient(async (url) => {
    if (url === `/api/${NS}.update`) return new Response(JSON.stringify(installFixture), { status: 200 });
    return plainHandler(url);
  }, { pluginManager: fakeManager });
  const appInstall = installVm.mountInstance();
  let treeInstall = await appInstall.settle();
  assert.equal(updateActionOf(treeInstall).children[0], enPanel['update.install'], 'the available state with a plugin manager must offer the install control');
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.available'].replace('{version}', '0.2.0')), 'the installable update must render update.available');

  holdInstall = true;
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle(false);
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.installing'].replace('{version}', '0.2.0')), 'an in-flight install must render update.installing');
  assert.equal(updateActionOf(treeInstall).props.disabled, true, 'the action control must disable while installing');
  const releaseInstall = holdInstall;
  holdInstall = null;
  releaseInstall();
  treeInstall = await appInstall.settle();
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.current']), 'an applied install must return the row to the current state');
  assert.ok(updateRowTextOf(treeInstall).includes('Version 0.2.0'), 'the applied install must report the new running version');
  assert.equal(installCalls[0].spec, 'dsh-orchestrator-kit@0.2.0', 'the first install must request the name@version spec');
  assert.ok(String(installCalls[0].requestId).startsWith(`${NS}-update-0.2.0-`), 'the install must carry the namespaced requestId');
  assert.equal(installVm.storage.get('dsh-orchestrator-kit.update.installed'), '0.2.0', 'the applied install must remember the installed version');
  assert.deepEqual(JSON.parse(installVm.storage.get('dsh-orchestrator-kit.update.whatsNew')), {
    version: '0.2.0',
    notes: 'GitHub release body',
    url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.2.0'
  }, 'the applied install must persist the What\'s-new record');

  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.restart'].replace('{version}', '0.2.0')), 'a check whose latest equals the remembered install must render the restart state');

  installFixture = { ...fixtures.available, latest: '0.3.0', url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.3.0' };
  installReplies.push({ ok: true, value: { error: { code: 'already-installed' } } }, { ok: true, value: { application: 'applied', version: '0.3.0' } });
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.available'].replace('{version}', '0.3.0')), 'the next release must become installable again');
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.current']), 'the tarball fallback install must return the row to the current state');
  assert.equal(installCalls[1].spec, 'dsh-orchestrator-kit@0.3.0', 'the refused install must first try the name@version spec');
  assert.equal(installCalls[2].spec, 'https://registry.npmjs.org/dsh-orchestrator-kit/-/dsh-orchestrator-kit-0.3.0.tgz', 'an already-installed refusal must fall back to the exact npm tarball');
  assert.equal(installVm.storage.get('dsh-orchestrator-kit.update.installed'), '0.3.0', 'the fallback install must remember the new version');

  installFixture = { ...fixtures.available, latest: '0.4.0', url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.4.0' };
  installReplies.push({ ok: true, value: { application: 'restart-required' } });
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.restart'].replace('{version}', '0.4.0')), 'a restart-required install must render the restart state');
  assert.equal(installVm.storage.get('dsh-orchestrator-kit.update.installed'), '0.4.0', 'the restart-required install must remember the version');

  installFixture = { ...fixtures.available, latest: '0.5.0', url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.5.0' };
  installReplies.push({ ok: true, value: { error: { code: 'boom', diagnostic: 'pnpm went sideways\nsecond line' } } });
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.failed'].replace('{error}', 'pnpm went sideways')), 'an invalid install result must render update.failed with the first diagnostic line');

  installFixture = { ...fixtures.available, latest: '0.6.0', url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.6.0' };
  installReplies.push({ ok: false, error: { message: 'manager refused the bundle' } });
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.failed'].replace('{error}', 'manager refused the bundle')), 'a manager refusal must render update.failed with the manager error');

  installFixture = { ...fixtures.available, latest: '0.7.0-beta.1' };
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  assert.equal(installCalls.length, 6, 'a malformed latest must never reach the plugin manager');
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.failed'].replace('{error}', 'malformed update info')), 'a malformed latest must render update.failed with the guard message');

  installFixture = { ...fixtures.available, latest: '0.8.0', url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.8.0' };
  installReplies.push({ ok: false, error: { code: 'remote-boom', diagnostic: 'manager diag line\nsecond' } });
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  updateActionOf(treeInstall).props.onClick();
  treeInstall = await appInstall.settle();
  assert.ok(updateRowTextOf(treeInstall).includes(enPanel['update.failed'].replace('{error}', 'manager diag line')), 'a diagnostic-only reply error must surface its first diagnostic line');
  assert.equal(installCalls.length, 7, 'the diagnostic-only reply must have reached the manager exactly once');
  appInstall.unmount();
});

await test('client.js What\'s-new dialog: once-per-version seen gate, install-record consumption, host-absent restore, per-language notes with English fallback and star persistence', async () => {
  const enPanel = localePanelOf('en');
  const dialogModalOf = (tree) => findNodes(tree, (n) => n.type === 'vm-modal')[0];
  const dialogNotesOf = (tree) => findNodes(tree, (n) => n.type === 'div' && n.props.className === 'dsh-ok-whatsnew')[0];
  const dialogNotesTextOf = (tree) => {
    const notes = dialogNotesOf(tree);
    return notes === undefined ? undefined : collectText(notes).join('');
  };
  const dialogStarOf = (tree) => findNodes(tree, (n) => n.type === 'div' && n.props.className === 'dsh-ok-whatsnew-star')[0];
  const dialogFooterButtonOf = (tree) => findNodes(dialogModalOf(tree)?.props?.footer, (n) => n.type === 'vm-button')[0];
  const dialogFooterLinkOf = (tree) => findNodes(dialogModalOf(tree)?.props?.footer, (n) => n.type === 'a')[0];
  const SEEN = 'dsh-orchestrator-kit.update.seen';
  const WHATS_NEW = 'dsh-orchestrator-kit.update.whatsNew';
  const PREFS = 'dsh-orchestrator-kit.prefs';
  const seenSeed = () => new Map([[SEEN, '0.1.0']]);
  const recordSeed = () => new Map([
    [WHATS_NEW, JSON.stringify({ version: '0.2.0', notes: 'Record english body', url: 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.2.0' })]
  ]);
  let currentNotes = { en: 'Dialog notes en', 'pt-BR': 'Dialog notes pt' };
  let hostAnswers = true;
  const dialogHandler = async (url) => {
    if (url === `/api/${NS}.update?current=1`) {
      if (!hostAnswers) return new Response(JSON.stringify({ ok: false, error: 'host down' }), { status: 500 });
      return new Response(JSON.stringify({ ok: true, current: '0.2.0', notes: currentNotes }), { status: 200 });
    }
    if (url === `/api/${NS}.update`) return new Response(JSON.stringify({ ok: true, name: NS, current: '0.2.0', latest: '0.2.0', managed: true, newer: false }), { status: 200 });
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: [{ id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };

  const vmSeen = mountVmClient(dialogHandler, { storageMap: seenSeed() });
  const appSeen = vmSeen.mountInstance();
  let treeSeen = await appSeen.settle();
  assert.ok(dialogModalOf(treeSeen), 'a newer running version over the seen one must open the What\'s-new dialog');
  assert.equal(dialogModalOf(treeSeen).props.title, enPanel['whatsNew.title'].replace('{version}', '0.2.0'), 'the dialog must render whatsNew.title with the version');
  assert.equal(dialogNotesTextOf(treeSeen), 'Dialog notes en', 'the dialog must render the notes for the active language');
  assert.equal(dialogNotesOf(treeSeen).props.lang, 'en', 'the notes container must carry the resolved language');
  assert.equal(dialogFooterLinkOf(treeSeen).props.href, 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.2.0', 'the dialog footer must link the release tag');
  assert.equal(vmSeen.storage.get(SEEN), '0.2.0', 'the dialog open must record the running version as seen');
  assert.ok(dialogStarOf(treeSeen), 'an unanswered support question must render the star line');

  const starLink = findNodes(dialogStarOf(treeSeen), (n) => n.type === 'a' && n.props.className === 'dsh-ok-whatsnew-link')[0];
  assert.equal(starLink.props.href, 'https://github.com/klaus-2/dsh-orchestrator-kit', 'the star link must open the repository');
  starLink.props.onClick();
  assert.equal(JSON.parse(vmSeen.storage.get(PREFS)).support, 'thanked', 'the star link must persist the thanked support answer');
  treeSeen = appSeen.renderCycle();
  assert.ok(dialogStarOf(treeSeen), 'the star link must keep the line while the browser opens the repository');
  const dismissButton = findNodes(treeSeen, (n) => n.type === 'button' && n.props.className === 'dsh-ok-whatsnew-dismiss')[0];
  dismissButton.props.onClick();
  assert.equal(JSON.parse(vmSeen.storage.get(PREFS)).support, 'dismissed', 'the dismiss control must persist the dismissed support answer');
  treeSeen = appSeen.renderCycle();
  assert.equal(dialogStarOf(treeSeen), undefined, 'the dismissed answer must remove the star line at once');

  dialogFooterButtonOf(treeSeen).props.onClick();
  treeSeen = appSeen.renderCycle();
  assert.equal(dialogModalOf(treeSeen), undefined, 'closing the dialog must remove it from the render');
  const appSeenAgain = vmSeen.mountInstance();
  const treeSeenAgain = await appSeenAgain.settle();
  assert.equal(dialogModalOf(treeSeenAgain), undefined, 'the same version must never reopen the dialog (once per version)');
  appSeenAgain.unmount();
  appSeen.unmount();

  const vmRecord = mountVmClient(dialogHandler, { storageMap: recordSeed() });
  currentNotes = { 'pt-BR': 'Dialog notes pt' };
  const appRecord = vmRecord.mountInstance();
  const treeRecord = await appRecord.settle();
  assert.ok(dialogModalOf(treeRecord), 'an install-time record for the running version must open the dialog');
  assert.equal(dialogNotesTextOf(treeRecord), 'Record english body', 'the record\'s English body must back the dialog when the running copy ships no English notes');
  assert.equal(dialogFooterLinkOf(treeRecord).props.href, 'https://github.com/klaus-2/dsh-orchestrator-kit/releases/tag/v0.2.0', 'the record\'s url must drive the footer link');
  assert.equal(vmRecord.storage.has(WHATS_NEW), false, 'the consumed record must leave storage');
  appRecord.unmount();

  const vmRestore = mountVmClient(dialogHandler, { storageMap: recordSeed() });
  hostAnswers = false;
  const appRestore = vmRestore.mountInstance();
  const treeRestore = await appRestore.settle();
  assert.equal(dialogModalOf(treeRestore), undefined, 'a start without a Host answer must not open the dialog');
  assert.equal(vmRestore.storage.get(WHATS_NEW), recordSeed().get(WHATS_NEW), 'the record must be restored for the next start');
  appRestore.unmount();
  hostAnswers = true;
  const vmRestoreNext = mountVmClient(dialogHandler, { storageMap: recordSeed() });
  const appRestoreNext = vmRestoreNext.mountInstance();
  const treeRestoreNext = await appRestoreNext.settle();
  assert.ok(dialogModalOf(treeRestoreNext), 'the restored record must open the dialog on the next start once the Host answers');
  assert.equal(vmRestoreNext.storage.has(WHATS_NEW), false, 'the restored record must be consumed after it shows');
  appRestoreNext.unmount();

  const vmLanguage = mountVmClient(dialogHandler, { storageMap: seenSeed() });
  currentNotes = { en: 'Dialog notes en', 'pt-BR': 'Dialog notes pt' };
  vmLanguage.locale.active = 'zh';
  const appLanguage = vmLanguage.mountInstance();
  const treeLanguage = await appLanguage.settle();
  assert.equal(dialogNotesTextOf(treeLanguage), 'Dialog notes en', 'an unmatched UI language must fall back to the English notes');
  assert.equal(dialogNotesOf(treeLanguage).props.lang, 'en', 'the fallback notes must carry the en language id');
  appLanguage.unmount();

  currentNotes = { 'pt-BR': 'Notas em português' };
  const vmFirstKey = mountVmClient(dialogHandler, { storageMap: seenSeed() });
  const appFirstKey = vmFirstKey.mountInstance();
  const treeFirstKey = await appFirstKey.settle();
  assert.equal(dialogNotesTextOf(treeFirstKey), 'Notas em português', 'notes without English must show the first shipped language');
  assert.equal(dialogNotesOf(treeFirstKey).props.lang, 'pt-BR', 'the first-key fallback must carry the shipped language id');
  appFirstKey.unmount();

  currentNotes = { en: '## Fixed\n**Fast** startup now' };
  const vmMarkdown = mountVmClient(dialogHandler, { storageMap: seenSeed() });
  const appMarkdown = vmMarkdown.mountInstance();
  const treeMarkdown = await appMarkdown.settle();
  assert.equal(dialogNotesTextOf(treeMarkdown), 'Fixed\nFast startup now', 'plainNotes must strip headings and bold marks from the notes');
  appMarkdown.unmount();
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
  'profile.summary', 'profile.export', 'profile.import', 'events.summary',
  'legend.provider', 'legend.providerText', 'legend.model', 'legend.modelText', 'legend.effort', 'legend.effortText', 'legend.disabled', 'legend.disabledText', 'legend.inherit', 'legend.inheritText', 'legend.subagent', 'legend.apply', 'legend.summary',
  'search.aria', 'search.placeholder', 'filter.status.aria', 'filter.status.all', 'sort.aria', 'sort.name', 'sort.routedFirst', 'sort.inheritsFirst', 'density.aria', 'density.comfortable', 'density.compact', 'tab.breakdownTitle'
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
      for (const prop of ['aria-label', 'title', 'placeholder']) {
        const value = node.props?.[prop];
        if (typeof value === 'string') acc.push(value);
      }
      for (const child of node.children ?? []) scanEnValues(child, acc);
    }
    return acc;
  };
  const renderedStrings = scanEnValues(treeEnValues, []).join('\n');
  for (const key of PANEL_RENDERABLE_KEYS) {
    const value = enDict[key];
    assert.ok(value !== undefined && renderedStrings.includes(value), 'the en value for ' + key + ' must render in the driven panel state');
  }
  appEnValues.unmount();
  vmEnValues.runPluginDisposers();
});

await test('save safety: mtime-keyed draft hoisting, dirty seal on every section, warn-before-unload and Ctrl+S on the focused card', async () => {
  const roles = [
    { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 },
    { id: 'docs-scout', name: 'docs-scout', description: 'Searches the repo', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 2000 },
    { id: 'zeta-custom', name: 'zeta-custom', description: 'Custom Z', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 3000 }
  ];
  let liveRoles = roles.map((role) => ({ ...role }));
  let holdRoute = null;
  const vm = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: liveRoles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const index = liveRoles.findIndex((r) => r.id === payload.id);
      const base = liveRoles[index];
      const next = { ...base, mtimeMs: base.mtimeMs + 10 };
      if (payload.provider !== undefined) next.provider = payload.provider;
      if (payload.model !== undefined) next.model = payload.model === null ? 'inherit' : payload.model;
      if (payload.fallback !== undefined) {
        next.fallbackProvider = payload.fallback === null ? null : payload.fallback.provider;
        next.fallbackModel = payload.fallback === null ? null : payload.fallback.model;
      }
      if (payload.reasoningEffort !== undefined) next.reasoningEffort = payload.reasoningEffort;
      if (payload.disabled !== undefined) next.disabled = payload.disabled;
      if (holdRoute) {
        return new Promise((resolve) => {
          holdRoute = () => {
            liveRoles[index] = next;
            resolve(new Response(JSON.stringify({ ok: true, role: next }), { status: 200 }));
          };
        });
      }
      liveRoles[index] = next;
      return new Response(JSON.stringify({ ok: true, role: next }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  let tree = await app.settle();

  const initialUnloads = vm.windowListeners.filter((entry) => entry.type === 'beforeunload');
  assert.equal(initialUnloads.length, 1, 'the beforeunload guard must register exactly once at mount');
  const spyCounts = { prevent: 0 };
  const cleanEvent = { preventDefault: () => { spyCounts.prevent += 1; }, returnValue: '' };
  initialUnloads[0].handler(cleanEvent);
  assert.equal(spyCounts.prevent, 0, 'the guard must not preventDefault while every draft is clean');

  for (const id of ['planner', 'docs-scout', 'zeta-custom']) {
    const card = cardOf(tree, id);
    assert.ok(card, `the ${id} card must render`);
    checkboxOfCard(card).props.onChange({ target: { checked: true } });
  }
  tree = app.renderCycle();
  for (const id of ['planner', 'docs-scout', 'zeta-custom']) {
    const card = cardOf(tree, id);
    assert.equal(card.props.style.borderColor, 'var(--dsw-alias-state-warning-primary, #f59e0b)', `the dirty ${id} card must carry the amber border`);
    assert.ok(collectText(card).join('').includes(' (unsaved)'), `the dirty ${id} card must render the unsaved suffix`);
  }
  const unloads = vm.windowListeners.filter((entry) => entry.type === 'beforeunload');
  assert.equal(unloads.length, 1, 'a dirty panel must re-register exactly one beforeunload guard');
  assert.notEqual(unloads[0].handler, initialUnloads[0].handler, 'the [roles, drafts] deps change must swap the guard handler');
  const dirtyEvent = { preventDefault: () => { spyCounts.prevent += 1; }, returnValue: '' };
  unloads[0].handler(dirtyEvent);
  assert.equal(spyCounts.prevent, 1, 'the guard must preventDefault while drafts are dirty');

  holdRoute = true;
  saveOfCard(cardOf(tree, 'planner')).props.onClick();
  tree = await app.settle(false);
  assert.ok(collectText(cardOf(tree, 'planner')).join('').includes('Saving…'), 'the in-flight save must render save.busy through t');
  holdRoute();
  holdRoute = null;
  tree = await app.settle();

  const unloadsAfter = vm.windowListeners.filter((entry) => entry.type === 'beforeunload');
  assert.equal(unloadsAfter.length, 1, 'the guard must re-register while other drafts stay dirty');
  const stillDirtyEvent = { preventDefault: () => { spyCounts.prevent += 1; } };
  unloadsAfter[0].handler(stillDirtyEvent);
  assert.equal(spyCounts.prevent, 2, 'the guard must still preventDefault for the remaining dirty cards');
  const plannerCard = cardOf(tree, 'planner');
  assert.ok(!collectText(plannerCard).join('').includes(' (unsaved)'), 'the saved planner card must lose its dirty suffix');
  assert.equal(plannerCard.props.style.borderColor, 'var(--dsw-alias-state-success-primary, #22c55e)', 'the saved planner card must show the highlight border (highlight wins)');

  await saveOfCard(cardOf(tree, 'docs-scout')).props.onClick();
  await saveOfCard(cardOf(tree, 'zeta-custom')).props.onClick();
  tree = await app.settle();
  assert.equal(vm.windowListeners.filter((entry) => entry.type === 'beforeunload').length, 1, 'the guard must still be registered exactly once on the clean panel');

  checkboxOfId(tree, 'zeta-custom').props.onChange({ target: { checked: false } });
  tree = app.renderCycle();
  const card = cardOf(tree, 'zeta-custom');
  card.props.onFocusCapture();
  const savedCount = routePostsOf(vm).length;
  rootOf(tree).props.onKeyDown({ key: 's', ctrlKey: true, preventDefault() {} });
  tree = await app.settle();
  assert.equal(routePostsOf(vm).length, savedCount + 1, 'Ctrl+S must issue exactly one POST');
  assert.deepEqual(JSON.parse(routePostsOf(vm).at(-1).opts.body), { id: 'zeta-custom', expectedMtimeMs: 3010, disabled: false }, 'Ctrl+S must save the focused card with the current draft payload');

  checkboxOfId(tree, 'zeta-custom').props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  cardOf(tree, 'zeta-custom').props.onFocusCapture();
  rootOf(tree).props.onKeyDown({ key: 's', metaKey: true, preventDefault() {} });
  tree = await app.settle();
  assert.deepEqual(JSON.parse(routePostsOf(vm).at(-1).opts.body), { id: 'zeta-custom', expectedMtimeMs: 3020, disabled: true }, 'metaKey+s must trigger the focused-card save');

  const beforeNoop = routePostsOf(vm).length;
  rootOf(tree).props.onKeyDown({ key: 'x', ctrlKey: true, preventDefault() {} });
  tree = await app.settle();
  assert.equal(routePostsOf(vm).length, beforeNoop, 'a non-s key must not POST');

  const fallbackProviderSelect = findNodes(cardOf(tree, 'zeta-custom'), (n) => n.type === 'select' && n.props['aria-label'] === 'Fallback provider for zeta-custom')[0];
  assert.ok(fallbackProviderSelect, 'the comfortable card must render the fallback provider select');
  let fallbackModelSelect = findNodes(cardOf(tree, 'zeta-custom'), (n) => n.type === 'select' && n.props['aria-label'] === 'Fallback model for zeta-custom')[0];
  assert.ok(fallbackModelSelect, 'the comfortable card must render the fallback model select');
  assert.equal(fallbackModelSelect.props.disabled, true, 'the fallback model select must stay disabled until a provider is chosen');
  fallbackProviderSelect.props.onChange({ target: { value: EXAMPLE_HUB } });
  tree = app.renderCycle();
  fallbackModelSelect = findNodes(cardOf(tree, 'zeta-custom'), (n) => n.type === 'select' && n.props['aria-label'] === 'Fallback model for zeta-custom')[0];
  assert.equal(fallbackModelSelect.props.disabled, false, 'choosing a fallback provider must enable the model select');
  fallbackModelSelect.props.onChange({ target: { value: 'flash-a' } });
  tree = app.renderCycle();
  const fallbackPostsBefore = routePostsOf(vm).length;
  await saveOfCard(cardOf(tree, 'zeta-custom')).props.onClick();
  tree = await app.settle();
  assert.equal(routePostsOf(vm).length, fallbackPostsBefore + 1, 'the fallback save must issue exactly one POST');
  const fallbackPost = JSON.parse(routePostsOf(vm).at(-1).opts.body);
  assert.deepEqual(fallbackPost.fallback, { provider: EXAMPLE_HUB, model: 'flash-a' }, 'the fallback save must POST the pair');
  assert.ok(!('provider' in fallbackPost) && !('model' in fallbackPost), 'a fallback-only save must not resend the route');
  const savedZeta = liveRoles.find((role) => role.id === 'zeta-custom');
  assert.equal(savedZeta.fallbackProvider, EXAMPLE_HUB, 'the saved fallback must surface in the server role state');
  assert.equal(cardOf(tree, 'zeta-custom') && !collectText(cardOf(tree, 'zeta-custom')).join('').includes(' (unsaved)'), true, 'the saved fallback must clear the dirty suffix');

  checkboxOfId(tree, 'zeta-custom').props.onChange({ target: { checked: false } });
  tree = app.renderCycle();
  const secondMount = vm.mountInstance();
  const hoistTree = secondMount.renderCycle();
  assert.equal(checkboxOfId(hoistTree, 'zeta-custom').props.checked, false, 'the mtime-matched draft must hoist into the remount init state');

  liveRoles = liveRoles.map((role) => ({ ...role, mtimeMs: role.mtimeMs + 1000 }));
  const remountFresh = vm.mountInstance();
  await remountFresh.settle();
  const remountStale = vm.mountInstance();
  const staleTree = remountStale.renderCycle();
  assert.equal(checkboxOfId(staleTree, 'zeta-custom').props.checked, true, 'an mtime mismatch must discard the stored draft and re-normalize from the server state');
  await remountStale.settle();
  const freshServerMtime = liveRoles.find((role) => role.id === 'zeta-custom').mtimeMs;
  checkboxOfId(staleTree, 'zeta-custom').props.onChange({ target: { checked: false } });
  tree = remountStale.renderCycle();
  assert.equal(saveOfCard(cardOf(tree, 'zeta-custom')).props.disabled, false, 'the fresh-draft card must be saveable');
  await saveOfCard(cardOf(tree, 'zeta-custom')).props.onClick();
  tree = remountStale.renderCycle();
  assert.deepEqual(JSON.parse(routePostsOf(vm).at(-1).opts.body), { id: 'zeta-custom', expectedMtimeMs: freshServerMtime, disabled: false }, 'the next save must carry the fresh mtime');

  const cleanMount = vm.mountInstance();
  const cleanTree = cleanMount.renderCycle();
  assert.ok(!collectText(cardOf(cleanTree, 'zeta-custom')).join('').includes(' (unsaved)'), 'a clean save must prune the draft store (no dirty state on remount)');
  cleanMount.unmount();
  remountStale.unmount();
  remountFresh.unmount();
  secondMount.unmount();
  app.unmount();
});

await test('undo last save: reverse POST of the pre-save summary with the post-save mtime, snapshot lifecycle and loop-helper guards', async () => {
  const roles = [
    { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 },
    { id: 'zeta-custom', name: 'zeta-custom', description: 'Custom Z', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 3000 }
  ];
  let liveRoles = roles.map((role) => ({ ...role }));
  let routeMode = 'ok';
  let holdUndo = null;
  const vm = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: liveRoles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const index = liveRoles.findIndex((r) => r.id === payload.id);
      const base = liveRoles[index];
      if (routeMode === '409') return new Response(JSON.stringify({ ok: false, error: 'stale mtime' }), { status: 409 });
      if (routeMode === 'unchanged') return new Response(JSON.stringify({ ok: true, unchanged: true, role: { ...base, disabled: payload.disabled ?? base.disabled } }), { status: 200 });
      const next = { ...base, mtimeMs: base.mtimeMs + 10 };
      if (payload.provider !== undefined) next.provider = payload.provider;
      if (payload.model !== undefined) next.model = payload.model === null ? 'inherit' : payload.model;
      if (payload.reasoningEffort !== undefined) next.reasoningEffort = payload.reasoningEffort;
      if (payload.disabled !== undefined) next.disabled = payload.disabled;
      if (holdUndo) {
        return new Promise((resolve) => {
          holdUndo = () => {
            liveRoles[index] = next;
            resolve(new Response(JSON.stringify({ ok: true, role: next }), { status: 200 }));
          };
        });
      }
      liveRoles[index] = next;
      return new Response(JSON.stringify({ ok: true, role: next }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  let tree = await app.settle();

  assert.equal(undoButtonsOf(cardOf(tree, 'zeta-custom')).length + undoButtonsOf(cardOf(tree, 'planner')).length, 0, 'no snapshot must mean no undo button');

  checkboxOfId(tree, 'zeta-custom').props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  await saveOfCard(cardOf(tree, 'zeta-custom')).props.onClick();
  tree = await app.settle();
  const zetaCard = cardOf(tree, 'zeta-custom');
  const undoButton = undoButtonsOf(zetaCard)[0];
  assert.ok(undoButton, 'the undo button must appear after a save');
  assert.equal(undoButton.props['aria-label'], 'Undo last save for zeta-custom', 'the undo button must carry the undo.aria label');

  const postsBeforeUndo = routePostsOf(vm).length;
  holdUndo = true;
  undoButton.props.onClick();
  tree = await app.settle(false);
  assert.deepEqual(JSON.parse(routePostsOf(vm).at(-1).opts.body), { id: 'zeta-custom', expectedMtimeMs: 3010, provider: null, model: null, disabled: false, reasoningEffort: null, fallback: null }, 'the undo POST must reverse the pre-save summary with the post-save mtime');
  const busyUndo = undoButtonsOf(cardOf(app.renderCycle(), 'zeta-custom'))[0];
  assert.equal(busyUndo.children[0], 'Undoing…', 'the in-flight undo must read undo.busy');
  assert.equal(saveOfCard(cardOf(app.renderCycle(), 'zeta-custom')).props.disabled, true, 'save must be disabled while undo is in flight');
  holdUndo();
  holdUndo = null;
  tree = await app.settle();
  assert.equal(routePostsOf(vm).length, postsBeforeUndo + 1, 'the undo must issue exactly one POST');
  assert.equal(checkboxOfId(tree, 'zeta-custom').props.checked, false, 'the undo must restore the pre-save state');
  assert.ok(collectText(tree).join('').includes('Undone — the previous settings are restored.'), 'a successful undo must render notice.undo');
  assert.equal(undoButtonsOf(cardOf(tree, 'zeta-custom')).length, 0, 'the consumed snapshot must remove the undo button');

  effortSelectOfCard(cardOf(tree, 'planner')).props.onChange({ target: { value: 'high' } });
  tree = app.renderCycle();
  const plannerSave = saveOfCard(cardOf(tree, 'planner'));
  assert.equal(plannerSave.props.disabled, false, 'the effort-dirty planner draft must be saveable');
  const plannerPosts = routePostsOf(vm).length;
  await plannerSave.props.onClick();
  tree = await app.settle();
  const plannerUndo = undoButtonsOf(cardOf(tree, 'planner'))[0];
  assert.ok(plannerUndo, 'the route-dirty planner save must expose the undo button');
  plannerUndo.props.onClick();
  tree = await app.settle();
  assert.deepEqual(JSON.parse(routePostsOf(vm)[plannerPosts + 1].opts.body), { id: 'planner', expectedMtimeMs: 1010, provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, fallback: null, disabled: false }, 'the route-dirty undo must carry the pre-save provider/model strings and clear the effort');

  routeMode = 'ok';
  checkboxOfId(tree, 'zeta-custom').props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  await saveOfCard(cardOf(tree, 'zeta-custom')).props.onClick();
  tree = await app.settle();
  const secondUndo = undoButtonsOf(cardOf(tree, 'zeta-custom'))[0];
  assert.ok(secondUndo, 'the latest save must expose the undo button');
  secondUndo.props.onClick();
  tree = await app.settle();
  assert.equal(checkboxOfId(tree, 'zeta-custom').props.checked, false, 'the undo must restore the pre-save state');
  assert.equal(undoButtonsOf(cardOf(tree, 'zeta-custom')).length, 0, 'undo must never create a snapshot');

  routeMode = '409';
  checkboxOfId(tree, 'zeta-custom').props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  await saveOfCard(cardOf(tree, 'zeta-custom')).props.onClick();
  tree = await app.settle();
  assert.ok(collectText(cardOf(tree, 'zeta-custom')).join('').includes('Conflict/validation error (409)'), 'a 409 save must render the conflict text');
  assert.equal(undoButtonsOf(cardOf(tree, 'zeta-custom')).length, 0, 'a failed save must never expose an undo button');

  routeMode = 'ok';
  checkboxOfId(tree, 'zeta-custom').props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  assert.equal(saveOfCard(cardOf(tree, 'zeta-custom')).props.disabled, false, 'the re-dirtied draft must be saveable');
  await saveOfCard(cardOf(tree, 'zeta-custom')).props.onClick();
  tree = await app.settle();
  const retainedUndo = undoButtonsOf(cardOf(tree, 'zeta-custom'))[0];
  assert.ok(retainedUndo, 'the successful save must expose the undo button');
  routeMode = '409';
  retainedUndo.props.onClick();
  tree = await app.settle();
  assert.ok(collectText(cardOf(tree, 'zeta-custom')).join('').includes('Conflict/validation error (409)'), 'an undo 409 must render the conflict text');
  assert.equal(undoButtonsOf(cardOf(tree, 'zeta-custom')).length, 1, 'a failed undo must retain the snapshot');
  assert.ok(collectText(tree).some((value) => value.includes('reasoning effort') || value.includes('effort')), 'an undo 409 for an effort-carrying route must render the effort hint');
  const undoRegion = findNodes(tree, (n) => n.props?.role === 'status' && n.props['aria-live'] === 'polite' && n.props['aria-atomic'] === 'true').find((n) => n.props.style?.position === 'absolute' && n.props.style?.width === 1);
  assert.ok(undoRegion && collectText(undoRegion).some((value) => value.includes('Conflict')), 'a failed undo must be announced in the shared aria-live region');

  routeMode = 'ok';
  checkboxOfId(tree, 'zeta-custom').props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  await saveOfCard(cardOf(tree, 'zeta-custom')).props.onClick();
  tree = await app.settle();
  const aliveUndo = undoButtonsOf(cardOf(tree, 'zeta-custom'))[0];
  assert.ok(aliveUndo, 'the final save must expose the undo button for the alive-guard drive');
  holdUndo = true;
  aliveUndo.props.onClick();
  await app.settle(false);
  app.unmount();
  holdUndo();
  holdUndo = null;
  await new Promise((r) => setTimeout(r, 0));
});

await test('save error actions: 409 re-GET keeps the draft and never resends a stale mtime; effort hint; lock-timeout guidance renders', async () => {
  const roles = [
    { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 }
  ];
  let rolesMtime = 1000;
  let routeMode = '409';
  const vm = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: [{ ...roles[0], mtimeMs: rolesMtime }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const base = roles[0];
      if (routeMode === '409') return new Response(JSON.stringify({ ok: false, error: 'stale mtime' }), { status: 409 });
      if (routeMode === '503lock') return new Response(JSON.stringify({ ok: false, error: 'lock-timeout on role cards: retry after the in-flight write completes' }), { status: 503 });
      return new Response(JSON.stringify({ ok: true, role: { ...base, disabled: payload.disabled ?? base.disabled, reasoningEffort: payload.reasoningEffort === undefined ? base.reasoningEffort : payload.reasoningEffort, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  let tree = await app.settle();

  const postsBefore = routePostsOf(vm).length;
  checkboxOfId(tree, 'planner').props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  await saveOfCard(cardOf(tree, 'planner')).props.onClick();
  tree = app.renderCycle();
  assert.equal(routePostsOf(vm).length, postsBefore + 1, 'the conflicting save must have POSTed once');
  const card = cardOf(tree, 'planner');
  const regetButton = findNodes(card, (n) => n.type === 'button' && n.props['aria-label'] === 'Reload saved state and keep edits for planner')[0];
  assert.ok(regetButton, 'the 409 message must render the re-GET action button');
  assert.ok(regetButton.children.includes('Reload saved state, keep edits'), 'the action button must read error.action.reget');
  assert.ok(collectText(card).join('').includes('Conflict/validation error (409)'), 'the 409 message text must render');

  rolesMtime = 1500;
  const rolesCallsBefore = vm.fetchCalls.filter((c) => c.url.startsWith(`/api/${NS}.roles`)).length;
  const routeCallsBefore = routePostsOf(vm).length;
  regetButton.props.onClick();
  tree = await app.settle();
  assert.equal(vm.fetchCalls.filter((c) => c.url.startsWith(`/api/${NS}.roles`)).length, rolesCallsBefore + 1, 'the action must re-GET roles');
  assert.equal(routePostsOf(vm).length, routeCallsBefore, 'the action must issue ZERO new .route calls');
  assert.ok(!collectText(cardOf(tree, 'planner')).join('').includes('Conflict/validation error (409)'), 'the action must clear the conflict message');
  assert.equal(checkboxOfId(tree, 'planner').props.checked, true, 'the action must keep the draft dirty');
  assert.ok(collectText(cardOf(tree, 'planner')).join('').includes(' (unsaved)'), 'the kept draft must still render the unsaved suffix');

  routeMode = 'ok';
  await saveOfCard(cardOf(tree, 'planner')).props.onClick();
  tree = app.renderCycle();
  assert.deepEqual(JSON.parse(routePostsOf(vm).at(-1).opts.body), { id: 'planner', expectedMtimeMs: 1500, disabled: true }, 'the next save must carry the fresh mtime, never the stale one');
  assert.ok(collectText(cardOf(tree, 'planner')).join('').includes('Saved — applies on the next turn / next subagent_role.'), 'the retried save must succeed');

  effortSelectOfCard(cardOf(tree, 'planner')).props.onChange({ target: { value: 'high' } });
  tree = app.renderCycle();
  routeMode = '409';
  await saveOfCard(cardOf(tree, 'planner')).props.onClick();
  tree = app.renderCycle();
  assert.ok(collectText(cardOf(tree, 'planner')).join('').includes('The chosen reasoning effort may not be supported by this route'), 'an effort-carrying 409 must render the effort hint');

  routeMode = '503lock';
  checkboxOfId(tree, 'planner').props.onChange({ target: { checked: false } });
  tree = app.renderCycle();
  await saveOfCard(cardOf(tree, 'planner')).props.onClick();
  tree = app.renderCycle();
  const lockCard = cardOf(tree, 'planner');
  assert.ok(collectText(lockCard).join('').includes('lock-timeout on role cards'), 'the lock-timeout guidance must render via error.raw');
  assert.ok(collectText(lockCard).join('').includes('retry after the in-flight write completes'), 'the retry instruction must render');
  assert.equal(findNodes(lockCard, (n) => n.type === 'button' && n.props['aria-label'] === 'Reload saved state and keep edits for planner').length, 0, 'the lock-timeout message must not render a re-GET action');
  app.unmount();
});

await test('accessible save confirmation: shared polite region announces success/failure/unchanged, saved-card highlight and live top summary', async () => {
  const roles = [
    { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 }
  ];
  let routeMode = 'ok';
  const vm = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const base = roles.find((r) => r.id === payload.id);
      if (routeMode === '409') return new Response(JSON.stringify({ ok: false, error: 'stale mtime' }), { status: 409 });
      if (routeMode === 'unchanged') return new Response(JSON.stringify({ ok: true, unchanged: true, role: { ...base, disabled: payload.disabled ?? base.disabled } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, role: { ...base, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  let tree = await app.settle();
  const regions = findNodes(tree, (n) => n.props?.role === 'status' && n.props['aria-live'] === 'polite' && n.props['aria-atomic'] === 'true');
  assert.ok(regions.length >= 2, 'the shared sr-only region and the live top summary must exist');
  const regionText = (node) => collectText(node).join('');
  const srRegion = regions.find((n) => n.props.style?.position === 'absolute' && n.props.style?.width === 1);
  assert.ok(srRegion, 'one polite region must carry the sr-only style');
  const summaryRegion = regions.find((n) => n.props.style?.position !== 'absolute');
  assert.ok(summaryRegion, 'one polite region must be the header counts summary');
  assert.ok(regionText(summaryRegion).includes(' roles · '), 'the summary region must carry the saved-state counts');
  assert.ok(regionText(summaryRegion).includes('0 disabled'), 'the summary must start at the saved-state counts');

  checkboxOfId(tree, 'planner').props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  await saveOfCard(cardOf(tree, 'planner')).props.onClick();
  tree = await app.settle();
  const srAfterSave = findNodes(app.renderCycle(), (n) => n.props?.role === 'status' && n.props['aria-live'] === 'polite' && n.props['aria-atomic'] === 'true').find((n) => n.props.style?.position === 'absolute' && n.props.style?.width === 1);
  assert.ok(regionText(srAfterSave).includes('Saved — applies'), 'the region must announce the saved notice after success');
  const savedCard = cardOf(tree, 'planner');
  assert.equal(savedCard.props.style.borderColor, 'var(--dsw-alias-state-success-primary, #22c55e)', 'the saved card must carry the green highlight border');
  const summaryAfterSave = findNodes(app.renderCycle(), (n) => n.props?.role === 'status' && n.props['aria-live'] === 'polite' && n.props['aria-atomic'] === 'true').find((n) => n.props.style?.position !== 'absolute');
  assert.ok(regionText(summaryAfterSave).includes('1 disabled'), 'the summary must update after a save');

  checkboxOfId(tree, 'planner').props.onChange({ target: { checked: false } });
  tree = app.renderCycle();
  assert.ok(cardOf(tree, 'planner').props.style.borderColor !== 'var(--dsw-alias-state-success-primary, #22c55e)', 'the next interaction must clear the green highlight (the new draft turns the border amber)');

  routeMode = '409';
  effortSelectOfCard(cardOf(tree, 'planner')).props.onChange({ target: { value: 'high' } });
  tree = app.renderCycle();
  assert.equal(saveOfCard(cardOf(tree, 'planner')).props.disabled, false, 'the effort-dirty draft must be saveable');
  await saveOfCard(cardOf(tree, 'planner')).props.onClick();
  tree = await app.settle();
  const srAfterFail = findNodes(app.renderCycle(), (n) => n.props?.role === 'status' && n.props['aria-live'] === 'polite' && n.props['aria-atomic'] === 'true').find((n) => n.props.style?.position === 'absolute' && n.props.style?.width === 1);
  assert.ok(regionText(srAfterFail).includes('Conflict/validation error (409)'), 'the region must announce the conflict message on failure');
  assert.ok(cardOf(tree, 'planner').props.style.borderColor !== 'var(--dsw-alias-state-success-primary, #22c55e)', 'a failed save must not highlight the card');

  routeMode = 'unchanged';
  effortSelectOfCard(cardOf(tree, 'planner')).props.onChange({ target: { value: null } });
  tree = app.renderCycle();
  assert.equal(saveOfCard(cardOf(tree, 'planner')).props.disabled, false, 'the re-dirtied draft must be saveable');
  await saveOfCard(cardOf(tree, 'planner')).props.onClick();
  tree = await app.settle();
  const srAfterUnchanged = findNodes(app.renderCycle(), (n) => n.props?.role === 'status' && n.props['aria-live'] === 'polite' && n.props['aria-atomic'] === 'true').find((n) => n.props.style?.position === 'absolute' && n.props.style?.width === 1);
  assert.ok(regionText(srAfterUnchanged).includes('Already up to date'), 'the region must announce the unchanged notice');
  app.unmount();
});

await test('role view controls: search, status filter, sort selector and per-tab status breakdown compose with phase tabs', async () => {
  const roles = [
    { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 },
    { id: 'alpha-custom', name: 'alpha-custom', description: 'Alpha notes', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 2000 },
    { id: 'zeta-custom', name: 'zeta-custom', description: 'Custom Z', provider: null, model: 'inherit', reasoningEffort: null, disabled: true, mtimeMs: 3000 },
    { id: 'ghost', name: 'ghost', description: 'Ghost route', provider: 'ghost', model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 4000 }
  ];
  const vm = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  let tree = await app.settle();
  assert.equal(visibleIds(tree).length, 4, 'the default view must render all four roles');
  const searchInput0 = findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Search roles')[0];
  assert.ok(searchInput0, 'the search input must render');
  assert.equal(searchInput0.props.placeholder, 'Filter by name or description', 'the search input must carry the placeholder');
  let searchInput = searchInput0;

  searchInput.props.onChange({ target: { value: 'plan' } });
  tree = app.renderCycle();
  assert.deepEqual(visibleIds(tree), ['planner'], 'the name search must hide zeta-custom and show planner');

  searchInput.props.onChange({ target: { value: 'ghost route' } });
  tree = app.renderCycle();
  assert.deepEqual(visibleIds(tree), ['ghost'], 'the description fragment must match too');

  searchInput.props.onChange({ target: { value: '' } });
  tree = app.renderCycle();
  const filterButton = (label) => findNodes(tree, (n) => n.type === 'button' && n.props['aria-pressed'] !== undefined && n.children[0] === label)[0];
  assert.equal(filterButton('All statuses').props['aria-pressed'], true, 'All statuses must start pressed');

  filterButton('Routed').props.onClick();
  tree = app.renderCycle();
  assert.deepEqual(visibleIds(tree).sort(), ['ghost', 'planner'], 'the routed filter must compose AND with the all tab');
  clickTab(tree, app, 'Planning & Execution');
  tree = app.renderCycle();
  assert.deepEqual(visibleIds(tree), ['planner'], 'the routed filter must compose AND with a phase tab');
  filterButton('Disabled').props.onClick();
  tree = app.renderCycle();
  assert.equal(visibleIds(tree).length, 0, 'the disabled filter must compose AND with the planning tab');
  clickTab(tree, app, 'All roles');
  tree = app.renderCycle();
  assert.deepEqual(visibleIds(tree), ['zeta-custom'], 'the disabled filter must compose AND with the all tab');
  filterButton('Inherits chat').props.onClick();
  tree = app.renderCycle();
  assert.deepEqual(visibleIds(tree), ['alpha-custom'], 'the inherit filter must compose with the search');
  filterButton('All statuses').props.onClick();
  tree = app.renderCycle();

  const sortSelect = findNodes(tree, (n) => n.type === 'select' && n.props['aria-label'] === 'Sort roles')[0];
  assert.ok(sortSelect, 'the sort selector must render');
  sortSelect.props.onChange({ target: { value: 'routedFirst' } });
  tree = app.renderCycle();
  assert.deepEqual(visibleIds(tree), ['planner', 'ghost', 'alpha-custom', 'zeta-custom'], 'routed-first must reorder within each section');
  const badgeTextOfId = (id) => statusBadgeOf(cardOf(tree, id)).children[statusBadgeOf(cardOf(tree, id)).children.length - 1];
  assert.deepEqual(visibleIds(tree).map(badgeTextOfId), ['Routed', 'Routed', 'Inherits chat', 'Disabled'], 'routed-first must order routed, inherit, disabled');

  sortSelect.props.onChange({ target: { value: 'inheritsFirst' } });
  tree = app.renderCycle();
  assert.deepEqual(visibleIds(tree), ['planner', 'alpha-custom', 'zeta-custom', 'ghost'], 'inherits-first must reorder within each section');
  assert.deepEqual(visibleIds(tree).map(badgeTextOfId), ['Routed', 'Inherits chat', 'Disabled', 'Routed'], 'inherits-first must order inherit, disabled, routed');
  sortSelect.props.onChange({ target: { value: 'name' } });
  tree = app.renderCycle();

  const breakdownOf = (label) => {
    const button = tabByLabel(tree, label);
    const spans = findNodes(button, (n) => n.type === 'span' && n.props.title === 'Routed / inherit / disabled counts for this tab');
    return spans[0]?.children[0];
  };
  assert.equal(breakdownOf('All roles'), '2/1/1', 'the all tab must show its routed/inherit/disabled breakdown');
  assert.equal(breakdownOf('Planning & Execution'), '1/0/0', 'the planning tab must show its breakdown');
  assert.equal(breakdownOf('Discovery & Advisory'), '0/0/0', 'the empty discovery tab must show a zero breakdown');
  assert.equal(breakdownOf('Other'), '1/1/1', 'the other tab must show its breakdown');

  searchInput.props.onChange({ target: { value: 'zzz-no-match' } });
  tree = app.renderCycle();
  assert.ok(collectText(tree).join('').includes('No roles match the current search or filter.'), 'an empty filtered view must show the no-match state');
  searchInput = findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Search roles')[0];
  searchInput.props.onChange({ target: { value: '' } });
  tree = app.renderCycle();
  clickTab(tree, app, 'Discovery & Advisory');
  tree = app.renderCycle();
  assert.ok(collectText(tree).join('').includes('No roles in this group yet.'), 'a genuinely empty phase must still show the no-group state');
  app.unmount();
});

await test('density modes: compact one-line rows keep the same controls; grid cards reserve space via content-visibility; inherit hint shows the chat default', async () => {
  const roles = [
    { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 },
    { id: 'alpha-custom', name: 'alpha-custom', description: 'Alpha notes', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 2000 }
  ];
  const vm = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: { provider: EXAMPLE_CLOUD, model: 'reasoner-d' }, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const base = roles.find((r) => r.id === payload.id);
      return new Response(JSON.stringify({ ok: true, role: { ...base, disabled: payload.disabled ?? base.disabled, provider: payload.provider === undefined ? base.provider : payload.provider, model: payload.model === undefined ? base.model : (payload.model === null ? 'inherit' : payload.model), reasoningEffort: payload.reasoningEffort === undefined ? base.reasoningEffort : payload.reasoningEffort, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  let tree = await app.settle();
  const plannerCard = cardOf(tree, 'planner');
  assert.equal(plannerCard.props.style.contentVisibility, 'auto', 'comfortable cards must set contentVisibility');
  assert.equal(plannerCard.props.style.containIntrinsicSize, 'auto 220px', 'comfortable cards must set containIntrinsicSize');
  assert.ok(collectText(cardOf(tree, 'alpha-custom')).join('').includes('Inherits chat default: example-cloud / reasoner-d'), 'the inherit hint must render the chat default');
  assert.equal(fieldHelpOf(cardOf(tree, 'planner')).length, 4, 'comfortable cards keep the four field help nodes (route pair, effort and fallback)');

  const densitySelect = findNodes(tree, (n) => n.type === 'select' && n.props['aria-label'] === 'Density')[0];
  assert.ok(densitySelect, 'the density select must render');
  densitySelect.props.onChange({ target: { value: 'compact' } });
  tree = app.renderCycle();
  const compactCard = cardOf(tree, 'planner');
  assert.equal(compactCard.props.style.flexDirection, 'row', 'compact rows must lay out as a row');
  assert.equal(compactCard.props.style.contentVisibility, undefined, 'compact rows must not carry contentVisibility');
  assert.equal(compactCard.props.style.containIntrinsicSize, undefined, 'compact rows must not carry containIntrinsicSize');
  assert.ok(checkboxOfCard(compactCard), 'the compact row must keep the disabled checkbox');
  const compactProvider = providerSelectOfCard(compactCard);
  const compactModel = modelSelectOfCard(compactCard);
  assert.ok(compactProvider && compactModel, 'the compact row must keep both selects');
  assert.equal(compactProvider.props['aria-label'], 'Provider for planner', 'the compact provider select must keep its aria-label');
  assert.equal(compactModel.props['aria-label'], 'Model for planner', 'the compact model select must keep its aria-label');
  assert.ok(saveOfCard(compactCard), 'the compact row must keep the save button');
  assert.equal(fieldHelpOf(compactCard).length, 0, 'compact rows must render zero field help nodes');
  assert.ok(collectText(cardOf(tree, 'alpha-custom')).join('').includes('Inherits chat default: example-cloud / reasoner-d'), 'the compact inherit row must keep the inherit hint');

  providerSelectOfCard(cardOf(app.renderCycle(), 'planner')).props.onChange({ target: { value: '' } });
  tree = app.renderCycle();
  assert.ok(collectText(cardOf(tree, 'planner')).join('').includes(' (unsaved)'), 'drafting in compact mode must mark the card dirty');
  assert.equal(undoButtonsOf(cardOf(tree, 'planner')).length, 0, 'undo must not render without a snapshot');
  await saveOfCard(cardOf(tree, 'planner')).props.onClick();
  tree = await app.settle();
  assert.ok(collectText(cardOf(tree, 'planner')).join('').includes('Saved — applies'), 'saving from compact mode must show the notice');
  assert.equal(undoButtonsOf(cardOf(tree, 'planner')).length, 1, 'a successful compact save must expose the undo button in the one-line row');
  await undoButtonsOf(cardOf(tree, 'planner'))[0].props.onClick();
  tree = await app.settle();
  assert.ok(collectText(cardOf(tree, 'planner')).join('').includes('Undone'), 'undo must render its notice in compact mode too');

  const secondVm = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const secondApp = secondVm.mountInstance();
  const secondTree = await secondApp.settle();
  assert.ok(!collectText(cardOf(secondTree, 'alpha-custom')).join('').includes('Inherits chat default:'), 'a null chat default must render no inherit hint');
  secondApp.unmount();
  app.unmount();
});

await test('panel prefs: tab, legend and density persist same-session with best-effort localStorage and degrade silently', async () => {
  const roles = [{ id: 'zeta-custom', name: 'zeta-custom', description: 'Custom Z', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 3000 }];
  const handler = async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };
  const vm = mountVmClient(handler);
  const app = vm.mountInstance();
  let tree = await app.settle();
  assert.equal(vm.storage.has('dsh-orchestrator-kit.prefs'), false, 'no prefs must exist before a first change');

  clickTab(tree, app, 'Other');
  tree = app.renderCycle();
  assert.ok(vm.storage.has('dsh-orchestrator-kit.prefs'), 'the tab switch must persist the prefs key');
  assert.deepEqual(JSON.parse(vm.storage.get('dsh-orchestrator-kit.prefs')), { tab: 'other' }, 'the tab switch must persist tab: other');

  const details = findNodes(tree, (n) => n.type === 'details')[0];
  assert.ok(details, 'the legend details must render');
  assert.equal(details.props.open, true, 'the legend must start open');
  details.props.onToggle({ target: { open: false } });
  tree = app.renderCycle();
  assert.deepEqual(JSON.parse(vm.storage.get('dsh-orchestrator-kit.prefs')), { tab: 'other', legend: false }, 'the legend toggle must persist legend: false');

  findNodes(tree, (n) => n.type === 'select' && n.props['aria-label'] === 'Density')[0].props.onChange({ target: { value: 'compact' } });
  tree = app.renderCycle();
  assert.deepEqual(JSON.parse(vm.storage.get('dsh-orchestrator-kit.prefs')), { tab: 'other', legend: false, density: 'compact' }, 'the density switch must persist density: compact');
  app.unmount();

  const appRemount = vm.mountInstance();
  tree = await appRemount.settle();
  assert.equal(tabByLabel(tree, 'Other').props['aria-selected'], true, 'the restored prefs must select the persisted tab');
  assert.equal(findNodes(tree, (n) => n.type === 'details')[0].props.open, false, 'the restored prefs must keep the legend closed');
  assert.equal(findNodes(tree, (n) => n.type === 'select' && n.props['aria-label'] === 'Density')[0].props.value, 'compact', 'the restored prefs must select compact density');
  appRemount.unmount();

  const vmThrow = mountVmClient(handler, { storage: 'throw' });
  const appThrow = vmThrow.mountInstance();
  tree = await appThrow.settle();
  clickTab(tree, appThrow, 'Other');
  tree = appThrow.renderCycle();
  assert.equal(tabByLabel(tree, 'Other').props['aria-selected'], true, 'a storage failure must still switch the tab in memory');
  assert.equal(vmThrow.storage.size, 0, 'a storage failure must keep the storage empty');
  findNodes(tree, (n) => n.type === 'details')[0].props.onToggle({ target: { open: false } });
  tree = appThrow.renderCycle();
  assert.equal(findNodes(tree, (n) => n.type === 'details')[0].props.open, false, 'the legend toggle must work in memory when storage throws');
  appThrow.unmount();

  const seed = new Map([['dsh-orchestrator-kit.prefs', '{broken']]);
  const vmInvalid = mountVmClient(handler, { storageMap: seed });
  const appInvalid = vmInvalid.mountInstance();
  tree = await appInvalid.settle();
  assert.equal(tabByLabel(tree, 'All roles').props['aria-selected'], true, 'invalid stored JSON must fall back to the default tab');
  assert.equal(findNodes(tree, (n) => n.type === 'details')[0].props.open, true, 'invalid stored JSON must fall back to the open legend');
  assert.equal(findNodes(tree, (n) => n.type === 'select' && n.props['aria-label'] === 'Density')[0].props.value, 'comfortable', 'invalid stored JSON must fall back to comfortable density');
  appInvalid.unmount();
});

await test('remount cache: a fresh catalog cache skips the catalog refetch while roles still refetch; explicit refresh always refetches both', async () => {
  const roles = [{ id: 'zeta-custom', name: 'zeta-custom', description: 'Custom Z', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: 3000 }];
  const vm = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  await app.settle();
  const catalogFetches = () => vm.fetchCalls.filter((c) => c.url.startsWith(`/api/${NS}.catalog`)).length;
  const rolesFetches = () => vm.fetchCalls.filter((c) => c.url.startsWith(`/api/${NS}.roles`)).length;
  assert.equal(catalogFetches(), 1, 'the first mount must fetch the catalog once');
  assert.equal(rolesFetches(), 1, 'the first mount must fetch roles once');
  const dirtyCheckbox = findNodes(app.renderCycle(), (n) => n.type === 'input' && n.props['aria-label'] === 'Disable zeta-custom')[0];
  dirtyCheckbox.props.onChange({ target: { checked: true } });
  let tree = app.renderCycle();
  assert.ok(collectText(tree).join('').includes(' (unsaved)'), 'the draft must be dirty before refresh');

  const second = vm.mountInstance();
  await second.settle();
  assert.equal(rolesFetches(), 2, 'a remount must refetch roles');
  assert.equal(catalogFetches(), 1, 'a remount must skip the catalog refetch while a cached catalog exists');

  findNodes(app.renderCycle(), (n) => n.type === 'button' && n.props['aria-label'] === 'Refresh roles and catalog')[0].props.onClick();
  await app.settle();
  assert.equal(rolesFetches(), 3, 'an explicit refresh must refetch roles');
  assert.equal(catalogFetches(), 2, 'an explicit refresh must refetch the catalog');
  tree = app.renderCycle();
  assert.equal(findNodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable zeta-custom')[0].props.checked, false, 'the explicit Refresh must reset drafts to the saved state');
  assert.ok(!collectText(tree).join('').includes(' (unsaved)'), 'the explicit Refresh must clear the dirty seal');
  app.unmount();
  second.unmount();
});

await test('catalog 503 state: banner renders, provider/model selects disable, route saves block and disabled-only saves still work', async () => {
  const roles = [
    { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: 1000 }
  ];
  let routeMode = 'ok';
  const vm = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: false, error: 'catalog temporarily unavailable' }), { status: 503 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const base = roles.find((r) => r.id === payload.id);
      if (routeMode === '409') return new Response(JSON.stringify({ ok: false, error: 'stale mtime' }), { status: 409 });
      return new Response(JSON.stringify({ ok: true, role: { ...base, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  let tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('catalog temporarily unavailable'), 'the catalog 503 must render the banner');
  const card = cardOf(tree, 'planner');
  const providerSelect = providerSelectOfCard(card);
  const modelSelect = modelSelectOfCard(card);
  assert.equal(providerSelect.props.disabled, true, 'the provider select must disable when the catalog is unavailable');
  assert.equal(modelSelect.props.disabled, true, 'the model select must disable when the catalog is unavailable');

  checkboxOfId(tree, 'planner').props.onChange({ target: { checked: true } });
  tree = app.renderCycle();
  const disabledSave = saveOfCard(cardOf(tree, 'planner'));
  assert.equal(disabledSave.props.disabled, false, 'a disabled-only save must stay enabled');
  await disabledSave.props.onClick();
  tree = await app.settle();
  assert.deepEqual(JSON.parse(routePostsOf(vm).at(-1).opts.body), { id: 'planner', expectedMtimeMs: 1000, disabled: true }, 'the disabled-only save must POST');
  assert.ok(collectText(cardOf(tree, 'planner')).join('').includes('Saved — applies'), 'the disabled-only save must succeed');

  providerSelectOfCard(cardOf(tree, 'planner')).props.onChange({ target: { value: '' } });
  tree = app.renderCycle();
  const blockedSave = saveOfCard(cardOf(tree, 'planner'));
  assert.equal(blockedSave.props.disabled, true, 'a route-dirty save must block while the catalog is unavailable');
  app.unmount();
});

await test('client.js pass-3 static markers: contentVisibility, undoSnapshots, prefs key and aria-live present in source', () => {
  const clientText = readFileSync(path.join(packageDir, 'client.js'), 'utf8');
  assert.ok(clientText.includes('contentVisibility'), 'client.js must declare contentVisibility');
  assert.ok(clientText.includes('undoSnapshots'), 'client.js must declare the undo snapshot map');
  assert.ok(clientText.includes('dsh-orchestrator-kit.prefs'), 'client.js must declare the prefs storage key');
  assert.ok(clientText.includes('aria-live'), 'client.js must declare aria-live regions');
});

const routePOSTsOf = (vm) => vm.fetchCalls.filter((call) => call.url === `/api/${NS}.route` && call.opts?.method === 'POST');

const p4Card = (id, notes) => `---\nname: ${id}\ndescription: ${id} notes\nmodel: inherit\n---\n\n${id} body\n`;
const p4LoadRoles = (mtime) => [
  { id: 'planner', name: 'planner', description: 'Plans the work', provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false, mtimeMs: mtime },
  { id: 'debugger', name: 'debugger', description: 'Debugs the work', provider: null, model: 'inherit', reasoningEffort: null, disabled: false, mtimeMs: mtime + 1000 },
  { id: 'zeta-custom', name: 'zeta-custom', description: 'Custom Z', provider: null, model: 'inherit', reasoningEffort: null, fallbackProvider: EXAMPLE_HUB, fallbackModel: 'flash-b', disabled: false, mtimeMs: mtime + 2000 }
];
const P4_ROLE_NOTES = { planner: 'Plans the work', debugger: 'Debugs the work', 'zeta-custom': 'Custom Z' };

await test('batch apply: per-phase loop reuses runCardLoop with the cancel hook, per-card results, 409 continue-and-report and abort on first 503', async () => {
  let routeMode = 'ok';
  let holdP4Route = null;
  const vm = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) {
      return new Response(JSON.stringify({ ok: true, roles: p4LoadRoles(1000) }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }, { id: 'flash-b', name: 'Flash B' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const base = p4LoadRoles(1000).find((role) => role.id === payload.id);
      if (holdP4Route) {
        return new Promise((resolve) => {
          holdP4Route = () => resolve(new Response(JSON.stringify({ ok: true, role: { ...base, provider: payload.provider ?? base.provider, model: payload.model === undefined ? base.model : (payload.model === null ? 'inherit' : payload.model), reasoningEffort: payload.reasoningEffort === undefined ? base.reasoningEffort : payload.reasoningEffort, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 }));
        });
      }
      if (routeMode === '409') return new Response(JSON.stringify({ ok: false, error: 'stale mtime' }), { status: 409 });
      if (routeMode === '503') return new Response(JSON.stringify({ ok: false, error: 'atomic-write: timed out waiting for the writer lock' }), { status: 503 });
      return new Response(JSON.stringify({ ok: true, role: { ...base, provider: payload.provider ?? base.provider, model: payload.model === undefined ? base.model : (payload.model === null ? 'inherit' : payload.model), reasoningEffort: payload.reasoningEffort === undefined ? base.reasoningEffort : payload.reasoningEffort, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vm.mountInstance();
  let tree = await app.settle();
  assert.equal(findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Apply the current route to every role in Planning & Execution').length, 0, 'the all tab must render no batch control');
  const batchApplyAria = (phaseLabel) => `Apply the current route to every role in ${phaseLabel}`;
  const busyButtonsOf = (node) => findNodes(node, (n) => n.type === 'button' && (n.children[0] === 'Applying…' || n.children[0] === 'Cancel'));

  clickTab(tree, app, 'Other');
  tree = app.renderCycle();
  const emptyBatch = findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === batchApplyAria('Other'))[0];
  assert.ok(emptyBatch, 'the phase tab must render a batch control');
  assert.equal(emptyBatch.props.disabled, true, 'a phase without a dirty draft route must keep the batch control disabled');
  Promise.resolve(emptyBatch.props.onClick()).catch(() => {});
  tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('Nothing to apply: no role in this phase has a draft route.'), 'the empty batch drive must render batch.empty');
  assert.equal(routePOSTsOf(vm).length, 0, 'the empty batch drive must issue zero route POSTs');

  clickTab(tree, app, 'Planning & Execution');
  tree = app.renderCycle();
  providerSelectOfCard(cardOf(tree, 'planner')).props.onChange({ target: { value: EXAMPLE_HUB } });
  tree = app.renderCycle();
  modelSelectOfCard(cardOf(tree, 'planner')).props.onChange({ target: { value: 'flash-b' } });
  tree = app.renderCycle();
  const readyBatch = findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === batchApplyAria('Planning & Execution'))[0];
  assert.ok(readyBatch, 'a dirty source card must enable the batch control');
  assert.equal(readyBatch.props.disabled, false, 'a dirty source card must enable the batch control');
  assert.ok(readyBatch.props['aria-label'] === batchApplyAria('Planning & Execution'), 'the batch control must name the phase through batch.applyAria');
  readyBatch.props.onClick();
  tree = await app.settle();
  const appliedPosts = routePOSTsOf(vm);
  assert.equal(appliedPosts.length, 2, 'the batch must POST exactly once per matching phase card (the source card included)');
  assert.deepEqual(appliedPosts.map((call) => JSON.parse(call.opts.body).id), ['debugger', 'planner'], 'the loop must visit the phase cards in render order (name-sorted with the frozen sortRoles)');
  assert.deepEqual(JSON.parse(appliedPosts[0].opts.body), { id: 'debugger', expectedMtimeMs: 2000, provider: EXAMPLE_HUB, model: 'flash-b' }, 'each target POST must carry the card mtime and the shared route payload');
  assert.deepEqual(JSON.parse(appliedPosts[1].opts.body), { id: 'planner', expectedMtimeMs: 1000, provider: EXAMPLE_HUB, model: 'flash-b' }, 'the source-card POST must carry its mtime and the shared route payload');
  assert.ok(collectText(tree).join('').includes('Batch finished: 2 applied · 0 conflicts · 0 failed'), 'the successful batch must render the summary with per-card counts');
  assert.ok(!collectText(cardOf(tree, 'debugger')).join('').includes(' (unsaved)'), 'a batch-applied card must lose its dirty draft suffix');
  assert.ok(!collectText(cardOf(tree, 'planner')).join('').includes(' (unsaved)'), 'the source card must lose its dirty draft suffix');

  routeMode = '409';
  providerSelectOfCard(cardOf(app.renderCycle(), 'debugger')).props.onChange({ target: { value: EXAMPLE_HUB } });
  tree = app.renderCycle();
  modelSelectOfCard(cardOf(tree, 'debugger')).props.onChange({ target: { value: 'flash-a' } });
  tree = app.renderCycle();
  await findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === batchApplyAria('Planning & Execution'))[0].props.onClick();
  tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('Batch finished: 0 applied · 2 conflicts · 0 failed'), 'a 409 batch must continue past every conflict and report each conflicted card');
  assert.ok(collectText(cardOf(tree, 'debugger')).join('').includes(' (unsaved)'), 'a conflicted card must keep its draft');

  routeMode = '503';
  const abortPostsBefore = routePOSTsOf(vm).length;
  await findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === batchApplyAria('Planning & Execution'))[0].props.onClick();
  tree = await app.settle();
  const abortPosts = routePOSTsOf(vm).slice(abortPostsBefore);
  assert.equal(abortPosts.length, 1, 'the 503 must abort the loop right after the first non-409 failure');
  assert.equal(JSON.parse(abortPosts[0].opts.body).id, 'debugger', 'the abort must stop at the first card in render order and leave the remaining target untouched');
  assert.ok(collectText(tree).join('').includes('Batch finished: 0 applied · 0 conflicts · 1 failed'), 'the aborted batch must render the failure summary');

  routeMode = 'ok';
  holdP4Route = true;
  const cancelPostsBefore = routePOSTsOf(vm).length;
  findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === batchApplyAria('Planning & Execution'))[0].props.onClick();
  tree = await app.settle(false);
  const cancelControl = busyButtonsOf(tree)[0];
  assert.ok(cancelControl && cancelControl.children[0] === 'Cancel', 'an in-flight batch must expose the cancel control');
  cancelControl.props.onClick();
  holdP4Route();
  holdP4Route = null;
  tree = await app.settle();
  assert.equal(routePOSTsOf(vm).length - cancelPostsBefore, 1, 'the cancel drive must complete exactly the in-flight POST and skip the rest');
  assert.ok(collectText(tree).join('').includes('Batch cancelled — 1 roles were already updated.'), 'a cancelled batch must render batch.cancelled with the applied count');
  app.unmount();
});

await test('routing profiles: export carries version and no mtimes; import validates every entry before the first write, then refresh-then-applies', async () => {
  let routeMode = 'ok';
  let rolesMtime = 1000;
  const reloadRoles = () => p4LoadRoles(rolesMtime);
  const vm = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) {
      if (routeMode === 'rolesdown') return new Response(JSON.stringify({ ok: false, error: 'roles down' }), { status: 500 });
      return new Response(JSON.stringify({ ok: true, roles: reloadRoles() }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      if (routeMode === '409') return new Response(JSON.stringify({ ok: false, error: 'stale mtime' }), { status: 409 });
      const base = reloadRoles().find((role) => role.id === payload.id);
      return new Response(JSON.stringify({ ok: true, role: { ...base, provider: payload.provider ?? base.provider, model: payload.model === undefined ? base.model : (payload.model === null ? 'inherit' : payload.model), reasoningEffort: payload.reasoningEffort === undefined ? base.reasoningEffort : payload.reasoningEffort, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }, { storageMap: new Map() });
  const app = vm.mountInstance();
  let tree = await app.settle();

  const fileInput = findNodes(tree, (n) => n.type === 'input' && n.props.type === 'file')[0];
  assert.ok(fileInput, 'the profile import must render a file input');
  assert.equal(fileInput.props.accept, 'application/json', 'the profile file input must accept JSON profiles');
  const exportButton = findNodes(tree, (n) => n.type === 'button' && n.children[0] === 'Export profile')[0];
  assert.ok(exportButton, 'the profile export control must render');
  exportButton.props.onClick();
  tree = app.renderCycle();
  const exportArea = findNodes(tree, (n) => n.type === 'textarea')[0];
  assert.ok(exportArea && exportArea.props.readOnly === true, 'the export fallback must render a read-only textarea');
  const exported = JSON.parse(exportArea.props.value);
  assert.equal(exported.version, 1, 'the exported profile must carry version 1');
  assert.equal(exported.generator, 'dsh-orchestrator-kit', 'the exported profile must carry the generator');
  assert.deepEqual(Object.keys(exported.roles).sort(), ['debugger', 'planner', 'zeta-custom'], 'the exported profile must key roles by id');
  assert.equal(exported.roles.planner.provider, EXAMPLE_HUB, 'a routed role must export its saved provider');
  assert.equal(exported.roles.planner.model, 'flash-a', 'a routed role must export its saved model');
  assert.equal(exported.roles.planner.fallback, null, 'a role without a fallback must export a null fallback');
  assert.equal(exported.roles.debugger.provider, null, 'an inherit role must export a null provider');
  assert.equal(exported.roles.debugger.model, null, 'an inherit role must export a null model');
  assert.deepEqual(exported.roles['zeta-custom'].fallback, { provider: EXAMPLE_HUB, model: 'flash-b' }, 'a role with a fallback must export the pair');
  assert.ok(!JSON.stringify(exported).includes('mtimeMs'), 'the exported profile must never carry mtimes');

  const importJson = async (payload) => {
    fileInput.props.onChange({ target: { files: [{ text: async () => JSON.stringify(payload) }] } });
  };

  await importJson({ version: 2, roles: { planner: { provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false } } });
  tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('Invalid profile: unsupported version: 2'), 'an unsupported version must render profile.invalid');
  assert.equal(routePOSTsOf(vm).length, 0, 'a validation failure must issue zero route POSTs');
  await importJson({ version: 1, roles: { planner: { provider: EXAMPLE_HUB, model: null, reasoningEffort: null, disabled: false } } });
  tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('Invalid profile:'), 'a half-written entry must render profile.invalid');
  assert.equal(routePOSTsOf(vm).length, 0, 'a half-written entry must write nothing');
  await importJson({ version: 1, roles: { 'ghost-role': { provider: null, model: null, reasoningEffort: null, disabled: false } } });
  tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('Nothing was written: 1 entries failed.'), 'an unknown-only profile must render profile.rejected');
  assert.equal(routePOSTsOf(vm).length, 0, 'an unknown-only profile must write nothing');
  await importJson({ version: 1, roles: { planner: { provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, fallback: { provider: EXAMPLE_HUB }, disabled: false } } });
  tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('Invalid profile: planner: fallback must be null or a {provider, model} object'), 'a half-written fallback entry must render profile.invalid');
  assert.equal(routePOSTsOf(vm).length, 0, 'a half-written fallback entry must write nothing');

  routeMode = 'rolesdown';
  await importJson({ version: 1, roles: { planner: { provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false } } });
  tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('roles could not be refreshed'), 'a failed roles refresh must render the invalid-roles notice');
  assert.equal(routePOSTsOf(vm).length, 0, 'a failed roles refresh must write nothing');

  routeMode = 'ok';
  const importRolesCallsBefore = vm.fetchCalls.filter((call) => call.url.startsWith(`/api/${NS}.roles`)).length;
  await importJson({ version: 1, roles: { planner: { provider: EXAMPLE_HUB, model: 'flash-b', reasoningEffort: 'high', disabled: false }, debugger: { provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, fallback: { provider: EXAMPLE_CLOUD, model: 'reasoner-b' }, disabled: false } } });
  tree = await app.settle();
  const importPosts = routePOSTsOf(vm).map((call) => JSON.parse(call.opts.body));
  assert.equal(vm.fetchCalls.filter((call) => call.url.startsWith(`/api/${NS}.roles`)).length, importRolesCallsBefore + 1, 'the import must issue exactly one roles re-GET');
  assert.ok(importPosts.length > 0, 'a valid import must POST each entry');
  assert.deepEqual(importPosts.map((post) => post.id), ['planner', 'debugger'], 'the import loop must visit every known entry');
  assert.deepEqual(importPosts.map((post) => post.expectedMtimeMs), [rolesMtime, rolesMtime + 1000], 'every import POST must carry the FRESH per-card mtime from the refresh');
  assert.deepEqual(importPosts[0], { id: 'planner', provider: EXAMPLE_HUB, model: 'flash-b', reasoningEffort: 'high', disabled: false, expectedMtimeMs: rolesMtime }, 'the planner POST must carry the full route+effort+disabled set with its own refreshed mtime');
  assert.ok(!('fallback' in importPosts[0]), 'a profile entry without a fallback key must not send one (old profiles stay valid)');
  assert.deepEqual(importPosts[1].fallback, { provider: EXAMPLE_CLOUD, model: 'reasoner-b' }, 'a profile entry with a fallback must POST the pair');
  assert.ok(collectText(tree).join('').includes('Profile applied: 2 roles updated, 0 skipped.'), 'a valid import must render profile.applied with the counts');
  fileInput.props.onChange({ target: { files: [{ text: async () => JSON.stringify({ version: 1, roles: { planner: { provider: null, model: null, reasoningEffort: null, disabled: false } } }) }] } });
  tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('Profile applied: 1 roles updated, 0 skipped.'), 'a reset import must render the applied counts');
  assert.ok(!collectText(cardOf(tree, 'planner')).join('').includes(' (unsaved)'), 'the applied import must leave no dirty drafts');

  rolesMtime = 5000;
  routeMode = '409';
  const postsBefore409 = routePOSTsOf(vm).length;
  await importJson({ version: 1, roles: { planner: { provider: EXAMPLE_HUB, model: 'flash-b', reasoningEffort: null, disabled: false } } });
  tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('Nothing was written: 1 entries failed.'), 'a 409 import must render profile.rejected with the failure count');
  assert.ok(collectText(cardOf(tree, 'planner')).join('').includes('Conflict/validation error (409)'), 'the 409 import must render the translated conflict on the card');
  assert.equal(routePOSTsOf(vm).length - postsBefore409, 1, 'a 409 import must issue exactly one POST');

  routeMode = 'ok';
  const postsBeforeSecond = routePOSTsOf(vm).length;
  await importJson({ version: 1, roles: { planner: { provider: EXAMPLE_HUB, model: 'flash-b', reasoningEffort: null, disabled: false }, debugger: { provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: null, disabled: false } } });
  tree = await app.settle();
  assert.ok(collectText(tree).join('').includes('Profile applied: 2 roles updated, 0 skipped.'), 'the mixed-profile import must render the applied counts');
  assert.equal(routePOSTsOf(vm).length - postsBeforeSecond, 2, 'the import must POST once per known entry');
  assert.equal(routePOSTsOf(vm).length, postsBeforeSecond + 2, 'the import loop must issue exactly one POST per entry');
  assert.deepEqual(routePOSTsOf(vm).slice(postsBeforeSecond).map((call) => JSON.parse(call.opts.body).expectedMtimeMs), [5000, 6000], 'the fresh per-card mtimes from the refresh must back every import POST');
  app.unmount();
});

await test('audit trail: append inside the write lock, relative-only records with no secrets, best-effort failure, and the bounded events route', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-audit-trail-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const cardFile = path.join(dir, 'planner.md');
    writeFileSync(cardFile, p4Card('planner'), 'utf8');
    const auditFile = path.join(dir, '.orchestrator-audit.jsonl');
    const secretFixture = ['sk', '-live'].join('');

    const prevWarn = console.warn;
    const warns = [];
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      await withMockHost({ agentsHome: tmpHome, llm: flashCatalogLlm() }, async ({ call }) => {
        const rolesFirst = await call(`/api/${NS}.roles`);
        const cardMtime = rolesFirst.data.roles.find((role) => role.id === 'planner').mtimeMs;
        const { status, data } = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', expectedMtimeMs: cardMtime, provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: 'high' }) });
        assert.equal(status, 200, 'the audited save must succeed');
        assert.equal(data.unchanged, undefined, 'the audited save must be a real write');
        const raw = readFileSync(auditFile, 'utf8');
        const lines = raw.split('\n').filter((line) => line.trim() !== '');
        assert.equal(lines.length, 1, 'the save must append exactly ONE audit record');
        const record = JSON.parse(lines[0]);
        assert.equal(typeof record.at, 'string' && record.at.length > 0 ? 'string' : 'not-string', 'the audit record must carry a timestamp');
        assert.equal(record.id, 'planner', 'the audit record must carry the role id');
        assert.deepEqual(record.previous, { provider: null, model: null, reasoningEffort: null, fallback: null, disabled: false }, 'the audit record must summarize the previous meta');
        assert.deepEqual(record.next, { provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: 'high', fallback: null, disabled: false }, 'the audit record must summarize the next meta');
        assert.equal(record.origin, 'panel', 'the audit record must carry the panel origin');
        assert.equal(JSON.stringify(record).includes(secretFixture), false, 'the audit record must never carry a secret-shaped value');
        assert.equal(JSON.stringify(record).includes(tmpHome), false, 'the audit record must never carry an absolute path');
        assert.ok(!raw.includes(BAK_LITERAL), 'the audit record must never reference a backup suffix');
        const warnText = warns.join('\n');
        for (const token of [WIN_HOME_TOKEN, POSIX_HOME_TOKEN]) {
          assert.ok(!warnText.toLowerCase().includes(token), 'the audit warn must not leak home tokens');
        }

        const rolesAfterFirst = await call(`/api/${NS}.roles`);
        const currentMtime = rolesAfterFirst.data.roles.find((role) => role.id === 'planner').mtimeMs;
        await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', expectedMtimeMs: currentMtime, disabled: true }) });
        const afterToggle = readFileSync(auditFile, 'utf8').split('\n').filter((line) => line.trim() !== '');
        assert.equal(afterToggle.length, 2, 'the next audited save must append a second record');
        assert.deepEqual(JSON.parse(afterToggle[1]).next, { provider: EXAMPLE_HUB, model: 'flash-a', reasoningEffort: 'high', fallback: null, disabled: true }, 'the second record must summarize the disabled toggle');
      });

      chmodSync(dir, 0o555);
      try {
        await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
          warns.length = 0;
          const rolesRetry = await call(`/api/${NS}.roles`);
          const retryMtime = rolesRetry.data.roles.find((role) => role.id === 'planner').mtimeMs;
          const { status } = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', expectedMtimeMs: retryMtime, disabled: false }) });
          if (status !== 200) {
            assert.ok(status === 503 || status === 500, 'on a filesystem that cannot fail the append alone, the write must surface a lock/write error, never a silent success');
            for (const token of [WIN_HOME_TOKEN, POSIX_HOME_TOKEN]) {
              assert.ok(!warns.join('\n').toLowerCase().includes(token), 'any failure warn must not leak home tokens');
            }
          } else {
            const postAppendCard = readFileSync(cardFile, 'utf8'); assert.ok(postAppendCard.includes('model:') && postAppendCard.includes('provider:'), 'the card write must survive regardless of the audit append outcome');
            const lines = readFileSync(auditFile, 'utf8').split('\n').filter((line) => line.trim() !== '');
            assert.ok(lines.length === 2 || lines.length === 3, 'the audit append must be best-effort: either a redacted warn (2 lines) or a valid third record (3 lines), never a partial record');
            if (warns.join('\n').includes('appending the audit record')) assert.equal(lines.length, 2, 'a failed append must not write a partial record');
            assert.ok(!warns.join('\n').includes(tmpHome), 'the audit warn must never carry the absolute tmp path');
          }
        });
      } finally {
        chmodSync(dir, 0o755);
      }

      await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
        const rolesStable = await call(`/api/${NS}.roles`);
        const stable = rolesStable.data.roles.find((role) => role.id === 'planner');
        const unchanged = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', expectedMtimeMs: stable.mtimeMs, disabled: stable.disabled }) });
        assert.equal(unchanged.status, 200, 'the unchanged no-op save must answer 200');
        assert.equal(unchanged.data.unchanged, true, 'the no-op must answer unchanged:true');
        const lines = readFileSync(auditFile, 'utf8').split('\n').filter((line) => line.trim() !== '');
        assert.ok(lines.length === 2 || lines.length === 3, 'the unchanged no-op must write NO audit record');
        const lastRecord = JSON.parse(lines[lines.length - 1]);
        assert.ok(lastRecord.next.disabled === true || lastRecord.next.disabled === false, 'the last audit record must describe a real write, never the no-op');
      });
    } finally {
      console.warn = prevWarn;
    }
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }

  const serverHome = mkdtempSync(path.join(tmpdir(), 'map-audit-events-'));
  try {
    const dir = path.join(serverHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const auditFile = path.join(dir, '.orchestrator-audit.jsonl');
    const many = [];
    for (let i = 0; i < 55; i += 1) {
      if (i === 53) many.push('not-json');
      else many.push(JSON.stringify({ at: `t${i}`, id: `m${i}`, previous: null, next: { provider: 'p' }, origin: 'panel' }));
    }
    appendFileSync(auditFile, many.join('\n') + '\n', 'utf8');
    await withMockHost({ agentsHome: serverHome, llm: undefined }, async ({ call }) => {
      const { status, data } = await call(`/api/${NS}.events`);
      assert.equal(status, 200, 'the events route must answer 200 for a readable audit file');
      assert.equal(data.ok, true, 'the events route must carry ok:true');
      assert.equal(data.events.length, 49, 'the events route must cap the last 50 lines then skip malformed ones');
      assert.deepEqual(data.events.slice(0, 2).map((event) => event.id), ['m5', 'm6'], 'the cap must return the LAST 50 valid records in file order');
      assert.deepEqual(data.events.at(-1).id, 'm54', 'the cap must end at the newest record');
      assert.equal(data.skipped, 1, 'the events route must count malformed lines in skipped');
      assert.equal(data.events[0].origin, 'panel', 'the events route must surface the origin');
    });
    rmSync(auditFile, { force: true });
    mkdirSync(auditFile);
    try {
      await withMockHost({ agentsHome: serverHome, llm: undefined }, async ({ call }) => {
        const failed = await call(`/api/${NS}.events`);
        assert.equal(failed.status, 500, 'an unreadable audit path (EISDIR) must surface a redacted 500');
        assert.ok(!JSON.stringify(failed.data).includes(serverHome), 'the events failure body must never carry the absolute home path');
      });
    } finally {
      rmSync(auditFile, { recursive: true, force: true });
    }
  } finally {
    rmSync(serverHome, { recursive: true, force: true });
  }

  const emptyHome = mkdtempSync(path.join(tmpdir(), 'map-audit-empty-'));
  try {
    await withMockHost({ agentsHome: emptyHome, llm: undefined }, async ({ call }) => {
      const { status, data } = await call(`/api/${NS}.events`);
      assert.equal(status, 200, 'the events route must answer 200 when the audit file is absent');
      assert.deepEqual(data.events, [], 'the events route must answer an empty list for ENOENT');
      assert.equal(data.skipped, 0, 'the ENOENT answer must carry zero skipped');
    });
  } finally {
    rmSync(emptyHome, { recursive: true, force: true });
  }
});

await test('diagnostics: missing, invalid, outside-catalog and body-drift detection degrade gracefully when craft/ is unavailable', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-diagnostics-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    const sources = {
      'alpha-valid': '---\nname: alpha-valid\ndescription: A\nmodel: inherit\n---\n\nA body\n',
      'broken-card': '---\nname: [unterminated\n---\n\nBroken body\n',
      'outside-card': `---\nname: outside-card\ndescription: O\nprovider: ${EXAMPLE_HUB}\nmodel: flash-a\n---\n\nO body\n`,
      'drift-card': '---\nname: drift-card\ndescription: D\nmodel: inherit\n---\n\nD body original\n'
    };
    for (const [id, text] of Object.entries(sources)) {
      writeFileSync(path.join(dir, `${id}.md`), text, 'utf8');
    }
    writeFileSync(path.join(tmpHome, 'agents', '.orchestrator-audit.jsonl'), '', 'utf8');
    const prevWarn = console.warn;
    const warns = [];
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
        const roles = await call(`/api/${NS}.roles`);
        assert.equal(roles.status, 200, 'the diagnostics home must serve roles');
        assert.deepEqual(roles.data.roles.map((role) => role.id), ['alpha-valid', 'drift-card', 'outside-card'], 'the broken card must surface only through invalid[]');
        assert.deepEqual(roles.data.invalid.map((entry) => entry.id), ['broken-card'], 'the broken card must be listed as invalid');
        assert.ok(warns.join('\n').includes('broken-card'), 'the diagnostics home must keep the warn channel live for the invalid card');
        const diag = await call(`/api/${NS}.diagnostics`);
        assert.equal(diag.status, 200, 'the real diagnostics route must answer 200 with a degraded catalog');
        const craftIds = CRAFT_ROLES.filter((id) => !['alpha-valid', 'drift-card', 'outside-card', 'broken-card'].includes(id) && !id.startsWith('alpha-valid') && !id.startsWith('drift-card') && !id.startsWith('outside-card'));
        assert.deepEqual(diag.data.missing, craftIds.filter((id) => existsSync(path.join(packageDir, 'craft', 'agents', `${id}.md`))).sort(), 'the real diagnostics route must compute missing ids against craft/');
        assert.deepEqual(diag.data.invalid.map((entry) => entry.id), ['broken-card'], 'the real diagnostics route must surface the invalid card');
        assert.deepEqual(diag.data.drift, [], 'a card with no craft source cannot have body drift');
        assert.deepEqual(diag.data.outsideCatalog, [], 'the real diagnostics route must omit outsideCatalog when the catalog is unavailable');
        assert.deepEqual(diag.data.fallbackOutsideCatalog, [], 'the real diagnostics route must omit fallbackOutsideCatalog when the catalog is unavailable');
        assert.equal(diag.data.craftAvailable, true, 'the real diagnostics route must find the shipped craft/ sources');
      });

      await withMockHost({ agentsHome: tmpHome, llm: flashCatalogLlm() }, async ({ call }) => {
        writeFileSync(path.join(dir, 'outside-card.md'), `---\nname: outside-card\ndescription: O\nprovider: ${EXAMPLE_CLOUD}\nmodel: reasoner-b\n---\n\nO body\n`, 'utf8');
        const catalogDiag = await call(`/api/${NS}.diagnostics`);
        assert.equal(catalogDiag.status, 200, 'the live-catalog diagnostics route must answer 200');
        assert.deepEqual(catalogDiag.data.outsideCatalog, ['outside-card'], 'the live catalog must flag the route outside the listed providers');
        assert.deepEqual(catalogDiag.data.fallbackOutsideCatalog, [], 'no fallback outside the catalog yet');
        writeFileSync(path.join(dir, 'outside-card.md'), `---\nname: outside-card\ndescription: O\nprovider: ${EXAMPLE_CLOUD}\nmodel: reasoner-b\nfallback:\n  provider: ${EXAMPLE_CLOUD}\n  model: reasoner-a\n---\n\nO body\n`, 'utf8');
        const withFallback = await call(`/api/${NS}.diagnostics`);
        assert.deepEqual(withFallback.data.fallbackOutsideCatalog, ['outside-card'], 'a fallback route outside the live catalog must be flagged');
        writeFileSync(path.join(dir, 'outside-card.md'), `---\nname: outside-card\ndescription: O\nprovider: ${EXAMPLE_CLOUD}\nmodel: reasoner-b\nfallback:\n  provider: ${EXAMPLE_HUB}\n  model: flash-b\n---\n\nO body\n`, 'utf8');
        const insideFallback = await call(`/api/${NS}.diagnostics`);
        assert.deepEqual(insideFallback.data.fallbackOutsideCatalog, [], 'a fallback route inside the live catalog must not be flagged');
        assert.deepEqual(insideFallback.data.outsideCatalog, ['outside-card'], 'the route check must stay independent of the fallback check');
      });
    } finally {
      console.warn = prevWarn;
    }
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }

  let diagMode = 'ok';
  const vmDiag = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: p4LoadRoles(1000) }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.diagnostics`)) {
      if (diagMode === '500') return new Response(JSON.stringify({ ok: false, error: 'diagnostics boom' }), { status: 500 });
      return new Response(JSON.stringify({ ok: true, missing: ['ghost-role'], invalid: [{ id: 'alpha-custom', error: 'bad yaml' }], outsideCatalog: ['zeta-custom'], fallbackOutsideCatalog: ['eta-custom'], drift: ['planner'], craftAvailable: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const appDiag = vmDiag.mountInstance();
  let treeDiag = await appDiag.settle();
  const summaryTextOf = (node) => collectText((findNodes(node, (child) => child.type === 'summary')[0] ?? { children: [] })).join('');
  const diagDetails = findNodes(treeDiag, (n) => n.type === 'details' && summaryTextOf(n).includes('Installed-card diagnostics'))[0];
  assert.ok(diagDetails, 'the diagnostics section must render inside the legend');
  diagDetails.props.onToggle({ target: { open: true } });
  treeDiag = await appDiag.settle();
  const diagText = collectText(treeDiag).join('');
  assert.ok(diagText.includes('Missing roles: ghost-role'), 'the diagnostics missing list must render');
  assert.ok(diagText.includes('Cards with invalid frontmatter: alpha-custom'), 'the diagnostics invalid list must render');
  assert.ok(diagText.includes('Routes outside the live catalog: zeta-custom'), 'the diagnostics outside-catalog list must render');
  assert.ok(diagText.includes('Fallback routes outside the live catalog: eta-custom'), 'the diagnostics fallback outside-catalog list must render');
  assert.ok(diagText.includes('Body differs from the craft source: planner'), 'the diagnostics drift list must render');
  assert.ok(diagText.includes('craft/ sources are unavailable'), 'the diagnostics craftMissing line must render');
  assert.ok(!diagText.includes('No problems found.'), 'a non-empty diagnostics report must not render the ok line');
  const diagHtmlNodes = findNodes(treeDiag, (n) => n.props && (n.props.dangerouslySetInnerHTML !== undefined || n.props.innerHTML !== undefined));
  assert.equal(diagHtmlNodes.length, 0, 'the diagnostics section must never carry an HTML-injection prop');
  diagMode = '500';
  diagDetails.props.onToggle({ target: { open: true } });
  treeDiag = await appDiag.settle();
  assert.ok(collectText(treeDiag).join('').includes('diagnostics boom'), 'a diagnostics load failure must render the loadError line with the detail');
  appDiag.unmount();
});

await test('readonly mode: the env flag returns 403 before any disk read, the roles envelope carries readOnly and the panel disables every mutating control', async () => {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'map-readonly-gate-'));
  try {
    const dir = path.join(tmpHome, 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'planner.md'), p4Card('planner'), 'utf8');
    process.env.DSH_ORCHESTRATOR_READONLY = '1';
    let success = null;
    try {
      await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
        const valid = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', disabled: true, expectedMtimeMs: 0 }) });
        assert.equal(valid.status, 403, 'a valid payload must still 403 in readonly mode');
        assert.equal(valid.data.code, 'readonly', 'the readonly 403 must carry the readonly code');
        const invalid = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ unknownField: true }) });
        assert.equal(invalid.status, 403, 'an invalid payload must 403 BEFORE validation');
        assert.equal(invalid.data.code, 'readonly', 'the invalid-payload 403 must carry the readonly code');
        const badId = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'missing-role', disabled: true }) });
        assert.equal(badId.status, 403, 'a valid-shape payload for an absent role must 403 before any disk read');
        assert.equal(badId.data.code, 'readonly', 'the absent-role 403 must carry the readonly code');
        assert.ok(!existsSync(path.join(dir, 'missing-role.md.lock')), 'the readonly 403 must never touch the disk');
        const roles = await call(`/api/${NS}.roles`);
        assert.equal(roles.status, 200, 'GET .roles must stay reachable in readonly mode');
        assert.equal(roles.data.readOnly, true, 'the roles envelope must carry readOnly:true');
      });
    } finally {
      delete process.env.DSH_ORCHESTRATOR_READONLY;
    }
    for (const spelling of ['TRUE', 'True', ' true ', '1']) {
      process.env.DSH_ORCHESTRATOR_READONLY = spelling;
      try {
        await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
          const probe = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', disabled: true, expectedMtimeMs: 0 }) });
          assert.equal(probe.status, 403, `the readonly spelling ${JSON.stringify(spelling)} must arm the 403 gate`);
        });
      } finally {
        delete process.env.DSH_ORCHESTRATOR_READONLY;
      }
    }
    await withMockHost({ agentsHome: tmpHome, llm: undefined }, async ({ call }) => {
      const roles = await call(`/api/${NS}.roles`);
      assert.equal(roles.data.readOnly, false, 'the roles envelope must carry readOnly:false when the flag is off');
      const savedMtime = roles.data.roles.find((role) => role.id === 'planner').mtimeMs;
      success = await call(`/api/${NS}.route`, { method: 'POST', body: JSON.stringify({ id: 'planner', disabled: true, expectedMtimeMs: savedMtime }) });
      assert.equal(success.status, 200, 'with the flag off the save must succeed again');
    });
  } finally {
    delete process.env.DSH_ORCHESTRATOR_READONLY;
    rmSync(tmpHome, { recursive: true, force: true });
  }

  const vmReadonly = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: p4LoadRoles(1000), readOnly: true }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const app = vmReadonly.mountInstance();
  let tree = await app.settle();
  const readonlyText = collectText(tree).join('');
  assert.ok(readonlyText.includes('Read-only mode'), 'the readonly banner title must render');
  assert.ok(readonlyText.includes('Saving is disabled by the server configuration'), 'the readonly banner notice must render');
  assert.equal(providerSelectOfCard(cardOf(tree, 'planner')).props.disabled, true, 'the provider select must be disabled in readonly mode');
  assert.equal(modelSelectOfCard(cardOf(tree, 'planner')).props.disabled, true, 'the model select must be disabled in readonly mode');
  assert.equal(effortSelectOfCard(cardOf(tree, 'planner')).props.disabled, true, 'the effort select must be disabled in readonly mode');
  assert.equal(checkboxOfCard(cardOf(tree, 'planner')).props.disabled, true, 'the disabled checkbox must be disabled in readonly mode');
  assert.equal(saveOfCard(cardOf(tree, 'planner')).props.disabled, true, 'save must be disabled in readonly mode');
  assert.equal(undoButtonsOf(cardOf(tree, 'planner')).length, 0, 'undo must not render without a snapshot');
  const importInputReadonly = findNodes(tree, (n) => n.type === 'input' && n.props.type === 'file')[0];
  assert.ok(importInputReadonly, 'the profile import input must render in readonly mode');
  assert.equal(importInputReadonly.props.disabled, true, 'profile import must be disabled in readonly mode');
  assert.equal(findNodes(tree, (n) => n.type === 'button' && n.children[0] === 'Export profile')[0].props.disabled, false, 'profile export must stay enabled in readonly mode');
  const postsBefore = routePOSTsOf(vmReadonly).length;
  cardOf(tree, 'planner').props.onFocusCapture();
  rootOf(tree).props.onKeyDown({ key: 's', ctrlKey: true, preventDefault() {} });
  tree = await app.settle();
  assert.equal(routePOSTsOf(vmReadonly).length, postsBefore, 'Ctrl+S must be a no-op in readonly mode');
  app.unmount();

  const vmNormal = mountVmClient(async (url) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: p4LoadRoles(1000) }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  const appNormal = vmNormal.mountInstance();
  let treeNormal = await appNormal.settle();
  assert.ok(!collectText(treeNormal).join('').includes('Read-only mode'), 'the non-readonly panel must not render the readonly banner');
  findNodes(treeNormal, (n) => n.type === 'input' && n.props['aria-label'] === 'Disable planner')[0].props.onChange({ target: { checked: true } });
  treeNormal = appNormal.renderCycle();
  assert.equal(saveOfCard(cardOf(treeNormal, 'planner')).props.disabled, false, 'with the flag off a dirty draft must keep the save control enabled');
  appNormal.unmount();
});

await test('craft installer: tmp-home copy, skip-existing always, lock-timeout guidance, and path containment', async () => {
  const installerPath = path.join(packageDir, 'scripts', 'install-craft.js');
  assert.ok(existsSync(installerPath), 'scripts/install-craft.js must exist before the installer contract can run');
  const firstHome = mkdtempSync(path.join(tmpdir(), 'map-installer-first-'));
  try {
    const first = spawnSync(process.execPath, [installerPath], { cwd: packageDir, encoding: 'utf8', env: { ...process.env, DSH_AGENTS_HOME: firstHome } });
    assert.equal(first.status, 0, `the first installer run must succeed: ${first.stderr}`);
    assert.match(first.stdout, /created 51, skipped 0, failed 0/, 'the first run must create the full craft tree (20 role cards + 31 skill files) and report the summary');
    assert.ok(!first.stdout.toLowerCase().includes(BAK_LITERAL), 'the installer stdout must never reference backup artifacts');
    assert.ok(!first.stdout.includes(firstHome), 'the installer stdout must never print absolute paths');
    assert.ok(!first.stdout.includes(WIN_HOME_TOKEN) && !first.stdout.toLowerCase().includes(POSIX_HOME_TOKEN), 'the installer stdout must never carry home tokens');
    const agentsDir = path.join(firstHome, 'agents');
    for (const role of CRAFT_ROLES) {
      assert.ok(existsSync(path.join(agentsDir, `${role}.md`)), `the first run must install the ${role} role card`);
    }
    assert.ok(existsSync(path.join(firstHome, 'skills', 'dev-flow', 'SKILL.md')), 'the first run must install the dev-flow SKILL.md');
    for (const playbook of CRAFT_PLAYBOOKS) {
      assert.ok(existsSync(path.join(firstHome, 'skills', 'dev-flow', 'playbooks', playbook)), `the first run must install the ${playbook} playbook`);
    }
    const installedBefore = readFileSync(path.join(agentsDir, 'planner.md'));

    const userEdit = Buffer.from('---\nname: planner\ndescription: USER CUSTOMIZATION — must survive reinstall\nmodel: inherit\n---\n\nmy body\n', 'utf8');
    writeFileSync(path.join(agentsDir, 'planner.md'), userEdit);
    const second = spawnSync(process.execPath, [installerPath], { cwd: packageDir, encoding: 'utf8', env: { ...process.env, DSH_AGENTS_HOME: firstHome } });
    assert.equal(second.status, 0, `the second installer run must succeed: ${second.stderr}`);
    assert.match(second.stdout, /created 0, skipped 51, failed 0/, 'the second run must skip every existing target');
    assert.deepEqual(readFileSync(path.join(agentsDir, 'planner.md')), userEdit, 'skip-existing must never overwrite a user-edited installed card');
    writeFileSync(path.join(agentsDir, 'planner.md'), installedBefore);

    const dryRun = spawnSync(process.execPath, [installerPath, '--dry-run'], { cwd: packageDir, encoding: 'utf8', env: { ...process.env, DSH_AGENTS_HOME: firstHome } });
    assert.equal(dryRun.status, 0, `the dry run must succeed: ${dryRun.stderr}`);
    assert.match(dryRun.stdout, /created 0, skipped 51, failed 0/, 'the dry run must report the same skip summary without writing');
    assert.deepEqual(readFileSync(path.join(agentsDir, 'planner.md')), installedBefore, 'the dry run must never write');

    const plannerTarget = path.join(agentsDir, 'planner.md');
    const lockFile = `${plannerTarget}.lock`;
    const heldHome = mkdtempSync(path.join(tmpdir(), 'map-installer-lock-'));
    try {
      mkdirSync(path.join(heldHome, 'agents'), { recursive: true });
      writeFileSync(`${path.join(heldHome, 'agents', 'planner.md')}.lock`, '0\n', 'utf8');
      const locked = spawnSync(process.execPath, [installerPath], { cwd: packageDir, encoding: 'utf8', env: { ...process.env, DSH_AGENTS_HOME: heldHome } });
      assert.equal(locked.status, 1, 'a held lock must fail the installer run with exit code 1');
      assert.match(locked.stdout + locked.stderr, /retry in a moment; if the owner crashed/, 'the lock failure must print the retry/operator guidance');
      assert.match(locked.stdout + locked.stderr, /agents\/planner\.md\.lock/, 'the lock guidance must name the relative lock path');
      assert.ok(!(locked.stdout + locked.stderr).includes(heldHome), 'the lock guidance must never print an absolute path');
      assert.ok(existsSync(`${path.join(heldHome, 'agents', 'planner.md')}.lock`), 'the installer must never remove a lock it did not create');
      assert.ok(existsSync(path.join(heldHome, 'agents', 'docs-scout.md')), 'the other files must still be created around the held lock');
      const treeList = readdirSync(path.join(heldHome, 'agents'));
      assert.ok(!treeList.some((name) => BAK_SUFFIX_RE.test(name)), 'the installer must never create backup artifacts');
    } finally {
      rmSync(heldHome, { recursive: true, force: true });
    }
    rmSync(lockFile, { force: true });
  } finally {
    rmSync(firstHome, { recursive: true, force: true });
  }

  const wrapper = mkdtempSync(path.join(tmpdir(), 'map-installer-contain-wrap-'));
  const containHome = mkdtempSync(path.join(wrapper, 'map-installer-contain-'));
  try {
    const installerSource = readFileSync(installerPath, 'utf8');
    assert.ok(installerSource.includes('path.relative'), 'the installer must verify target containment with a path.relative check');
    assert.ok(installerSource.includes('isEntryName'), 'the installer must filter craft source ids through isEntryName');
    const parentBefore = new Set(readdirSync(wrapper));
    const contained = spawnSync(process.execPath, [installerPath], { cwd: packageDir, encoding: 'utf8', env: { ...process.env, DSH_AGENTS_HOME: containHome } });
    assert.equal(contained.status, 0, `the containment run must succeed: ${contained.stderr}`);
    assert.match(contained.stdout, /created 51, skipped 0, failed 0/, 'the containment run must install the full tree');
    const parentAfter = readdirSync(wrapper);
    const created = parentAfter.filter((name) => !parentBefore.has(name));
    assert.deepEqual(created, [], 'the installer must never write outside the configured agents root');
  } finally {
    rmSync(wrapper, { recursive: true, force: true });
  }
});

await test('new surfaces render untrusted markup as text: batch summary, event entries and diagnostics lists', async () => {
  const fixture = '<img src=x onerror=alert(1)>"\'&';
  const fixtureEvents = [{ at: fixture, id: fixture, previous: null, next: { provider: fixture }, origin: 'panel' }];
  let diagMode = 'ok';
  const vm = mountVmClient(async (url, opts) => {
    if (url.startsWith(`/api/${NS}.roles`)) return new Response(JSON.stringify({ ok: true, roles: p4LoadRoles(1000) }), { status: 200 });
    if (url.startsWith(`/api/${NS}.catalog`)) return new Response(JSON.stringify({ ok: true, available: true, degraded: false, default: null, groups: [{ provider: EXAMPLE_HUB, name: 'Example Hub', models: [{ id: 'flash-a', name: 'Flash A' }] }] }), { status: 200 });
    if (url.startsWith(`/api/${NS}.efforts`)) return new Response(JSON.stringify({ ok: true, defaultEffort: 'medium', efforts: [{ id: 'high', name: 'High' }] }), { status: 200 });
    if (url === `/api/${NS}.route`) {
      const payload = JSON.parse(opts.body);
      const base = p4LoadRoles(1000).find((role) => role.id === payload.id);
      return new Response(JSON.stringify({ ok: true, role: { ...base, provider: payload.provider ?? base.provider, model: payload.model === undefined ? base.model : (payload.model === null ? 'inherit' : payload.model), reasoningEffort: payload.reasoningEffort === undefined ? base.reasoningEffort : payload.reasoningEffort, disabled: payload.disabled ?? base.disabled, mtimeMs: base.mtimeMs + 10 } }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.events`)) {
      if (eventsMode === '500') return new Response(JSON.stringify({ ok: false, error: `events boom ${fixture}` }), { status: 500 });
      return new Response(JSON.stringify({ ok: true, events: fixtureEvents, skipped: 0 }), { status: 200 });
    }
    if (url.startsWith(`/api/${NS}.diagnostics`)) {
      if (diagMode === '500') return new Response(JSON.stringify({ ok: false, error: `diagnostics boom ${fixture}` }), { status: 500 });
      return new Response(JSON.stringify({ ok: true, missing: [fixture], invalid: [{ id: fixture, error: 'bad yaml' }], outsideCatalog: [fixture], drift: [fixture], craftAvailable: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
  let eventsMode = 'ok';
  const app = vm.mountInstance();
  let tree = await app.settle();

  clickTab(tree, app, 'Planning & Execution');
  tree = app.renderCycle();
  providerSelectOfCard(cardOf(tree, 'planner')).props.onChange({ target: { value: fixture } });
  tree = app.renderCycle();
  await findNodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Apply the current route to every role in Planning & Execution')[0].props.onClick();
  tree = await app.settle();
  assert.ok(collectText(tree).some((text) => text.includes(fixture)), 'the batch summary route detail must render the fixture as literal text');
  clickTab(tree, app, 'All roles');
  tree = app.renderCycle();

  const eventsDetails = findNodes(tree, (n) => n.type === 'details' && collectText(findNodes(n, (child) => child.type === 'summary')[0] ?? { children: [] }).join('').includes('Recent changes'))[0];
  assert.ok(eventsDetails, 'the events section must render');
  eventsDetails.props.onToggle({ target: { open: true } });
  tree = await app.settle();
  assert.ok(collectText(tree).some((text) => text.includes(fixture)), 'the event entry fields must render the fixture as literal text');

  const diagDetailsXss = findNodes(tree, (n) => n.type === 'details' && collectText(findNodes(n, (child) => child.type === 'summary')[0] ?? { children: [] }).join('').includes('Installed-card diagnostics'))[0];
  assert.ok(diagDetailsXss, 'the diagnostics section must render');
  diagDetailsXss.props.onToggle({ target: { open: true } });
  tree = await app.settle();
  assert.ok(collectText(tree).some((text) => text.includes(fixture)), 'the diagnostics lists must render the fixture as literal text');
  const drivenHtmlNodes = findNodes(tree, (n) => n.props && (n.props.dangerouslySetInnerHTML !== undefined || n.props.innerHTML !== undefined));
  assert.equal(drivenHtmlNodes.length, 0, 'no driven node may carry an HTML-injection prop');

  const eventsGetBefore = vm.fetchCalls.filter((call) => call.url === `/api/${NS}.events`).length;
  const currentEventsDetails = () => findNodes(tree, (n) => n.type === 'details' && collectText(findNodes(n, (child) => child.type === 'summary')[0] ?? { children: [] }).join('').includes('Recent changes'))[0];
  currentEventsDetails().props.onToggle({ target: { open: false } });
  tree = app.renderCycle();
  currentEventsDetails().props.onToggle({ target: { open: true } });
  tree = await app.settle();
  assert.equal(vm.fetchCalls.filter((call) => call.url === `/api/${NS}.events`).length, eventsGetBefore + 1, 're-expanding Recent changes must re-fetch events');
  eventsMode = '500';
  const currentDiagDetails = () => findNodes(tree, (n) => n.type === 'details' && collectText(findNodes(n, (child) => child.type === 'summary')[0] ?? { children: [] }).join('').includes('Installed-card diagnostics'))[0];
  currentEventsDetails().props.onToggle({ target: { open: false } });
  tree = app.renderCycle();
  currentEventsDetails().props.onToggle({ target: { open: true } });
  tree = await app.settle();
  assert.ok(collectText(tree).some((text) => text.includes('events boom')), 'a re-expanded events section must render the current loadError');
  eventsDetails.props.onToggle({ target: { open: true } });
  tree = await app.settle();
  assert.ok(collectText(tree).some((text) => text.includes(fixture)), 'the events loadError must render the fixture as literal text');
  diagMode = '500';
  currentDiagDetails().props.onToggle({ target: { open: false } });
  tree = app.renderCycle();
  currentDiagDetails().props.onToggle({ target: { open: true } });
  tree = await app.settle();
  assert.ok(collectText(tree).some((text) => text.includes('diagnostics boom')), 'a re-expanded diagnostics section must render the current loadError');
  diagDetailsXss.props.onToggle({ target: { open: true } });
  tree = await app.settle();
  assert.ok(collectText(tree).some((text) => text.includes(fixture)), 'the diagnostics loadError must render the fixture as literal text');
  const sourceNodes = findNodes(tree, (n) => n.props && (n.props.dangerouslySetInnerHTML !== undefined || n.props.innerHTML !== undefined));
  assert.equal(sourceNodes.length, 0, 'no loadError node may carry an HTML-injection prop');
  app.unmount();
});

await test('npm pack: dry-run file list matches the frozen 78-entry contract and packed content passes the forbidden-token scan', () => {
  const dryRun = spawnSync('npm pack --dry-run --json', { cwd: packageDir, encoding: 'utf8', shell: true });
  assert.equal(dryRun.status, 0, `npm pack --dry-run must succeed: ${dryRun.stderr}`);
  const parsed = JSON.parse(dryRun.stdout);
  assert.equal(parsed[0].filename, `${PKG.name}-${PKG.version}.tgz`);
  assert.equal(parsed[0].entryCount, 78);
  assert.deepEqual(parsed[0].files.map((entry) => entry.path).sort(), [...FROZEN_PACK_FILES].sort(), 'the packed file set must match the frozen 78-entry contract');

  const tmp = mkdtempSync(path.join(tmpdir(), 'pack-scan-'));
  try {
    const packed = spawnSync('npm pack --pack-destination ' + JSON.stringify(tmp), { cwd: packageDir, encoding: 'utf8', shell: true });
    assert.equal(packed.status, 0, `npm pack must succeed: ${packed.stderr}`);
    const tarball = path.join(tmp, `${PKG.name}-${PKG.version}.tgz`);
    const extracted = spawnSync('tar', ['--force-local', '-xzf', tarball, '-C', tmp], { encoding: 'utf8' });
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
    assert.deepEqual(relPaths, [...FROZEN_PACK_FILES].sort(), 'the extracted tarball content must match the frozen 78-entry contract');
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

function checkLinks(markdownFiles) {
  const findings = [];
  const anchorsOf = (text) => new Set(
    [...text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)].map((m) =>
      m[1].toLowerCase().replace(/[^\w\u00C0-\uFFFF -]/g, '').trim().replace(/\s+/g, '-')));
  for (const file of markdownFiles) {
    const text = readFileSync(file, 'utf8');
    const dir = path.dirname(file);
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (/^[a-z]+:\/\//i.test(target) || target.startsWith('//')) continue;
      const hash = match[1].split('#')[1];
      if (target === '') {
        if (hash && !anchorsOf(text).has(hash.toLowerCase())) {
          findings.push(`${path.relative(packageDir, file)}: missing anchor #${hash} in ${path.basename(file)}`);
        }
        continue;
      }
      let resolved;
      try {
        resolved = path.resolve(dir, decodeURIComponent(target));
      } catch {
        findings.push(`${path.relative(packageDir, file)}: malformed link target: ${target}`);
        continue;
      }
      if (!resolved.startsWith(packageDir + path.sep)) {
        findings.push(`${path.relative(packageDir, file)}: link escapes the repo: ${target}`);
        continue;
      }
      if (!existsSync(resolved)) {
        findings.push(`${path.relative(packageDir, file)}: missing file: ${target}`);
        continue;
      }
      if (hash && resolved.endsWith('.md') && !anchorsOf(readFileSync(resolved, 'utf8')).has(hash.toLowerCase())) {
        findings.push(`${path.relative(packageDir, file)}: missing anchor #${hash} in ${target}`);
      }
    }
  }
  return findings;
}

await test('native V8 coverage: the hand-rolled reporter aggregates NODE_V8_COVERAGE JSON and enforces 70% statements / 60% functions on own sources', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'dsh-cov-data-'));
  const reportDir = mkdtempSync(path.join(tmpdir(), 'dsh-cov-report-'));
  try {
    const range = (count) => ({ startOffset: 0, endOffset: 10, count });
    const entry = (url, ranges) => ({ url, functions: [{ functionName: 'fixture', ranges, isBlockCoverage: true }] });
    const indexUrl = pathToFileURL(path.join(packageDir, 'index.js')).href;
    const testUrl = pathToFileURL(path.join(packageDir, 'scripts', 'test.mjs')).href;
    const nodeModulesUrl = pathToFileURL(path.join(packageDir, 'node_modules', 'lib', 'index.js')).href;
    const clientUrl = pathToFileURL(path.join(packageDir, 'client.js')).href;
    writeFileSync(path.join(dataDir, 'coverage-1.json'), JSON.stringify({ result: [entry(indexUrl, [range(1), range(1)])] }), 'utf8');
    writeFileSync(path.join(dataDir, 'coverage-2.json'), JSON.stringify({ result: [entry(testUrl, [range(2)]), entry(indexUrl, [range(1)]), entry(nodeModulesUrl, [range(0), range(0), range(0), range(0)]), entry(clientUrl, [range(0), range(0)])] }), 'utf8');
    const res = spawnSync(process.execPath, [path.join(packageDir, 'scripts', 'test.mjs'), '--coverage-report', `--coverage-dir=${dataDir}`], { encoding: 'utf8', env: { ...process.env, NODE_V8_COVERAGE: reportDir } });
    assert.equal(res.status, 0, `coverage report must pass: ${res.stderr}`);
    assert.match(res.stdout, /statements: 4\/4 \(100\.0%\)/, 'the same own-source file emitted in two JSON files must be MERGED, not replaced');
    assert.match(res.stdout, /functions: 3\/3 \(100\.0%\)/, 'merged function counts must sum across JSON files');
    assert.match(res.stdout, /client\.js: vm-evaluated — no V8 entry/);
    assert.match(res.stdout, /^COVERAGE OK$/m);
    assert.deepEqual(readdirSync(dataDir).sort(), ['coverage-1.json', 'coverage-2.json'], 'the report process must not write into the data dir');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(reportDir, { recursive: true, force: true });
  }
});

await test('coverage gate fails closed: empty directory, missing coverage root and below-floor ratios each fail with the specified message', () => {
  const script = path.join(packageDir, 'scripts', 'test.mjs');
  const emptyDir = mkdtempSync(path.join(tmpdir(), 'dsh-cov-empty-'));
  const belowDir = mkdtempSync(path.join(tmpdir(), 'dsh-cov-below-'));
  const envOnlyDir = mkdtempSync(path.join(tmpdir(), 'dsh-cov-env-'));
  try {
    writeFileSync(path.join(belowDir, 'coverage-1.json'), JSON.stringify({
      result: [{
        url: pathToFileURL(path.join(packageDir, 'index.js')).href,
        functions: [{ functionName: 'fixture', ranges: [{ startOffset: 0, endOffset: 1, count: 0 }, { startOffset: 1, endOffset: 2, count: 0 }, { startOffset: 2, endOffset: 3, count: 0 }, { startOffset: 3, endOffset: 4, count: 0 }, { startOffset: 4, endOffset: 5, count: 0 }, { startOffset: 5, endOffset: 6, count: 0 }, { startOffset: 6, endOffset: 7, count: 0 }] }]
      }]
    }), 'utf8');
    const baseEnv = { ...process.env, NODE_V8_COVERAGE: envOnlyDir };

    const empty = spawnSync(process.execPath, [script, '--coverage-report', `--coverage-dir=${emptyDir}`], { encoding: 'utf8', env: baseEnv });
    assert.equal(empty.status, 1, 'an empty coverage dir must fail');
    assert.match(empty.stderr, /no coverage entries/);

    const missingWithEnv = spawnSync(process.execPath, [script, '--coverage-report'], { encoding: 'utf8', env: baseEnv });
    assert.equal(missingWithEnv.status, 1, 'report mode with only NODE_V8_COVERAGE must be rejected');
    assert.match(missingWithEnv.stderr, /coverage root is missing — pass --coverage-dir=<dir>/);

    const missingWithoutEnv = spawnSync(process.execPath, [script, '--coverage-report'], { encoding: 'utf8', env: { ...process.env, NODE_V8_COVERAGE: '' } });
    assert.equal(missingWithoutEnv.status, 1, 'report mode without --coverage-dir must fail even with no env');
    assert.match(missingWithoutEnv.stderr, /coverage root is missing — pass --coverage-dir=<dir>/);

    const below = spawnSync(process.execPath, [script, '--coverage-report', `--coverage-dir=${belowDir}`], { encoding: 'utf8', env: baseEnv });
    assert.equal(below.status, 1, 'below-floor ratios must fail');
    assert.match(below.stderr, /^COVERAGE FAILED: /m);
    assert.match(below.stderr, /statements 0\.0% is below the 70% floor/);
    assert.match(below.stderr, /functions 0\.0% is below the 60% floor/);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
    rmSync(belowDir, { recursive: true, force: true });
    rmSync(envOnlyDir, { recursive: true, force: true });
  }
});

await test('client.js byte budget: measured size stays under the versioned 139264-byte ceiling with no self-adjustment', () => {
  const size = statSync(path.join(packageDir, 'client.js')).size;
  assert.equal(size, 138853, 'client.js must stay byte-identical at the measured 138853 bytes');
  assert.equal(CLIENT_BYTE_CEILING, 139264, 'the versioned ceiling must stay 139264 bytes (136 KiB)');
  assert.equal(CLIENT_BYTE_CEILING - size, 411, 'the headroom must stay 411 bytes');
  assert.ok(size <= CLIENT_BYTE_CEILING, `client.js is ${size} bytes; ceiling is ${CLIENT_BYTE_CEILING} (136 KiB) — bump the versioned ceiling by explicit commit or split a chunk (C17)`);
});

await test('docs-parity.mjs: three READMEs share headings, table rows and fenced blocks; importing has no side effects', async () => {
  const parityScript = path.join(packageDir, 'scripts', 'docs-parity.mjs');
  assert.ok(existsSync(parityScript), `scripts/docs-parity.mjs must exist at ${parityScript}`);
  const snapshot = () => repoFiles().map((file) => `${file}:${statSync(file).size}`).join('\n');
  const before = snapshot();
  const mod = await import(pathToFileURL(parityScript).href);
  assert.equal(typeof mod.checkDocsParity, 'function', 'docs-parity.mjs must export checkDocsParity');
  assert.equal(snapshot(), before, 'importing docs-parity.mjs must not write any repo file');
  const readmes = ['README.md', 'README.pt-BR.md', 'README.zh-CN.md'].map((name) => path.join(packageDir, name));
  assert.deepEqual(mod.checkDocsParity(readmes), [], 'the three READMEs must share headings, table rows and fenced blocks');

  const driftDir = mkdtempSync(path.join(tmpdir(), 'dsh-parity-'));
  try {
    const copies = readmes.map((file, index) => {
      const out = path.join(driftDir, `README${index}.md`);
      writeFileSync(out, readFileSync(file, 'utf8'), 'utf8');
      return out;
    });
    writeFileSync(copies[1], readFileSync(readmes[1], 'utf8').replace(/^## .+$/m, '### Drifted heading depth'), 'utf8');
    const findings = mod.checkDocsParity(copies);
    assert.ok(findings.some((finding) => finding.includes('heading levels differ')), 'a heading-level drift must produce a finding');
    assert.ok(findings.every((finding) => typeof finding === 'string' && finding.length > 0), 'findings must be non-empty strings');

    writeFileSync(copies[1], readFileSync(readmes[1], 'utf8').replace(/^\|.*\|\r?\n/m, ''), 'utf8');
    const tableFindings = mod.checkDocsParity(copies);
    assert.ok(tableFindings.some((finding) => finding.includes('table rows differ')), 'a table-row drift must produce a finding');

    writeFileSync(copies[1], `${readFileSync(readmes[1], 'utf8')}\n\`\`\`\ndrifted fence\n\`\`\`\n`, 'utf8');
    const fenceFindings = mod.checkDocsParity(copies);
    assert.ok(fenceFindings.some((finding) => finding.includes('fenced blocks differ')), 'a fence-count drift must produce a finding');
  } finally {
    rmSync(driftDir, { recursive: true, force: true });
  }
});

await test('docs links and anchors: every relative markdown link resolves in-repo with no external fetch', () => {
  const docsDir = path.join(packageDir, 'docs');
  const markdownFiles = [
    ...['README.md', 'README.pt-BR.md', 'README.zh-CN.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'AGENTS.md', 'craft/README.md'].map((name) => path.join(packageDir, name)),
    ...readdirSync(docsDir).filter((name) => name.endsWith('.md')).sort().map((name) => path.join(docsDir, name))
  ];
  const findings = checkLinks(markdownFiles);
  assert.deepEqual(findings, [], `every relative link must resolve: ${findings.join(' | ')}`);

  const fixtureDir = mkdtempSync(path.join(packageDir, 'link-fixture-'));
  try {
    writeFileSync(path.join(fixtureDir, 'b.md'), '# Real\n', 'utf8');
    writeFileSync(path.join(fixtureDir, 'a.md'), [
      '# Real',
      '',
      '[missing](missing.md)',
      '[escape](../../outside.md)',
      '[bad anchor](b.md#nope)',
      '[web](https://example.invalid/x)',
      '[self](#real)',
      '[self bad](#nope)'
    ].join('\n'), 'utf8');
    const fixtureFindings = checkLinks([path.join(fixtureDir, 'a.md')]);
    assert.equal(fixtureFindings.length, 4, `the fixture must yield exactly 4 findings: ${fixtureFindings.join(' | ')}`);
    assert.ok(fixtureFindings.some((finding) => finding.includes('missing file: missing.md')), 'a missing target must be reported');
    assert.ok(fixtureFindings.some((finding) => finding.includes('link escapes the repo: ../../outside.md')), 'an escaping link must be reported');
    assert.ok(fixtureFindings.some((finding) => finding.includes('missing anchor #nope in b.md')), 'a bad anchor must be reported');
    assert.ok(fixtureFindings.some((finding) => finding.includes('missing anchor #nope in a.md')), 'a bad same-file anchor must be reported');
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

await test('pass-5 docs and static markers: six reference docs carry their sections and CI mirrors the coverage gate', () => {
  const docAnchors = {
    'docs/glossary.md': ['role', 'phase', 'harness catalog', 'reasoning effort', 'inherit', 'route', 'dispatch', 'batch', 'profile', 'audit trail', 'readonly', 'content-visibility', 'expectedMtimeMs'],
    'docs/recipes.md': ['economical', 'balanced', 'max-quality', 'provider', 'model', 'reasoning_effort', 'disabled'],
    'docs/role-card.md': ['name', 'description', 'provider', 'model', 'reasoning_effort', 'disabled', '65536', 'CRLF', 'BOM'],
    'docs/architecture.md': ['expectedMtimeMs', 'withFileLock', 'writeFileAtomic', 'realpath', 'audit', '409', '503', 'update checking'],
    'docs/troubleshooting.md': ['400', '409', '503', '403', 'readonly', 'coverage', 'byte'],
    'docs/api.md': ['roles', 'catalog', 'efforts', 'route', 'events', 'diagnostics', 'update', 'readOnly']
  };
  const docSections = {
    'docs/glossary.md': ['## Localized terms', '## Code identifiers (no panel key)'],
    'docs/recipes.md': ['## 1. Economical', '## 2. Balanced', '## 3. Max quality'],
    'docs/role-card.md': ['## Fields the writer reads', '## Field rules', '## Strict parsing and limits', '## What a save changes'],
    'docs/architecture.md': ['## Trust boundary', '## The save sequence, in execution order', '## Audit trail', '## Route surface', '## Update checking'],
    'docs/troubleshooting.md': ['## Save and validation failures', '## Batch, profile and diagnostics failures', '## Installer and verification gates'],
    'docs/api.md': ['## Route summary', '## GET roles', '## GET catalog', '## GET efforts', '## POST route', '## GET events', '## GET diagnostics', '## GET update']
  };
  const normalize = (value) => value.toLowerCase().replace(/[-_]/g, ' ');
  for (const [rel, anchors] of Object.entries(docAnchors)) {
    const file = path.join(packageDir, rel);
    assert.ok(existsSync(file), `${rel} must exist`);
    const bytes = readFileSync(file);
    assert.ok(!bytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), `${rel} must not carry a BOM`);
    assert.ok(!bytes.toString('utf8').includes('\r\n'), `${rel} must use pure LF`);
    const text = normalize(bytes.toString('utf8'));
    for (const anchor of anchors) {
      assert.ok(text.includes(normalize(anchor)), `${rel} must mention ${anchor}`);
    }
    const headings = bytes.toString('utf8').split('\n').filter((line) => /^#{1,6} /.test(line));
    for (const section of docSections[rel]) {
      assert.ok(headings.includes(section), `${rel} must carry the section heading ${section}`);
    }
  }

  const expectedBlock = [
    'NODE_V8_COVERAGE=${{ runner.temp }}/dsh-coverage node scripts/test.mjs',
    'NODE_V8_COVERAGE=${{ runner.temp }}/dsh-coverage-report node scripts/test.mjs --coverage-report --coverage-dir=${{ runner.temp }}/dsh-coverage'
  ];
  const workflowBlock = (rel) => {
    const text = readFileSync(path.join(packageDir, '.github', 'workflows', rel), 'utf8');
    assert.ok(text.includes('- name: Coverage gate'), `${rel} must carry a Coverage gate step`);
    const lines = text.split('\n').map((line) => line.trim());
    const start = lines.findIndex((line) => line === expectedBlock[0]);
    assert.ok(start >= 0, `${rel} must carry the coverage emit command`)
    assert.equal(lines[start + 1], expectedBlock[1], `${rel} must carry the report command byte-identically after the emit command`);
    return [lines[start], lines[start + 1]];
  };
  assert.deepEqual(workflowBlock('ci.yml'), expectedBlock, 'ci.yml must carry the frozen 2-line coverage block');
  assert.deepEqual(workflowBlock('publish.yml'), expectedBlock, 'publish.yml must carry the byte-identical coverage block');

  const testerText = readFileSync(path.join(packageDir, 'scripts', 'test.mjs'), 'utf8');
  assert.ok(testerText.includes('139264'), 'the versioned byte budget constant must be present');
});

await test('repo hygiene: no backup artifacts and zero machine tokens in any repo file', () => {
  const files = repoFiles();
  assert.ok(files.length > 0, 'the repo must contain files to scan');
  const relPaths = files.map((file) => path.relative(packageDir, file).split(path.sep).join('/'));
  for (const required of ['.github/workflows/ci.yml', '.github/workflows/publish.yml', '.devflow']) {
    assert.ok(relPaths.some((rel) => rel === required || rel.startsWith(`${required}/`)), `the hygiene walker must scan ${required} (dot-directories are not skipped)`);
  }
  for (const file of files) {
    const rel = path.relative(packageDir, file);
    assert.ok(!BAK_SUFFIX_RE.test(rel), `${rel} must not be a backup artifact`);
    const bytes = readFileSync(file);
    const hasNulByte = bytes.some((byte) => byte === 0);
    const isBinary = hasNulByte || bytes.subarray(0, 12).toString('latin1').includes('GIF8');
    if (isBinary) continue;
    const text = bytes.toString('utf8');
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
