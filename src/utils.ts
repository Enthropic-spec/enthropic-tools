import { existsSync } from 'fs';
import { resolve } from 'path';

export function resolveSpec(file?: string): string {
  if (file && existsSync(file)) return resolve(file);
  const def = 'enthropic.enth';
  if (existsSync(def)) return resolve(def);
  throw new Error('No .enth file specified and enthropic.enth not found in the current directory.');
}

export function tryResolveSpec(file?: string): string | null {
  if (file && existsSync(file)) return resolve(file);
  const def = 'enthropic.enth';
  if (existsSync(def)) return resolve(def);
  return null;
}
