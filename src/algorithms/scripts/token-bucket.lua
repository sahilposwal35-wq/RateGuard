-- Token bucket algorithm (PID section 14.3)
-- KEYS[1] = bucket key (e.g. rl:{client_id}:route:token_bucket)
-- ARGV[1] = capacity (burst)
-- ARGV[2] = refill rate per second
-- ARGV[3] = cost
-- ARGV[4] = TTL multiplier (seconds, used for key expiry)
-- Returns: {allowed (0|1), floor(tokens), retry_ms, reset_ms}

local t = redis.call('TIME')
local now_ms = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

local d = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(d[1]) or capacity
local ts = tonumber(d[2]) or now_ms

-- Refill tokens based on elapsed time
local elapsed_ms = math.max(0, now_ms - ts)
tokens = math.min(capacity, tokens + elapsed_ms * refill_rate / 1000)

local allowed = 0
local retry_ms = 0
local reset_ms = 0

if tokens >= cost then
    tokens = tokens - cost
    allowed = 1
    -- Reset time: how long until bucket is full again
    reset_ms = math.ceil((capacity - tokens) / refill_rate * 1000)
else
    -- Not enough tokens: compute retry time
    retry_ms = math.ceil((cost - tokens) / refill_rate * 1000)
    reset_ms = math.ceil(capacity / refill_rate * 1000)
end

redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now_ms))

-- TTL: enough time for bucket to fully refill twice
local ttl_ms = math.ceil(capacity / refill_rate * 2000)
redis.call('PEXPIRE', KEYS[1], ttl_ms)

return {allowed, math.floor(tokens), retry_ms, reset_ms}
