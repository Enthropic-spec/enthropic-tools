import { Command } from 'commander';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { tmpdir } from 'os';
import { execSync, spawnSync } from 'child_process';
import chalk from 'chalk';
import { select, Separator } from '@inquirer/prompts';

import { parse } from './parser.js';
import type { EnthSpec } from './parser.js';
import { cmdCheck, check } from './check.js';
import { generate as generateContext } from './context.js';
import { setStatus } from './state.js';
import {
  setSecret, deleteSecret, listKeys, exportEnv,
} from './vault.js';
import * as tui from './tui.js';
import { run as setupRun } from './setup.js';
import { run as newWizardRun } from './new_wizard.js';
import { run as buildRun } from './build_cmd.js';
import { run as initRun } from './init_cmd.js';
import { serve } from './mcp.js';
import { runMigrate } from './migrate.js';
import { resolveSpec } from './utils.js';
import { getWorkdir, loadConfig } from './global_config.js';

function projectName(spec: EnthSpec, path: string): string {
  const val = spec.project.get('NAME');
  const raw = val?.kind === 'str' ? val.value : path.replace(/\.enth$/, '').split('/').pop() ?? 'project';
  return raw.replace(/^"|"$/g, '').toLowerCase().replace(/ /g, '_');
}

function vaultProject(file?: string): [string, string, string[]] {
  const specPath = resolveSpec(file);
  const spec = parse(specPath);
  const name = projectName(spec, specPath);
  const dir = dirname(specPath);
  return [name, dir, spec.secrets];
}



function cmdContext(file?: string, out?: string): boolean {
  const path = resolveSpec(file);
  const spec = parse(path);
  const name = projectName(spec, path);
  const dir = dirname(path);
  const candidate = resolve(dir, `state_${name}.enth`);
  const statePath = existsSync(candidate) ? candidate : undefined;
  const result = generateContext(spec, statePath);

  if (out) {
    writeFileSync(out, result);
    console.log(`${chalk.green('✓')} Context written to ${out}`);
  } else {
    process.stdout.write(result);
  }
  return true;
}

function cmdStateShow(file?: string): boolean {
  let statePath: string;
  if (file) {
    const basename = file.split('/').pop() ?? '';
    if (basename.startsWith('state_')) {
      statePath = resolve(file);
    } else {
      const path = resolveSpec(file);
      const spec = parse(path);
      const name = projectName(spec, path);
      statePath = resolve(dirname(path), `state_${name}.enth`);
    }
  } else {
    const path = resolveSpec(undefined);
    const spec = parse(path);
    const name = projectName(spec, path);
    statePath = resolve(dirname(path), `state_${name}.enth`);
  }

  if (!existsSync(statePath)) {
    console.error(`${chalk.red('✗')} No state file found. Run 'enthropic validate' first.`);
    return false;
  }
  process.stdout.write(readFileSync(statePath, 'utf-8'));
  return true;
}

function cmdStateSet(key: string, status: string, file?: string): boolean {
  const specPath = resolveSpec(file);
  const spec = parse(specPath);
  const name = projectName(spec, specPath);
  const statePath = resolve(dirname(specPath), `state_${name}.enth`);

  if (!existsSync(statePath)) {
    console.error(`${chalk.red('✗')} State file not found: ${statePath}. Run 'enthropic validate' first.`);
    return false;
  }

  try {
    setStatus(statePath, key, status);
    console.log(`${chalk.green('✓')} ${key} → ${status.toUpperCase()}`);
    return true;
  } catch (e) {
    console.error(`${chalk.red('✗')} ${String(e)}`);
    return false;
  }
}

function cmdVaultSet(key: string, value: string, file?: string): boolean {
  const [project, directory, secretNames] = vaultProject(file);
  try {
    setSecret(project, key, value, directory, secretNames);
    console.log(`${chalk.green('✓')} ${key} → SET in vault_${project}.enth`);
    return true;
  } catch (e) {
    console.error(`${chalk.red('✗')} ${String(e)}`);
    return false;
  }
}

function cmdVaultDelete(key: string, file?: string): boolean {
  const [project, directory, secretNames] = vaultProject(file);
  try {
    deleteSecret(project, key, directory, secretNames);
    console.log(`${chalk.green('✓')} ${key} → UNSET`);
    return true;
  } catch (e) {
    console.error(`${chalk.red('✗')} ${String(e)}`);
    return false;
  }
}

function cmdVaultKeys(file?: string): boolean {
  const [project] = vaultProject(file);
  try {
    const keys = listKeys(project);
    if (keys.length === 0) {
      console.log(chalk.dim('No secrets set yet.'));
    } else {
      for (const k of keys) {
        console.log(`  ${chalk.cyan(k)}  ${chalk.green('SET')}`);
      }
    }
    return true;
  } catch (e) {
    console.error(`${chalk.red('✗')} ${String(e)}`);
    return false;
  }
}

function cmdVaultExport(out?: string, file?: string): boolean {
  const [project] = vaultProject(file);
  try {
    const result = exportEnv(project);
    if (out) {
      writeFileSync(out, result);
      console.log(`${chalk.green('✓')} Exported to ${out}`);
    } else {
      console.log(result);
    }
    return true;
  } catch (e) {
    console.error(`${chalk.red('✗')} ${String(e)}`);
    return false;
  }
}


async function pickEnthFile(workdir: string, label = 'Select project', allowBack = false): Promise<string | null> {
  type Choice = { name: string; value: string };
  const choices: Choice[] = [];

  // Flat files in workdir
  for (const f of readdirSync(workdir).sort()) {
    if (f.endsWith('.enth') && !f.startsWith('vault_') && !f.startsWith('state_')) {
      choices.push({ name: tui.pink(f), value: join(workdir, f) });
    }
  }

  // Project subfolders: workdir/<slug>/<slug>.enth
  for (const entry of readdirSync(workdir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      const specPath = join(workdir, entry.name, `${entry.name}.enth`);
      if (existsSync(specPath)) {
        choices.push({ name: tui.pink(entry.name) + tui.dimmed(`  ${entry.name}/${entry.name}.enth`), value: specPath });
      }
    }
  }

  if (choices.length === 0) {
    tui.printError('No .enth projects found in ' + workdir);
    return null;
  }

  if (allowBack) {
    choices.push({ name: tui.dimmed('← back'), value: '__back__' });
  }

  const result = await select({ message: label, pageSize: 20, choices });
  return result === '__back__' ? null : result;
}

async function runInteractiveMenu(workdir: string): Promise<void> {
  let firstRun = true;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!firstRun) {
      console.log(tui.dimmed('──────────────────────────────────────────────────────────────'));
    }
    firstRun = false;
    // eslint-disable-next-line no-await-in-loop
    const choice = await select({
      message: 'Select a command',
      pageSize: 30,
      choices: [
        { name: tui.pink('setup'.padEnd(11))    + tui.dimmed('Configure AI provider and API key'),                          value: 'setup',   short: 'setup' },
        { name: tui.pink('open'.padEnd(11))     + tui.dimmed('Open a project spec in your editor'),                         value: 'open',    short: 'open' },
        new Separator(),
        { name: tui.pink('new'.padEnd(11))      + tui.dimmed('Create a new .enth project'),                                 value: 'new',     short: 'new' },
        { name: tui.pink('update'.padEnd(11))   + tui.dimmed('Refine an existing spec with AI'),                            value: 'update',  short: 'update' },
        { name: tui.pink('reverse'.padEnd(11))  + tui.dimmed('Reverse-engineer a codebase into a starter .enth file'),      value: 'reverse', short: 'reverse' },
        new Separator(),
        { name: tui.pink('check'.padEnd(11))    + tui.dimmed('Validate & lint — errors and warnings in one view'),          value: 'check',   short: 'check' },
        { name: tui.pink('context'.padEnd(11))  + tui.dimmed('Generate AI context block from a spec'),                      value: 'context', short: 'context' },
        new Separator(),
        { name: tui.pink('state'.padEnd(11))    + tui.dimmed('Manage project build state'),                                 value: 'state',   short: 'state' },
        { name: tui.pink('vault'.padEnd(11))    + tui.dimmed('Manage encrypted project secrets'),                           value: 'vault',   short: 'vault' },
        new Separator(),
        { name: tui.pink('serve'.padEnd(11))    + tui.dimmed('MCP server — Claude Desktop, Cursor, Docker'),                value: 'serve',   short: 'serve' },
        new Separator(),
        { name: tui.pink('delete'.padEnd(11))   + tui.dimmed('Delete a project and all its files'),                         value: 'delete',  short: 'delete' },
        new Separator(),
        { name: tui.dimmed('exit'),              value: 'exit' },
      ],
    });

    if (choice === 'exit') {
      process.exit(0);
    }

    if (choice === 'serve') {
      serve();
      return;
    }

    if (choice === 'setup') {
      // eslint-disable-next-line no-await-in-loop
      await setupRun();
    } else if (choice === 'open') {
      // eslint-disable-next-line no-await-in-loop
      const specFile = await pickEnthFile(workdir, 'Open which project?', true);
      if (specFile) {
        const editor = process.env.EDITOR ?? 'open';
        try {
          execSync(`${editor} "${specFile}"`, { stdio: 'ignore' });
          tui.printSuccess(`Opened  ${specFile}`);
        } catch {
          // fallback to macOS open
          try { execSync(`open "${specFile}"`, { stdio: 'ignore' }); tui.printSuccess(`Opened  ${specFile}`); }
          catch (e) { tui.printError(`Cannot open file: ${String(e)}`); }
        }
        // eslint-disable-next-line no-await-in-loop
        await tui.pressEnter();
      }
    } else if (choice === 'new') {
      // eslint-disable-next-line no-await-in-loop
      await newWizardRun();
    } else if (choice === 'reverse') {
      // eslint-disable-next-line no-await-in-loop
      const dir = await tui.inputWithDefault('Directory to scan', '.');
      // eslint-disable-next-line no-await-in-loop
      await initRun(dir);
    } else if (choice === 'update') {
      // eslint-disable-next-line no-await-in-loop
      const file = await pickEnthFile(workdir, 'Which project to update?', true);
      if (file) {
        // eslint-disable-next-line no-await-in-loop
        await buildRun(file, false, workdir, true);
      }
    } else if (choice === 'check') {
      // eslint-disable-next-line no-await-in-loop
      const file = await pickEnthFile(workdir, 'Select project', true);
      if (file) {
        let results: import('./check.js').CheckResult[] = [];
        try {
          const spec = parse(file);
          results = check(spec);
          cmdCheck(file);
        } catch (e) { tui.printError(String(e)); }

        const hasIssues = results.some(r => r.severity === 'ERROR' || r.severity === 'WARN');
        if (hasIssues) {
          const errorsText = results.map(r => `[${r.severity}] ${r.rule}: ${r.message}`).join('\n');
          // eslint-disable-next-line no-await-in-loop
          const action = await select({
            message: tui.pink('What do you want to do?'),
            pageSize: 5,
            choices: [
              { name: tui.pink('back        ') + tui.dimmed('return to menu'),                    value: 'back',   short: 'back' },
              { name: tui.pink('refine AI   ') + tui.dimmed('fix issues with AI assistance'),     value: 'ai',     short: 'refine with AI' },
              { name: tui.pink('edit        ') + tui.dimmed('open spec in editor'),               value: 'edit',   short: 'edit manually' },
            ],
          });
          process.stdin.resume();
          if (action === 'ai') {
            // eslint-disable-next-line no-await-in-loop
            await buildRun(file, false, workdir, true, errorsText);
          } else if (action === 'edit') {
            const editor = process.env.EDITOR ?? 'open';
            try { execSync(`${editor} "${file}"`, { stdio: 'ignore' }); }
            catch { try { execSync(`open "${file}"`, { stdio: 'ignore' }); } catch { /**/ } }
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          await tui.pressEnter();
        }
      }
    } else if (choice === 'context') {
      // eslint-disable-next-line no-await-in-loop
      const file = await pickEnthFile(workdir, 'Select project', true);
      if (file) {
        try {
          const spec = parse(file);
          const projectNm = spec.project.get('NAME');
          const nm = projectNm?.kind === 'str' ? projectNm.value.replace(/"/g, '') : file.split('/').pop()?.replace('.enth', '') ?? 'project';
          const dir = dirname(file);
          const stateCand = resolve(dir, `state_${nm}.enth`);
          const statePath = existsSync(stateCand) ? stateCand : undefined;
          const { generate: genCtx } = await import('./context.js');
          const content = genCtx(spec, statePath);
          const tmpFile = join(tmpdir(), `enth_ctx_${Date.now()}.md`);
          writeFileSync(tmpFile, content);
          spawnSync('less', ['-R', tmpFile], { stdio: 'inherit' });
          try { unlinkSync(tmpFile); } catch { /**/ }
        } catch (e) { tui.printError(String(e)); }
      }
    } else if (choice === 'state') {
      // eslint-disable-next-line no-await-in-loop
      const specFile = await pickEnthFile(workdir, 'state  — select project', true);
      if (specFile) {
        // inner loop: stay in state until user goes back
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const projectName = specFile.split('/').slice(-2, -1)[0] ?? specFile;
          // eslint-disable-next-line no-await-in-loop
          const sub = await select({
            message: tui.pink('state') + tui.dimmed(`  ${projectName}`),
            pageSize: 10,
            choices: [
              { name: tui.pink('show  ') + tui.dimmed('  View current build state'),    value: 'show',  short: 'show' },
              { name: tui.pink('set   ') + tui.dimmed('  Update an entry status'),       value: 'set',   short: 'set' },
              new Separator(),
              { name: tui.dimmed('← back'),                                              value: 'back',  short: 'back' },
            ],
          });
          if (sub === 'back') break;
          if (sub === 'show') {
            try { cmdStateShow(specFile); } catch (e) { tui.printError(String(e)); }
            // eslint-disable-next-line no-await-in-loop
            await tui.pressEnter();
          } else if (sub === 'set') {
            // eslint-disable-next-line no-await-in-loop
            const key = await tui.input('Key to update');
            // eslint-disable-next-line no-await-in-loop
            const status = await tui.input('New status  (pending / in_progress / done / blocked)');
            try { cmdStateSet(key, status, specFile); } catch (e) { tui.printError(String(e)); }
            // eslint-disable-next-line no-await-in-loop
            await tui.pressEnter();
          }
        }
      }
    } else if (choice === 'vault') {
      // eslint-disable-next-line no-await-in-loop
      const specFile = await pickEnthFile(workdir, 'vault  — select project', true);
      if (specFile) {
        // inner loop: stay in vault until user goes back
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const projectName = specFile.split('/').slice(-2, -1)[0] ?? specFile;
          // eslint-disable-next-line no-await-in-loop
          const sub = await select({
            message: tui.pink('vault') + tui.dimmed(`  ${projectName}`),
            pageSize: 10,
            choices: [
              { name: tui.pink('keys  ') + tui.dimmed('  List all secret names'),        value: 'keys',   short: 'keys' },
              { name: tui.pink('set   ') + tui.dimmed('  Store a secret'),               value: 'set',    short: 'set' },
              { name: tui.pink('delete') + tui.dimmed('  Remove a secret'),              value: 'delete', short: 'delete' },
              { name: tui.pink('export') + tui.dimmed('  Export as .env file'),          value: 'export', short: 'export' },
              new Separator(),
              { name: tui.dimmed('← back'),                                              value: 'back',   short: 'back' },
            ],
          });
          if (sub === 'back') break;
          if (sub === 'keys') {
            try { cmdVaultKeys(specFile); } catch (e) { tui.printError(String(e)); }
            // eslint-disable-next-line no-await-in-loop
            await tui.pressEnter();
          } else if (sub === 'set') {
            // eslint-disable-next-line no-await-in-loop
            const key = await tui.input('Secret name  (UPPER_CASE)');
            // eslint-disable-next-line no-await-in-loop
            const val = await tui.password('Secret value');
            try { cmdVaultSet(key, val, specFile); } catch (e) { tui.printError(String(e)); }
            // eslint-disable-next-line no-await-in-loop
            await tui.pressEnter();
          } else if (sub === 'delete') {
            // eslint-disable-next-line no-await-in-loop
            const key = await tui.input('Secret name to delete');
            try { cmdVaultDelete(key, specFile); } catch (e) { tui.printError(String(e)); }
            // eslint-disable-next-line no-await-in-loop
            await tui.pressEnter();
          } else if (sub === 'export') {
            // eslint-disable-next-line no-await-in-loop
            const outFile = await tui.inputWithDefault('Output file', '.env');
            try { cmdVaultExport(outFile, specFile); } catch (e) { tui.printError(String(e)); }
            // eslint-disable-next-line no-await-in-loop
            await tui.pressEnter();
          }
        }
      }
    } else if (choice === 'delete') {
      // eslint-disable-next-line no-await-in-loop
      const specFile = await pickEnthFile(workdir, 'Delete which project?', true);
      if (specFile) {
        const projectDir = specFile.split('/').slice(0, -1).join('/');
        const projectName = specFile.split('/').slice(-2, -1)[0] ?? specFile;
        console.log();
        tui.printError(`  This will permanently delete:  ${projectDir}`);
        console.log();
        // eslint-disable-next-line no-await-in-loop
        const confirmed = await tui.confirm(`Delete  ${projectName}  and all its files?`);
        if (confirmed) {
          rmSync(projectDir, { recursive: true, force: true });
          tui.printSuccess(`${projectName} deleted.`);
          console.log();
        } else {
          tui.printDim('  Cancelled.');
        }
      }
    }

    console.log();
  }
}

async function main(): Promise<void> {
  const workdir = getWorkdir();
  process.chdir(workdir);

  const program = new Command();

  program
    .name('enthropic')
    .description('Enthropic — toolkit for the .enth architectural specification format.')
    .helpOption('-h, --help', 'Show help')
    .addHelpCommand(false);

  program
    .command('validate [file]')
    .description('Validate an .enth file (errors + warnings)')
    .action((file?: string) => {
      if (!cmdCheck(file)) process.exit(1);
    });

  program
    .command('lint [file]')
    .description('Lint an .enth file (alias for validate)')
    .action((file?: string) => {
      if (!cmdCheck(file)) process.exit(1);
    });

  program
    .command('check [file]')
    .description('Full check: errors and warnings in one view')
    .action((file?: string) => {
      if (!cmdCheck(file)) process.exit(1);
    });

  program
    .command('context [file]')
    .description('Generate the context block to paste as AI system prompt')
    .option('-o, --out <file>', 'Write output to file')
    .action((file?: string, opts?: { out?: string }) => {
      if (!cmdContext(file, opts?.out)) process.exit(1);
    });

  program
    .command('state')
    .description('Manage project build state')
    .addCommand(
      new Command('show')
        .argument('[file]', 'State file or spec file')
        .description('Show the current build state')
        .action((file?: string) => {
          cmdStateShow(file);
        }),
    )
    .addCommand(
      new Command('set')
        .argument('<key>', 'Key to update')
        .argument('<status>', 'New status')
        .argument('[file]', '.enth spec file')
        .description('Update a single entry status in the state file')
        .action((key: string, status: string, file?: string) => {
          cmdStateSet(key, status, file);
        }),
    );

  program
    .command('vault')
    .description('Manage project secrets (encrypted vault)')
    .addCommand(
      new Command('set')
        .argument('<key>', 'Secret key name')
        .argument('<value>', 'Secret value')
        .argument('[file]', '.enth spec file')
        .description('Store a secret in the encrypted vault')
        .action((key: string, value: string, file?: string) => {
          cmdVaultSet(key, value, file);
        }),
    )
    .addCommand(
      new Command('delete')
        .argument('<key>', 'Secret key to remove')
        .argument('[file]', '.enth spec file')
        .description('Remove a secret from the vault')
        .action((key: string, file?: string) => {
          cmdVaultDelete(key, file);
        }),
    )
    .addCommand(
      new Command('keys')
        .argument('[file]', '.enth spec file')
        .description('List all key names in the vault')
        .action((file?: string) => {
          cmdVaultKeys(file);
        }),
    )
    .addCommand(
      new Command('export')
        .argument('[file]', '.enth spec file')
        .option('-o, --out <file>', 'Write to .env file')
        .description('Export vault contents as .env (decrypted)')
        .action((file?: string, opts?: { out?: string }) => {
          cmdVaultExport(opts?.out, file);
        }),
    );

  program
    .command('setup')
    .description('Configure your AI provider and API key')
    .action(async () => {
      await setupRun();
    });

  program
    .command('new')
    .description('Create a new Enthropic project interactively')
    .action(async () => {
      await newWizardRun();
    });

  program
    .command('init [dir]')
    .description('Reverse-engineer an existing codebase into a starter .enth file')
    .action(async (dir?: string) => {
      await initRun(dir ?? process.cwd());
    });

  program
    .command('build [file]')
    .description('Start an interactive AI build session for this project')
    .action(async (file?: string) => {
      await buildRun(file);
    });

  program
    .command('serve')
    .description('Start MCP server (stdio) — use with Claude Desktop, Cursor, or Docker')
    .action(() => {
      // serve runs forever — skip post-parse menu
      serve();
      process.exit(0);
    });

  program
    .command('migrate')
    .description('Compare two .enth specs and produce a human-readable migration report')
    .requiredOption('--from <file>', 'Source spec file (old version)')
    .requiredOption('--to <file>', 'Target spec file (new version)')
    .action((opts: { from: string; to: string }) => {
      runMigrate(opts.from, opts.to);
    });

  // Default: no command → interactive menu
  if (process.argv.length <= 2) {
    tui.printHeader();
    tui.printWorkdir(workdir);
    const cfg = loadConfig();
    if (cfg.provider && cfg.model) {
      console.log(tui.dimmed(`  ${cfg.provider}  ·  ${cfg.model}`));
      console.log();
    }
    await runInteractiveMenu(workdir);
    return;
  }

  await program.parseAsync(process.argv);

  // After any direct command, return to menu if interactive terminal
  if (process.stdout.isTTY) {
    process.stdin.resume();
    console.log();
    tui.printWorkdir(workdir);
    await runInteractiveMenu(workdir);
  }
}

main().catch(e => {
  console.error(`${chalk.red('✗')} ${String(e)}`);
  process.exit(1);
});
