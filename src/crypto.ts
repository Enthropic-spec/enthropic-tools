import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from 'crypto';

export function encryptData(key: Uint8Array, data: Uint8Array): Uint8Array {
  const nonce = new Uint8Array(randomBytes(12));
  const cipher = chacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(data);
  const result = new Uint8Array(12 + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, 12);
  return result;
}

export function decryptData(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 12) throw new Error('Ciphertext too short');
  const nonce = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const cipher = chacha20poly1305(key, nonce);
  return cipher.decrypt(ciphertext);
}
