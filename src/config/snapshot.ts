import { getPool } from './database.js';

export interface PolicyRecord {
  id: number;
  planId: number;
  routePattern: string;
  algorithm: string;
  limitUnits: number;
  windowSeconds: number;
  burst: number | null;
  failMode: 'open' | 'closed';
  shadow: boolean;
}

export interface PlanRecord {
  id: number;
  name: string;
  quotaLimit: number | null;
  quotaMode: 'exact' | 'write_behind';
}

export interface ConfigSnapshot {
  version: number;
  plans: Map<number, PlanRecord>;
  policies: PolicyRecord[];
  bypass: boolean;
}

let currentSnapshot: ConfigSnapshot | null = null;

export function getSnapshot(): ConfigSnapshot {
  if (!currentSnapshot) {
    throw new Error('Config snapshot not loaded yet');
  }
  return currentSnapshot;
}

export function setSnapshot(snapshot: ConfigSnapshot): void {
  currentSnapshot = snapshot;
}

export async function loadSnapshot(): Promise<ConfigSnapshot> {
  const pool = getPool();

  const [plansResult, policiesResult, versionResult, bypassResult] = await Promise.all([
    pool.query('SELECT * FROM plans ORDER BY id'),
    pool.query('SELECT * FROM policies ORDER BY id'),
    pool.query('SELECT version FROM config_version WHERE id = 1'),
    pool.query("SELECT value FROM settings WHERE key = 'bypass'"),
  ]);

  const plans = new Map<number, PlanRecord>();
  for (const row of plansResult.rows) {
    plans.set(parseInt(row.id, 10), {
      id: parseInt(row.id, 10),
      name: row.name,
      quotaLimit: row.quota_limit ? parseInt(row.quota_limit, 10) : null,
      quotaMode: row.quota_mode as 'exact' | 'write_behind',
    });
  }

  const policies: PolicyRecord[] = policiesResult.rows.map((row: Record<string, unknown>) => ({
    id: parseInt(row.id as string, 10),
    planId: parseInt(row.plan_id as string, 10),
    routePattern: row.route_pattern as string,
    algorithm: row.algorithm as string,
    limitUnits: parseInt(row.limit_units as string, 10),
    windowSeconds: parseInt(row.window_seconds as string, 10),
    burst: row.burst ? parseInt(row.burst as string, 10) : null,
    failMode: row.fail_mode as 'open' | 'closed',
    shadow: row.shadow as boolean,
  }));

  const version = versionResult.rows.length > 0
    ? parseInt(versionResult.rows[0].version, 10)
    : 0;

  const bypass = bypassResult.rows.length > 0
    ? bypassResult.rows[0].value === 'true'
    : false;

  const snapshot: ConfigSnapshot = { version, plans, policies, bypass };

  // Atomic swap
  currentSnapshot = snapshot;

  return snapshot;
}

export function resolvePolicy(planId: number, route: string): PolicyRecord | null {
  const snapshot = getSnapshot();
  const planPolicies = snapshot.policies.filter(p => p.planId === planId);

  if (planPolicies.length === 0) return null;

  // Specificity order per PID section FR-3:
  // 1. Exact route match
  // 2. Longest prefix match (patterns ending with *)
  // 3. Wildcard (*)
  // 4. Plan default (also *)

  // Exact match
  const exact = planPolicies.find(p => p.routePattern === route);
  if (exact) return exact;

  // Longest prefix match
  const prefixPolicies = planPolicies
    .filter(p => p.routePattern.endsWith('*') && p.routePattern !== '*')
    .map(p => ({ policy: p, prefix: p.routePattern.slice(0, -1) }))
    .filter(({ prefix }) => route.startsWith(prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  if (prefixPolicies.length > 0) return prefixPolicies[0].policy;

  // Wildcard / plan default
  const wildcard = planPolicies.find(p => p.routePattern === '*');
  if (wildcard) return wildcard;

  return null;
}

// Config polling
let pollInterval: ReturnType<typeof setInterval> | null = null;

export async function startConfigPoller(intervalMs: number): Promise<void> {
  // Initial load
  await loadSnapshot();

  pollInterval = setInterval(async () => {
    try {
      const pool = getPool();
      const result = await pool.query('SELECT version FROM config_version WHERE id = 1');
      const newVersion = result.rows.length > 0 ? parseInt(result.rows[0].version, 10) : 0;

      if (currentSnapshot && newVersion !== currentSnapshot.version) {
        await loadSnapshot();
      }
    } catch (err) {
      // Keep last good snapshot on error (PID 13.5)
      console.error('Config reload error, keeping last snapshot:', err);
    }
  }, intervalMs);
}

export function stopConfigPoller(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
