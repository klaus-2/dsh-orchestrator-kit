// Transient research helper: ASAR-aware bounded directory listing and literal search.
// Run with the harness Electron runtime (ELECTRON_RUN_AS_NODE=1). All paths come from argv.
// Usage: node asar-lookup.mjs list <dir>
//        node asar-lookup.mjs search <dir> <term> [maxMatches]
import fs from 'node:fs';
import path from 'node:path';

const [mode, dir, term, maxArg] = process.argv.slice(2);
const MAX_FILE = 1024 * 1024;
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.txt']);

function walk(root, visit) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(p, visit);
    } else if (e.isFile()) visit(p);
  }
}

if (mode === 'list') {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      console.log((e.isDirectory() ? 'D ' : 'F ') + e.name);
    }
  } catch (err) { console.log('ERR ' + err.code); }
} else if (mode === 'search') {
  const max = Number(maxArg || 40);
  let hits = 0;
  let files = 0;
  walk(dir, (p) => {
    if (hits >= max) return;
    if (!TEXT_EXT.has(path.extname(p))) return;
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.size > MAX_FILE) return;
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { return; }
    files++;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && hits < max; i++) {
      if (lines[i].includes(term)) {
        hits++;
        console.log(path.relative(dir, p) + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 220));
      }
    }
  });
  console.log(`-- ${hits} hits (cap ${max}), ${files} files scanned under ${path.basename(dir)}`);
} else {
  console.log('unknown mode');
}