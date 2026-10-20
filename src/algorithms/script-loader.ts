import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ScriptCache {
  sha: string;
  source: string;
}

const scriptCache = new Map<string, ScriptCache>();

function loadScript(name: string): ScriptCache {
  const cached = scriptCache.get(name);
  if (cached) return cached;
  const path = resolve(__dirname, 'scripts', `${name}.lua`);
  const source = readFileSync(path, 'utf-8');
  const sha = createHash('sha1').update(source).digest('hex');
  const entry: ScriptCache = { sha, source };
  scriptCache.set(name, entry);
  return entry;
}

export async function evalScript(
  redis: Redis,
  scriptName: string,
  keys: string[],
  args: (string | number)[]
): Promise<unknown> {
  const script = loadScript(scriptName);
  try {
    // Try EVALSHA first (cached on Redis server)
    return await redis.evalsha(script.sha, keys.length, ...keys, ...args);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('NOSCRIPT')) {
      // Script not cached on server, fall back to EVAL
      return await redis.eval(script.source, keys.length, ...keys, ...args);
    }
    throw err;
  }
}

export function getScriptSha(name: string): string {
  return loadScript(name).sha;
}

export function preloadScript(name: string): void {
  loadScript(name);
}
