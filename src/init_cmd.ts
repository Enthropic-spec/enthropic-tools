import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename, join } from 'path';
import ora from 'ora';
import * as tui from './tui.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'vendor']);
const ENTITY_FILTER = new Set(['index', 'main', 'app', 'utils', 'helpers', 'types', 'config', 'constants', 'test', 'spec']);
const ENTITY_SOURCE_DIRS = ['src', 'models', 'entities', 'domain', 'lib'];

const LAYER_KEYWORD_MAP: Record<string, string> = {
  controllers: 'API',
  controller: 'API',
  routes: 'API',
  route: 'API',
  api: 'API',
  services: 'SERVICE',
  service: 'SERVICE',
  models: 'STORAGE',
  model: 'STORAGE',
  repositories: 'STORAGE',
  repository: 'STORAGE',
  db: 'STORAGE',
  database: 'STORAGE',
  utils: 'UTIL',
  util: 'UTIL',
  lib: 'UTIL',
  helpers: 'UTIL',
  helper: 'UTIL',
};

const SKIP_LAYER_DIRS = new Set([
  'node_modules', 'dist', 'build', 'test', '__tests__',
  '.git', '.next', 'vendor', '__pycache__',
]);

interface ScanResult {
  entities: string[];
  layers: Map<string, string[]>; // layerName -> owned entities
  language: string;
  stack: string[];
  dirName: string;
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function collectFiles(dir: string, depth = 0): string[] {
  const results: string[] = [];
  if (depth > 10) return results;
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, depth + 1));
    } else {
      results.push(full);
    }
  }
  return results;
}

function extractEntities(targetDir: string): { entities: string[]; entitiesByTopDir: Map<string, string[]> } {
  const seen = new Set<string>();
  const entitiesByTopDir = new Map<string, string[]>();

  for (const srcDir of ENTITY_SOURCE_DIRS) {
    const dirPath = join(targetDir, srcDir);
    if (!existsSync(dirPath)) continue;
    const files = collectFiles(dirPath);

    for (const f of files) {
      const base = basename(f).replace(/\.[^.]+$/, '');
      const snake = toSnakeCase(base);
      if (!ENTITY_FILTER.has(snake) && snake.length > 2 && /^[a-z]/.test(snake)) {
        if (!seen.has(snake)) {
          seen.add(snake);
          // track top-level subdir relative to the entity source root
          const rel = f.slice(dirPath.length + 1);
          const topSub = rel.includes('/') ? rel.split('/')[0] : srcDir;
          if (!entitiesByTopDir.has(topSub)) entitiesByTopDir.set(topSub, []);
          entitiesByTopDir.get(topSub)!.push(snake);
        }
      }
    }
  }

  return { entities: [...seen], entitiesByTopDir };
}

function detectLayers(targetDir: string, hasSrc: boolean): Map<string, string> {
  // dirName -> canonical layer name
  const result = new Map<string, string>();
  const scanRoot = hasSrc ? join(targetDir, 'src') : targetDir;
  let entries: string[] = [];
  try { entries = readdirSync(scanRoot); } catch { return result; }

  for (const entry of entries) {
    if (SKIP_LAYER_DIRS.has(entry)) continue;
    const full = join(scanRoot, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      const mapped = LAYER_KEYWORD_MAP[entry.toLowerCase()];
      if (mapped) result.set(entry, mapped);
    }
  }
  return result;
}

function detectLanguage(targetDir: string): string {
  if (existsSync(join(targetDir, 'Cargo.toml'))) return 'rust';
  if (existsSync(join(targetDir, 'go.mod'))) return 'go';
  if (existsSync(join(targetDir, 'pom.xml')) || existsSync(join(targetDir, 'build.gradle'))) return 'java';
  if (existsSync(join(targetDir, 'requirements.txt')) || existsSync(join(targetDir, 'pyproject.toml'))) return 'python';
  if (existsSync(join(targetDir, 'package.json'))) {
    return existsSync(join(targetDir, 'tsconfig.json')) ? 'typescript' : 'javascript';
  }
  return 'unknown';
}

function detectStack(targetDir: string): string[] {
  const pkgPath = join(targetDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { dependencies?: Record<string, string> };
      return Object.keys(pkg.dependencies ?? {}).slice(0, 5);
    } catch { /* fall through */ }
  }

  const reqPath = join(targetDir, 'requirements.txt');
  if (existsSync(reqPath)) {
    try {
      return readFileSync(reqPath, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .map(l => l.split(/[>=<!]/)[0].trim())
        .filter(l => l.length > 0)
        .slice(0, 5);
    } catch { /* fall through */ }
  }

  return [];
}

function scan(targetDir: string): ScanResult {
  const abs = resolve(targetDir);
  const dirName = basename(abs);
  const hasSrc = existsSync(join(abs, 'src'));

  const language = detectLanguage(abs);
  const stack = detectStack(abs);
  const { entities, entitiesByTopDir } = extractEntities(abs);
  const layerDirMap = detectLayers(abs, hasSrc);

  // Map layer names -> entities they own (based on subdir co-location)
  const layerEntities = new Map<string, string[]>();
  for (const [dir, layer] of layerDirMap) {
    const ents = entitiesByTopDir.get(dir) ?? [];
    if (!layerEntities.has(layer)) layerEntities.set(layer, []);
    layerEntities.get(layer)!.push(...ents);
  }

  return { entities, layers: layerEntities, language, stack, dirName };
}

function generateEnth(result: ScanResult): string {
  const { entities, layers, language, stack, dirName } = result;

  let out = 'VERSION 0.1.0\n\n';
  out += '# Generated by enthropic init — review and adjust before using\n';
  out += '# Confidence: MEDIUM — verify entities and layers\n\n';

  out += `PROJECT "${dirName}"\n`;
  out += `  LANG   ${language}\n`;
  if (stack.length > 0) out += `  STACK  ${stack.join(', ')}\n`;
  out += '  ARCH   layered\n\n';

  out += 'CONTEXT\n';
  out += '  ENTITY\n';
  if (entities.length > 0) {
    for (const e of entities) out += `    ${e}\n`;
  } else {
    out += '    # add your domain entities here\n';
  }
  out += '\n';

  out += '  LAYERS\n';
  if (layers.size > 0) {
    for (const [layer, ents] of layers) {
      out += `    ${layer}\n`;
      if (ents.length > 0) out += `      OWNS  ${ents.join(', ')}\n`;
    }
  } else {
    out += '    # add your architectural layers here\n';
    out += '    # e.g.: API, SERVICE, STORAGE\n';
  }
  out += '\n';

  out += 'CONTRACTS\n';
  out += '  # Add your architectural constraints here\n';
  out += '  # Examples:\n';
  out += '  # user.password NEVER plaintext\n';
  out += '  # admin.* REQUIRES verified-auth\n';

  return out;
}

export async function run(dir: string): Promise<void> {

  const targetDir = resolve(dir);

  if (!existsSync(targetDir)) {
    tui.printError(`Directory not found: ${targetDir}`);
    process.exit(1);
  }

  const spinner = ora({ text: `Scanning ${targetDir}…`, color: 'magenta' }).start();

  let result: ScanResult;
  try {
    result = scan(targetDir);
    spinner.stop();
  } catch (e) {
    spinner.stop();
    tui.printError(`Scan failed: ${String(e)}`);
    process.exit(1);
  }

  const { entities, layers, language, stack, dirName } = result;

  console.log();
  tui.printSuccess(`Scanned ${dirName}`);
  console.log(`  ${tui.dimmed('Language:')}  ${language}`);
  if (stack.length > 0) console.log(`  ${tui.dimmed('Stack:')}     ${stack.join(', ')}`);
  console.log(`  ${tui.dimmed('Entities:')} ${entities.length > 0 ? entities.join(', ') : '(none found)'}`);
  console.log(`  ${tui.dimmed('Layers:')}   ${layers.size > 0 ? [...layers.keys()].join(', ') : '(none detected)'}`);
  console.log();

  const outPath = resolve(targetDir, 'enthropic.enth');

  if (existsSync(outPath)) {
    const overwrite = await tui.confirm(`enthropic.enth already exists in ${dirName}. Overwrite?`);
    console.log();
    if (!overwrite) {
      tui.printDim('  Aborted — existing file unchanged.');
      return;
    }
  }

  const content = generateEnth(result);
  writeFileSync(outPath, content);

  tui.printSuccess(`enthropic.enth created at ${outPath}`);
  console.log();
  tui.printDim('  Run `enthropic validate` to check your spec');
}
