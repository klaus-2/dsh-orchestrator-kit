#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.0.0';
export const STATE_DIR = '.devflow/maps';
export const STATE_FILE = 'codemap.json';
export const LEGACY_STATE_FILE = 'cartography.json';
export const CODEMAP_FILE = 'codemap.md';

const TOK_LITERAL = 0;
const TOK_ANY_CHAR = 1;
const TOK_STAR = 2;
const TOK_GLOBSTAR = 3;
const TOK_GLOBSTAR_DIR = 4;
const TOK_PREFIX_ANY = 5;

function compilePatternTokens(pattern) {
  const normalized = pattern
    .replace(/\*{2,}/g, '**')
    .replace(/(?:\*\*\/)+/g, '**/');
  const tokens = [];
  let i = 0;
  if (normalized.startsWith('/')) {
    i = 1;
  } else {
    tokens.push({ kind: TOK_PREFIX_ANY });
  }
  while (i < normalized.length) {
    if (normalized.startsWith('**/', i) && (i === 0 || normalized[i - 1] === '/')) {
      tokens.push({ kind: TOK_GLOBSTAR_DIR });
      i += 3;
    } else if (normalized.startsWith('**', i)) {
      if (tokens[tokens.length - 1]?.kind !== TOK_GLOBSTAR) {
        tokens.push({ kind: TOK_GLOBSTAR });
      }
      i += 2;
    } else if (normalized[i] === '*') {
      if (tokens[tokens.length - 1]?.kind !== TOK_STAR) {
        tokens.push({ kind: TOK_STAR });
      }
      i += 1;
    } else if (normalized[i] === '?') {
      tokens.push({ kind: TOK_ANY_CHAR });
      i += 1;
    } else {
      tokens.push({ kind: TOK_LITERAL, ch: normalized[i] });
      i += 1;
    }
  }
  if (normalized.endsWith('/') && tokens[tokens.length - 1]?.kind !== TOK_GLOBSTAR) {
    tokens.push({ kind: TOK_GLOBSTAR });
  }
  return tokens;
}

function matchTokens(tokens, text) {
  const len = text.length;
  let curr = new Uint8Array(len + 1);
  let next = new Uint8Array(len + 1);
  curr[0] = 1;

  for (const tok of tokens) {
    next.fill(0);
    if (tok.kind === TOK_PREFIX_ANY) {
      if (curr[0]) {
        next[0] = 1;
        for (let p = 1; p <= len; p++) {
          if (text[p - 1] === '/') next[p] = 1;
        }
      }
    } else if (tok.kind === TOK_GLOBSTAR) {
      let seen = false;
      for (let p = 0; p <= len; p++) {
        if (curr[p]) seen = true;
        if (seen) next[p] = 1;
      }
    } else if (tok.kind === TOK_GLOBSTAR_DIR) {
      let seen = false;
      for (let p = 0; p <= len; p++) {
        if (curr[p]) {
          seen = true;
          next[p] = 1;
        }
        if (seen && p > 0 && text[p - 1] === '/') {
          next[p] = 1;
        }
      }
    } else if (tok.kind === TOK_STAR) {
      let active = false;
      for (let p = 0; p <= len; p++) {
        if (curr[p]) active = true;
        if (active) next[p] = 1;
        if (p < len && text[p] === '/') active = false;
      }
    } else if (tok.kind === TOK_ANY_CHAR) {
      for (let p = 0; p < len; p++) {
        if (curr[p] && text[p] !== '/') next[p + 1] = 1;
      }
    } else if (tok.kind === TOK_LITERAL) {
      for (let p = 0; p < len; p++) {
        if (curr[p] && text[p] === tok.ch) next[p + 1] = 1;
      }
    }
    const tmp = curr;
    curr = next;
    next = tmp;
  }

  return curr[len] === 1;
}

export class PatternMatcher {
  compiledPatterns;

  constructor(patterns) {
    this.compiledPatterns = patterns.map(compilePatternTokens);
  }

  matches(filePath) {
    for (const tokens of this.compiledPatterns) {
      if (matchTokens(tokens, filePath)) return true;
    }
    return false;
  }
}

function lstatOptional(targetPath) {
  try {
    return lstatSync(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function assertContainedNoSymlinks(root, targetPath) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes repository root: ${targetPath}`);
  }
  const rootReal = realpathSync(resolvedRoot);
  const segments = rel === '' ? [] : rel.split(path.sep).filter(Boolean);
  let cur = resolvedRoot;
  let deepestExisting = resolvedRoot;
  for (const seg of segments) {
    cur = path.join(cur, seg);
    const st = lstatOptional(cur);
    if (st === null) break;
    if (st.isSymbolicLink()) {
      throw new Error(`Refusing symbolic link inside repository: ${cur}`);
    }
    deepestExisting = cur;
  }
  const realTarget = realpathSync(deepestExisting);
  const realRel = path.relative(rootReal, realTarget);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    throw new Error(`Path resolves outside repository root: ${targetPath}`);
  }
}

export function loadGitignore(root) {
  const gitignorePath = path.join(root, '.gitignore');
  assertContainedNoSymlinks(root, gitignorePath);
  const st = lstatOptional(gitignorePath);
  if (st === null || !st.isFile()) return [];

  return readFileSync(gitignorePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function walkFiles(root) {
  const files = [];

  function visit(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) {
          visit(fullPath);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  visit(root);
  return files.sort();
}

export function selectFiles(
  root,
  includePatterns,
  excludePatterns,
  exceptions,
  gitignorePatterns,
) {
  const includeMatcher = new PatternMatcher(includePatterns);
  const excludeMatcher = new PatternMatcher(excludePatterns);
  const gitignoreMatcher = new PatternMatcher(gitignorePatterns);
  const exceptionSet = new Set(exceptions);

  return walkFiles(root).filter((fullPath) => {
    let relPath = path.relative(root, fullPath).replaceAll(path.sep, '/');
    if (relPath.startsWith('./')) {
      relPath = relPath.slice(2);
    }

    if (gitignoreMatcher.matches(relPath)) return false;
    if (excludeMatcher.matches(relPath) && !exceptionSet.has(relPath)) {
      return false;
    }

    return includeMatcher.matches(relPath) || exceptionSet.has(relPath);
  });
}

export function computeFileHash(filePath) {
  let buffer;
  try {
    buffer = readFileSync(filePath);
  } catch (error) {
    throw new Error(`Cannot read file for hashing (${filePath}): ${error instanceof Error ? error.message : String(error)}`);
  }
  return createHash('md5').update(buffer).digest('hex');
}

export function computeFolderHash(folder, fileHashes) {
  const folderFiles = Object.entries(fileHashes)
    .filter(
      ([filePath]) =>
        filePath.startsWith(`${folder}/`) ||
        (folder === '.' && !filePath.includes('/')),
    )
    .sort(([a], [b]) => a.localeCompare(b));

  if (!folderFiles.length) return '';

  const hasher = createHash('md5');
  for (const [filePath, hash] of folderFiles) {
    hasher.update(`${filePath}:${hash}\n`);
  }
  return hasher.digest('hex');
}

export function getFoldersWithFiles(files, root) {
  const folders = new Set(['.']);

  for (const filePath of files) {
    const relPath = path.relative(root, filePath).replaceAll(path.sep, '/');
    const parts = relPath.split('/').slice(0, -1);
    for (let i = 0; i < parts.length; i++) {
      folders.add(parts.slice(0, i + 1).join('/'));
    }
  }

  return folders;
}

export function migrateLegacyState(root) {
  const stateDir = path.join(root, STATE_DIR);
  const statePath = path.join(stateDir, STATE_FILE);

  assertContainedNoSymlinks(root, statePath);
  if (lstatOptional(statePath) !== null) {
    return false;
  }

  const legacyCandidates = [
    `.codemap/${STATE_FILE}`,
    `.codemap/${LEGACY_STATE_FILE}`,
    STATE_FILE,
    LEGACY_STATE_FILE,
  ];

  const foundRel = legacyCandidates.find((relPath) => {
    const candidatePath = path.join(root, ...relPath.split('/'));
    assertContainedNoSymlinks(root, candidatePath);
    const st = lstatOptional(candidatePath);
    return st !== null && st.isFile();
  });

  if (!foundRel) {
    return false;
  }

  const foundLegacyPath = path.join(root, ...foundRel.split('/'));
  assertContainedNoSymlinks(root, stateDir);
  mkdirSync(stateDir, { recursive: true });
  assertContainedNoSymlinks(root, statePath);
  renameSync(foundLegacyPath, statePath);

  if (foundRel.startsWith('.codemap/')) {
    const legacyDir = path.join(root, '.codemap');
    try {
      assertContainedNoSymlinks(root, legacyDir);
      if (lstatOptional(legacyDir)?.isDirectory() && readdirSync(legacyDir).length === 0) {
        rmdirSync(legacyDir);
      }
    } catch (error) {
      if (error?.code !== 'ENOTEMPTY' && error?.code !== 'EEXIST' && error?.code !== 'EBUSY') {
        console.warn(`Unable to remove legacy .codemap directory: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  console.log(`Migrated ${foundRel} -> ${STATE_DIR}/${STATE_FILE}`);
  return true;
}

function assertStringArrayField(meta, field) {
  const value = meta[field];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid codemap state in ${STATE_DIR}/${STATE_FILE}: metadata.${field} must be an array of strings`);
  }
}

export function loadState(root) {
  migrateLegacyState(root);
  const statePath = path.join(root, STATE_DIR, STATE_FILE);
  assertContainedNoSymlinks(root, statePath);
  const st = lstatOptional(statePath);
  if (st === null) return null;
  if (!st.isFile()) {
    throw new Error(`Invalid codemap state path (not a file): ${STATE_DIR}/${STATE_FILE}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to load ${STATE_DIR}/${STATE_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid codemap state in ${STATE_DIR}/${STATE_FILE}: expected a JSON object`);
  }
  if (parsed.metadata !== undefined) {
    if (parsed.metadata === null || typeof parsed.metadata !== 'object' || Array.isArray(parsed.metadata)) {
      throw new Error(`Invalid codemap state in ${STATE_DIR}/${STATE_FILE}: metadata must be an object`);
    }
    assertStringArrayField(parsed.metadata, 'include_patterns');
    assertStringArrayField(parsed.metadata, 'exclude_patterns');
    assertStringArrayField(parsed.metadata, 'exceptions');
  }
  return parsed;
}

export function saveState(root, state) {
  const stateDir = path.join(root, STATE_DIR);
  const statePath = path.join(stateDir, STATE_FILE);
  assertContainedNoSymlinks(root, stateDir);
  mkdirSync(stateDir, { recursive: true });
  assertContainedNoSymlinks(root, statePath);
  const tmpPath = path.join(
    stateDir,
    `${STATE_FILE}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
  );
  try {
    writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    renameSync(tmpPath, statePath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failure if temp file was never created.
    }
    throw error;
  }
}

export function createEmptyCodemap(folderPath, folderName, root = folderPath) {
  const codemapPath = path.join(folderPath, CODEMAP_FILE);
  assertContainedNoSymlinks(root, codemapPath);
  if (lstatOptional(codemapPath) !== null) return;

  const content = `# ${folderName}/

<!-- implementer / repo-scout: Fill in this section with architectural understanding -->

## Responsibility

<!-- What is this folder's job in the system? -->

## Design

<!-- Key patterns, abstractions, architectural decisions -->

## Flow

<!-- How does data/control flow through this module? -->

## Integration

<!-- How does it connect to other parts of the system? -->
`;

  try {
    writeFileSync(codemapPath, content, { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') return;
    throw error;
  }
}

function buildState(
  root,
  includePatterns,
  excludePatterns,
  exceptions,
  selectedFiles,
) {
  const fileHashes = {};
  for (const filePath of selectedFiles) {
    const relPath = path.relative(root, filePath).replaceAll(path.sep, '/');
    fileHashes[relPath] = computeFileHash(filePath);
  }

  const folders = getFoldersWithFiles(selectedFiles, root);
  const folderHashes = {};
  for (const folder of folders) {
    folderHashes[folder] = computeFolderHash(folder, fileHashes);
  }

  const state = {
    metadata: {
      version: VERSION,
      last_run: new Date().toISOString(),
      root,
      include_patterns: includePatterns,
      exclude_patterns: excludePatterns,
      exceptions,
    },
    file_hashes: fileHashes,
    folder_hashes: folderHashes,
  };

  return { state, folders };
}

export function cmdInit({ root, include = [], exclude = [], exception = [] }) {
  const resolvedRoot = path.resolve(root);
  if (!existsSync(resolvedRoot) || !statSync(resolvedRoot).isDirectory()) {
    console.error(`Error: ${resolvedRoot} is not a directory`);
    return 1;
  }

  const includePatterns = include.length ? include : ['**/*'];
  const excludePatterns = exclude;
  const exceptions = exception;
  const gitignore = loadGitignore(resolvedRoot);

  console.log(`Scanning ${resolvedRoot}...`);
  console.log(`Include patterns: ${JSON.stringify(includePatterns)}`);
  console.log(`Exclude patterns: ${JSON.stringify(excludePatterns)}`);
  console.log(`Exceptions: ${JSON.stringify(exceptions)}`);

  const selectedFiles = selectFiles(
    resolvedRoot,
    includePatterns,
    excludePatterns,
    exceptions,
    gitignore,
  );

  console.log(`Selected ${selectedFiles.length} files`);

  const { state, folders } = buildState(
    resolvedRoot,
    includePatterns,
    excludePatterns,
    exceptions,
    selectedFiles,
  );

  saveState(resolvedRoot, state);
  console.log(`Created ${STATE_DIR}/${STATE_FILE}`);

  for (const folder of folders) {
    const folderPath =
      folder === '.' ? resolvedRoot : path.join(resolvedRoot, folder);
    const folderName = folder === '.' ? path.basename(resolvedRoot) : folder;
    createEmptyCodemap(folderPath, folderName, resolvedRoot);
  }

  console.log(`Created ${folders.size} empty codemap.md files`);
  return 0;
}

export function cmdChanges({ root }) {
  const resolvedRoot = path.resolve(root);
  const state = loadState(resolvedRoot);
  if (!state) {
    console.error("No codemap state found. Run 'init' first.");
    return 1;
  }

  const metadata = state.metadata ?? {};
  const includePatterns = metadata.include_patterns ?? ['**/*'];
  const excludePatterns = metadata.exclude_patterns ?? [];
  const exceptions = metadata.exceptions ?? [];
  const gitignore = loadGitignore(resolvedRoot);

  const currentFiles = selectFiles(
    resolvedRoot,
    includePatterns,
    excludePatterns,
    exceptions,
    gitignore,
  );

  const currentHashes = Object.fromEntries(
    currentFiles.map((filePath) => [
      path.relative(resolvedRoot, filePath).replaceAll(path.sep, '/'),
      computeFileHash(filePath),
    ]),
  );

  const savedHashes = state.file_hashes ?? {};
  const currentPaths = new Set(Object.keys(currentHashes));
  const savedPaths = new Set(Object.keys(savedHashes));

  const added = [...currentPaths]
    .filter((filePath) => !savedPaths.has(filePath))
    .sort();
  const removed = [...savedPaths]
    .filter((filePath) => !currentPaths.has(filePath))
    .sort();
  const modified = [...currentPaths]
    .filter((filePath) => savedPaths.has(filePath))
    .filter((filePath) => currentHashes[filePath] !== savedHashes[filePath])
    .sort();

  if (!added.length && !removed.length && !modified.length) {
    console.log('No changes detected.');
    return 0;
  }

  if (added.length) {
    console.log(`\n${added.length} added:`);
    for (const filePath of added) console.log(`  + ${filePath}`);
  }

  if (removed.length) {
    console.log(`\n${removed.length} removed:`);
    for (const filePath of removed) console.log(`  - ${filePath}`);
  }

  if (modified.length) {
    console.log(`\n${modified.length} modified:`);
    for (const filePath of modified) console.log(`  ~ ${filePath}`);
  }

  const affectedFolders = new Set(['.']);
  for (const filePath of [...added, ...removed, ...modified]) {
    const parts = filePath.split('/').slice(0, -1);
    for (let i = 0; i < parts.length; i++) {
      affectedFolders.add(parts.slice(0, i + 1).join('/'));
    }
  }

  const sortedFolders = [...affectedFolders].sort();
  console.log(`\n${sortedFolders.length} folders affected:`);
  for (const folder of sortedFolders) {
    console.log(`  ${folder}/`);
  }

  return 0;
}

export function cmdUpdate({ root }) {
  const resolvedRoot = path.resolve(root);
  const state = loadState(resolvedRoot);
  if (!state) {
    console.error("No codemap state found. Run 'init' first.");
    return 1;
  }

  const metadata = state.metadata ?? {};
  const includePatterns = metadata.include_patterns ?? ['**/*'];
  const excludePatterns = metadata.exclude_patterns ?? [];
  const exceptions = metadata.exceptions ?? [];
  const gitignore = loadGitignore(resolvedRoot);

  const selectedFiles = selectFiles(
    resolvedRoot,
    includePatterns,
    excludePatterns,
    exceptions,
    gitignore,
  );

  const { state: nextState } = buildState(
    resolvedRoot,
    includePatterns,
    excludePatterns,
    exceptions,
    selectedFiles,
  );

  saveState(resolvedRoot, nextState);
  console.log(
    `Updated ${STATE_DIR}/${STATE_FILE} with ${selectedFiles.length} files`,
  );
  return 0;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { include: [], exclude: [], exception: [] };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = rest[i + 1];

    if (!arg?.startsWith('--')) continue;
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    const key = arg.slice(2);
    if (key === 'include' || key === 'exclude' || key === 'exception') {
      options[key].push(value);
    } else if (key === 'root') {
      options.root = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }

    i++;
  }

  return { command, options };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const { command, options } = parseArgs(argv);

    if (!command || !options.root) {
      console.error(
        'Usage: codemap.mjs <init|changes|update> --root /path [--include glob] [--exclude glob] [--exception path]',
      );
      return 1;
    }

    if (command === 'init') return cmdInit(options);
    if (command === 'changes') return cmdChanges(options);
    if (command === 'update') return cmdUpdate(options);

    console.error(`Unknown command: ${command}`);
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  process.exit(main());
}
