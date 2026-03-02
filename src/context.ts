import { readFileSync, existsSync } from 'fs';
import type { EnthSpec } from './parser.js';

const PREAMBLE_TEMPLATE = `=== ENTHROPIC CONTEXT __version__ ===

This project uses the Enthropic specification format.
Read the spec below before generating any code.
All architectural decisions declared here are final.

RULES:
  CONTEXT       — closed world. What is not declared does not exist.
                  Do not invent entities, transforms, or relationships.
  CONTRACTS     — invariants. Violations are unacceptable, no exceptions, no workarounds.
  VOCABULARY    — canonical names. Use them exactly in all code, comments, file names,
                  variable names, and identifiers. Never use aliases or alternatives.
  LAYERS        — ownership boundaries. Never implement logic in a layer that does not own it.
                  Never cross CALLS boundaries.
  FLOWS         — ordered sequences. Execute steps in declared order. Never skip or reorder.
                  On failure, execute ROLLBACK in listed order.
  OBSERVABILITY — logging constraints. Fields in must-NOT-log must never appear in logs.
                  Fields in must-log must always be logged at the declared level.
  TESTING       — coverage contracts. required-tests must all be implemented.
                  coverage target must be met before shipping.

=== PROJECT SPEC ===

`;

export function generate(spec: EnthSpec, statePath?: string): string {
  const version = spec.version || '0.1.0';
  const preamble = PREAMBLE_TEMPLATE.replace('__version__', version);
  const specContent = readFileSync(spec.sourceFile, 'utf-8');
  let output = preamble + specContent;

  if (statePath && existsSync(statePath)) {
    const stateContent = readFileSync(statePath, 'utf-8');
    output += '\n\n=== CURRENT BUILD STATE ===\n\n';
    output += stateContent;
    output += '\n\nOnly implement entities, flows, and layers marked PENDING or PARTIAL.';
    output += '\nDo not re-implement anything marked BUILT.';
  }

  if (spec.ownership.length > 0) {
    output += '\n\n=== OWNERSHIP ===\n\n';
    for (const entry of spec.ownership) {
      output += `  ${entry.kind} ${entry.name} -> ${entry.owners.join(', ')}`;
      if (entry.requiredReview.length > 0) {
        output += ' (required-review)';
      }
      output += '\n';
    }
  }

  if (spec.observability.size > 0) {
    output += '\n\n=== OBSERVABILITY ===\n\n';
    for (const entry of spec.observability.values()) {
      output += `flow ${entry.flow}\n`;
      if (entry.level) output += `  level: ${entry.level}\n`;
      if (entry.mustLog.length > 0) output += `  must-log: ${entry.mustLog.join(', ')}\n`;
      if (entry.mustNotLog.length > 0) output += `  must-NOT-log: ${entry.mustNotLog.join(', ')}\n`;
      if (entry.metrics.length > 0) output += `  metrics: ${entry.metrics.join(', ')}\n`;
    }
  }

  if (spec.testing.size > 0) {
    output += '\n\n=== TESTING ===\n\n';
    for (const entry of spec.testing.values()) {
      output += `flow ${entry.flow}\n`;
      if (entry.coverage !== undefined) output += `  coverage: ${entry.coverage}%\n`;
      if (entry.requiredTests.length > 0) output += `  required-tests: ${entry.requiredTests.join(', ')}\n`;
    }
  }

  if (spec.quotas.length > 0) {
    output += '\n\n=== QUOTAS ===\n\n';
    for (const q of spec.quotas) {
      output += `  ${q.resource}: ${q.limit}\n`;
    }
  }

  if (spec.performance.length > 0) {
    output += '\n\n=== PERFORMANCE ===\n\n';
    for (const entry of spec.performance) {
      output += `  entity ${entry.entity}\n`;
      if (entry.cardinality) output += `    cardinality: ${entry.cardinality}\n`;
      if (entry.hotspot) output += `    hotspot: ${entry.hotspot}\n`;
      if (entry.requires.length > 0) output += `    requires: ${entry.requires.join(', ')}\n`;
      if (entry.baseline) {
        output += `    baseline\n`;
        if (entry.baseline.p50) output += `      p50: ${entry.baseline.p50}\n`;
        if (entry.baseline.p99) output += `      p99: ${entry.baseline.p99}\n`;
        if (entry.baseline.maxMemory) output += `      max-memory: ${entry.baseline.maxMemory}\n`;
      }
      if (entry.constraints) {
        output += `    constraints\n`;
        if (entry.constraints.p99) output += `      p99: ${entry.constraints.p99}\n`;
        if (entry.constraints.errorRate) output += `      error-rate: ${entry.constraints.errorRate}\n`;
      }
    }
  }

  if (spec.changelog.length > 0) {
    output += '\n\n=== CHANGELOG ===\n\n';
    for (const ver of spec.changelog) {
      output += `  ${ver.version}\n`;
      for (const entry of ver.entries) {
        const prefix = entry.keyword === 'BREAKING' ? '[BREAKING] ' : '';
        output += `    ${prefix}${entry.keyword}  ${entry.description}\n`;
      }
    }
  }

  return output;
}
