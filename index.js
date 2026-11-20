import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { parseDocument, visit } from 'yaml';

const name = 'dsh-orchestrator-kit';
const inject = ['connection'];

const CATALOG_TIMEOUT_MS = 10000;
const ENTRY_PATH = /^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*$/;
const FRONTMATTER = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FRONTMATTER_MAX_BYTES = 65536;
const FRONTMATTER_MAX_PATH = 24;
const MAX_ROUTE_BODY_BYTES = 65536;
const CARD_READ_CONCURRENCY = 8;
const ROUTE_BODY_FIELDS = new Set(['id', 'provider', 'model', 'disabled', 'reasoningEffort', 'expectedMtimeMs']);
const LOCK_TIMEOUT_PREFIX = 'atomic-write: timed out waiting for the writer lock';

function agentsRootOf(env = process.env) {
  const configured = env.DSH_AGENTS_HOME;
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured.trim());
  return path.join(homedir(), '.agents');
}

function isEntryName(value) {
  return typeof value === 'string' && ENTRY_PATH.test(value);
}

function cardPathOf(cardsDir, id) {
  if (!isEntryName(id)) {
    const err = new Error(`invalid entry name: ${JSON.stringify(id)}`);
    err.statusCode = 400;
    throw err;
  }
  const root = path.resolve(cardsDir);
  const resolved = path.resolve(root, `${id}.md`);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    const err = new Error(`entry would escape the agents directory: ${id}`);
    err.statusCode = 400;
    throw err;
  }
  return resolved;
}

async function lstatNoSymlink(file) {
  const info = await lstat(file);
  if (info.isSymbolicLink()) {
    const err = new Error('role card path escapes the agents directory via symbolic link');
    err.statusCode = 400;
    throw err;
  }
  return info;
}

async function assertContainedRealCardPath(cardsDir, file) {
  const root = path.resolve(cardsDir);
  const resolved = path.resolve(file);
  const rel = path.relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error(`entry escapes the agents directory`);
    err.statusCode = 400;
    throw err;
  }
  const segments = rel.split(path.sep).filter(Boolean);
  let realRoot;
  try {
    realRoot = await realpath(root);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  let current = root;
  let deepestExisting = root;
  for (const seg of segments) {
    current = path.join(current, seg);
    let st;
    try {
      st = await lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
    if (st.isSymbolicLink()) {
      const err = new Error(`role card path escapes the agents directory via symbolic link: ${seg}`);
      err.statusCode = 400;
      throw err;
    }
    deepestExisting = current;
  }
  const realTarget = await realpath(deepestExisting);
  const realRel = path.relative(realRoot, realTarget);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    const err = new Error('role card real path escapes the agents directory');
    err.statusCode = 400;
    throw err;
  }
}

function dominantEolOf(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return lf >= crlf ? '\n' : '\r\n';
}

function optionalScalar(meta, key, basename) {
  const value = meta[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${basename}: frontmatter ${key} must be a non-empty string`);
  return value.trim();
}

const SECRET_ASSIGN_PREFIX = String.raw`\b((?:api[-_]?key|apikey|access[-_]?token|auth[-_]?token|refresh[-_]?token|token|secret|password|passwd|client[-_]?secret)["']?\s*[:=]\s*`;

const AUTH_PREFIX = String.raw`\b(authorization["']?\s*[:=]\s*)(?:bearer\s+|basic\s+)?`;

const SECRET_REDACTIONS = [
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/'"]*@/gi, '$1[redacted]@'],
  [new RegExp(String.raw`${AUTH_PREFIX}"(?:[^"\\]|\\.)*"`, 'gi'), '$1"[redacted]"'],
  [new RegExp(String.raw`${AUTH_PREFIX}'(?:[^'\\]|\\.)*'`, 'gi'), '$1\'[redacted]\''],
  [new RegExp(String.raw`${AUTH_PREFIX}(?![A-Za-z]:)[A-Za-z0-9._~+=-]+(?:[ \t]+(?![A-Za-z]:)[A-Za-z0-9._~+=-]+)*`, 'gi'), '$1[redacted]'],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]'],
  [new RegExp(String.raw`${SECRET_ASSIGN_PREFIX})"(?:[^"\\]|\\.)*"`, 'gi'), '$1"[redacted]"'],
  [new RegExp(String.raw`${SECRET_ASSIGN_PREFIX})'(?:[^'\\]|\\.)*'`, 'gi'), '$1\'[redacted]\''],
  [new RegExp(String.raw`${SECRET_ASSIGN_PREFIX}["']?)[^\s"',;]+`, 'gi'), '$1[redacted]'],
  [/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,})/g, '[redacted]'],
  [/(?<=^|[\s'"(=,;/])[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/'"\s:;,)]+/gi, '[home]'],
  [/(?<=^|[\s'"(=,;])\/(?:home|Users)\/[^/'"\s:;,)]+/gi, '[home]']
];

function redactText(text) {
  let out = String(text);
  const home = homedir();
  if (home && home !== path.sep) out = out.split(home).join('[home]');
  for (const [pattern, replacement] of SECRET_REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

function safeErrorText(error) {
  return redactText(String(error?.message ?? error));
}

function parseFrontmatterDocument(text, basename = 'role card', { strict = false } = {}) {
  if (typeof text !== 'string') throw new TypeError('card text must be a string');
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const match = FRONTMATTER.exec(body);
  if (match === null) throw new Error(`${basename}: no frontmatter block; role cards start with a --- block`);
  if (Buffer.byteLength(match[1], 'utf8') > FRONTMATTER_MAX_BYTES) {
    throw new Error(`${basename}: frontmatter exceeds the ${FRONTMATTER_MAX_BYTES}-byte limit`);
  }
  const doc = parseDocument(match[1]);
  if (doc.errors.length > 0) throw new Error(`${basename}: frontmatter is not valid YAML: ${doc.errors[0].message ?? String(doc.errors[0])}`);
  if (strict) {
    visit(doc, {
      Alias() { throw new Error(`${basename}: frontmatter aliases are not allowed`); },
      Node(key, node, path) {
        if (node.anchor) throw new Error(`${basename}: frontmatter anchors are not allowed`);
        if (node.tag) throw new Error(`${basename}: frontmatter custom tags are not allowed`);
        if (path.length > FRONTMATTER_MAX_PATH) throw new Error(`${basename}: frontmatter nesting is too deep`);
      }
    });
  }
  const meta = doc.toJS({ maxAliasCount: 0 });
  if (doc.contents !== null && (meta === null || typeof meta !== 'object' || Array.isArray(meta))) {
    throw new Error(`${basename}: frontmatter must be a YAML object`);
  }
  return { body, match, doc, meta: meta ?? {} };
}

function parseRoleCard(text, basename = 'role card', options = {}) {
  const { meta } = parseFrontmatterDocument(text, basename, options);
  const cardName = optionalScalar(meta, 'name', basename);
  const description = optionalScalar(meta, 'description', basename);
  const provider = optionalScalar(meta, 'provider', basename);
  const model = optionalScalar(meta, 'model', basename);
  const effort = optionalScalar(meta, 'reasoning_effort', basename);
  const camelEffort = optionalScalar(meta, 'reasoningEffort', basename);
  if (effort !== undefined && camelEffort !== undefined && effort !== camelEffort) {
    throw new Error(`${basename}: reasoning_effort and reasoningEffort conflict`);
  }
  const reasoningEffort = effort ?? camelEffort;
  if (model === 'inherit' && provider !== undefined) throw new Error(`${basename}: model inherit cannot specify a provider`);
  return {
    ...(cardName === undefined ? {} : { name: cardName }),
    ...(description === undefined ? {} : { description }),
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    disabled: meta.disabled === true
  };
}

function validateRouteInput(route) {
  if (route !== null && (typeof route !== 'object' || Array.isArray(route))) throw new Error('route must be null or a {provider, model} object');
  if (route !== null) {
    if (typeof route.provider !== 'string' || route.provider.trim() === '' || typeof route.model !== 'string' || route.model.trim() === '') {
      throw new Error('a route needs a non-empty provider and model; a half-written route is rejected');
    }
    if (route.model.trim() === 'inherit') {
      throw new Error('model inherit cannot specify a provider');
    }
  }
}

function applyCardSettings(text, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('patch must be a settings object');
  }
  if (patch.route !== undefined) validateRouteInput(patch.route);
  if (patch.disabled !== undefined && typeof patch.disabled !== 'boolean') {
    throw new Error('disabled must be a boolean');
  }
  if (patch.reasoningEffort !== undefined && patch.reasoningEffort !== null && (typeof patch.reasoningEffort !== 'string' || patch.reasoningEffort.trim() === '')) {
    throw new Error('reasoningEffort must be null or a non-empty string');
  }
  if (patch.route === null && patch.reasoningEffort !== undefined && patch.reasoningEffort !== null) {
    throw new Error('cannot set reasoningEffort when resetting route to inherit');
  }

  const { body, match, doc, meta } = parseFrontmatterDocument(text, 'role card', { strict: true });
  const eol = dominantEolOf(body);
  const prevProvider = typeof meta.provider === 'string' && meta.provider.trim() !== '' ? meta.provider.trim() : undefined;
  const prevModel = typeof meta.model === 'string' && meta.model.trim() !== '' ? meta.model.trim() : undefined;

  if (patch.route === null) {
    doc.delete('provider');
    doc.set('model', 'inherit');
    doc.delete('reasoning_effort');
    doc.delete('reasoningEffort');
  } else if (patch.route !== undefined) {
    const nextProvider = patch.route.provider.trim();
    const nextModel = patch.route.model.trim();
    doc.set('provider', nextProvider);
    doc.set('model', nextModel);
    if ((prevProvider !== nextProvider || prevModel !== nextModel) && patch.reasoningEffort === undefined) {
      doc.delete('reasoning_effort');
      doc.delete('reasoningEffort');
    }
  }

  if (patch.disabled === true) {
    doc.set('disabled', true);
  } else if (patch.disabled === false) {
    doc.delete('disabled');
  }

  if (patch.reasoningEffort !== undefined) {
    doc.delete('reasoningEffort');
    if (patch.reasoningEffort === null) {
      doc.delete('reasoning_effort');
    } else {
      const updated = doc.toJS() ?? {};
      const effectiveProvider = typeof updated.provider === 'string' && updated.provider.trim() !== '' ? updated.provider.trim() : undefined;
      const effectiveModel = typeof updated.model === 'string' && updated.model.trim() !== '' ? updated.model.trim() : undefined;
      if (effectiveModel === 'inherit' || effectiveProvider === undefined || effectiveModel === undefined) {
        throw new Error('cannot set reasoningEffort when model is inherit or route is incomplete');
      }
      doc.set('reasoning_effort', patch.reasoningEffort.trim());
    }
  }

  let frontmatter = doc.toString().replace(/\r\n/g, '\n');
  if (frontmatter.endsWith('\n')) frontmatter = frontmatter.slice(0, -1);
  frontmatter = frontmatter.replace(/\n/g, eol);
  const hadTrailingNewline = match[0].endsWith('\n');
  return `---${eol}${frontmatter}${eol}---${hadTrailingNewline ? eol : ''}${body.slice(match[0].length)}`;
}

function applyRouteToCard(text, route) {
  validateRouteInput(route);
  return applyCardSettings(text, { route });
}

function withinDeadline(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms} ms`)), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const ADAPTER_FAULT_LLM_CODES = new Set([
  'INVALID_MODEL_INFO',
  'INVALID_MODEL_CONTEXT',
  'INVALID_MODEL_MAX_TOKENS',
  'INVALID_MODEL_REASONING',
  'INVALID_CATALOG'
]);

const UNKNOWN_ROUTE_LLM_CODES = new Set([
  'NO_ADAPTER',
  'UNKNOWN_MODEL',
  'MODEL_UNSUPPORTED',
  'UNSUPPORTED_REASONING_EFFORT'
]);

async function resolveModelEfforts(llm, provider, model, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`model info resolution for ${provider}/${model} did not answer within ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    const lookup = Promise.resolve().then(() => llm.resolveModelInfo(provider, model, controller.signal));
    lookup.catch(() => {});
    const resolved = await Promise.race([lookup, deadline]);
    if (resolved === null || typeof resolved !== 'object' || Array.isArray(resolved)) {
      console.warn(redactText(`${name}: resolveModelInfo returned non-object for ${provider}/${model}`));
      return { ok: false, kind: 'adapter-fault', error: new Error(`invalid model info for ${provider}/${model}`) };
    }
    if (resolved.reasoning !== undefined && (resolved.reasoning === null || typeof resolved.reasoning !== 'object' || Array.isArray(resolved.reasoning))) {
      console.warn(redactText(`${name}: resolveModelInfo returned invalid reasoning metadata for ${provider}/${model}`));
      return { ok: false, kind: 'adapter-fault', error: new Error(`invalid reasoning metadata for ${provider}/${model}`) };
    }
    const rawEfforts = resolved.reasoning?.efforts;
    if (rawEfforts !== undefined && !Array.isArray(rawEfforts)) {
      console.warn(redactText(`${name}: resolveModelInfo returned non-array reasoning.efforts for ${provider}/${model}`));
      return { ok: false, kind: 'adapter-fault', error: new Error(`invalid reasoning efforts for ${provider}/${model}`) };
    }
    const efforts = Array.isArray(rawEfforts)
      ? rawEfforts
          .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string' && entry.id !== '')
          .map((entry) => ({
            id: entry.id,
            name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.id,
            ...(typeof entry.description === 'string' && entry.description !== '' ? { description: entry.description } : {})
          }))
      : [];
    const defaultEffort = typeof resolved.reasoning?.defaultEffort === 'string' && resolved.reasoning.defaultEffort !== ''
      ? resolved.reasoning.defaultEffort
      : null;
    return { ok: true, defaultEffort, efforts };
  } catch (error) {
    console.warn(redactText(`${name}: resolveModelEfforts failed for ${provider}/${model}:`), safeErrorText(error));
    const kind = timedOut || error?.code === 'TIMEOUT' || error?.code === 'ABORTED'
      ? 'timeout'
      : ADAPTER_FAULT_LLM_CODES.has(error?.code)
        ? 'adapter-fault'
        : UNKNOWN_ROUTE_LLM_CODES.has(error?.code)
          ? 'unknown-route'
          : 'upstream';
    return { ok: false, kind, error };
  } finally {
    clearTimeout(timer);
  }
}

async function modelCatalog(ctx, timeoutMs = CATALOG_TIMEOUT_MS) {
  const get = (service) => {
    try { return ctx.get(service); } catch (error) {
      console.warn(redactText(`${name}: service lookup for ${service} failed:`), safeErrorText(error));
      return undefined;
    }
  };
  let fallback;
  try {
    fallback = get('agentDefaultModel')?.currentSelection?.();
  } catch (error) {
    console.warn(redactText(`${name}: reading agentDefaultModel.currentSelection() failed:`), safeErrorText(error));
  }
  const failedProviders = new Set();
  const catalog = { available: false, degraded: false, failedProviders, default: null, groups: [] };
  if (typeof fallback?.provider === 'string' && typeof fallback?.model === 'string' && fallback.provider !== '' && fallback.model !== '') {
    catalog.default = { provider: fallback.provider, model: fallback.model };
  }
  const llm = get('llm');
  if (llm === null || typeof llm !== 'object' || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
    catalog.degraded = true;
    return catalog;
  }
  let providers;
  try {
    providers = llm.listProviders();
  } catch (error) {
    console.warn(redactText(`${name}: llm.listProviders() failed:`), safeErrorText(error));
    catalog.degraded = true;
    return catalog;
  }
  if (!Array.isArray(providers)) {
    console.warn(redactText(`${name}: llm.listProviders() returned a non-array value`));
    catalog.degraded = true;
    return catalog;
  }
  catalog.available = true;
  const listed = await Promise.all(providers.map(async (provider) => {
    if (provider === null || typeof provider !== 'object' || typeof provider.id !== 'string' || provider.id === '') return null;
    try {
      const models = await withinDeadline(Promise.resolve(llm.listModels(provider.id)), timeoutMs, `model listing for ${provider.id}`);
      if (!Array.isArray(models)) {
        console.warn(redactText(`${name}: llm.listModels(${provider.id}) returned a non-array value`));
        failedProviders.add(provider.id);
        return null;
      }
      const entries = models
        .filter((model) => model !== null && typeof model === 'object' && typeof model.id === 'string' && model.id !== '')
        .map((model) => ({ id: model.id, name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id }));
      return entries.length === 0 ? null : { provider: provider.id, name: typeof provider.name === 'string' && provider.name !== '' ? provider.name : provider.id, models: entries };
    } catch (error) {
      console.warn(redactText(`${name}: listing models for ${provider.id} failed:`), safeErrorText(error));
      failedProviders.add(provider.id);
      return null;
    }
  }));
  catalog.groups = listed.filter((group) => group !== null);
  catalog.degraded = failedProviders.size > 0;
  return catalog;
}

function toRoleSummary(id, card, mtimeMs) {
  return {
    id,
    name: card.name ?? id,
    description: card.description ?? null,
    provider: card.provider ?? null,
    model: card.model ?? null,
    reasoningEffort: card.reasoningEffort ?? null,
    disabled: card.disabled,
    mtimeMs
  };
}

async function apply(ctx, config = {}) {
  const json = (value, status = 200, timing = []) => new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(timing.length > 0 ? { 'server-timing': timing.map(([metric, ms]) => `${metric};dur=${ms.toFixed(1)}`).join(', ') } : {})
    }
  });
  const cardsDir = () => path.join(agentsRootOf(), 'agents');
  const timeoutMs = typeof config?.catalogTimeoutMs === 'number' && Number.isFinite(config.catalogTimeoutMs) && config.catalogTimeoutMs > 0
    ? config.catalogTimeoutMs
    : CATALOG_TIMEOUT_MS;
  const getService = (service) => {
    try { return ctx.get(service); } catch (error) {
      console.warn(redactText(`${name}: service lookup for ${service} failed:`), safeErrorText(error));
      return undefined;
    }
  };

  ctx.connection?.fetch?.register({
    path: '/api/dsh-orchestrator-kit.roles',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const started = performance.now();
      let entries;
      try {
        entries = await readdir(cardsDir(), { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') return json({ ok: true, roles: [], invalid: [] }, 200, [['reads', performance.now() - started]]);
        console.warn(redactText(`${name}: the roles directory is unreadable:`), safeErrorText(error));
        return json({ ok: false, error: `the roles directory is unreadable: ${safeErrorText(error)}` }, 500);
      }
      const candidates = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
      const roles = [];
      const invalid = [];
      let cursor = 0;
      const worker = async () => {
        for (;;) {
          const index = cursor++;
          if (index >= candidates.length) return;
          const entry = candidates[index];
          const id = entry.name.slice(0, -3);
          let file;
          try { file = cardPathOf(cardsDir(), id); } catch (error) {
            console.warn(redactText(`${name}: role card ${entry.name} is skipped:`), safeErrorText(error));
            continue;
          }
          let info;
          let text;
          try {
            info = await stat(file);
            text = await readFile(file, 'utf8');
          } catch (error) {
            console.warn(redactText(`${name}: role card ${id} is unreadable:`), safeErrorText(error));
            continue;
          }
          try {
            const card = parseRoleCard(text, entry.name);
            roles.push(toRoleSummary(id, card, info.mtimeMs));
          } catch (error) {
            console.warn(redactText(`${name}: role card ${id} is omitted from the list:`), safeErrorText(error));
            invalid.push({ id, error: safeErrorText(error) });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CARD_READ_CONCURRENCY, candidates.length) }, () => worker()));
      roles.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      invalid.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      return json({ ok: true, roles, invalid }, 200, [['reads', performance.now() - started]]);
    }
  });

  ctx.connection?.fetch?.register({
    path: '/api/dsh-orchestrator-kit.catalog',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const started = performance.now();
      const catalog = await modelCatalog(ctx, timeoutMs);
      return json({
        ok: true,
        available: catalog.available,
        degraded: catalog.degraded,
        failedProviders: [...catalog.failedProviders],
        default: catalog.default,
        groups: catalog.groups
      }, 200, [['catalog', performance.now() - started]]);
    }
  });

  ctx.connection?.fetch?.register({
    path: '/api/dsh-orchestrator-kit.efforts',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url, 'http://localhost');
      const provider = url.searchParams.get('provider')?.trim() ?? '';
      const model = url.searchParams.get('model')?.trim() ?? '';
      if (provider === '' || model === '') {
        return json({ ok: false, error: 'provider and model query parameters must be non-empty' }, 400);
      }
      const llm = getService('llm');
      if (llm === null || typeof llm !== 'object' || typeof llm.resolveModelInfo !== 'function') {
        return json({ ok: false, error: 'the LLM model resolver is unavailable' }, 503);
      }
      const result = await resolveModelEfforts(llm, provider, model, timeoutMs);
      if (!result.ok) {
        if (result.kind === 'timeout') {
          return json({ ok: false, error: safeErrorText(result.error) }, 504);
        }
        if (result.kind === 'adapter-fault') {
          return json({ ok: false, error: `invalid model metadata for ${provider}/${model}: ${safeErrorText(result.error)}` }, 502);
        }
        if (result.kind === 'unknown-route') {
          return json({ ok: false, error: `unknown or unresolvable route ${provider}/${model}: ${safeErrorText(result.error)}` }, 409);
        }
        return json({ ok: false, error: `model info lookup failed for ${provider}/${model}: ${safeErrorText(result.error)}` }, 503);
      }
      return json({ ok: true, provider, model, defaultEffort: result.defaultEffort, efforts: result.efforts });
    }
  });

  ctx.connection?.fetch?.register({
    path: '/api/dsh-orchestrator-kit.route',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const contentLength = Number(request.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_ROUTE_BODY_BYTES) {
        return json({ ok: false, error: `the request body exceeds the ${MAX_ROUTE_BODY_BYTES}-byte limit` }, 413);
      }
      let raw;
      try { raw = await request.text(); } catch { return json({ ok: false, error: 'the body is not valid JSON' }, 400); }
      if (Buffer.byteLength(raw, 'utf8') > MAX_ROUTE_BODY_BYTES) {
        return json({ ok: false, error: `the request body exceeds the ${MAX_ROUTE_BODY_BYTES}-byte limit` }, 413);
      }
      let body;
      try { body = JSON.parse(raw); } catch { return json({ ok: false, error: 'the body is not valid JSON' }, 400); }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'the body must be a JSON object' }, 400);
      const unknown = Object.keys(body).find((key) => !ROUTE_BODY_FIELDS.has(key));
      if (unknown !== undefined) return json({ ok: false, error: `the request contains an unknown field: ${redactText(String(unknown))}` }, 400);
      if (!isEntryName(body.id)) return json({ ok: false, error: 'the role id is not a valid entry name' }, 400);

      const { id, provider, model, disabled, reasoningEffort, expectedMtimeMs } = body;
      const hasProvider = provider !== undefined;
      const hasModel = model !== undefined;
      if (hasProvider !== hasModel) {
        return json({ ok: false, error: 'provider and model must both be provided or both omitted' }, 400);
      }
      const hasRoute = hasProvider;
      const resetRoute = hasRoute && provider === null && model === null;
      if (hasRoute && !resetRoute) {
        if (typeof provider !== 'string' || provider.trim() === '' || typeof model !== 'string' || model.trim() === '') {
          return json({ ok: false, error: 'a route needs a provider and a model, or both null to reset' }, 400);
        }
        if (model.trim() === 'inherit') {
          return json({ ok: false, error: 'model inherit cannot specify a provider' }, 400);
        }
      }

      const hasDisabled = disabled !== undefined;
      if (hasDisabled && typeof disabled !== 'boolean') {
        return json({ ok: false, error: 'disabled must be a boolean' }, 400);
      }

      const hasReasoningEffort = reasoningEffort !== undefined;
      if (hasReasoningEffort && reasoningEffort !== null && (typeof reasoningEffort !== 'string' || reasoningEffort.trim() === '')) {
        return json({ ok: false, error: 'reasoningEffort must be null or a non-empty string' }, 400);
      }

      const hasExpectedMtimeMs = expectedMtimeMs !== undefined;
      if (hasExpectedMtimeMs && (typeof expectedMtimeMs !== 'number' || !Number.isFinite(expectedMtimeMs) || expectedMtimeMs < 0)) {
        return json({ ok: false, error: 'expectedMtimeMs must be a finite number >= 0' }, 400);
      }

      if (!hasRoute && !hasDisabled && !hasReasoningEffort) {
        return json({ ok: false, error: 'at least one field (provider/model, disabled, or reasoningEffort) must be provided' }, 400);
      }

      if (resetRoute && hasReasoningEffort && reasoningEffort !== null) {
        return json({ ok: false, error: 'cannot set reasoningEffort when resetting route to inherit' }, 400);
      }

      let file;
      try {
        file = cardPathOf(cardsDir(), id);
        await assertContainedRealCardPath(cardsDir(), file);
      } catch (error) {
        if (error?.statusCode === 400) return json({ ok: false, error: safeErrorText(error) }, 400);
        console.warn(redactText(`${name}: validating role card path for ${id} failed:`), safeErrorText(error));
        return json({ ok: false, error: `validating the role card path failed: ${safeErrorText(error)}` }, 500);
      }

      let info;
      let text;
      try {
        info = await lstatNoSymlink(file);
        text = await readFile(file, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') return json({ ok: false, error: `no role card named ${id}` }, 404);
        if (error?.statusCode === 400) return json({ ok: false, error: safeErrorText(error) }, 400);
        console.warn(redactText(`${name}: role card ${id} is unreadable:`), safeErrorText(error));
        return json({ ok: false, error: `the role card is unreadable: ${safeErrorText(error)}` }, 500);
      }

      if (hasExpectedMtimeMs && info.mtimeMs !== expectedMtimeMs) {
        return json({ ok: false, error: 'role card changed on disk; refresh before saving' }, 409);
      }

      let existingMeta;
      try {
        existingMeta = parseFrontmatterDocument(text, `${id}.md`, { strict: true }).meta;
        if (!resetRoute && !hasReasoningEffort) {
          parseRoleCard(text, `${id}.md`, { strict: true });
        }
      } catch (error) {
        return json({ ok: false, error: safeErrorText(error) }, 400);
      }

      const existingProvider = typeof existingMeta.provider === 'string' && existingMeta.provider.trim() !== '' ? existingMeta.provider.trim() : undefined;
      const existingModel = typeof existingMeta.model === 'string' && existingMeta.model.trim() !== '' ? existingMeta.model.trim() : undefined;
      const effectiveProvider = resetRoute ? undefined : hasRoute ? provider.trim() : existingProvider;
      const effectiveModel = resetRoute ? 'inherit' : hasRoute ? model.trim() : existingModel;

      let catalogMs = null;
      if (hasRoute && !resetRoute) {
        const catalogStarted = performance.now();
        const catalog = await modelCatalog(ctx, timeoutMs);
        catalogMs = performance.now() - catalogStarted;
        if (catalog.available !== true || catalog.failedProviders.has(effectiveProvider) || catalog.groups.length === 0) {
          return json({ ok: false, error: 'the model catalog is unavailable; the route was not written' }, 503);
        }
        const group = catalog.groups.find((entry) => entry.provider === effectiveProvider);
        if (group === undefined) return json({ ok: false, error: `the provider is not in the live catalog: ${effectiveProvider}` }, 409);
        if (!group.models.some((entry) => entry.id === effectiveModel)) return json({ ok: false, error: `the model is not listed for ${effectiveProvider} in the live catalog: ${effectiveModel}` }, 409);
      }

      if (hasReasoningEffort && reasoningEffort !== null) {
        if (effectiveModel === 'inherit' || effectiveProvider === undefined || effectiveModel === undefined) {
          return json({ ok: false, error: 'cannot set reasoningEffort when the effective route is inherit' }, 400);
        }
        const llm = getService('llm');
        if (llm === null || typeof llm !== 'object' || typeof llm.resolveModelInfo !== 'function') {
          return json({ ok: false, error: 'the LLM model resolver is unavailable; reasoningEffort was not written' }, 503);
        }
        const resolvedEfforts = await resolveModelEfforts(llm, effectiveProvider, effectiveModel, timeoutMs);
        if (!resolvedEfforts.ok) {
          if (resolvedEfforts.kind === 'unknown-route') {
            return json({ ok: false, error: `cannot validate reasoningEffort for ${effectiveProvider}/${effectiveModel}: ${safeErrorText(resolvedEfforts.error)}` }, 409);
          }
          return json({ ok: false, error: safeErrorText(resolvedEfforts.error) }, 503);
        }
        const trimmedEffort = reasoningEffort.trim();
        if (!resolvedEfforts.efforts.some((entry) => entry.id === trimmedEffort)) {
          return json({ ok: false, error: `reasoningEffort "${trimmedEffort}" is not supported by ${effectiveProvider}/${effectiveModel}` }, 409);
        }
      }

      const patch = {
        ...(hasRoute ? { route: resetRoute ? null : { provider: effectiveProvider, model: effectiveModel } } : {}),
        ...(hasDisabled ? { disabled } : {}),
        ...(hasReasoningEffort ? { reasoningEffort: reasoningEffort === null ? null : reasoningEffort.trim() } : {})
      };

      let next;
      let nextCard;
      try {
        next = applyCardSettings(text, patch);
        nextCard = parseRoleCard(next, `${id}.md`, { strict: true });
      } catch (error) {
        return json({ ok: false, error: safeErrorText(error) }, 400);
      }
      if (next === text) {
        let freshInfo;
        try {
          freshInfo = await lstatNoSymlink(file);
        } catch (error) {
          if (error?.code === 'ENOENT') return json({ ok: false, error: `no role card named ${id}` }, 404);
          if (error?.statusCode === 400) return json({ ok: false, error: safeErrorText(error) }, 400);
          console.warn(redactText(`${name}: role card ${id} became unreadable:`), safeErrorText(error));
          return json({ ok: false, error: `the role card is unreadable: ${safeErrorText(error)}` }, 500);
        }
        if (freshInfo.mtimeMs !== info.mtimeMs) {
          return json({ ok: false, error: 'role card changed on disk; refresh before saving' }, 409);
        }
        return json({ ok: true, unchanged: true, role: toRoleSummary(id, nextCard, info.mtimeMs) }, 200, catalogMs === null ? [] : [['catalog', catalogMs]]);
      }

      try {
        await assertContainedRealCardPath(cardsDir(), file);
      } catch (error) {
        if (error?.statusCode === 400) return json({ ok: false, error: safeErrorText(error) }, 400);
        console.warn(redactText(`${name}: pre-lock path check for ${id} failed:`), safeErrorText(error));
        return json({ ok: false, error: `validating the role card path failed: ${safeErrorText(error)}` }, 500);
      }

      const baselineMtimeMs = hasExpectedMtimeMs ? expectedMtimeMs : info.mtimeMs;
      let freshMtimeMs;
      let writtenText;
      const writeStarted = performance.now();
      try {
        const writeOutcome = await withFileLock(file, async () => {
          await assertContainedRealCardPath(cardsDir(), file);
          let latestInfo;
          try {
            latestInfo = await lstatNoSymlink(file);
          } catch (error) {
            if (error?.code === 'ENOENT') return { status: 404, error: `no role card named ${id}` };
            if (error?.statusCode === 400) return { status: 400, error: safeErrorText(error) };
            console.warn(redactText(`${name}: role card ${id} became unreadable:`), safeErrorText(error));
            return { status: 500, error: `the role card is unreadable: ${safeErrorText(error)}` };
          }
          if (latestInfo.mtimeMs !== baselineMtimeMs) {
            return { status: 409, error: 'role card changed on disk while validating; refresh before saving' };
          }
          try {
            await writeFileAtomic(file, next, { mode: 0o644, dirMode: 0o700 });
          } catch (error) {
            console.warn(redactText(`${name}: writing role card ${id} failed:`), safeErrorText(error));
            return { status: 500, error: `writing the role card failed: ${safeErrorText(error)}` };
          }
          try {
            const afterStat = await lstatNoSymlink(file);
            const afterText = await readFile(file, 'utf8');
            return { status: 200, mtimeMs: afterStat.mtimeMs, text: afterText };
          } catch (error) {
            if (error?.statusCode === 400) return { status: 400, error: safeErrorText(error) };
            console.warn(redactText(`${name}: reading back role card ${id} after write failed:`), safeErrorText(error));
            return { status: 500, error: `reading back the rewritten role card failed: ${safeErrorText(error)}` };
          }
        });
        if (writeOutcome.status !== 200) {
          return json({ ok: false, error: writeOutcome.error }, writeOutcome.status);
        }
        freshMtimeMs = writeOutcome.mtimeMs;
        writtenText = writeOutcome.text;
      } catch (error) {
        if (error?.statusCode === 400) return json({ ok: false, error: safeErrorText(error) }, 400);
        if (typeof error?.message === 'string' && error.message.startsWith(LOCK_TIMEOUT_PREFIX)) {
          console.warn(redactText(`${name}: locking role card ${id} timed out:`), safeErrorText(error));
          const lockName = `${path.relative(agentsRootOf(), file).split(path.sep).join('/')}.lock`;
          return json({
            ok: false,
            code: 'lock-timeout',
            error: redactText(`the role card is busy: another writer holds ${lockName}. Retry in a moment; if the lock is orphaned (owner crashed), an operator must remove that lock file manually.`)
          }, 503);
        }
        console.warn(redactText(`${name}: locking or writing role card ${id} failed:`), safeErrorText(error));
        return json({ ok: false, error: `writing the role card failed: ${safeErrorText(error)}` }, 500);
      }
      const writeMs = performance.now() - writeStarted;

      let role;
      try {
        const card = parseRoleCard(writtenText, `${id}.md`, { strict: true });
        role = toRoleSummary(id, card, freshMtimeMs);
      } catch (error) {
        console.warn(redactText(`${name}: the rewritten role card ${id} failed post-write validation:`), safeErrorText(error));
        return json({ ok: false, error: `rewritten role card failed validation: ${safeErrorText(error)}` }, 500);
      }
      return json({ ok: true, role }, 200, [...(catalogMs === null ? [] : [['catalog', catalogMs]]), ['write', writeMs]]);
    }
  });
}

export { name, inject, apply, agentsRootOf, isEntryName, cardPathOf, parseRoleCard, applyRouteToCard, applyCardSettings, redactText };
