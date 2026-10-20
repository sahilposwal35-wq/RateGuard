-- Migration 001: Initial schema from PID section 15

CREATE TABLE IF NOT EXISTS plans (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    quota_limit BIGINT,
    quota_mode TEXT NOT NULL DEFAULT 'exact' CHECK (quota_mode IN ('exact', 'write_behind'))
);

CREATE TABLE IF NOT EXISTS clients (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    plan_id BIGINT NOT NULL REFERENCES plans(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT NOT NULL REFERENCES clients(id),
    key_hash BYTEA NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policies (
    id BIGSERIAL PRIMARY KEY,
    plan_id BIGINT NOT NULL REFERENCES plans(id),
    route_pattern TEXT NOT NULL,
    algorithm TEXT NOT NULL CHECK (algorithm IN ('fixed_window', 'sliding_window', 'token_bucket')),
    limit_units BIGINT NOT NULL CHECK (limit_units > 0),
    window_seconds INT NOT NULL CHECK (window_seconds > 0),
    burst BIGINT,
    fail_mode TEXT NOT NULL DEFAULT 'open' CHECK (fail_mode IN ('open', 'closed')),
    shadow BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (plan_id, route_pattern)
);

CREATE TABLE IF NOT EXISTS quota_usage (
    client_id BIGINT NOT NULL REFERENCES clients(id),
    period_start DATE NOT NULL,
    used BIGINT NOT NULL DEFAULT 0 CHECK (used >= 0),
    PRIMARY KEY (client_id, period_start)
);

CREATE TABLE IF NOT EXISTS config_version (
    id INT PRIMARY KEY CHECK (id = 1),
    version BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Seed initial config version and bypass setting
INSERT INTO config_version (id, version) VALUES (1, 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('bypass', 'false') ON CONFLICT (key) DO NOTHING;

-- Track applied migrations
CREATE TABLE IF NOT EXISTS migrations (
    id INT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
