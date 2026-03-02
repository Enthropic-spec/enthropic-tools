import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { encryptData, decryptData } from './crypto.js';

function keyDir(): string {
  return join(homedir(), '.enthropic');
}

function keyPath(project: string): string {
  return join(keyDir(), `${project}.key`);
}

function secretsPath(project: string): string {
  return join(keyDir(), `${project}.secrets`);
}

function getOrCreateKey(project: string): Uint8Array {
  const kp = keyPath(project);
  mkdirSync(keyDir(), { recursive: true });

  if (existsSync(kp)) {
    const bytes = readFileSync(kp);
    if (bytes.length !== 32) throw new Error(`Key file corrupted: expected 32 bytes, got ${bytes.length}`);
    return new Uint8Array(bytes);
  }

  const key = randomBytes(32);
  writeFileSync(kp, key);
  try { chmodSync(kp, 0o600); } catch { /* non-unix */ }
  return new Uint8Array(key);
}

function loadSecrets(project: string): Record<string, string> {
  const sp = secretsPath(project);
  if (!existsSync(sp)) return {};
  const key = getOrCreateKey(project);
  const cipherdata = new Uint8Array(readFileSync(sp));
  const plaintext = decryptData(key, cipherdata);
  try {
    return JSON.parse(Buffer.from(plaintext).toString('utf-8')) as Record<string, string>;
  } catch (e) {
    throw new Error('Failed to parse vault secrets: ' + String(e));
  }
}

function saveSecrets(project: string, secrets: Record<string, string>): void {
  mkdirSync(keyDir(), { recursive: true });
  const key = getOrCreateKey(project);
  const json = Buffer.from(JSON.stringify(secrets), 'utf-8');
  const encrypted = encryptData(key, new Uint8Array(json));
  const sp = secretsPath(project);
  writeFileSync(sp, encrypted);
  try { chmodSync(sp, 0o600); } catch { /* non-unix */ }
}

export function generateVaultFile(project: string, secretNames: string[]): string {
  const existing = (() => { try { return loadSecrets(project); } catch { return {}; } })();
  const lines = [`VAULT ${project}`, ''];

  if (secretNames.length === 0) {
    lines.push('  # no secrets declared in spec');
  } else {
    for (const name of secretNames) {
      const status = name in existing ? 'SET' : 'UNSET';
      lines.push(`  ${name.padEnd(28)} ${status}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function refreshVaultFile(project: string, secretNames: string[], directory: string): void {
  const vaultPath = join(directory, `vault_${project}.enth`);
  const content = generateVaultFile(project, secretNames);
  writeFileSync(vaultPath, content);
}

export function setSecret(project: string, key: string, value: string, directory: string, secretNames: string[]): void {
  const secrets = loadSecrets(project);
  secrets[key] = value;
  saveSecrets(project, secrets);
  refreshVaultFile(project, secretNames, directory);
}

export function deleteSecret(project: string, key: string, directory: string, secretNames: string[]): void {
  const secrets = loadSecrets(project);
  if (!(key in secrets)) throw new Error(`Key '${key}' not found in vault`);
  delete secrets[key];
  saveSecrets(project, secrets);
  refreshVaultFile(project, secretNames, directory);
}

export function listKeys(project: string): string[] {
  return Object.keys(loadSecrets(project));
}

export function exportEnv(project: string): string {
  const secrets = loadSecrets(project);
  return Object.entries(secrets).map(([k, v]) => `${k}="${v}"`).join('\n');
}
