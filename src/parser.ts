import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface Transform {
  source: string;
  target: string;
  actions: string[];
}

export interface Layer {
  name: string;
  owns: string[];
  can: string[];
  cannot: string[];
  calls: string[];
  never: string[];
  latency?: string;
}

export interface Contract {
  subject: string;
  keyword: string;
  qualifier: string;
}

export interface FlowStep {
  number: number;
  subject: string;
  action: string;
}

export interface Flow {
  name: string;
  steps: FlowStep[];
  rollback: string[];
  atomic?: boolean;
  timeout?: string;
  retry?: number;
}

export type ProjectValue =
  | { kind: 'str'; value: string }
  | { kind: 'list'; value: string[] }
  | { kind: 'deps'; value: Record<string, string[]> };

export interface OwnershipEntry {
  kind: 'entity' | 'flow';
  name: string;
  owners: string[];          // e.g. ["alice@company"]
  requiredReview: string[];  // e.g. ["alice", "bob"] if "required-review" present
}

export interface ObservabilityEntry {
  flow: string;
  level?: string;          // critical | warn | info
  mustLog: string[];
  mustNotLog: string[];
  metrics: string[];
}

export interface TestingEntry {
  flow: string;
  coverage?: number;       // percentage
  requiredTests: string[];
}

export interface QuotaEntry {
  resource: string;   // e.g. "stripe.charges"
  limit: string;      // e.g. "1000/day"
}

export interface ChangelogEntry {
  keyword: 'BREAKING' | 'ADDED' | 'DEPRECATED' | 'CHANGED';
  description: string;
}

export interface ChangelogVersion {
  version: string;
  entries: ChangelogEntry[];
}

export interface PerformanceEntry {
  entity: string;
  cardinality?: string;
  hotspot?: string;
  requires: string[];
  baseline?: {
    p50?: string;
    p99?: string;
    maxMemory?: string;
  };
  constraints?: {
    p99?: string;
    errorRate?: string;
  };
}

export interface EnthSpec {
  sourceFile: string;
  version: string;
  project: Map<string, ProjectValue>;
  vocabulary: string[];
  entities: string[];
  transforms: Transform[];
  layers: Map<string, Layer>;
  layersOrder: string[];
  contracts: Contract[];
  flows: Map<string, Flow>;
  flowsOrder: string[];
  secrets: string[];
  ownership: OwnershipEntry[];
  observability: Map<string, ObservabilityEntry>;
  testing: Map<string, TestingEntry>;
  quotas: QuotaEntry[];
  performance: PerformanceEntry[];
  changelog: ChangelogVersion[];
}

function stripComment(line: string): string {
  const idx = line.indexOf('#');
  return idx === -1 ? line : line.slice(0, idx);
}

function indentLen(line: string): number {
  return line.length - line.trimStart().length;
}

export function splitList(s: string): string[] {
  return s.split(',').map(x => x.trim()).filter(x => x.length > 0);
}

const BLOCK_INDENT = 2;

function defaultSpec(sourceFile: string): EnthSpec {
  return {
    sourceFile: resolve(sourceFile),
    version: '',
    project: new Map(),
    vocabulary: [],
    entities: [],
    transforms: [],
    layers: new Map(),
    layersOrder: [],
    contracts: [],
    flows: new Map(),
    flowsOrder: [],
    secrets: [],
    ownership: [],
    observability: new Map(),
    testing: new Map(),
    quotas: [],
    performance: [],
    changelog: [],
  };
}

export function parse(path: string): EnthSpec {
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  const spec = defaultSpec(path);

  let i = 0;
  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    const ind = indentLen(clean);
    if (ind > 0) { i++; continue; }

    if (tok.startsWith('VERSION ')) {
      spec.version = tok.slice('VERSION '.length).trim();
      i++;
    } else if (tok === 'PROJECT' || tok.startsWith('PROJECT ')) {
      if (tok.startsWith('PROJECT ')) {
        const name = tok.slice('PROJECT '.length).trim();
        if (!spec.project.has('NAME')) {
          spec.project.set('NAME', { kind: 'str', value: name });
        }
      }
      i = parseProject(lines, i + 1, spec);
    } else if (tok === 'CONTEXT') {
      i = parseContext(lines, i + 1, spec);
    } else if (tok === 'VOCABULARY') {
      i = parseVocabulary(lines, i + 1, spec);
    } else if (tok.startsWith('ENTITY ')) {      // inline: ENTITY foo, bar, baz
      spec.entities = splitList(tok.slice('ENTITY '.length));
      i++;
    } else if (tok === 'ENTITY') {
      // multiline: indented lines follow
      i = parseEntityMultiline(lines, i + 1, spec);
    } else if (tok === 'TRANSFORM') {
      i = parseTransform(lines, i + 1, spec);
    } else if (tok === 'LAYERS') {
      i = parseLayers(lines, i + 1, spec);
    } else if (tok === 'CONTRACTS') {
      i = parseContracts(lines, i + 1, spec);
    } else if (tok === 'SECRETS') {
      i = parseSecrets(lines, i + 1, spec);
    } else if (tok === 'OWNERSHIP') {
      i = parseOwnership(lines, i + 1, spec);
    } else if (tok === 'OBSERVABILITY') {
      i = parseObservability(lines, i + 1, spec);
    } else if (tok === 'TESTING') {
      i = parseTesting(lines, i + 1, spec);
    } else if (tok === 'QUOTAS') {
      i = parseQuotas(lines, i + 1, spec);
    } else if (tok === 'PERFORMANCE') {
      i = parsePerformance(lines, i + 1, spec);
    } else if (tok === 'CHANGELOG') {
      i = parseChangelog(lines, i + 1, spec);
    } else {
      i++;
    }
  }

  return spec;
}

function parseEntityMultiline(lines: string[], start: number, spec: EnthSpec, stopIndent = 0): number {
  let i = start;
  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    if (indentLen(clean) <= stopIndent) return i;
    // Each indented non-empty non-comment line is one entity name
    const name = tok.split(/\s+/)[0];
    if (name) spec.entities.push(name);
    i++;
  }
  return i;
}

function parseProject(lines: string[], start: number, spec: EnthSpec): number {
  let i = start;
  let inDeps = false;
  const depsMap: Record<string, string[]> = {};

  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    const ind = indentLen(clean);
    if (ind === 0) {
      if (Object.keys(depsMap).length > 0) {
        spec.project.set('DEPS', { kind: 'deps', value: depsMap });
      }
      return i;
    }
    if (ind <= BLOCK_INDENT) {
      inDeps = tok === 'DEPS';
      if (!inDeps) {
        const spaceIdx = tok.search(/\s/);
        if (spaceIdx !== -1) {
          const key = tok.slice(0, spaceIdx).trim();
          const val = tok.slice(spaceIdx + 1).trim().replace(/^"|"$/g, '').trim();
          if (key === 'STACK') {
            spec.project.set(key, { kind: 'list', value: splitList(val) });
          } else {
            spec.project.set(key, { kind: 'str', value: val });
          }
        }
      }
    } else if (inDeps) {
      const spaceIdx = tok.search(/\s/);
      if (spaceIdx !== -1) {
        const depKey = tok.slice(0, spaceIdx).trim();
        const val = tok.slice(spaceIdx + 1).trim();
        if (depKey === 'SYSTEM' || depKey === 'RUNTIME' || depKey === 'DEV') {
          depsMap[depKey] = splitList(val);
        }
      }
    }
    i++;
  }
  if (Object.keys(depsMap).length > 0) {
    spec.project.set('DEPS', { kind: 'deps', value: depsMap });
  }
  return i;
}

function parseVocabulary(lines: string[], start: number, spec: EnthSpec, stopIndent = 0): number {
  let i = start;
  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    if (indentLen(clean) <= stopIndent) return i;
    const first = tok.split(/\s+/)[0];
    if (first) spec.vocabulary.push(first);
    i++;
  }
  return i;
}

function parseTransform(lines: string[], start: number, spec: EnthSpec, stopIndent = 0): number {
  let i = start;
  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    if (indentLen(clean) <= stopIndent) return i;
    if (tok.includes('->') && tok.includes(':')) {
      const colonIdx = tok.indexOf(':');
      const arrow = tok.slice(0, colonIdx);
      const actionsStr = tok.slice(colonIdx + 1);
      const parts = arrow.split('->');
      if (parts.length === 2) {
        spec.transforms.push({
          source: parts[0].trim(),
          target: parts[1].trim(),
          actions: splitList(actionsStr),
        });
      }
    }
    i++;
  }
  return i;
}

function parseLayers(lines: string[], start: number, spec: EnthSpec, stopIndent = 0): number {
  let i = start;
  let current: string | null = null;

  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    const ind = indentLen(clean);
    if (ind <= stopIndent) return i;

    if (ind <= stopIndent + BLOCK_INDENT) {
      const name = tok;
      current = name;
      spec.layersOrder.push(name);
      spec.layers.set(name, { name, owns: [], can: [], cannot: [], calls: [], never: [] });
    } else if (current !== null) {
      const spaceIdx = tok.search(/\s/);
      if (spaceIdx !== -1) {
        const key = tok.slice(0, spaceIdx).trim();
        const val = tok.slice(spaceIdx + 1).trim();
        const layer = spec.layers.get(current)!;
        switch (key) {
          case 'OWNS': layer.owns = splitList(val); break;
          case 'CAN': layer.can = splitList(val); break;
          case 'CANNOT': layer.cannot = splitList(val); break;
          case 'CALLS': layer.calls = splitList(val); break;
          case 'NEVER': layer.never.push(val); break;
          case 'LATENCY': layer.latency = val; break;
        }
      }
    }
    i++;
  }
  return i;
}

function parseContext(lines: string[], start: number, spec: EnthSpec): number {
  let i = start;
  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    const ind = indentLen(clean);
    if (ind === 0) return i;

    if (ind <= BLOCK_INDENT) {
      if (tok === 'VOCABULARY') {
        i = parseVocabulary(lines, i + 1, spec, BLOCK_INDENT);
      } else if (tok.startsWith('ENTITY ')) {
        spec.entities = splitList(tok.slice('ENTITY '.length));
        i++;
      } else if (tok === 'ENTITY') {
        i = parseEntityMultiline(lines, i + 1, spec, BLOCK_INDENT);
      } else if (tok === 'TRANSFORM') {
        i = parseTransform(lines, i + 1, spec, BLOCK_INDENT);
      } else if (tok === 'LAYERS') {
        i = parseLayers(lines, i + 1, spec, BLOCK_INDENT);
      } else if (tok === 'OWNERSHIP') {
        i = parseOwnership(lines, i + 1, spec, BLOCK_INDENT);
      } else if (tok === 'PERFORMANCE') {
        i = parsePerformance(lines, i + 1, spec, BLOCK_INDENT);
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return i;
}

function parseContracts(lines: string[], start: number, spec: EnthSpec): number {
  let i = start;
  let currentFlow: string | null = null;

  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    const ind = indentLen(clean);
    if (ind === 0) return i;

    if (ind <= BLOCK_INDENT) {
      if (tok === 'QUOTAS') {
        currentFlow = null;
        i = parseQuotas(lines, i + 1, spec, BLOCK_INDENT);
        continue;
      } else if (tok === 'OBSERVABILITY') {
        currentFlow = null;
        i = parseObservability(lines, i + 1, spec, BLOCK_INDENT);
        continue;
      } else if (tok === 'TESTING') {
        currentFlow = null;
        i = parseTesting(lines, i + 1, spec, BLOCK_INDENT);
        continue;
      } else if (tok === 'CHANGELOG') {
        currentFlow = null;
        i = parseChangelog(lines, i + 1, spec, BLOCK_INDENT);
        continue;
      } else if (tok.startsWith('FLOW ')) {
        const name = tok.slice('FLOW '.length).trim();
        currentFlow = name;
        spec.flowsOrder.push(name);
        spec.flows.set(name, { name, steps: [], rollback: [] });
      } else {
        currentFlow = null;
        const parts = tok.split(/\s+/);
        if (parts.length >= 3) {
          const [subj, kw, ...rest] = parts;
          if (kw === 'ALWAYS' || kw === 'NEVER' || kw === 'REQUIRES') {
            spec.contracts.push({ subject: subj, keyword: kw, qualifier: rest.join(' ') });
          }
        }
      }
    } else if (currentFlow !== null) {
      const spaceIdx = tok.search(/\s/);
      const first = spaceIdx === -1 ? tok : tok.slice(0, spaceIdx);
      const rest = spaceIdx === -1 ? '' : tok.slice(spaceIdx + 1).trim();

      if (first.endsWith('.') && /^\d+$/.test(first.slice(0, -1))) {
        const num = parseInt(first.slice(0, -1), 10);
        const flow = spec.flows.get(currentFlow)!;
        const dotIdx = rest.indexOf('.');
        if (dotIdx !== -1) {
          flow.steps.push({ number: num, subject: rest.slice(0, dotIdx).trim(), action: rest.slice(dotIdx + 1).trim() });
        } else {
          flow.steps.push({ number: num, subject: '', action: rest });
        }
      } else {
        const flow = spec.flows.get(currentFlow);
        if (flow) {
          switch (first) {
            case 'ROLLBACK': flow.rollback = splitList(rest); break;
            case 'ATOMIC': flow.atomic = rest.toLowerCase() === 'true'; break;
            case 'TIMEOUT': flow.timeout = rest; break;
            case 'RETRY': {
              const n = parseInt(rest, 10);
              if (!isNaN(n)) flow.retry = n;
              break;
            }
          }
        }
      }
    }
    i++;
  }
  return i;
}

function parseSecrets(lines: string[], start: number, spec: EnthSpec): number {
  let i = start;
  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    if (indentLen(clean) === 0) return i;
    const first = tok.split(/\s+/)[0];
    if (first) spec.secrets.push(first);
    i++;
  }
  return i;
}

function parseOwnership(lines: string[], start: number, spec: EnthSpec, stopIndent = 0): number {
  let i = start;
  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    if (indentLen(clean) <= stopIndent) return i;
    // format: (entity|flow) <name> -> <owners> [(required-review)]
    const m = tok.match(/^(entity|flow)\s+(\S+)\s+->\s+(.+)$/);
    if (m) {
      const kind = m[1] as 'entity' | 'flow';
      const name = m[2];
      const rest = m[3].trim();
      const hasRequired = rest.includes('(required-review)');
      const ownersStr = rest.replace(/\(required-review\)/, '').trim().replace(/,\s*$/, '');
      const owners = splitList(ownersStr);
      spec.ownership.push({
        kind,
        name,
        owners,
        requiredReview: hasRequired ? owners.slice() : [],
      });
    }
    i++;
  }
  return i;
}

function parseObservability(lines: string[], start: number, spec: EnthSpec, stopIndent = 0): number {
  let i = start;
  let current: string | null = null;

  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    const ind = indentLen(clean);
    if (ind <= stopIndent) return i;

    if (ind <= stopIndent + BLOCK_INDENT) {
      if (tok.startsWith('flow ')) {
        const name = tok.slice('flow '.length).trim();
        current = name;
        spec.observability.set(name, { flow: name, mustLog: [], mustNotLog: [], metrics: [] });
      }
    } else if (current !== null) {
      const colonIdx = tok.indexOf(':');
      if (colonIdx !== -1) {
        const key = tok.slice(0, colonIdx).trim().toLowerCase();
        const val = tok.slice(colonIdx + 1).trim();
        const entry = spec.observability.get(current)!;
        switch (key) {
          case 'level': entry.level = val; break;
          case 'must-log': entry.mustLog = splitList(val); break;
          case 'must-not-log': entry.mustNotLog = splitList(val); break;
          case 'metrics': entry.metrics = splitList(val); break;
        }
      }
    }
    i++;
  }
  return i;
}

function parseTesting(lines: string[], start: number, spec: EnthSpec, stopIndent = 0): number {
  let i = start;
  let current: string | null = null;

  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    const ind = indentLen(clean);
    if (ind <= stopIndent) return i;

    if (ind <= stopIndent + BLOCK_INDENT) {
      if (tok.startsWith('flow ')) {
        const name = tok.slice('flow '.length).trim();
        current = name;
        spec.testing.set(name, { flow: name, requiredTests: [] });
      }
    } else if (current !== null) {
      const colonIdx = tok.indexOf(':');
      if (colonIdx !== -1) {
        const key = tok.slice(0, colonIdx).trim().toLowerCase();
        const val = tok.slice(colonIdx + 1).trim();
        const entry = spec.testing.get(current)!;
        switch (key) {
          case 'coverage': {
            const n = parseInt(val, 10);
            if (!isNaN(n)) entry.coverage = n;
            break;
          }
          case 'required-tests': entry.requiredTests = splitList(val); break;
        }
      }
    }
    i++;
  }
  return i;
}

function parseQuotas(lines: string[], start: number, spec: EnthSpec, stopIndent = 0): number {
  let i = start;
  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    if (indentLen(clean) <= stopIndent) return i;
    const colonIdx = tok.indexOf(':');
    if (colonIdx !== -1) {
      const resource = tok.slice(0, colonIdx).trim();
      const limit = tok.slice(colonIdx + 1).trim();
      if (resource) spec.quotas.push({ resource, limit });
    }
    i++;
  }
  return i;
}

function parsePerformance(lines: string[], start: number, spec: EnthSpec, stopIndent = 0): number {
  let i = start;
  let current: PerformanceEntry | null = null;
  let subBlock: 'baseline' | 'constraints' | null = null;

  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    const ind = indentLen(clean);
    if (ind <= stopIndent) return i;

    if (ind <= stopIndent + BLOCK_INDENT) {
      // "entity <name>"
      if (tok.startsWith('entity ')) {
        const name = tok.slice('entity '.length).trim();
        current = { entity: name, requires: [] };
        spec.performance.push(current);
        subBlock = null;
      }
    } else if (ind <= stopIndent + BLOCK_INDENT * 2 && current !== null) {
      // flat key-value OR sub-block keyword
      const colonIdx = tok.indexOf(':');
      if (colonIdx !== -1) {
        const key = tok.slice(0, colonIdx).trim().toLowerCase();
        const val = tok.slice(colonIdx + 1).trim();
        subBlock = null;
        switch (key) {
          case 'cardinality': current.cardinality = val; break;
          case 'hotspot': current.hotspot = val; break;
          case 'requires': current.requires = splitList(val); break;
        }
      } else {
        // sub-block keyword (baseline / constraints)
        const kw = tok.toLowerCase();
        if (kw === 'baseline' || kw === 'constraints') {
          subBlock = kw as 'baseline' | 'constraints';
          if (subBlock === 'baseline' && !current.baseline) current.baseline = {};
          if (subBlock === 'constraints' && !current.constraints) current.constraints = {};
        }
      }
    } else if (ind <= stopIndent + BLOCK_INDENT * 3 && current !== null && subBlock !== null) {
      // key-value inside sub-block
      const colonIdx = tok.indexOf(':');
      if (colonIdx !== -1) {
        const key = tok.slice(0, colonIdx).trim().toLowerCase();
        const val = tok.slice(colonIdx + 1).trim();
        if (subBlock === 'baseline') {
          if (!current.baseline) current.baseline = {};
          switch (key) {
            case 'p50': current.baseline.p50 = val; break;
            case 'p99': current.baseline.p99 = val; break;
            case 'max-memory': current.baseline.maxMemory = val; break;
          }
        } else if (subBlock === 'constraints') {
          if (!current.constraints) current.constraints = {};
          switch (key) {
            case 'p99': current.constraints.p99 = val; break;
            case 'error-rate': current.constraints.errorRate = val; break;
          }
        }
      }
    }
    i++;
  }
  return i;
}

const VALID_CHANGELOG_KEYWORDS = new Set(['BREAKING', 'ADDED', 'DEPRECATED', 'CHANGED']);

function parseChangelog(lines: string[], start: number, spec: EnthSpec, stopIndent = 0): number {
  let i = start;
  let currentVersion: ChangelogVersion | null = null;

  while (i < lines.length) {
    const clean = stripComment(lines[i]);
    const tok = clean.trim();
    if (!tok) { i++; continue; }
    const ind = indentLen(clean);
    if (ind <= stopIndent) return i;

    if (ind <= stopIndent + BLOCK_INDENT) {
      // version string e.g. "v0.2.0"
      currentVersion = { version: tok, entries: [] };
      spec.changelog.push(currentVersion);
    } else if (currentVersion !== null) {
      // "KEYWORD description"
      const spaceIdx = tok.search(/\s/);
      if (spaceIdx !== -1) {
        const kw = tok.slice(0, spaceIdx).trim();
        const desc = tok.slice(spaceIdx + 1).trim();
        if (VALID_CHANGELOG_KEYWORDS.has(kw)) {
          currentVersion.entries.push({
            keyword: kw as ChangelogEntry['keyword'],
            description: desc,
          });
        }
      }
    }
    i++;
  }
  return i;
}
