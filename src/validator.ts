import type { EnthSpec } from './parser.js';

export interface ValidationError {
  rule: number;
  message: string;
  severity: string;
}

function isUpperCase(s: string): boolean {
  if (!s || !/^[A-Z]/.test(s)) return false;
  return /^[A-Z][A-Z0-9_]*$/.test(s);
}

function isPascalCase(s: string): boolean {
  if (!s || !/^[A-Z]/.test(s)) return false;
  return /^[A-Za-z0-9]+$/.test(s);
}

function isSnakeCase(s: string): boolean {
  if (!s || !/^[a-z]/.test(s)) return false;
  return /^[a-z][a-z0-9_]*$/.test(s);
}

export function validate(spec: EnthSpec): ValidationError[] {
  const errors: ValidationError[] = [];
  const entities = new Set(spec.entities);

  // 1 — VERSION must be present
  if (!spec.version) {
    errors.push({ rule: 1, message: 'VERSION is missing', severity: 'ERROR' });
  }

  // 2 — ENTITY must declare at least one entity
  if (entities.size === 0) {
    errors.push({ rule: 2, message: 'ENTITY must declare at least one entity', severity: 'ERROR' });
  }

  // 3 — TRANSFORM entities must be declared
  for (const t of spec.transforms) {
    for (const name of [t.source, t.target]) {
      if (!entities.has(name)) {
        errors.push({ rule: 3, message: `TRANSFORM references undeclared entity '${name}'`, severity: 'ERROR' });
      }
    }
  }

  // 4 — CONTRACT subjects must reference declared entities or layer names (or wildcard)
  const layerNamesLower = new Set([...spec.layers.keys()].map(k => k.toLowerCase()));
  for (const c of spec.contracts) {
    const base = c.subject.split('.')[0];
    if (base !== '*' && !entities.has(base) && !layerNamesLower.has(base)) {
      errors.push({ rule: 4, message: `CONTRACTS subject '${c.subject}' references undeclared entity or layer '${base}'`, severity: 'ERROR' });
    }
  }

  // 5 — FLOW step subjects must reference declared entities or layer names
  for (const flow of spec.flows.values()) {
    for (const step of flow.steps) {
      if (step.subject && !entities.has(step.subject) && !layerNamesLower.has(step.subject)) {
        errors.push({ rule: 5, message: `FLOW '${flow.name}' step ${step.number} references undeclared entity or layer '${step.subject}'`, severity: 'ERROR' });
      }
    }
  }

  // 6 — FLOW steps must be sequential from 1
  for (const flow of spec.flows.values()) {
    const nums = flow.steps.map(s => s.number);
    const expected = Array.from({ length: nums.length }, (_, k) => k + 1);
    if (JSON.stringify(nums) !== JSON.stringify(expected)) {
      errors.push({ rule: 6, message: `FLOW '${flow.name}' steps are not sequential from 1: ${JSON.stringify(nums)}`, severity: 'ERROR' });
    }
  }

  // 7 — FLOW must have at least 2 steps
  for (const flow of spec.flows.values()) {
    if (flow.steps.length < 2) {
      errors.push({ rule: 7, message: `FLOW '${flow.name}' must have at least 2 steps (has ${flow.steps.length})`, severity: 'ERROR' });
    }
  }

  // 8 — LAYERS names must be UPPER_CASE
  for (const name of spec.layers.keys()) {
    if (!isUpperCase(name)) {
      errors.push({ rule: 8, message: `LAYERS name must be UPPER_CASE: '${name}'`, severity: 'ERROR' });
    }
  }

  // 9 — VOCABULARY entries must be PascalCase
  for (const entry of spec.vocabulary) {
    if (!isPascalCase(entry)) {
      errors.push({ rule: 9, message: `VOCABULARY entry must be PascalCase: '${entry}'`, severity: 'ERROR' });
    }
  }

  // 10 — ENTITY identifiers must be snake_case
  for (const entity of spec.entities) {
    if (!isSnakeCase(entity)) {
      errors.push({ rule: 10, message: `ENTITY identifier must be snake_case: '${entity}'`, severity: 'ERROR' });
    }
  }


  // 12 — LAYERS CALLS may only reference declared layer names ('none' = calls nothing)
  const declaredLayers = new Set(spec.layers.keys());
  for (const layer of spec.layers.values()) {
    for (const ref of layer.calls) {
      if (ref.toLowerCase() === 'none') continue;
      if (!declaredLayers.has(ref)) {
        errors.push({ rule: 12, message: `LAYERS '${layer.name}' CALLS undeclared layer '${ref}'`, severity: 'ERROR' });
      }
    }
  }

  // 13 — SECRETS entries must be UPPER_CASE
  for (const secret of spec.secrets) {
    if (!isUpperCase(secret)) {
      errors.push({ rule: 13, message: `SECRETS entry must be UPPER_CASE: '${secret}'`, severity: 'ERROR' });
    }
  }

  // 14 — OBSERVABILITY flow references undeclared FLOW
  const declaredFlows = new Set(spec.flows.keys());
  for (const entry of spec.observability.values()) {
    if (!declaredFlows.has(entry.flow)) {
      errors.push({ rule: 14, message: `OBSERVABILITY references undeclared FLOW '${entry.flow}'`, severity: 'ERROR' });
    }
  }

  // 15 — TESTING flow references undeclared FLOW
  for (const entry of spec.testing.values()) {
    if (!declaredFlows.has(entry.flow)) {
      errors.push({ rule: 15, message: `TESTING references undeclared FLOW '${entry.flow}'`, severity: 'ERROR' });
    }
  }

  // 16 — TESTING coverage must be 0–100
  for (const entry of spec.testing.values()) {
    if (entry.coverage !== undefined && (entry.coverage < 0 || entry.coverage > 100)) {
      errors.push({ rule: 16, message: `TESTING '${entry.flow}' coverage must be 0–100 (got ${entry.coverage})`, severity: 'ERROR' });
    }
  }

  // 17 — OBSERVABILITY level must be critical, warn, or info
  const validLevels = new Set(['critical', 'warn', 'info']);
  for (const entry of spec.observability.values()) {
    if (entry.level !== undefined && !validLevels.has(entry.level)) {
      errors.push({ rule: 17, message: `OBSERVABILITY '${entry.flow}' level must be 'critical', 'warn', or 'info' (got '${entry.level}')`, severity: 'ERROR' });
    }
  }

  // 18 — OWNERSHIP entity references undeclared entity
  // 19 — OWNERSHIP flow references undeclared flow
  for (const entry of spec.ownership) {
    if (entry.kind === 'entity' && !entities.has(entry.name)) {
      errors.push({ rule: 18, message: `OWNERSHIP references undeclared entity '${entry.name}'`, severity: 'ERROR' });
    }
    if (entry.kind === 'flow' && !declaredFlows.has(entry.name)) {
      errors.push({ rule: 19, message: `OWNERSHIP references undeclared flow '${entry.name}'`, severity: 'ERROR' });
    }
  }

  // 21 — QUOTAS entry must have a non-empty limit value
  for (const q of spec.quotas) {
    if (!q.limit) {
      errors.push({ rule: 21, message: `QUOTAS entry '${q.resource}' has an empty limit value`, severity: 'ERROR' });
    }
  }

  // 20 — PERFORMANCE entity references undeclared entity
  for (const entry of spec.performance) {
    if (!entities.has(entry.entity)) {
      errors.push({ rule: 20, message: `PERFORMANCE references undeclared entity '${entry.entity}'`, severity: 'ERROR' });
    }
  }

  // 22 — CHANGELOG entry keyword must be BREAKING, ADDED, DEPRECATED, or CHANGED
  const validChangelogKeywords = new Set(['BREAKING', 'ADDED', 'DEPRECATED', 'CHANGED']);
  for (const ver of spec.changelog) {
    for (const entry of ver.entries) {
      if (!validChangelogKeywords.has(entry.keyword)) {
        errors.push({ rule: 22, message: `CHANGELOG '${ver.version}' entry has invalid keyword '${entry.keyword}'`, severity: 'ERROR' });
      }
    }
  }

  // 23 — VERSION must match semver format
  if (spec.version && !/^\d+\.\d+\.\d+/.test(spec.version)) {
    errors.push({ rule: 23, message: `VERSION '${spec.version}' does not match semver format (x.y.z)`, severity: 'ERROR' });
  }

  return errors;
}
