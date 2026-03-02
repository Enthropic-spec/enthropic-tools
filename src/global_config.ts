import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { encryptData, decryptData } from './crypto.js';

export interface GlobalConfig {
  provider?: string;
  model?: string;
  workdir?: string;
}

function configDir(): string {
  return join(homedir(), '.enthropic');
}

function configPath(): string {
  return join(configDir(), 'config.json');
}

function globalKeyPath(): string {
  return join(configDir(), 'global.key');
}

function globalKeysPath(): string {
  return join(configDir(), 'global.keys');
}

function ensureDir(): void {
  mkdirSync(configDir(), { recursive: true });
}

export function loadConfig(): GlobalConfig {
  const p = configPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as GlobalConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: GlobalConfig): void {
  ensureDir();
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

function getOrCreateGlobalKey(): Uint8Array {
  ensureDir();
  const kp = globalKeyPath();
  if (existsSync(kp)) {
    const bytes = readFileSync(kp);
    if (bytes.length !== 32) throw new Error(`Global key file corrupted: expected 32 bytes, got ${bytes.length}`);
    return new Uint8Array(bytes);
  }
  const key = randomBytes(32);
  writeFileSync(kp, key);
  try { chmodSync(kp, 0o600); } catch { /* non-unix */ }
  return new Uint8Array(key);
}

function loadApiKeys(): Record<string, string> {
  const p = globalKeysPath();
  if (!existsSync(p)) return {};
  const key = getOrCreateGlobalKey();
  const cipherdata = new Uint8Array(readFileSync(p));
  const plaintext = decryptData(key, cipherdata);
  try {
    return JSON.parse(Buffer.from(plaintext).toString('utf-8')) as Record<string, string>;
  } catch (e) {
    throw new Error('Failed to parse API keys: ' + String(e));
  }
}

function saveApiKeys(keys: Record<string, string>): void {
  ensureDir();
  const key = getOrCreateGlobalKey();
  const json = Buffer.from(JSON.stringify(keys), 'utf-8');
  const encrypted = encryptData(key, new Uint8Array(json));
  const p = globalKeysPath();
  writeFileSync(p, encrypted);
  try { chmodSync(p, 0o600); } catch { /* non-unix */ }
}

export function defaultWorkdir(): string {
  return join(configDir(), 'workspace');
}

export function getWorkdir(): string {
  const cfg = loadConfig();
  if (cfg.workdir && existsSync(cfg.workdir)) return cfg.workdir;
  const def = defaultWorkdir();
  mkdirSync(def, { recursive: true });
  return def;
}

export function setWorkdir(dir: string): void {
  const cfg = loadConfig();
  cfg.workdir = dir;
  saveConfig(cfg);
}

export function setApiKey(provider: string, apiKey: string): void {
  const keys = (() => { try { return loadApiKeys(); } catch { return {}; } })();
  keys[provider] = apiKey;
  saveApiKeys(keys);
}

export function getApiKey(provider: string): string | undefined {
  try {
    return loadApiKeys()[provider];
  } catch {
    return undefined;
  }
}

export function hasAnyKey(): boolean {
  try {
    return Object.keys(loadApiKeys()).length > 0;
  } catch {
    return false;
  }
}
