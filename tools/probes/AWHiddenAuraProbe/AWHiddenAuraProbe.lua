-- Замер, не поставка. Цель одна: ответить, кладёт ли КЛИЕНТ скрытую ауру босса в слоты аур юнита.
-- Если да -- в логе появится строка "AWAURA ... + ..." с непустым caster и, скорее всего, пустым именем:
-- это значит, что "на кого побегут духи" читается с клиента, и дальше решаем, как это показать.
-- Если нет -- за один прогон становится ясно, что на клиенте данных нет ни при каком смещении в dll.
--
-- Почему слотами, а не по id: на 3.3.5a UnitBuff/UnitDebuff по индексу отдают
-- name, rank, icon, count, dispelType, duration, expires, caster, isStealable -- СПELL ID среди них нет
-- (кодекс, патч 3.3.5a), поэтому неизвестное заклинание выглядит как слот без имени, и ловим мы его
-- именно так: по появлению слота и по caster.
--
-- /awa            -- включить/выключить живой лог (по умолчанию включён в бою)
-- /awa now        -- один полный снимок: все слоты без имени у player/target/focus/raid1..40
-- /awa base       -- принять текущее состояние за исходное (после пулла, чтобы не тащить хвост боя)

local MAX_INDEX = 40
local PREFIX = "AWAURA"

local baseline = {}
local live = true
local lastPrint = {}

local function unitTokens()
    local out = { "player", "target", "focus", "targettarget" }
    for i = 1, 40 do
        if UnitExists("raid" .. i) then out[#out + 1] = "raid" .. i end
    end
    return out
end

-- Один слот: {index, filter, name, icon, count, duration, expires, caster}
local function readSlot(unit, i, filter)
    local getter = (filter == "HELPFUL") and UnitBuff or UnitDebuff
    local name, rank, icon, count, dispelType, duration, expires, caster = getter(unit, i, filter)
    if not name and not icon and not expires and not caster then return nil end
    return { i, filter, name, icon, count, duration, expires, caster }
end

local function signature(slot)
    -- имя и таймер-якорь меняются при обновлении, поэтому сравнение по содержательной части
    return table.concat({ slot[2], slot[3] or "", slot[4] or "", slot[5] or "", slot[8] or "" }, "|")
end

local function snapshot(unit)
    local seen, bySig = {}, {}
    for _, filter in ipairs({ "HELPFUL", "HARMFUL" }) do
        local empty = 0
        for i = 1, MAX_INDEX do
            local slot = readSlot(unit, i, filter)
            if slot then
                empty = 0
                seen[#seen + 1] = slot
                bySig[signature(slot)] = slot
            else
                empty = empty + 1
                if empty >= 2 then break end   -- два пустых подряд: дальше слотов нет
            end
        end
    end
    return seen, bySig
end

local function line(text)
    -- анти-спам на юнита: без него UNIT_AURA по всей рейдовой группе печатает пачку за кадр
    local now = GetTime()
    if lastPrint[text] and now - lastPrint[text] < 1 then return end
    lastPrint[text] = now
    print(text)
end

local function describe(slot)
    return ("%s|%s i=%d name=%s icon=%s count=%s dur=%s exp=%s caster=%s"):format(
        PREFIX, slot[2], slot[1],
        (slot[3] ~= nil and slot[3] ~= "") and slot[3] or "НЕТ",
        slot[4] or "НЕТ", tostring(slot[5] or "-"),
        slot[6] and string.format("%.1f", slot[6]) or "-",
        slot[7] and string.format("%.1f", slot[7] - GetTime()) .. "s" or "-",
        slot[8] or "НЕТ")
end

local function diff(unit)
    local _, now = snapshot(unit)
    local was = baseline[unit] or {}
    for sig, slot in pairs(now) do
        if not was[sig] then line(describe(slot) .. "  +на " .. unit) end
    end
    for sig, slot in pairs(was) do
        if not now[sig] then line(describe(slot) .. "  -пропала у " .. unit) end
    end
    baseline[unit] = now
end

local function dumpAll()
    for _, unit in ipairs(unitTokens()) do
        for _, slot in ipairs((snapshot(unit))) do
            if slot[3] == nil or slot[3] == "" then
                line(describe(slot) .. "  (нет имени) @ " .. unit)
            end
        end
    end
end

local function setBaseline()
    baseline = {}
    for _, unit in ipairs(unitTokens()) do
        local _, bySig = snapshot(unit)
        baseline[unit] = bySig
    end
    print(PREFIX .. ": исходное состояние принято (" .. #unitTokens() .. " юнитов)")
end

local f = CreateFrame("Frame")
f:RegisterEvent("UNIT_AURA")
f:RegisterEvent("PLAYER_REGEN_DISABLED")
f:SetScript("OnEvent", function(self, event, arg1)
    if event == "PLAYER_REGEN_DISABLED" then
        setBaseline()
        return
    end
    if not live then return end
    if arg1 and (baseline[arg1] or arg1 == "player" or string.find(arg1, "^raid") or arg1 == "target" or arg1 == "focus") then
        diff(arg1)
    end
end)

SLASH_AWHIDDENAURA1 = "/awa"
SlashCmdList["AWHIDDENAURA"] = function(msg)
    msg = (msg or ""):gsub("%s", ""):lower()
    if msg == "now" then
        dumpAll()
    elseif msg == "base" then
        setBaseline()
    elseif msg == "off" then
        live = false
        print(PREFIX .. ": живой лог выключен")
    elseif msg == "on" then
        live = true
        print(PREFIX .. ": живой лог включён")
    else
        live = not live
        print(PREFIX .. ": живой лог " .. (live and "включён" or "выключен")
            .. " | /awa now -- снимок, /awa base -- принять текущее за исходное")
    end
end

print(PREFIX .. ": проба скрытых аур загружена, /awa показывает строки в бою")
