import { existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import chalk from 'chalk';
import { parse } from './parser.js';
import type { EnthSpec } from './parser.js';
import { validate } from './validator.js';
import { lint } from './lint.js';
import { generate as generateState } from './state.js';
import * as tui from './tui.js';

export interface CheckResult {
  rule: string;
  severity: 'ERROR' | 'WARN';
  message: string;
}

export function check(spec: EnthSpec): CheckResult[] {
  const results: CheckResult[] = [];
  for (const e of validate(spec)) {
    results.push({ rule: `V${e.rule}`, severity: 'ERROR', message: e.message });
  }
  for (const w of lint(spec)) {
    results.push({ rule: `L${w.rule}`, severity: 'WARN', message: w.message });
  }
  return results;
}

function projectName(spec: EnthSpec, path: string): string {
  const val = spec.project.get('NAME');
  const raw = val?.kind === 'str' ? val.value : path.replace(/\.enth$/, '').split('/').pop() ?? 'project';
  return raw.replace(/^"|"$/g, '').toLowerCase().replace(/ /g, '_');
}

export function cmdCheck(file?: string): boolean {
  const specPath = file ?? (() => { throw new Error('No spec file provided'); })();
  const spec = parse(specPath);
  const results = check(spec);

  const errors = results.filter(r => r.severity === 'ERROR');
  const warnings = results.filter(r => r.severity === 'WARN');

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`\n  ${chalk.green('✓')} Spec is clean — no errors, no warnings\n`);
  } else {
    const col = (s: string, w: number) => (s + ' '.repeat(w)).slice(0, w);
    if (errors.length > 0) {
      console.log(`\n  ${tui.errorRed(`✗ ${errors.length} ERROR${errors.length > 1 ? 'S' : ''}`)}`);
      console.log('  ' + '─'.repeat(76));
      for (const e of errors) {
        console.log(`  ${chalk.dim(col(e.rule, 5))} ${tui.errorRed(col('ERROR', 8))}  ${e.message}`);
      }
    }
    if (warnings.length > 0) {
      console.log(`\n  ${tui.warnYellow(`⚠ ${warnings.length} WARNING${warnings.length > 1 ? 'S' : ''}`)}`);
      console.log('  ' + '─'.repeat(76));
      for (const w of warnings) {
        console.log(`  ${chalk.dim(col(w.rule, 5))} ${tui.warnYellow(col('WARN', 8))}  ${w.message}`);
      }
    }
    console.log('');
  }

  // On clean spec: scaffold state file if missing
  if (errors.length === 0) {
    const name = projectName(spec, specPath);
    const dir = dirname(specPath);

    const statePath = resolve(dir, `state_${name}.enth`);
    if (!existsSync(statePath)) {
      writeFileSync(statePath, generateState(spec, name));
      console.log(chalk.dim(`  created state_${name}.enth`));
    }
  }

  return errors.length === 0;
}
