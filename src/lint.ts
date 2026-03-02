import type { EnthSpec } from './parser.js';

export interface LintResult {
  rule: number;
  severity: 'WARN';
  message: string;
}

export function lint(spec: EnthSpec): LintResult[] {
  const results: LintResult[] = [];

  // Collect all entities owned by any layer
  const ownedEntities = new Set<string>();
  for (const layer of spec.layers.values()) {
    for (const e of layer.owns) ownedEntities.add(e);
  }

  // Collect all entities referenced anywhere (transforms, flows, contracts, layer owns)
  const referenced = new Set<string>();
  for (const t of spec.transforms) {
    referenced.add(t.source);
    referenced.add(t.target);
  }
  for (const flow of spec.flows.values()) {
    for (const step of flow.steps) {
      if (step.subject) referenced.add(step.subject);
    }
  }
  for (const c of spec.contracts) {
    const base = c.subject.split('.')[0];
    if (base !== '*') referenced.add(base);
  }
  for (const e of ownedEntities) referenced.add(e);

  // L1 — Unused entity
  for (const entity of spec.entities) {
    if (!referenced.has(entity)) {
      results.push({
        rule: 1,
        severity: 'WARN',
        message: `Unused entity '${entity}' — declared but never referenced in TRANSFORM, FLOW, CONTRACT, or LAYER OWNS`,
      });
    }
  }

  // L2 — Circular LAYERS dependency (cycle detection in CALLS graph)
  const declaredLayers = new Set(spec.layers.keys());
  function hasCycle(start: string, visited: Set<string>, stack: Set<string>): string[] | null {
    visited.add(start);
    stack.add(start);
    const layer = spec.layers.get(start);
    if (layer) {
      for (const callee of layer.calls) {
        if (!declaredLayers.has(callee)) continue;
        if (!visited.has(callee)) {
          const cycle = hasCycle(callee, visited, stack);
          if (cycle) return cycle;
        } else if (stack.has(callee)) {
          return [...stack, callee];
        }
      }
    }
    stack.delete(start);
    return null;
  }

  const visitedAll = new Set<string>();
  for (const name of spec.layers.keys()) {
    if (!visitedAll.has(name)) {
      const cycle = hasCycle(name, visitedAll, new Set());
      if (cycle) {
        const cycleStr = cycle.join(' → ');
        results.push({
          rule: 2,
          severity: 'WARN',
          message: `Circular LAYERS dependency detected: ${cycleStr}`,
        });
      }
    }
  }

  // L3 — Contradictory contracts: same subject with both ALWAYS and NEVER
  const alwaysSubjects = new Set<string>();
  const neverSubjects = new Set<string>();
  for (const c of spec.contracts) {
    if (c.keyword === 'ALWAYS') alwaysSubjects.add(c.subject);
    if (c.keyword === 'NEVER') neverSubjects.add(c.subject);
  }
  for (const subj of alwaysSubjects) {
    if (neverSubjects.has(subj)) {
      results.push({
        rule: 3,
        severity: 'WARN',
        message: `Contradictory contracts for '${subj}' — appears with both ALWAYS and NEVER`,
      });
    }
  }

  // L4 — FLOW steps reference unknown subjects (not an entity, not a layer)
  // NOTE: hard errors for undeclared entities/layers are in validator Rules 4 & 5.
  // This lint rule only catches references that are syntactically valid but semantically
  // suspicious (e.g., layer name used without OWNS — handled by validator as ERROR).
  // Keeping rule number reserved; no WARN duplication needed here.

  // L5 — reserved (TRANSFORM errors are ERRORs in validator Rule 3)

  // L6 — CONTRACTS qualifier references a quota resource not declared in QUOTAS
  const declaredQuotas = new Set(spec.quotas.map(q => q.resource));
  for (const c of spec.contracts) {
    const words = c.qualifier.match(/\b[a-z][a-z0-9]*\.[a-z][a-z0-9.]*\b/g) ?? [];
    for (const word of words) {
      if (!declaredQuotas.has(word)) {
        results.push({
          rule: 6,
          severity: 'WARN',
          message: `CONTRACTS qualifier for '${c.subject}' references '${word}' which is not declared in QUOTAS`,
        });
      }
    }
  }

  return results;
}
