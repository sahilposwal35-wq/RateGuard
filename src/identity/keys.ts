import crypto from 'node:crypto';

const KEY_PREFIX = 'rg_live_';
const KEY_LENGTH = 32;

export function generateApiKey(): string {
  const random = crypto.randomBytes(KEY_LENGTH).toString('hex');
  return `${KEY_PREFIX}${random}`;
}

export function hashApiKey(key: string): Buffer {
  return crypto.createHash('sha256').update(key, 'utf-8').digest();
}

export function constantTimeCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
