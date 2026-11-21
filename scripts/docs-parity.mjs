import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const README_NAMES = ['README.md', 'README.pt-BR.md', 'README.zh-CN.md'];

function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function shapeOf(text) {
  const lines = text.split('\n');
  return {
    headings: lines.filter((line) => /^#{1,3} /.test(line)).map((line) => line.match(/^#+/)[0].length),
    tableRows: lines.filter((line) => /^\|/.test(line)).length,
    fences: (text.match(/^```/gm) ?? []).length,
  };
}

function signatureOf(shape) {
  return JSON.stringify(shape);
}

export function checkDocsParity(files, root = packageRoot()) {
  const targets = files ?? README_NAMES.map((name) => path.join(root, name));
  const findings = [];
  if (targets.length === 0) return ['docs parity: no files to compare'];
  const shapes = [];
  for (const file of targets) {
    try {
      shapes.push(shapeOf(readFileSync(file, 'utf8')));
    } catch {
      shapes.push(null);
      findings.push(`${path.basename(file)}: unreadable file`);
    }
  }
  const valid = shapes.filter((shape) => shape !== null);
  if (valid.length === 0) return findings;
  const counts = new Map();
  for (const shape of valid) {
    const signature = signatureOf(shape);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  let reference = signatureOf(valid[0]);
  for (const [signature, count] of counts) {
    if (count > counts.get(reference)) reference = signature;
  }
  const shared = JSON.parse(reference);
  targets.forEach((file, index) => {
    const shape = shapes[index];
    if (shape === null || signatureOf(shape) === reference) return;
    const name = path.basename(file);
    if (JSON.stringify(shape.headings) !== JSON.stringify(shared.headings)) {
      findings.push(`${name}: heading levels differ from the shared shape (expected ${shared.headings.join(',')}, got ${shape.headings.join(',')})`);
    }
    if (shape.tableRows !== shared.tableRows) {
      findings.push(`${name}: table rows differ from the shared shape (expected ${shared.tableRows}, got ${shape.tableRows})`);
    }
    if (shape.fences !== shared.fences) {
      findings.push(`${name}: fenced blocks differ from the shared shape (expected ${shared.fences / 2}, got ${shape.fences / 2})`);
    }
  });
  return findings;
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const findings = checkDocsParity();
  if (findings.length === 0) {
    console.log('docs parity OK: the three READMEs share heading levels, table rows and fenced blocks');
    process.exit(0);
  }
  for (const finding of findings) console.error(finding);
  process.exit(1);
}
