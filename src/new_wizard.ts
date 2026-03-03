import { writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import * as tui from './tui.js';
import { parse } from './parser.js';
import { validate } from './validator.js';
import { generate as generateState } from './state.js';
import { getWorkdir } from './global_config.js';

const LANGUAGES = ['python', 'rust', 'typescript', 'go', 'other'];
const ARCH_STYLES = ['layered', 'event-driven', 'realtime', 'offline-first', 'other'];

interface LayerDef {
  name: string;
  calls: string[];
  never: string[];
}

export async function run(): Promise<void> {

  // FIX: ask AI vs manual at start
  const modeIdx = await tui.select('How do you want to create the .enth?', [
    'With AI (guided conversation)',
    'Manually (follow the spec)',
  ]);

  if (modeIdx === 0) {
    // AI path — always fresh, never picks up existing spec
    const { run: buildRun } = await import('./build_cmd.js');
    await buildRun(undefined, true, getWorkdir());
    return;
  }

  // Manual path
  console.log();
  tui.printDim('  Open the spec at: https://github.com/Enthropic-spec/enthropic/blob/main/SPEC.md');
  console.log();

  console.log('  New Enthropic project\n');

  const projectName = await tui.input('Project name');
  console.log();

  const langIdx = await tui.select('Primary language', LANGUAGES);
  const lang = LANGUAGES[langIdx];
  console.log();

  const archIdx = await tui.select('Architecture style', ARCH_STYLES);
  const arch = ARCH_STYLES[archIdx];
  console.log();

  const stackRaw = await tui.input('Stack (comma-separated, e.g. fastapi, postgresql)');
  const stack = stackRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);
  console.log();

  console.log('  Entities — the core domain objects of your project.');
  const entitiesRaw = await tui.input('Add entities (comma-separated, snake_case)');
  const entities = entitiesRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);
  console.log();

  const layers: LayerDef[] = [];
  console.log('  Layers — logical boundaries in your code.');
  const addLayers = await tui.confirm('Add layers? (you can skip and add manually)');
  console.log();

  if (addLayers) {
     
    while (true) {
      const layerName = await tui.input('Layer name (UPPER_CASE)');
      console.log();

      const callsRaw = await tui.input('This layer CALLS (comma-separated layer names)');
      const calls = callsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);
      console.log();

      const neverRaw = await tui.inputWithDefault(
        'This layer NEVER (comma-separated, optional — leave blank to skip)',
        '',
      );
      const neverList = neverRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);
      console.log();

      layers.push({ name: layerName, calls, never: neverList });

      const addMore = await tui.confirm('Add another layer?');
      console.log();
      if (!addMore) break;
    }
  }

  let secrets: string[] = [];
  console.log('  Secrets — environment variables this project needs.');
  const addSecrets = await tui.confirm('Add secrets? (API keys, DB URLs, etc.)');
  console.log();

  if (addSecrets) {
    const secretsRaw = await tui.input('Secret names (comma-separated, UPPER_CASE)');
    secrets = secretsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);
    console.log();
  }

  const slug = projectName.trim().toLowerCase().replace(/ /g, '_');
  const nameClean = projectName.trim().replace(/^"|"$/g, '');

  let content = 'VERSION 1\n\n';
  content += `PROJECT "${nameClean}"\n`;
  content += `  LANG ${lang}\n`;
  content += `  ARCH ${arch}\n`;
  if (stack.length > 0) content += `  STACK ${stack.join(', ')}\n`;
  content += '\n';

  if (entities.length > 0) {
    content += `ENTITY ${entities.join(', ')}\n\n`;
  }

  if (layers.length > 0) {
    content += 'LAYERS\n';
    for (const layer of layers) {
      content += `  ${layer.name}\n`;
      if (layer.calls.length > 0) content += `    CALLS ${layer.calls.join(', ')}\n`;
      for (const n of layer.never) content += `    NEVER ${n}\n`;
    }
    content += '\n';
  }

  if (secrets.length > 0) {
    content += 'SECRETS\n';
    for (const s of secrets) content += `  ${s}\n`;
    content += '\n';
  }

  const workdir = getWorkdir();
  const projectDir = join(workdir, slug);
  mkdirSync(projectDir, { recursive: true });

  const specPath = join(projectDir, `${slug}.enth`);
  writeFileSync(specPath, content);

  const spec = parse(resolve(specPath));
  const errors = validate(spec);

  if (errors.length > 0) {
    console.log();
    tui.printError('Validation warnings (file written but has issues):');
    for (const e of errors) {
      console.log(`  [${String(e.rule).padStart(2)}] ${e.severity} — ${e.message}`);
    }
    console.log();
  }

  const stateContent = generateState(spec, slug);
  writeFileSync(join(projectDir, `state_${slug}.enth`), stateContent);

  console.log();
  if (errors.length === 0) {
    tui.printSuccess(`${slug}.enth created and validated`);
  } else {
    tui.printSuccess(`${slug}.enth created (with warnings — check above)`);
  }
  tui.printSuccess(`state_${slug}.enth created`);
  tui.printDim(`  Project folder: ${projectDir}`);
  console.log();
  tui.printDim('  Next: run  enthropic build  to start building with AI.');
}
