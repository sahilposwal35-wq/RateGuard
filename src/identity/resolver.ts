import { getPool } from '../config/database.js';
import { hashApiKey, constantTimeCompare } from './keys.js';

export interface ResolvedIdentity {
  clientId: number;
  clientName: string;
  planId: number;
  planName: string;
  quotaLimit: number | null;
  quotaMode: string;
  keyId: number;
}

interface CachedIdentity {
  identity: ResolvedIdentity;
  expiresAt: number;
}

const identityCache = new Map<string, CachedIdentity>();
const CACHE_TTL_MS = 10000; // 10 seconds
const MAX_CACHE_SIZE = 10000;

export function clearIdentityCache(): void {
  identityCache.clear();
}

export async function resolveIdentity(apiKey: string): Promise<
  { ok: true; identity: ResolvedIdentity } |
  { ok: false; reason: 'unknown_key' | 'key_revoked' }
> {
  const keyHash = hashApiKey(apiKey);
  const cacheKey = keyHash.toString('hex');

  // Check cache
  const cached = identityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, identity: cached.identity };
  }

  const pool = getPool();

  // Find matching key using constant-time comparison
  // We fetch all active keys and compare - for security with small datasets
  // For larger datasets, we use the hash as a DB lookup (it's unique)
  const keyResult = await pool.query(
    `SELECT ak.id as key_id, ak.client_id, ak.status, ak.key_hash,
            c.name as client_name, c.plan_id,
            p.name as plan_name, p.quota_limit, p.quota_mode
     FROM api_keys ak
     JOIN clients c ON ak.client_id = c.id
     JOIN plans p ON c.plan_id = p.id
     WHERE ak.key_hash = $1`,
    [keyHash]
  );

  if (keyResult.rows.length === 0) {
    return { ok: false, reason: 'unknown_key' };
  }

  const row = keyResult.rows[0];

  // Constant-time comparison of the hash
  const storedHash = row.key_hash as Buffer;
  if (!constantTimeCompare(keyHash, Buffer.from(storedHash))) {
    return { ok: false, reason: 'unknown_key' };
  }

  if (row.status === 'revoked') {
    return { ok: false, reason: 'key_revoked' };
  }

  const identity: ResolvedIdentity = {
    clientId: parseInt(row.client_id, 10),
    clientName: row.client_name,
    planId: parseInt(row.plan_id, 10),
    planName: row.plan_name,
    quotaLimit: row.quota_limit ? parseInt(row.quota_limit, 10) : null,
    quotaMode: row.quota_mode,
    keyId: parseInt(row.key_id, 10),
  };

  // Cache the result (bounded cache)
  if (identityCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entries
    const firstKey = identityCache.keys().next().value;
    if (firstKey) identityCache.delete(firstKey);
  }
  identityCache.set(cacheKey, {
    identity,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return { ok: true, identity };
}
