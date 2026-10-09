-- C_NamePlate as pure Lua. The dll publishes data only:
--   AW_NamePlates     : "nameplate7" -> plate frame   (visible plates, keyed by the unit token)
--   AW_NamePlateGuids : "F130…"      -> plate frame   (guid, no 0x prefix)
--   AW_NamePlateTokens: "F130…"      -> "nameplate7"  (обратная связь guid -> токен)
--   AW_NamePlateList  : array of the visible plate frames
--
-- The functions are Lua closures on purpose. A C closure is a pointer into AwesomeWotlkLib.dll, and the
-- client validates function pointers before calling them on some paths: measured 29.09 21:18, that is
-- ERROR #134 "Invalid function pointer: 6FF73640" with "Current Addon function: GetNamePlateForUnit".
-- Upstream answers by widening the range of pointers the client accepts. This pack changes no client code,
-- so it needs neither of that: published data plus Lua closures cover every call site.

if type(C_NamePlate) ~= "table" then C_NamePlate = {} end

local function guidKey(guid)
    if type(guid) ~= "string" then return nil end
    return string.upper((string.gsub(guid, "^0[xX]", "")))
end

function C_NamePlate.GetNamePlateForUnit(unit)
    if type(unit) ~= "string" then return nil end
    local plates = AW_NamePlates
    local plate = plates and plates[unit]
    if plate then return plate end
    -- "target"/"focus" and friends have no token key: resolve them through the guid the client itself
    -- reports for that unit, which is the same link the token path uses.
    local key = guidKey(UnitGUID and UnitGUID(unit))
    local byGuid = AW_NamePlateGuids
    if key and byGuid then return byGuid[key] end
    return nil
end

function C_NamePlate.GetNamePlates()
    local out = {}
    local list = AW_NamePlateList
    if type(list) == "table" then
        for i = 1, #list do out[i] = list[i] end
    end
    return out
end

-- guid -> плейт / guid -> токен. У форка awesome это C-функции (GetNamePlateByGUID,
-- GetNamePlateTokenByGUID); у нас те же две связи лежат в данных dll -- AW_NamePlateGuids и
-- AW_NamePlateTokens, ключ hex без 0x в верхнем регистре, как его печатает UnitGUID().
function C_NamePlate.GetNamePlateByGUID(guid)
    local key = guidKey(guid)
    local byGuid = AW_NamePlateGuids
    if key and byGuid then return byGuid[key] end
    return nil
end

function C_NamePlate.GetNamePlateTokenByGUID(guid)
    local key = guidKey(guid)
    local byToken = AW_NamePlateTokens
    if key and byToken then return byToken[key] end
    return nil
end
