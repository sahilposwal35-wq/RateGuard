-- Atomic write-behind quota check and increment
-- KEYS[1] = quota key (e.g. q:{client_id}:period)
-- ARGV[1] = cost
-- ARGV[2] = quota limit
-- ARGV[3] = initial usage from DB (if key does not exist)
-- ARGV[4] = TTL in seconds
-- Returns: {allowed (0|1), used_total}

local exists = redis.call('EXISTS', KEYS[1])
if exists == 0 then
    local init_val = tonumber(ARGV[3]) or 0
    redis.call('SET', KEYS[1], tostring(init_val), 'EX', tonumber(ARGV[4]))
end

local current = tonumber(redis.call('GET', KEYS[1])) or 0
local cost = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

if current + cost <= limit then
    local new_used = redis.call('INCRBY', KEYS[1], cost)
    return {1, new_used}
else
    return {0, current}
end
