-- Refund script (PID section 14.5)
-- Adds units back. Works with all algorithm types.
-- KEYS[1] = key
-- ARGV[1] = algorithm type ('token_bucket', 'fixed_window', 'sliding_window')
-- ARGV[2] = units to refund
-- ARGV[3] = capacity (for token_bucket cap) or limit (for windows)
-- ARGV[4] = window_seconds (for fixed/sliding window key computation)
-- Returns: {refunded_units}

local algo = ARGV[1]
local units = tonumber(ARGV[2])
local cap = tonumber(ARGV[3])

if algo == 'token_bucket' then
    -- Add tokens back, capped at capacity
    local d = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
    local tokens = tonumber(d[1])
    if tokens == nil then
        return {0}
    end
    local new_tokens = math.min(cap, tokens + units)
    local refunded = new_tokens - tokens
    redis.call('HSET', KEYS[1], 'tokens', tostring(new_tokens))
    return {math.floor(refunded)}
elseif algo == 'fixed_window' or algo == 'sliding_window' then
    -- Decrement window counter, not below zero
    local t = redis.call('TIME')
    local now_s = tonumber(t[1])
    local window_s = tonumber(ARGV[4])
    local window_num = math.floor(now_s / window_s)
    local key = KEYS[1] .. ':' .. window_num
    local current = tonumber(redis.call('GET', key)) or 0
    local refund = math.min(units, current)
    if refund > 0 then
        redis.call('DECRBY', key, refund)
    end
    return {refund}
else
    return {0}
end
