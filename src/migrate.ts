import { existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from './parser.js';
import type { Contract } from './parser.js';
import * as tui from './tui.js';

const RENAME_SIMILARITY_THRESHOLD = 3;

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function findRename(removed: string, added: string[]): string | undefined {
  return added.find(a => levenshtein(removed, a) < RENAME_SIMILARITY_THRESHOLD);
}

function contractKey(c: Contract): string {
  return `${c.subject} ${c.keyword} ${c.qualifier}`;
}

export function runMigrate(fromPath: string, toPath: string): void {
  const absFrom = resolve(fromPath);
  const absTo = resolve(toPath);

  if (!existsSync(absFrom)) {
    tui.printError(`File not found: ${fromPath}`);
    process.exit(1);
  }
  if (!existsSync(absTo)) {
    tui.printError(`File not found: ${toPath}`);
    process.exit(1);
  }

  const oldSpec = parse(absFrom);
  const newSpec = parse(absTo);

  const fromVersion = oldSpec.version || '?';
  const toVersion = newSpec.version || '?';

  console.log(tui.warnYellow(`=== MIGRATION REPORT: v${fromVersion} → v${toVersion} ===`));
  console.log();

  // Entity diffs
  const oldEntities = new Set(oldSpec.entities);
  const newEntities = new Set(newSpec.entities);
  const addedEntities = newSpec.entities.filter(e => !oldEntities.has(e));
  const removedEntities = oldSpec.entities.filter(e => !newEntities.has(e));

  // Flow diffs
  const oldFlows = new Set(oldSpec.flowsOrder);
  const newFlows = new Set(newSpec.flowsOrder);
  const addedFlows = newSpec.flowsOrder.filter(f => !oldFlows.has(f));
  const removedFlows = oldSpec.flowsOrder.filter(f => !newFlows.has(f));

  // Contract diffs
  const oldContractKeys = new Set(oldSpec.contracts.map(contractKey));
  const newContractKeys = new Set(newSpec.contracts.map(contractKey));
  const addedContracts = newSpec.contracts.filter(c => !oldContractKeys.has(contractKey(c)));
  const removedContracts = oldSpec.contracts.filter(c => !newContractKeys.has(contractKey(c)));

  // Rename detection for entities (heuristic: levenshtein < 3)
  const renames: [string, string][] = [];
  for (const removed of removedEntities) {
    const match = findRename(removed, addedEntities);
    if (match) renames.push([removed, match]);
  }
  const renamedAdded = new Set(renames.map(([, a]) => a));
  const renamedRemoved = new Set(renames.map(([r]) => r));

  // BREAKING section: rename pairs
  if (renames.length > 0) {
    console.log(tui.warnYellow('BREAKING'));
    for (const [removed, added] of renames) {
      console.log(tui.removed(`  - entity '${removed}' removed`));
      console.log(tui.added(`  + entity '${added}' added`) + tui.warnYellow(`  ← possible rename of '${removed}'`));
    }
    console.log();
  }

  // ENTITIES section: net adds/removes (not part of rename pairs)
  const netAdded = addedEntities.filter(e => !renamedAdded.has(e));
  const netRemoved = removedEntities.filter(e => !renamedRemoved.has(e));
  if (netAdded.length > 0 || netRemoved.length > 0) {
    console.log(tui.boldText('ENTITIES'));
    for (const e of netAdded) console.log(tui.added(`  + added:   ${e}`));
    for (const e of netRemoved) console.log(tui.removed(`  - removed: ${e}`));
    console.log();
  }

  // FLOWS section
  if (addedFlows.length > 0 || removedFlows.length > 0) {
    console.log(tui.boldText('FLOWS'));
    for (const f of addedFlows) console.log(tui.added(`  + added:   ${f}`));
    for (const f of removedFlows) console.log(tui.removed(`  - removed: ${f}`));
    console.log();
  }

  // CONTRACTS section
  if (addedContracts.length > 0 || removedContracts.length > 0) {
    console.log(tui.boldText('CONTRACTS'));
    for (const c of addedContracts) console.log(tui.added(`  + added:   ${c.subject} ${c.keyword} ${c.qualifier}`));
    for (const c of removedContracts) console.log(tui.removed(`  - removed: ${c.subject} ${c.keyword} ${c.qualifier}`));
    console.log();
  }

  // CHANGELOG notes from new spec (newest version first, or version matching newSpec.version)
  const changelogVersion = newSpec.changelog.find(v => v.version === newSpec.version) ?? newSpec.changelog[0];
  if (changelogVersion && changelogVersion.entries.length > 0) {
    console.log(tui.boldText('CHANGELOG notes (from new spec):'));
    for (const entry of changelogVersion.entries) {
      const tag = `[${entry.keyword}]`.padEnd(14);
      const colored = entry.keyword === 'BREAKING' ? tui.warnYellow(tag)
        : entry.keyword === 'ADDED' ? tui.added(tag)
          : entry.keyword === 'DEPRECATED' ? tui.removed(tag)
            : tui.dimmed(tag);
      console.log(`  ${colored}  ${entry.description}`);
    }
    console.log();
  }
}
