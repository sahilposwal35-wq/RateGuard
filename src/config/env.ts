import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  DATABASE_URL: z.string().default('postgres://rateguard:rateguard@localhost:5432/rateguard'),
  SERVICE_TOKEN: z.string().min(1),
  ADMIN_TOKEN: z.string().min(1),
  CONFIG_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  FLUSHER_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MAX_COST: z.coerce.number().int().positive().default(100),
  MAX_ROUTE_LENGTH: z.coerce.number().int().positive().default(500),
  REDIS_TIMEOUT_MS: z.coerce.number().int().positive().default(250),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
