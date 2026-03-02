import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { parse } from './parser.js';
import { validate } from './validator.js';
import { generate as generateContext } from './context.js';
import { getWorkdir } from './global_config.js';

const VERSION = '0.1.0';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface JsonRpcRequest {
  jsonrpc: string;
  id?: JsonValue;
  method: string;
  params?: JsonValue;
}

function toolOk(id: JsonValue, text: string): JsonValue {
  return {
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text }] },
  };
}

function toolError(id: JsonValue, msg: string): JsonValue {
  return {
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text: msg }], isError: true },
  };
}

function errorResponse(id: JsonValue, code: number, msg: string): JsonValue {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message: msg },
  };
}

function handleInitialize(id: JsonValue): JsonValue {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'enthropic', version: VERSION },
    },
  };
}

function handleToolsList(id: JsonValue): JsonValue {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      tools: [
        {
          name: 'read_spec',
          description: 'Read the Enthropic .enth spec file for this project. Always call this before writing any code.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to .enth file. Defaults to enthropic.enth in working directory.' },
            },
          },
        },
        {
          name: 'get_context',
          description: 'Get the full Enthropic context block — spec + state — formatted as AI system prompt. Use this as context before generating code.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to .enth file. Defaults to enthropic.enth in working directory.' },
            },
          },
        },
        {
          name: 'validate_spec',
          description: 'Validate an Enthropic .enth spec file and return any errors or warnings.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to .enth file to validate.' },
            },
          },
        },
        {
          name: 'spec_summary',
          description: 'Get a concise summary of the project: name, language, stack, entities, layers, open contracts.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to .enth file. Defaults to enthropic.enth in working directory.' },
            },
          },
        },
      ],
    },
  };
}

function resolvePath(args: JsonValue): string {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const p = (args as Record<string, JsonValue>)['path'];
    if (typeof p === 'string') return p;
  }
  return 'enthropic.enth';
}

function toolReadSpec(id: JsonValue, args: JsonValue): JsonValue {
  const path = resolvePath(args);
  try {
    return toolOk(id, readFileSync(path, 'utf-8'));
  } catch (e) {
    return toolError(id, `Cannot read ${path}: ${String(e)}`);
  }
}

function toolGetContext(id: JsonValue, args: JsonValue): JsonValue {
  const path = resolvePath(args);
  try {
    const spec = parse(path);
    const nameVal = spec.project.get('NAME');
    const name = nameVal?.kind === 'str'
      ? nameVal.value.replace(/^"|"$/g, '').toLowerCase().replace(/ /g, '_')
      : (path.replace(/\.enth$/, '').split('/').pop() ?? 'project');
    const dir = dirname(resolve(path));
    const candidate = `${dir}/state_${name}.enth`;
    const statePath = existsSync(candidate) ? candidate : undefined;
    const ctx = generateContext(spec, statePath);
    return toolOk(id, ctx);
  } catch (e) {
    return toolError(id, `Context error: ${String(e)}`);
  }
}

function toolValidateSpec(id: JsonValue, args: JsonValue): JsonValue {
  const path = resolvePath(args);
  try {
    const spec = parse(path);
    const errors = validate(spec);
    if (errors.length === 0) return toolOk(id, `✓ ${path} is valid.`);
    const lines = errors.map(e => `[${e.severity}] ${e.rule} — ${e.message}`);
    return toolOk(id, `VALIDATION ERRORS:\n${lines.join('\n')}`);
  } catch (e) {
    return toolOk(id, `PARSE ERROR: ${String(e)}`);
  }
}

function toolSpecSummary(id: JsonValue, args: JsonValue): JsonValue {
  const path = resolvePath(args);
  try {
    const spec = parse(path);
    const nameVal = spec.project.get('NAME');
    const name = nameVal?.kind === 'str' ? nameVal.value.replace(/^"|"$/g, '') : 'unnamed';
    const langVal = spec.project.get('LANG');
    const lang = langVal?.kind === 'str' ? langVal.value : (langVal?.kind === 'list' ? langVal.value.join(', ') : 'unspecified');
    const stackVal = spec.project.get('STACK');
    const stack = stackVal?.kind === 'list' ? stackVal.value.join(', ') : 'unspecified';
    const archVal = spec.project.get('ARCH');
    const arch = archVal?.kind === 'str' ? archVal.value : (archVal?.kind === 'list' ? archVal.value.join(', ') : 'unspecified');

    const summary = [
      `Project: ${name}`,
      `Language: ${lang}`,
      `Stack: ${stack}`,
      `Architecture: ${arch}`,
      `Entities: ${spec.entities.length} (${spec.entities.join(', ')})`,
      `Layers: ${spec.layers.size}`,
      `Flows: ${spec.flows.size}`,
      `Secrets declared: ${spec.secrets.length}`,
    ].join('\n');

    return toolOk(id, summary);
  } catch (e) {
    return toolError(id, `Parse error: ${String(e)}`);
  }
}

function handleToolsCall(id: JsonValue, params: JsonValue): JsonValue {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return errorResponse(id, -32602, 'Invalid params');
  }
  const p = params as Record<string, JsonValue>;
  const name = typeof p['name'] === 'string' ? p['name'] : '';
  const args = p['arguments'] ?? {};

  switch (name) {
    case 'read_spec': return toolReadSpec(id, args);
    case 'get_context': return toolGetContext(id, args);
    case 'validate_spec': return toolValidateSpec(id, args);
    case 'spec_summary': return toolSpecSummary(id, args);
    default: return errorResponse(id, -32602, `Unknown tool: ${name}`);
  }
}

export function serve(): void {
  process.chdir(getWorkdir());
  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line: string) => {
    if (!line.trim()) return;

    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(line) as JsonRpcRequest;
    } catch {
      return;
    }

    // notifications have no id — no response needed
    if (msg.id === undefined || msg.id === null) return;

    const id = msg.id as JsonValue;
    const method = msg.method ?? '';
    const params = (msg.params ?? {}) as JsonValue;

    let response: JsonValue;
    switch (method) {
      case 'initialize': response = handleInitialize(id); break;
      case 'tools/list': response = handleToolsList(id); break;
      case 'tools/call': response = handleToolsCall(id, params); break;
      case 'ping': response = { jsonrpc: '2.0', id, result: {} }; break;
      default: response = errorResponse(id, -32601, 'Method not found');
    }

    process.stdout.write(JSON.stringify(response) + '\n');
  });

  rl.on('close', () => process.exit(0));
}
