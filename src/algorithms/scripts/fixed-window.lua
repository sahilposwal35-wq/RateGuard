-- Fixed window algorithm (PID section 14.1)
-- KEYS[1] = counter key (e.g. rl:{client_id}:route:fixed_window:window_num)
-- ARGV[1] = limit
-- ARGV[2] = window_seconds
-- ARGV[3] = cost
-- Returns: {allowed (0|1), remaining, retry_ms, reset_ms}

local t = redis.call('TIME')
local now_s = tonumber(t[1])
local now_ms = now_s * 1000 + math.floor(tonumber(t[2]) / 1000)

local limit = tonumber(ARGV[1])
local window_s = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

-- Compute window number and key
local window_num = math.floor(now_s / window_s)
local key = KEYS[1] .. ':' .. window_num

local current = tonumber(redis.call('GET', key)) or 0

local allowed = 0
local remaining = 0
local retry_ms = 0

if current + cost <= limit then
    current = tonumber(redis.call('INCRBY', key, cost))
    -- Set expiry on first use (idempotent if already set)
    redis.call('EXPIRE', key, window_s + 1)
    allowed = 1
    remaining = math.max(0, limit - current)
else
    remaining = 0
    -- Retry after: time until next window
    local window_end_ms = (window_num + 1) * window_s * 1000
    retry_ms = math.max(0, window_end_ms - now_ms)
end

-- Reset: time until window ends
local window_end_ms = (window_num + 1) * window_s * 1000
local reset_ms = math.max(0, window_end_ms - now_ms)

return {allowed, remaining, retry_ms, reset_ms}
