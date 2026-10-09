-- Yard labels for nameplates, target and focus.
--
-- The dll publishes numbers only (`AW_NamePlateDistances`, `AW_UnitDistances` -- see NamePlates.cpp), the
-- profile lives in `AWDistanceDB` (SavedVariables of this addon), and the window that edits it is the
-- "Distance" tab of AwesomeCVar (addons/AwesomeCVar/DistancePanel.lua). The feature set -- per-kind
-- profiles for players and NPCs, nine anchor sides, plate/name and target-frame/screen anchors, decimal or
-- whole yards, a range limit and "do not duplicate the number on the plate of my own target" -- is the
-- owner's own draft `RangeViewConfig.lua`; where a choice is his rather than ours the file:line is quoted.
-- There is nothing to hook here: in his draft the settings addon replaced the renderer of a third-party
-- dll, here the renderer was always ours, so the model and the controls moved and the hook did not.

local DEFAULTS = {
    -- RangeViewConfig.lua:14-31 without the minimap button (no icon was asked for)
    general = { decimals = true, limitRange = false, maxRange = 40, hideOwnPlate = false },
    players = { show = true, anchor = "plate", side = "LEFT", x = -4, y = 0,
        font = "Friz Quadrata", size = 12, outline = "OUTLINE", r = 1, g = 0.82, b = 0 },
    npcs = { show = true, anchor = "plate", side = "LEFT", x = -4, y = 0,
        font = "Friz Quadrata", size = 12, outline = "OUTLINE", r = 0.8, g = 0.8, b = 0.8 },
    target = { show = true, anchor = "frame", side = "BOTTOM", x = 0, y = -4,
        font = "Friz Quadrata", size = 20, outline = "OUTLINE", r = 1, g = 1, b = 1 },
    focus = { show = true, anchor = "frame", side = "BOTTOM", x = 0, y = -4,
        font = "Friz Quadrata", size = 20, outline = "OUTLINE", r = 1, g = 1, b = 1 },
}

-- The limits the options window must not offer beyond, and that the reader clamps to anyway. The panel
-- builds its sliders from these numbers, and tools/run_addon_behavior.js reads them out of this file --
-- one source of truth, not two lists that can drift apart.
local CLAMPS = {
    size = { 6, 36 },
    x = { -2000, 2000 },
    y = { -2000, 2000 },
    maxRange = { 5, 100 },
}

-- me = the point on the number, it = the point on whatever it hangs off (RangeViewConfig.lua:41-52)
local SIDES = {
    { value = "CENTER",      me = "CENTER",      it = "CENTER" },
    { value = "LEFT",        me = "RIGHT",       it = "LEFT" },
    { value = "RIGHT",       me = "LEFT",        it = "RIGHT" },
    { value = "TOP",         me = "BOTTOM",      it = "TOP" },
    { value = "BOTTOM",      me = "TOP",         it = "BOTTOM" },
    { value = "TOPLEFT",     me = "BOTTOMRIGHT", it = "TOPLEFT" },
    { value = "TOPRIGHT",    me = "BOTTOMLEFT",  it = "TOPRIGHT" },
    { value = "BOTTOMLEFT",  me = "TOPRIGHT",    it = "BOTTOMLEFT" },
    { value = "BOTTOMRIGHT", me = "TOPLEFT",     it = "BOTTOMRIGHT" },
}
local SIDE_BY_VALUE = {}
for _, s in ipairs(SIDES) do SIDE_BY_VALUE[s.value] = s end

local OUTLINES = {
    { value = "NONE",         text = "no outline" },
    { value = "OUTLINE",      text = "thin outline" },
    { value = "THICKOUTLINE", text = "thick outline" },
}

local PLATE_ANCHORS = { { value = "plate", text = "to the plate" }, { value = "name", text = "to the name" } }
local UNIT_ANCHORS = {
    target = { { value = "frame", text = "to the target frame" }, { value = "screen", text = "to the screen centre" } },
    focus  = { { value = "frame", text = "to the focus frame" },  { value = "screen", text = "to the screen centre" } },
}

-- ElvUI's unit frames first: when its module is on, the Blizzard frame is hidden (RangeViewConfig.lua:76-80)
local UNIT_FRAMES = {
    target = { "ElvUF_Target", "TargetFrame" },
    focus  = { "ElvUF_Focus",  "FocusFrame" },
}

local BUILTIN_FONTS = {
    ["Friz Quadrata"] = "Fonts\\FRIZQT__.TTF",
    ["Arial Narrow"]  = "Fonts\\ARIALN.TTF",
    ["Skurri"]        = "Fonts\\SKURRI.TTF",
    ["Morpheus"]      = "Fonts\\MORPHEUS.TTF",
}
-- All four paths were checked to exist in D:\Games\WowAwesome\Fonts (04.10 16:3x), so the list is usable
-- on a client with no media library at all.

local db
local plateFonts = {}     -- plate frame -> FontString
local unitFonts = {}      -- "target" / "focus" -> FontString
local appliedFont = {}    -- profile key -> { requested = path the settings ask for, applied = GetFont() }
local nameCache = {}      -- plate frame -> its name FontString
local guidByToken = {}    -- "nameplate7" -> "F130..." (no 0x, the way the dll strips it)
local styleGen = 1        -- bumps on any edit: only then do fonts get their style re-applied
local failures = 0
local broken = false

-- Не локал, а глобал: вкладку Distance собирает другой аддон (AwesomeCVar), а неймспейсы аддонов
-- в 3.3.5a не изолированы только по имени папки -- локал чанка наружу не виден никогда.
AW_Distance = {}

local function clamp(name, value, fallback)
    local range = CLAMPS[name]
    -- поля без заданной вилки (каналы цвета, строки) проходят как есть: кламп придумывать незачем, а
    -- падать на них -- значит ловить ошибку в коде, который ничего не просил ограничивать
    if not range then return tonumber(value) or fallback end
    local v = tonumber(value)
    if not v then return fallback end
    if v < range[1] then return range[1] end
    if v > range[2] then return range[2] end
    return floor(v + 0.5)
end

local function profileFor(key)
    local profile = db[key]
    profile.size = clamp("size", profile.size, DEFAULTS[key].size)
    profile.x = clamp("x", profile.x, DEFAULTS[key].x)
    profile.y = clamp("y", profile.y, DEFAULTS[key].y)
    return profile
end

local function fontPath(profile)
    local lsm = LibStub and LibStub("LibSharedMedia-3.0", true)
    if lsm then
        local path = lsm:Fetch("font", profile.font, true)
        if path then return path end
    end
    return BUILTIN_FONTS[profile.font] or "Fonts\\FRIZQT__.TTF"
end

local function fontFlags(profile)
    return (profile.outline and profile.outline ~= "NONE") and profile.outline or nil
end

local function applyStyle(fs, key, profile, anchor)
    local path, size, flags = fontPath(profile), profile.size, fontFlags(profile)
    -- 3.3.5a documents SetFont as returning whether the file was accepted; nothing is trusted blindly --
    -- /awdistance prints what GetFont() reports, so a rejected font is visible instead of silent.
    fs:SetFont(path, size, flags)
    -- The answer is remembered PER PROFILE, not per label: a profile whose labels are all off screen
    -- right now still has to be able to say which font it got (owner's screenshot 04.10 20:2x: the status
    -- line read "applied font: nil" twice while seven labels were on screen -- only NPC plates were near,
    -- and the old lookup searched live labels)
    local file = fs.GetFont and fs:GetFont()
    appliedFont[key] = { requested = path, applied = file }
    fs:SetTextColor(profile.r, profile.g, profile.b)
    fs:SetDrawLayer("OVERLAY")
    fs:ClearAllPoints()
    local side = SIDE_BY_VALUE[profile.side] or SIDE_BY_VALUE.CENTER
    fs:SetPoint(side.me, anchor, side.it, profile.x, profile.y)
end

-- His discriminator (RangeViewConfig.lua:141-145): in "0xF130..." the fifth character is the type -- 0
-- player, 3 NPC, 4 pet, 5 vehicle, the same read DBM's IsNonPlayableGUID uses. Our keys carry no "0x"
-- (plateGuidKey in the dll strips it), so the nibble sits at index 3 instead of 5.
local function isPlayerHex(hex)
    if type(hex) ~= "string" or #hex < 3 then return nil end
    return tonumber(hex:sub(3, 3), 16) == 0
end

-- The name of a Blizzard plate is its first FontString region (order Threat, Border, CastBarBorder,
-- CastBarShield, CastBarIcon, Highlight, Name, Level -- as RangeViewConfig.lua:147-164 reads it, and Frame
-- :GetRegions() is documented on this patch). ElvUI hides the native text and draws its own, so its
-- UnitFrame.Name is checked first.
local function nameRegion(plate)
    local uf = plate.UnitFrame
    if uf and uf.Name then return uf.Name end
    local cached = nameCache[plate]
    if cached then return cached end
    if not plate.GetRegions then return nil end
    for _, region in { plate:GetRegions() } do
        if region.GetObjectType and region:GetObjectType() == "FontString" then
            nameCache[plate] = region
            return region
        end
    end
end

-- Только ТОТ фрейм, который сейчас виден. ElvUI заводит `ElvUF_Focus` всегда, а показывает его лишь когда
-- модуль фокуса включён: якорь на скрытый фрейм делает метку невидимой при живых данных (замер владельца
-- 04.10 22:4x: «на фокусе нет цифры никогда»). Ни один не виден -- метка идёт на экран, а не в потёмки.
local function unitAnchor(key, profile)
    if profile.anchor == "screen" then return UIParent end
    for _, name in ipairs(UNIT_FRAMES[key]) do
        local f = _G[name]
        if f and f:IsShown() then return f end
    end
    return UIParent
end

-- «есть ли юнит» решает клиент, и это ЕДИНСТВЕННОЕ место, где рисовалка это спрашивает: число в
-- AW_UnitDistances ничего не доказывает (публичный резолвер на неразрешающийся токен отвечает
-- 0xFFFFFFFFFFFFFFFE -- замер 30.09 00:20:35 -- объект по такому значению находится, и дистанция у него
-- настоящая; баг владельца 04.10 15:5x -- цифра при пустом фокусе). Дублировать проверку в render()
-- незачем: тогда мутация одной копии не была бы видна гейту.
local function unitReal(key)
    return (UnitExists and UnitExists(key)) and true or false
end

local function formatDistance(distance)
    if db.general.decimals then
        return string.format("%.1f", distance)
    end
    return tostring(floor(distance + 0.5))
end

-- Одна и та же величина в двух формах: dll печатает ключи карт верхним регистром без "0x"
-- (`plateGuidKey` в NamePlates.cpp), `UnitGUID()` отвечает тем же значением, но с "0x" и, на других
-- сборках, с дополнением до 16 цифр и в нижнем регистре. Сравнивать строки как есть -- значит молча
-- потерять «не дублировать» (замер владельца 04.10 22:4x: цифра на плейте цели не пропадает).
local function guidKey(value)
    if type(value) ~= "string" then return nil end
    local key = value:gsub("^[0xX]+", ""):gsub("^0+", ""):upper()
    if key == "" then return nil end
    return key
end

local function rebuildGuidMap()
    wipe(guidByToken)
    local byGuid = AW_NamePlateTokens
    if type(byGuid) ~= "table" then return end
    for hex, token in pairs(byGuid) do
        if type(token) == "string" then guidByToken[token] = hex end
    end
end

local function plateLabel(plate, key, profile, distance)
    local fs = plateFonts[plate]
    if not fs then
        -- the template matters: a FontString without a font errors on SetText ("Font not set")
        fs = plate:CreateFontString(nil, "OVERLAY", "GameFontNormal")
        plateFonts[plate] = fs
    end
    local anchor = (profile.anchor == "name" and nameRegion(plate)) or plate
    if fs.awGen ~= styleGen or fs.awAnchor ~= anchor or fs.awProfile ~= profile then
        applyStyle(fs, key, profile, anchor)
        fs.awGen, fs.awAnchor, fs.awProfile = styleGen, anchor, profile
    end
    fs:SetText(formatDistance(distance))
    fs:Show()
    return fs
end

-- `dup` -- число этого юнита уже напечатано на его же плейте в этом кадре. С включённым «не дублировать»
-- метка у фрейма цели/фокуса тогда не нужна: дубль -- это ОНА, а не цифра на плейте (ожидание владельца,
-- замер 05.10 00:52: «галочка до сих пор не прячет ни фокус ни таргетъ». Прежняя ветка прятала цифру
-- с плейта -- ровно наоборот, и в дампе это выглядело как «не работает»).
local function unitLabel(key, distance, dup)
    local profile = profileFor(key)
    local fs = unitFonts[key]
    if not distance or not profile.show or not unitReal(key) or dup then
        if fs then fs:Hide() end
        return
    end
    if not fs then
        fs = UIParent:CreateFontString(nil, "OVERLAY", "GameFontNormal")
        fs.awUnit = key
        unitFonts[key] = fs
    end
    local anchor = unitAnchor(key, profile)
    if fs.awGen ~= styleGen or fs.awAnchor ~= anchor or fs.awProfile ~= profile then
        applyStyle(fs, key, profile, anchor)
        fs.awGen, fs.awAnchor, fs.awProfile = styleGen, anchor, profile
    end
    fs:SetText(formatDistance(distance))
    fs:Show()
end

local function hideAll()
    for _, fs in pairs(plateFonts) do fs:Hide() end
    for _, fs in pairs(unitFonts) do fs:Hide() end
end

-- Снятый тумблер. dll перестаёт писать числа, но то, что уже написано в её таблицах, остаётся -- и
-- рисовалка показывает последние цифры мёртвыми (замер владельца 04.10 21:1x: снял «Считать и показывать
-- дистанцию», числа на плейте зависли). Следующий образ dll чистит таблицы на этом же переходе, но и здесь
-- прятать обязаны мы: показывать то, что источник перестал обновлять, рисовалка не имеет права.
-- Переменной нет (клиент без этого профиля сборки) -- не гасим ничего, данными тогда нечего и рисовать.
local function switchOff()
    if not GetCVar then return false end
    local value = tonumber(GetCVar("distanceDisplay"))
    if not value then return false end
    return value < 0.5
end

-- dll не дала юниту число, но сам юнит стоит под плейтом: его ярд уже есть в таблице плейтов под этим
-- токеном. Замер владельца 04.10 23:53: `unit focus: exists=1 number=nil`, при этом `UnitGUID("focus")`
-- равен guid моба, чей плейт в таблице (`nameplate3 ... mine=TARGET`) -- то есть резолвер dll на "focus"
-- отвечает 0, и до пересборки dll это единственный путь дать фокусу цифру. Юнита без плейта это не
-- касается: там числа нет ни в одном источнике, и метка честно молчит.
local function plateDistanceOfUnit(key)
    local guid = guidKey(UnitGUID and UnitGUID(key))
    if not guid or not AW_NamePlateTokens then return nil end
    for hex, token in pairs(AW_NamePlateTokens) do
        if guidKey(hex) == guid then
            local d = AW_NamePlateDistances and AW_NamePlateDistances[token]
            if d then return d end
        end
    end
end

local function render()
    local distances, plates = AW_NamePlateDistances, AW_NamePlates
    if not distances or not plates then return end
    if switchOff() then
        hideAll()
        return
    end

    local g = db.general
    local targetDist, focusDist
    local units = AW_UnitDistances
    if units then targetDist, focusDist = units.target, units.focus end
    if not targetDist then targetDist = plateDistanceOfUnit("target") end
    if not focusDist then focusDist = plateDistanceOfUnit("focus") end

    -- A number standing in the table is not proof the unit is there: the client's token wrapper answers an
    -- unresolvable token with 0xFFFFFFFFFFFFFFFE (measured 30.09 00:20:35), the object lookup on that value
    -- succeeds and its distance is a real number. UnitExists is the authority (owner's bug, 04.10 15:5x).
    rebuildGuidMap()
    local seenFonts, liveFrames, drawnGuids = {}, {}, {}
    for token, distance in pairs(distances) do
        local plate = plates[token]
        if plate then liveFrames[plate] = true end
        local hex = guidKey(guidByToken[token])
        local player = isPlayerHex(hex)
        local kind = (player == false) and "npcs" or "players"
        local profile = profileFor(kind)
        local draw = plate and distance and profile.show
        if draw and g.limitRange and distance > g.maxRange then draw = false end
        if draw then
            seenFonts[plateLabel(plate, kind, profile, distance)] = true
            -- «на плейте этого юнита число есть» считается по факту кадра, а не по тому, что токен
            -- где-то в таблице есть: метку плейта мог снять и предел дальности, и show профиля
            if hex then drawnGuids[hex] = true end
        end
    end
    for plate, fs in pairs(plateFonts) do
        if not seenFonts[fs] then fs:Hide() end
        -- The frame is no longer anybody's plate: the client destroyed it, its children went with it, and
        -- the cache has to stop holding a dead object. Nothing is called on such a frame.
        if not liveFrames[plate] then plateFonts[plate] = nil end
    end

    unitLabel("target", targetDist, g.hideOwnPlate and drawnGuids[guidKey(UnitGUID and UnitGUID("target"))] ~= nil)
    unitLabel("focus", focusDist, g.hideOwnPlate and drawnGuids[guidKey(UnitGUID and UnitGUID("focus"))] ~= nil)
end

AW_Distance.render = render

local function touch()
    styleGen = styleGen + 1
    -- правка настроек перезаряжает fuse: игрок, который починил причину (например, поменял шрифт на
    -- существующий), обязан получить цифры обратно без /reload
    broken = false
    failures = 0
end

local function fuse()
    if broken then return end
    local ok, err = pcall(render)
    if ok then
        if failures > 0 then failures = 0 end
        return
    end
    failures = failures + 1
    if failures < 5 then return end
    -- His escape hatch (RangeViewConfig.lua:260-281), applied to our own drawing: a renderer that keeps
    -- failing must stop by itself and say so once, not spam an error every frame.
    broken = true
    hideAll()
    print("|cffff5555AWDistance|r: drawing failed 5 times, labels are off. " .. tostring(err))
end

local function initDB()
    AWDistanceDB = AWDistanceDB or {}
    db = AWDistanceDB
    for key, defaults in pairs(DEFAULTS) do
        db[key] = type(db[key]) == "table" and db[key] or {}
        for field, value in pairs(defaults) do
            if db[key][field] == nil then db[key][field] = value end
        end
    end
    db.general.maxRange = clamp("maxRange", db.general.maxRange, DEFAULTS.general.maxRange)
end

local driver = CreateFrame("Frame")
driver:RegisterEvent("PLAYER_ENTERING_WORLD")
driver:RegisterEvent("NAME_PLATE_UNIT_REMOVED")
driver:SetScript("OnEvent", function(self, event, arg)
    if event == "PLAYER_ENTERING_WORLD" then
        -- plates and their frames die on every zone change, and so do our labels and the caches about them
        wipe(plateFonts)
        wipe(unitFonts)
        wipe(nameCache)
        return
    end
    if arg then
        local plate = AW_NamePlates and AW_NamePlates[arg]
        if plate and plateFonts[plate] then plateFonts[plate]:Hide() end
        nameCache[plate] = nil
    end
end)
driver:SetScript("OnUpdate", function(self, elapsed)
    self.awElapsed = (self.awElapsed or 0) + elapsed
    if self.awElapsed < 0.1 then return end
    self.awElapsed = 0
    if not db then initDB() end
    fuse()
end)

-- ---------------------------------------------------------------- the API the options window uses

AW_Distance.db = function() if not db then initDB() end return db end
AW_Distance.defaults = DEFAULTS
AW_Distance.clamps = CLAMPS
AW_Distance.sides = SIDES
AW_Distance.outlines = OUTLINES
AW_Distance.plateAnchors = PLATE_ANCHORS
AW_Distance.unitAnchors = UNIT_ANCHORS
AW_Distance.fonts = function()
    local list = {}
    local lsm = LibStub and LibStub("LibSharedMedia-3.0", true)
    if lsm then
        for _, name in ipairs(lsm:List("font")) do list[#list + 1] = name end
    end
    if #list == 0 then
        for name in pairs(BUILTIN_FONTS) do list[#list + 1] = name end
        table.sort(list)
    end
    return list
end
AW_Distance.set = function(key, field, value)
    local store = AW_Distance.db()
    if CLAMPS[field] then
        -- clamp сам разберётся с «abc»: числовое поле обязано остаться числом, иначе метка получит
        -- размер "abc" и SetFont на этом клиенте не вернёт ошибку, а просто молча ничего не нарисует
        value = clamp(field, value, DEFAULTS[key][field])
    elseif field == "show" or field == "decimals" or field == "limitRange" or field == "hideOwnPlate" then
        value = value and true or false
    end
    store[key][field] = value
    touch()
end
AW_Distance.touch = touch
AW_Distance.isBroken = function() return broken end
AW_Distance.stats = function()
    local plates, units = 0, 0
    for _ in pairs(plateFonts) do plates = plates + 1 end
    for _ in pairs(unitFonts) do units = units + 1 end
    return { plates = plates, units = units }
end

-- what the client actually accepted: SetFont's return value is not trusted on this patch, so the options
-- window reads the font back and shows it. Answered from the per-profile memory above, NOT from a live
-- label -- a profile whose labels are off screen still has to answer (owner's screenshot 04.10 20:2x).
AW_Distance.appliedFont = function(key)
    local info = appliedFont[key]
    return info and info.applied
end
-- requested = the file the settings ask for (after SharedMedia, if any), applied = what the client kept;
-- nil, nil while this profile has never drawn a label
AW_Distance.fontInfo = function(key)
    local info = appliedFont[key]
    if not info then return nil end
    return info.requested, info.applied
end
AW_Distance.reset = function()
    local store = AW_Distance.db()
    for key, defaults in pairs(DEFAULTS) do
        for field, value in pairs(defaults) do store[key][field] = value end
    end
    touch()
end
AW_Distance.status = function()
    if not AW_NamePlateDistances then return nil, "dll without the distance profile" end
    if broken then return nil, "renderer is off after failures" end
    local shown = 0
    for _, fs in pairs(plateFonts) do if fs:IsShown() then shown = shown + 1 end end
    return shown, nil
end

-- ---------------------------------------------------------------- the dump

SLASH_AWDISTANCE1 = "/awdistance"
-- ASCII on purpose: this client is enUS + cp1251, and a UTF-8 Cyrillic byte reaches the chat window as
-- mojibake (measured 22.09: "ВКЛ" printed as "ÂÊË"). Comments may stay Russian, chat output may not.
SlashCmdList["AWDISTANCE"] = function()
    if not db then initDB() end
    local tokens, shown = 0, 0
    if AW_NamePlateDistances then
        for _ in pairs(AW_NamePlateDistances) do tokens = tokens + 1 end
    end
    for _, fs in pairs(plateFonts) do if fs:IsShown() then shown = shown + 1 end end
    local units = AW_UnitDistances or {}
    print(("AWDistance: dll=%s broken=%s | tokens_with_number=%d labels_shown=%d | target=%s focus=%s")
        :format(AW_NamePlateDistances and "yes" or "NO", tostring(broken), tokens, shown,
            units.target and formatDistance(units.target) or "nil",
            units.focus and formatDistance(units.focus) or "nil"))
    -- «не дублировать» и «меток юнита нет» -- два места, где форма guid и видимый фрейм решают всё, а
    -- глазами в игре не проверяются: печатаем обе стороны сравнения и оба якоря, чтобы один прогон
    -- отвечал на вопрос, а не обсуждение
    local tRaw, fRaw = UnitGUID and UnitGUID("target"), UnitGUID and UnitGUID("focus")
    print(("  hideOwn=%s | UnitGUID target=%s -> %s | focus=%s -> %s")
        :format(tostring(db.general.hideOwnPlate), tostring(tRaw), tostring(guidKey(tRaw)),
            tostring(fRaw), tostring(guidKey(fRaw))))
    for _, key in ipairs({ "target", "focus" }) do
        local frame
        for _, name in ipairs(UNIT_FRAMES[key]) do
            local f = _G[name]
            if f then frame = (f:IsShown() and (name .. " shown") or (name .. " HIDDEN")) break end
        end
        -- два числа рядом: что дала dll и что рисовалка в итоге использует (второе может быть ярдом
        -- плейта) -- иначе следующий прогон не отличит «резолвер молчит» от «метка не видна»
        local fromDll, used = units[key], plateDistanceOfUnit(key)
        print(("  unit %s: exists=%s number=%s plateFallback=%s anchor=%s/%s label=%s")
            :format(key, tostring(UnitExists and UnitExists(key)), tostring(fromDll), tostring(used),
                tostring(db[key].anchor), frame or "no frame -> UIParent",
                tostring(unitFonts[key] and unitFonts[key]:IsShown())))
    end
    rebuildGuidMap()
    for key in pairs(DEFAULTS) do
        if key ~= "general" then
            local profile = profileFor(key)
            local requested, applied = AW_Distance.fontInfo(key)
            -- "never drawn" and "the client took another file" are different facts, and only the second
            -- one is a bug
            local drawn = requested and (applied == requested and "ok" or ("KEPT " .. tostring(applied)))
                or "never drawn"
            print(("  %s: show=%s anchor=%s side=%s x=%s y=%s size=%s font=%s/%s outline=%s color=%.2f/%.2f/%.2f")
                :format(key, tostring(profile.show), tostring(profile.anchor), tostring(profile.side),
                    tostring(profile.x), tostring(profile.y), tostring(profile.size), tostring(profile.font),
                    drawn, tostring(profile.outline), profile.r, profile.g, profile.b))
        end
    end
    local g = db.general
    print(("  general: decimals=%s limitRange=%s maxRange=%s hideOwnPlate=%s")
        :format(tostring(g.decimals), tostring(g.limitRange), tostring(g.maxRange), tostring(g.hideOwnPlate)))
    -- the type split is read from the guid; the client's own answer is printed next to it, so a wrong
    -- nibble in a live session is visible instead of argued about
    for token, distance in pairs(AW_NamePlateDistances or {}) do
        local hex = guidKey(guidByToken[token])
        local exists = UnitExists and UnitExists(token)
        -- isPlayer is only asked when the client itself says the token is there: on an unknown unit the
        -- unit functions do not stay silent, they print "Usage:" (measured 03.10 23:54)
        local clientPlayer = exists and UnitIsPlayer and UnitIsPlayer(token)
        local mine = hex and (hex == guidKey(tRaw) and "TARGET" or (hex == guidKey(fRaw) and "FOCUS" or "-"))
        print(("  %s = %s | hex=%s byGuid=%s exists=%s client isPlayer=%s mine=%s")
            :format(token, formatDistance(distance), tostring(hex), tostring(isPlayerHex(hex)),
                tostring(exists), tostring(clientPlayer), tostring(mine)))
    end
end
