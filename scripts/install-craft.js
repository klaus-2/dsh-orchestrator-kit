#!/usr/bin/env node
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { agentsRootOf, isEntryName, cardPathOf, redactText } from '../index.js';

const LOCK_TIMEOUT_PREFIX = 'atomic-write: timed out waiting for the writer lock';
const CRAFT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CRAFT_AGENTS_DIR = path.join(CRAFT_ROOT, 'craft', 'agents');
const CRAFT_SKILL_DIR = path.join(CRAFT_ROOT, 'craft', 'skills', 'dev-flow');

const lockRelativeOf = (target) => path.relative(agentsRootOf(), `${target}.lock`).split(path.sep).join('/');

const assertContained = (root, target) => {
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`target escapes the agents root: ${path.basename(target)}`);
  }
  return relative.split(path.sep).join('/');
};

const collectAgentTargets = async () => {
  const cardsDir = path.join(agentsRootOf(), 'agents');
  const entries = await readdir(CRAFT_AGENTS_DIR, { withFileTypes: true });
  const targets = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const id = entry.name.slice(0, -3);
    if (!isEntryName(id)) continue;
    targets.push({
      id,
      source: path.join(CRAFT_AGENTS_DIR, entry.name),
      target: cardPathOf(cardsDir, id)
    });
  }
  targets.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return targets;
};

const collectSkillTargets = async (sourceDir, targetDir, targets) => {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await collectSkillTargets(source, target, targets);
      continue;
    }
    if (!entry.isFile()) continue;
    targets.push({ id: entry.name, source, target });
  }
};

const copyTarget = async (plan) => {
  const bytes = await readFile(plan.source);
  await mkdir(path.dirname(plan.target), { recursive: true });
  await withFileLock(plan.target, async () => {
    let exists = true;
    try {
      await stat(plan.target);
    } catch (error) {
      if (error?.code === 'ENOENT') exists = false;
      else throw error;
    }
    if (exists) throw new Error(`target appeared after the skip check: ${path.basename(plan.target)}`);
    await writeFileAtomic(plan.target, bytes, {});
  });
};

const main = async () => {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  const root = agentsRootOf();
  const agentPlans = await collectAgentTargets();
  const skillPlans = [];
  await collectSkillTargets(CRAFT_SKILL_DIR, path.join(root, 'skills', 'dev-flow'), skillPlans);
  const plans = [...agentPlans, ...skillPlans];
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const plan of plans) {
    try {
      const relative = assertContained(root, plan.target);
      let exists = false;
      try {
        await stat(plan.target);
        exists = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (exists) {
        skipped += 1;
        process.stdout.write(`skipped ${relative}\n`);
        continue;
      }
      if (!dryRun) {
        await copyTarget(plan);
        created += 1;
        process.stdout.write(`created ${relative}\n`);
        continue;
      }
      skipped += 1;
      process.stdout.write(`skipped ${relative}\n`);
    } catch (error) {
      if (typeof error?.message === 'string' && error.message.includes(LOCK_TIMEOUT_PREFIX)) {
        const relative = lockRelativeOf(plan.target);
        process.stdout.write(`failed ${relative}: the writer lock is held\n`);
        process.stderr.write(`the lock ${relative} is held by another writer. retry in a moment; if the owner crashed, an operator must remove that lock file manually.\n`);
        failed += 1;
        continue;
      }
      failed += 1;
      const relative = path.relative(root, plan.target).split(path.sep).join('/');
      process.stdout.write(`failed ${relative}: ${redactText(typeof error?.message === 'string' ? error.message : 'unknown error')}\n`);
    }
  }
  process.stdout.write(`created ${created}, skipped ${skipped}, failed ${failed}\n`);
  process.exitCode = failed === 0 ? 0 : 1;
};

main();
