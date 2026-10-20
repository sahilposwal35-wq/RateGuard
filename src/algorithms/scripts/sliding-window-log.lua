-- Sliding window log (exact baseline, PID section 14.4)
-- KEYS[1] = sorted set key (e.g. rl:{client_id}:route:sliding_window_log)
-- ARGV[1] = limit
-- ARGV[2] = window_seconds
-- ARGV[3] = cost
-- Returns: {allowed (0|1), remaining, retry_ms, reset_ms}
-- Note: each request adds 'cost' entries (timestamps as scores and members)

local t = redis.call('TIME')
local now_s = tonumber(t[1])
local now_us = tonumber(t[2])
local now_ms = now_s * 1000 + math.floor(now_us / 1000)

local limit = tonumber(ARGV[1])
local window_s = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

local window_start_ms = now_ms - window_s * 1000

-- Remove entries older than the window
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', window_start_ms)

-- Count current entries in window
local current_count = tonumber(redis.call('ZCARD', KEYS[1]))

local allowed = 0
local remaining = 0
local retry_ms = 0

if current_count + cost <= limit then
    -- Add entries for this request (one per cost unit, unique member via timestamp+counter)
    for i = 1, cost do
        local member = now_ms .. ':' .. now_us .. ':' .. i
        redis.call('ZADD', KEYS[1], now_ms, member)
    end
    allowed = 1
    remaining = math.max(0, limit - current_count - cost)
else
    remaining = 0
    -- Retry: when oldest entry falls out of window
    local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    if #oldest >= 2 then
        local oldest_ms = tonumber(oldest[2])
        retry_ms = math.max(0, oldest_ms + window_s * 1000 - now_ms)
    else
        retry_ms = window_s * 1000
    end
end

-- TTL: window duration plus buffer
redis.call('PEXPIRE', KEYS[1], window_s * 1000 + 1000)

-- Reset: window duration
local reset_ms = window_s * 1000

return {allowed, remaining, retry_ms, reset_ms}
