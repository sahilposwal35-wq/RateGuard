-- Sliding window counter algorithm (PID section 14.2)
-- KEYS[1] = base key (e.g. rl:{client_id}:route:sliding_window)
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

-- Current and previous window numbers
local current_window = math.floor(now_s / window_s)
local prev_window = current_window - 1

local current_key = KEYS[1] .. ':' .. current_window
local prev_key = KEYS[1] .. ':' .. prev_window

local current_count = tonumber(redis.call('GET', current_key)) or 0
local prev_count = tonumber(redis.call('GET', prev_key)) or 0

-- Fraction of previous window that overlaps with our sliding window
local window_start_s = current_window * window_s
local elapsed_in_window = now_s - window_start_s
local prev_weight = math.max(0, 1 - elapsed_in_window / window_s)

-- Weighted estimate of requests in sliding window
local estimate = prev_count * prev_weight + current_count

local allowed = 0
local remaining = 0
local retry_ms = 0

if estimate + cost <= limit then
    current_count = tonumber(redis.call('INCRBY', current_key, cost))
    redis.call('EXPIRE', current_key, window_s * 2 + 1)
    allowed = 1
    -- Recompute estimate after increment
    local new_estimate = prev_count * prev_weight + current_count
    remaining = math.max(0, math.floor(limit - new_estimate))
else
    remaining = 0
    -- Approximate retry: time until enough previous window weight drops off
    -- Simple heuristic: time until next window
    local window_end_ms = (current_window + 1) * window_s * 1000
    retry_ms = math.max(0, window_end_ms - now_ms)
end

-- Reset: time until current window ends
local window_end_ms = (current_window + 1) * window_s * 1000
local reset_ms = math.max(0, window_end_ms - now_ms)

return {allowed, remaining, retry_ms, reset_ms}
