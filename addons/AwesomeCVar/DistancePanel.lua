-- Distance tab of the AwesomeCVar window: the settings UI for the yard labels drawn by
-- addons/AWNamePlateAPI/AWDistance.lua.
--
-- This tab is not a list of CVar rows. Everything except the master switch lives in `AWDistanceDB`
-- (SavedVariables of AWNamePlateAPI): font, outline, colour, anchor, side, offsets, size, decimals, the
-- range limit and "do not duplicate the number on my own target's plate" -- forty-odd values, which a CVar
-- table cannot carry honestly. The one CVar stays a real row so the contract with the dll keeps holding,
-- and the gate reads it from this file: see ACVar.CUSTOM_PANEL_CVAR_ROWS below and tools/run_cvar_contract.js.
--
-- The controls (check / dropdown / slider / edit / colour swatch), the nine anchor sides and the grouping
-- are the owner's own draft `RangeViewConfig.lua:414-551` and `:571-650`, moved into this window instead of
-- a standalone /rvc frame. Three things could not be copied verbatim:
--   * the draft opens the picker through OpenColorPicker{...}, which does not exist on 3.3.5a -- here it is
--     the ColorPickerFrame dance that iTargetingFrames/options.lua:2995-3018 proves works on this client;
--   * the draft trusts the return value of SetFont -- this window reads the applied font back and prints it,
--     so a rejected file is visible instead of silent;
--   * the draft's lists are plain native dropdowns, and with the SharedMedia font list they run off the
--     bottom of the screen -- here the list is WeakAuras' scrollable pullout (see makePullout below).

local _, ACVar = ...
local L = ACVar.L or {}

-- Two languages here, not nine: these captions belong to this tab, and the client in question is enUS.
-- The keys that the rest of the window uses still come from all nine locale files.
local STR = {
    en = {
        off = "This client draws no distance numbers: the build profile has no distance feature, "
            .. "or AWNamePlateAPI is not loaded.",
        on = "Compute and show distance",
        general = "General", players = "Player plates", npcs = "NPC plates",
        target = "Target", focus = "Focus",
        decimals = "Show tenths (12.3, not 12)",
        hideOwn = "Hide the target/focus frame number when its own plate already shows it",
        limit = "Hide plates beyond a range",
        maxRange = "Range, yards",
        show = "Show", anchor = "Anchor", side = "Side", size = "Size", font = "Font",
        outline = "Outline", color = "Color",
        reset = "Reset all distance settings",
        applied = "Font in use",
        appliedShort = "font",
        kept = "client kept",
        noFont = "no label drawn yet",
        broken = "the renderer switched itself off after 5 failures",
        labelsShown = "labels on screen",
        -- подписи пунктов: рисовалка отдаёт их по-английски (она не знает, чьё окно её рисует), а значение
        -- в профиле остаётся англоязычным токеном -- перевод живёт здесь, у окна
        items = {
            side = { CENTER = "in the centre", LEFT = "left", RIGHT = "right", TOP = "above", BOTTOM = "below",
                TOPLEFT = "above left", TOPRIGHT = "above right", BOTTOMLEFT = "below left",
                BOTTOMRIGHT = "below right" },
            outline = { NONE = "no outline", OUTLINE = "thin outline", THICKOUTLINE = "thick outline" },
            anchorPlate = { plate = "to the plate", name = "to the name" },
            anchorTarget = { frame = "to the target frame", screen = "to the screen centre" },
            anchorFocus = { frame = "to the focus frame", screen = "to the screen centre" },
        },
    },
    ru = {
        off = "Этот клиент цифры дистанции не рисует: в профиле сборки нет функции distance, "
            .. "или не загружен AWNamePlateAPI.",
        on = "Считать и показывать дистанцию",
        general = "Общие", players = "Плейты игроков", npcs = "Плейты НПС",
        target = "Цель", focus = "Фокус",
        decimals = "Показывать десятые (12.3, а не 12)",
        hideOwn = "Не показывать цифру у фрейма цели/фокуса, если она уже на её плейте",
        limit = "Прятать плейты дальше предела",
        maxRange = "Предел, ярдов",
        show = "Показывать", anchor = "Привязка", side = "Сторона", size = "Размер", font = "Шрифт",
        outline = "Контур", color = "Цвет",
        reset = "Сбросить все настройки дистанции",
        applied = "Применённый шрифт",
        appliedShort = "шрифт",
        kept = "клиент взял",
        noFont = "меток ещё не было",
        broken = "рисовалка отключилась сама после 5 падений",
        labelsShown = "меток на экране",
        items = {
            side = { CENTER = "в центре", LEFT = "слева", RIGHT = "справа", TOP = "сверху", BOTTOM = "снизу",
                TOPLEFT = "сверху слева", TOPRIGHT = "сверху справа", BOTTOMLEFT = "снизу слева",
                BOTTOMRIGHT = "снизу справа" },
            outline = { NONE = "без контура", OUTLINE = "тонкий контур", THICKOUTLINE = "жирный контур" },
            anchorPlate = { plate = "к плашке", name = "к имени" },
            anchorTarget = { frame = "к фрейму цели", screen = "к центру экрана" },
            anchorFocus = { frame = "к фрейму фокуса", screen = "к центру экрана" },
        },
    },
}

local T = STR[((GetLocale and GetLocale() or "enUS"):sub(1, 2):lower())] or STR.en

-- The one CVar of the feature. Declared here, read by tools/run_cvar_contract.js together with the rows of
-- Constants.lua, so "the dll registers it" and "the window can edit it" still cannot drift apart.
ACVar.CUSTOM_PANEL_CVAR_ROWS = {
    { name = "distanceDisplay", label = T.on, desc = T.on, type = "toggle", min = 0, max = 1, default = 0, awNeeds = "профиль: distance" },
}

local floor, min, max = math.floor, math.min, math.max

local content, notice, statusLine, widgets
local widgetSeq = 0
local function nextName(kind)
    widgetSeq = widgetSeq + 1
    return "AwesomeCVarDistance" .. kind .. widgetSeq
end
local built = false

local function api() return rawget(_G, "AW_Distance") end

-- путь к шрифту в статусной строке длиннее самого сообщения: «Fonts\FRIZQT__.TTF» -> «FRIZQT__»
local function shortFont(path)
    if not path then return "?" end
    return tostring(path):gsub("^[Ff]onts[\\/]", ""):gsub("%.[Tt][Tt][Ff]$", "")
end

local function set(key, field, value)
    local a = api()
    if a then a.set(key, field, value) end
    ACVar:UpdateAllUI()
end

local function db()
    local a = api()
    return a and a.db()
end

local function getCVarFlag(name)
    local value = tonumber(ACVar:GetCVarValue(name))
    return (value or 0) >= 0.5
end

-- ---------------------------------------------------------------- widgets

local function caption(parent, text, x, y)
    local f = parent:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
    f:SetPoint("TOPLEFT", x, y)
    f:SetJustifyH("LEFT")
    f:SetText(text)
    return f
end

local function addRefresh(fn)
    widgets[#widgets + 1] = fn
    return fn
end

local function check(parent, text, x, y, get, setIt)
    local cb = CreateFrame("CheckButton", nextName("Check"), parent, "UICheckButtonTemplate")
    cb:SetSize(24, 24)
    cb:SetPoint("TOPLEFT", x, y)
    local label = _G[cb:GetName() .. "Text"]   -- именованный фрейм: клиент завёл и подпись
    label:SetText(text)
    label:SetJustifyH("LEFT")
    cb:SetScript("OnClick", function(self) setIt(self:GetChecked() and true or false) end)
    return addRefresh(function() cb:SetChecked(get() and true or false) end)
end

-- ---------------------------------------------------------------- прокручиваемый список
--
-- Нативный UIDropDownMenu прокрутку не имеет: в FrameXML/UIDropDownMenu.lua единственная забота о экране --
-- развернуть меню вверх, если оно свисает вниз (строки 757-784), а пунктов на экран становится сколько
-- угодно. У владельца так и было: список шрифтов уходил за край (замер 04.10 19:0x). Поэтому раскрытие
-- собирается механизмом WeakAuras -- Libs/AceGUI-3.0/widgets/AceGUIWidget-DropDown.lua, widgetType
-- "Dropdown-Pullout": ScrollFrame + itemFrame + вертикальный Slider (:294-342), прокрутка
-- SetScroll/MoveScroll/FixScroll (:90-151), потолок по SetMaxHeight (:229-236), раскрытие из виджета
-- Dropdown (:384-387) и оформление пунктов из AceGUIWidget-DropDown-Items.lua (:150-176).
--
-- Три отступления от оригинала, все вынужденные:
--   * вместо AceGUI-пула кнопок -- переиспользование frame.buttons[i] по образцу ElvUI Core/Dropdown.lua:40-75
--     (библиотеки AceGUI в AwesomeCVar нет);
--   * его defaultMaxHeight = 600 (:58) рассчитан на полноэкранное окно WeakAuras, а наше окно стоит по
--     центру экрана, поэтому потолок берётся от свободного места под контролом -- ровно та же проверка
--     экрана, что делает FrameXML (:757);
--   * прокрутка включается только когда контент СТРОГО выше окна: у оригинала на равенстве ветки расходятся
--     (в FixScroll это 0/0 = nan, в MoveScroll -- деление на ноль), а nan в offset уводит список в никуда.
local ROW_H = 16              -- :170 (#items * 16) и :192 ((i - 1) * -16)
local FRAME_PAD = 34          -- :172 (h + 34: 20 на разметку scrollFrame + 14 на пункты)
local SCROLL_W = 12           -- :103/-147: отступ itemFrame под ползунок
local BORDER_W = 6            -- :317-318: scrollFrame отступает по 6 пикселя слева/справа
local LIST_MAX = 600          -- :58 defaultMaxHeight
local LIST_MIN = 120          -- меньше семи строк список не сжимается: лучше ползунок
local PULLOUT_BACKDROP = {    -- :42-49
    bgFile = "Interface\\ChatFrame\\ChatFrameBackground",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    edgeSize = 32, tileSize = 32, tile = true,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
}
local SLIDER_BACKDROP = {     -- :50-55
    bgFile = "Interface\\Buttons\\UI-SliderBar-Background",
    edgeFile = "Interface\\Buttons\\UI-SliderBar-Border",
    tile = true, tileSize = 8, edgeSize = 8,
    insets = { left = 3, right = 3, top = 3, bottom = 3 },
}

local opened                  -- открыт всегда только один список (у AceGUI pullout тоже один на виджет)
local function closeOpened()
    if opened then
        opened.frame:Hide()
        opened = nil
    end
end

-- :25-34: strata надо спустить на ВСЕХ детей, иначе рамка списка и её содержимое рисуются в разных слоях
local function fixstrata(strata, parent, ...)
    local i = 1
    local child = select(i, ...)
    parent:SetFrameStrata(strata)
    while child do
        fixstrata(strata, child, child:GetChildren())
        i = i + 1
        child = select(i, ...)
    end
end

local function makePullout(dd, items, get, setIt, listWidth)
    local frame = CreateFrame("Frame", nextName("Pullout"), UIParent)
    frame:SetBackdrop(PULLOUT_BACKDROP)
    frame:SetBackdropColor(0, 0, 0)                 -- :286
    frame:SetFrameStrata("FULLSCREEN_DIALOG")       -- :287
    frame:SetClampedToScreen(true)                  -- :288
    frame:SetWidth(listWidth)                       -- :384: pullout:SetWidth(frame:GetWidth() виджета)
    frame:SetHeight(LIST_MAX)

    local scroll = CreateFrame("ScrollFrame", nextName("Scroll"), frame)   -- :294-297
    scroll:SetFrameLevel(frame:GetFrameLevel() + 1)
    local child = CreateFrame("Frame", nextName("Items"), scroll)
    child:SetFrameLevel(scroll:GetFrameLevel() + 1)

    local slider = CreateFrame("Slider", nextName("Scrollbar"), scroll)    -- :305-313
    slider:SetFrameLevel(scroll:GetFrameLevel() + 1)
    slider:SetOrientation("VERTICAL")
    slider:SetHitRectInsets(0, 0, -10, 0)
    slider:SetBackdrop(SLIDER_BACKDROP)
    slider:SetWidth(8)
    slider:SetThumbTexture("Interface\\Buttons\\UI-SliderBar-Button-Vertical")
    slider:SetFrameStrata("FULLSCREEN_DIALOG")

    scroll:SetScrollChild(child)                    -- :316-323
    scroll:SetPoint("TOPLEFT", frame, "TOPLEFT", BORDER_W, -12)
    scroll:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -BORDER_W, 12)
    scroll:EnableMouseWheel(true)
    scroll:SetToplevel(true)                        -- :322
    child:SetPoint("TOPLEFT", scroll, "TOPLEFT", 0, 0)   -- :325-329
    child:SetPoint("TOPRIGHT", scroll, "TOPRIGHT", -SCROLL_W, 0)
    child:SetHeight(400)
    child:SetToplevel(true)
    slider:SetPoint("TOPLEFT", scroll, "TOPRIGHT", -16, 0)     -- :331-336
    slider:SetPoint("BOTTOMLEFT", scroll, "BOTTOMRIGHT", -16, 0)
    slider:SetMinMaxValues(0, 1000)
    slider:SetValueStep(1)

    local p = { frame = frame, scroll = scroll, child = child, slider = slider,
                rows = {}, offset = 0, scrollvalue = 0, listHeight = LIST_MAX }

    local setScroll                                                   -- :90-106
    local fixScroll                                                   -- :128-151

    setScroll = function(value)
        local height, viewheight = scroll:GetHeight(), child:GetHeight()
        local offset
        if height > viewheight then
            offset = 0
        else
            offset = floor((viewheight - height) / 1000 * value)
        end
        child:ClearAllPoints()
        child:SetPoint("TOPLEFT", scroll, "TOPLEFT", 0, offset)
        child:SetPoint("TOPRIGHT", scroll, "TOPRIGHT", slider:IsShown() and -SCROLL_W or 0, offset)
        p.offset = offset
        p.scrollvalue = value
    end

    -- колесо мыши: :109-125. Шаг 1000/(diff/45) -- его же константа «45 пикселей на оборот»
    local function moveScroll(value)
        local height, viewheight = scroll:GetHeight(), child:GetHeight()
        if height >= viewheight then
            slider:Hide()
        else
            slider:Show()
            local diff = height - viewheight
            local delta = (value < 0) and -1 or 1
            slider:SetValue(min(max(p.scrollvalue + delta * (1000 / (diff / 45)), 0), 1000))
        end
    end

    fixScroll = function()
        local height, viewheight = scroll:GetHeight(), child:GetHeight()
        local offset = p.offset or 0
        if viewheight <= height then
            slider:Hide()
            child:SetPoint("TOPRIGHT", scroll, "TOPRIGHT", 0, offset)
            slider:SetValue(0)
        else
            slider:Show()
            local value = (offset / (viewheight - height) * 1000)
            if value > 1000 then value = 1000 end
            slider:SetValue(value)
            setScroll(value)
            if value < 1000 then
                child:ClearAllPoints()
                child:SetPoint("TOPLEFT", scroll, "TOPLEFT", 0, offset)
                child:SetPoint("TOPRIGHT", scroll, "TOPRIGHT", -SCROLL_W, offset)
                p.offset = offset
            end
        end
    end

    slider:SetScript("OnValueChanged", function(self, value) setScroll(value) end)  -- :79-81
    scroll:SetScript("OnMouseWheel", function(self, delta) moveScroll(delta) end)   -- :75-77
    scroll:SetScript("OnSizeChanged", function() fixScroll() end)                   -- :83-85

    -- :229-236: потолок применяется к уже посчитанной высоте списка
    local function setMaxHeight(height)
        p.listHeight = height or LIST_MAX
        if frame:GetHeight() > p.listHeight then
            frame:SetHeight(p.listHeight)
        elseif (child:GetHeight() + FRAME_PAD) < p.listHeight then
            frame:SetHeight(child:GetHeight() + FRAME_PAD)
        end
    end

    local function rowButton(i)                       -- оформление пунктов: Items:150-176
        local b = p.rows[i]
        if not b then
            b = CreateFrame("Button", nextName("Item"), child)
            b:SetHeight(ROW_H + 1)                    -- Items:150
            b:SetWidth(listWidth - 2 * BORDER_W)
            b:SetFrameStrata("FULLSCREEN_DIALOG")
            b.text = b:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")   -- Items:153-158
            b.text:SetTextColor(1, 1, 1)
            b.text:SetJustifyH("LEFT")
            b.text:SetPoint("TOPLEFT", b, "TOPLEFT", 18, 0)
            b.text:SetPoint("BOTTOMRIGHT", b, "BOTTOMRIGHT", -8, 0)
            b.hover = b:CreateTexture(nil, "OVERLAY")                            -- Items:160-168
            b.hover:SetTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight")
            b.hover:SetBlendMode("ADD")
            b.hover:SetHeight(14)
            b.hover:ClearAllPoints()
            b.hover:SetPoint("RIGHT", b, "RIGHT", -3, 0)
            b.hover:SetPoint("LEFT", b, "LEFT", 5, 0)
            b.hover:Hide()
            b.check = b:CreateTexture(nil, "OVERLAY")                             -- Items:170-176
            b.check:SetWidth(16)
            b.check:SetHeight(16)
            b.check:SetPoint("LEFT", b, "LEFT", 3, -1)
            b.check:SetTexture("Interface\\Buttons\\UI-CheckBox-Check")
            b.check:Hide()
            b:SetScript("OnEnter", function(self) self.hover:Show() end)          -- Items:37-48
            b:SetScript("OnLeave", function(self) self.hover:Hide() end)
            -- выбор закрывает список (Dropdown:426-443: для одиночного выбора checked -> Close)
            b:SetScript("OnClick", function(self)
                local value = self.value
                closeOpened()
                setIt(value)
                PlaySound("igMainMenuOptionCheckBoxOn")
            end)
            p.rows[i] = b
        end
        return b
    end

    -- :190-197 из Open() + :40-42 из ElvUI: лишние пункты прячутся, а не удаляются
    local function fill()
        local list = (type(items) == "function" and items()) or items or {}
        local chosen = get()
        local height = 8
        for i, item in ipairs(list) do
            local b = rowButton(i)
            b.value = item.value
            b.text:SetText(item.text or tostring(item.value))
            b:SetPoint("TOPLEFT", child, "TOPLEFT", 0, -2 + (i - 1) * -ROW_H)
            if item.value == chosen then b.check:Show() else b.check:Hide() end
            b:Show()
            height = height + ROW_H
        end
        for i = #list + 1, #p.rows do p.rows[i]:Hide() end
        child:SetHeight(height)
        frame:SetHeight(min(height + FRAME_PAD, p.listHeight))     -- :172
    end

    -- список живёт вне ScrollFrame окна (иначе его обрезало бы), поэтому он ребёнок UIParent и обязан
    -- убраться, когда окно спрятали -- у AceGUI за это отвечает OnHide виджета (:369-374, :682)
    frame:SetScript("OnUpdate", function()
        if not dd:IsVisible() then closeOpened() end
    end)

    function p:Open()                                   -- :182-201 + :384-387
        closeOpened()
        fill()
        -- потолок по месту: нижний край экрана это y = 0 (FrameXML/UIDropDownMenu.lua:757)
        local bottom = dd:GetBottom()
        if bottom then
            setMaxHeight(max(LIST_MIN, min(LIST_MAX, bottom - 8)))
        else
            setMaxHeight(LIST_MAX)
        end
        frame:ClearAllPoints()
        -- те же смещения, что клиент берёт для этого же шаблона (UI.lua:546-548: xOffset 18, yOffset 2):
        -- левый край рамки шаблона на 16 px левее видимой полосы, без этого список стоит левее контрола
        frame:SetPoint("TOPLEFT", dd, "BOTTOMLEFT", 18, 2)
        -- :198: окно AwesomeCVar само в FULLSCREEN_DIALOG (UI.lua:335), а внутри одного strata порядок
        -- идёт по frameLevel -- без подъёма в TOOLTIP список рисует ПОД окном (замер владельца 04.10 19:3x:
        -- «дропдавн где то за окном открывается»)
        fixstrata("TOOLTIP", frame, frame:GetChildren())
        frame:Show()
        fixScroll()
        opened = p
    end

    function p:Close() closeOpened() end                -- :204-207

    return p
end

-- Закрытый контрол -- нативный UIDropDownMenuTemplate ровно как строка CVar в UI.lua:542-552: фрейм
-- растянут по ширине строки (TOPLEFT + TOPRIGHT), ширина задана ЧИСЛОМ. Меняется только раскрытие: кнопка
-- шаблона больше не зовёт ToggleDropDownMenu, она открывает pullout выше.
local function dropdown(parent, label, x, y, items, get, setIt)
    local row = CreateFrame("Frame", nextName("DropRow"), parent)
    row:SetPoint("TOPLEFT", x, y)
    row:SetWidth(parent:GetWidth() - 26)
    row:SetHeight(48)
    caption(row, label, 16, -4)

    local dd = CreateFrame("Frame", nextName("Drop"), row, "UIDropDownMenuTemplate")
    dd:SetPoint("TOPLEFT", row, -16, -14)
    dd:SetPoint("TOPRIGHT", row)
    local listWidth = max(160, row:GetWidth() - 40)
    UIDropDownMenu_SetWidth(dd, listWidth)

    local pullout = makePullout(dd, items, get, setIt, listWidth)
    -- Список живёт на UIParent, а не внутри панели: skin-модуль, который обошёл дерево вкладки, его не
    -- найдёт. Отдаём ссылки на рамку и её ползунок прямо на дропдауне (Skins/ElvUI.lua забирает их там же).
    dd.awPulloutFrame, dd.awPulloutSlider = pullout.frame, pullout.slider
    local button = _G[dd:GetName() .. "Button"]         -- именованный фрейм: шаблон завёл кнопку
    button:SetScript("OnClick", function()
        if opened == pullout then pullout:Close() else pullout:Open() end
    end)
    return addRefresh(function()
        local chosen = get()
        local list = (type(items) == "function" and items()) or items
        local text = tostring(chosen)
        for _, item in ipairs(list) do
            if item.value == chosen then text = item.text end
        end
        UIDropDownMenu_SetText(dd, text)
    end)
end


local function slider(parent, label, minValue, maxValue, step, get, setIt, y)
    local s = CreateFrame("Slider", nextName("Slider"), parent, "OptionsSliderTemplate")
    s:SetWidth(200)
    s:SetPoint("TOPLEFT", 16, y)
    s:SetMinMaxValues(minValue, maxValue)
    s:SetValueStep(step)   -- SetObeyStepOnDrag на этом патче у Slider нет (кодекс, Slider:Methods) --
                        -- первый же клик по слайдеру дал бы «attempt to call a nil value»
    _G[s:GetName() .. "Low"]:SetText(tostring(minValue))
    _G[s:GetName() .. "High"]:SetText(tostring(maxValue))
    -- the window opens by setting values programmatically; OnValueChanged fires for those too, so the
    -- write is guarded by "did it actually change" (same trap AwesomeCVar already documents for its sliders)
    s:SetScript("OnValueChanged", function(self, value)
        local snapped = math.floor(value / step + 0.5) * step
        _G[self:GetName() .. "Text"]:SetText(label .. ": " .. snapped)
        if get() ~= snapped then setIt(snapped) end
    end)
    addRefresh(function()
        local value = get()
        s:SetValue(value)
        _G[s:GetName() .. "Text"]:SetText(label .. ": " .. value)
    end)
    return s
end

local function edit(parent, label, x, y, get, setIt)
    caption(parent, label, x, y - 4)
    local box = CreateFrame("EditBox", nextName("Edit"), parent, "InputBoxTemplate")
    box:SetSize(56, 20)
    box:SetPoint("TOPLEFT", x + 18, y)
    box:SetAutoFocus(false)
    box:SetMaxLetters(6)
    -- SetNumeric is not an option: it forbids the minus sign, and offsets are negative half the time
    box:SetScript("OnEnterPressed", function(self)
        local value = tonumber(self:GetText())
        if value then setIt(value) end
        self:ClearFocus()
    end)
    box:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
    return addRefresh(function() box:SetText(tostring(get())) end)
end

local function swatch(parent, label, x, y, key)
    caption(parent, label, x, y - 5)
    local button = CreateFrame("Button", nextName("Swatch"), parent)
    button:SetSize(22, 22)
    button:SetPoint("TOPLEFT", x + 44, y)
    button:SetNormalTexture("Interface\\ChatFrame\\ChatFrameColorSwatch")
    local fill = button:CreateTexture(nil, "BACKGROUND")
    fill:SetPoint("TOPLEFT", 3, -3)
    fill:SetPoint("BOTTOMRIGHT", -3, 3)
    button:SetScript("OnClick", function()
        local profile = db()[key]
        local oldR, oldG, oldB = profile.r, profile.g, profile.b
        local function keep()
            local r, g, b = ColorPickerFrame:GetColorRGB()
            profile.r, profile.g, profile.b = r, g, b
            local a = api()
            if a then a.touch() end
            ACVar:UpdateAllUI()
        end
        -- 3.3.5a has no OpenColorPicker(); this is the ColorPickerFrame dance iTargetingFrames uses here
        ColorPickerFrame.hasOpacity = false
        ColorPickerFrame.previousValues = { oldR, oldG, oldB, 1 }
        ColorPickerFrame.func = keep
        ColorPickerFrame.opacityFunc = keep
        ColorPickerFrame.cancelFunc = function(prev)
            profile.r, profile.g, profile.b = prev[1], prev[2], prev[3]
            local a = api()
            if a then a.touch() end
            ACVar:UpdateAllUI()
        end
        ColorPickerFrame:SetColorRGB(oldR, oldG, oldB)
        ColorPickerFrame:Hide()   -- runs the OnShow handler
        ColorPickerFrame:Show()
    end)
    return addRefresh(function()
        local profile = db()[key]
        fill:SetTexture(profile.r, profile.g, profile.b)
    end)
end

-- ---------------------------------------------------------------- blocks

local function block(parent, y, title)
    local box = CreateFrame("Frame", nil, parent)
    box:SetPoint("TOPLEFT", 10, y)
    -- ширина задаётся ЧИСЛОМ, а не вторым якорем: в момент сборки GetWidth() от пары TOPLEFT/TOPRIGHT
    -- ещё ноль, и все дочерние контролы получили бы нулевую ширину (замер 04.10 18:0x: дропдауны
    -- сжались в одни стрелки). UI.lua поступает так же -- control:SetWidth(...) до наполнения строки.
    box:SetWidth((parent:GetWidth() or 0) - 36)
    box:SetBackdrop({
        bgFile = "Interface/Tooltips/UI-Tooltip-Background",
        edgeFile = "Interface/Tooltips/UI-Tooltip-Border",
        tile = true, tileSize = 12, edgeSize = 12,
        insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    box:SetBackdropColor(0.15, 0.15, 0.15, 0.6)
    box:SetBackdropBorderColor(0.4, 0.4, 0.4, 0.8)
    local head = box:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    head:SetPoint("TOPLEFT", 12, -10)
    head:SetWidth(box:GetWidth() - 24)
    head:SetJustifyH("LEFT")
    head:SetText(title)
    box.head = head
    return box
end

-- список рисовалка отдаёт простыми строками, а пункты печатает наш pullout: пункт без text -- пустая
-- строка в списке (замер владельца 04.10 18:2x на вкладке «Шрифт», тогда ещё нативным списком)
local function nameItems(names)
    local out = {}
    for _, name in ipairs(names or {}) do out[#out + 1] = { value = name, text = tostring(name) } end
    return out
end

local function mapItems(list, group)
    local out = {}
    local captions = (T.items and T.items[group]) or {}
    for _, item in ipairs(list) do
        -- sides у рисовалки это {value, me, it} без подписи: без подписи в списке была бы пустая строка.
        -- подпись берётся от окна по значению, а не от рисовалки: игрок видит язык клиента, а в профиле
        -- лежит англоязычный токен (замер владельца 04.10 19:5x: список «Привязка» был по-английски)
        out[#out + 1] = { value = item.value,
                          text = captions[item.value] or item.text or tostring(item.value) }
    end
    return out
end

local function elementBlock(parent, y, title, key)
    local a = api()
    local box = block(parent, y, title)
    local clamps = a.clamps
    local isPlate = (key == "players" or key == "npcs")
    local get = function(field) return function() return db()[key][field] end end
    local put = function(field) return function(v) set(key, field, v) end end

    local rowY = -34
    check(box, T.show, 12, rowY, get("show"), put("show"))
    rowY = rowY - 28
    dropdown(box, T.anchor, 16, rowY,
        mapItems(isPlate and a.plateAnchors or a.unitAnchors[key],
            isPlate and "anchorPlate" or ("anchor" .. key:sub(1, 1):upper() .. key:sub(2))),
        get("anchor"), put("anchor"))
    rowY = rowY - 50
    dropdown(box, T.side, 16, rowY, mapItems(a.sides, "side"), get("side"), put("side"))
    rowY = rowY - 50
    dropdown(box, T.font, 16, rowY, function() return nameItems(a.fonts()) end, get("font"), put("font"))
    -- ответ клиента -- ПОД своим дропдауном, а не одной длинной строкой внизу вкладки: четыре профиля в
    -- одну строку не влезают и обрезаются по правому краю окна (скриншот владельца 04.10 20:5x, где
    -- «Плейты игроков: меток ещё не было | Плейты НПС: FRIZQT__ | Цель: ... |…» оборвалось на середине)
    rowY = rowY - 18
    local note = box:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    note:SetPoint("TOPLEFT", 24, rowY)
    note:SetPoint("TOPRIGHT", -20, rowY)   -- оба края: за пределы блока подпись уехать не может
    note:SetJustifyH("LEFT")
    addRefresh(function()
        local requested, applied = a.fontInfo(key)
        if not requested then
            note:SetText(T.noFont)
        elseif applied == requested then
            note:SetText(("%s: %s"):format(T.appliedShort, shortFont(applied)))
        else
            note:SetText(("%s: %s -> %s"):format(T.kept, shortFont(requested), shortFont(applied)))
        end
    end)
    rowY = rowY - 32
    dropdown(box, T.outline, 16, rowY, mapItems(a.outlines, "outline"), get("outline"), put("outline"))
    rowY = rowY - 50
    slider(box, T.size, clamps.size[1], clamps.size[2], 1, get("size"), put("size"), rowY)
    rowY = rowY - 44
    edit(box, "X", 16, rowY, get("x"), put("x"))
    edit(box, "Y", 150, rowY, get("y"), put("y"))
    rowY = rowY - 26
    swatch(box, T.color, 16, rowY, key)
    rowY = rowY - 34

    box:SetHeight(-rowY + 10)
    return box
end

local function build()
    local a = api()
    if not a then return end
    widgets = {}

    local y = -14
    local master = block(content, y, (L.CATEGORY_DISTANCE or "Distance"))
    master.head:SetText(T.on)
    master:SetHeight(52)
    check(master, T.on, 12, -30,
        function() return getCVarFlag("distanceDisplay") end,
        function(v) ACVar:SetCVarValue("distanceDisplay", v and "1" or "0", ACVar.CUSTOM_PANEL_CVAR_ROWS[1]) end)
    y = y - 64

    local gen = block(content, y, T.general)
    local rowY = -34
    check(gen, T.decimals, 12, rowY, function() return db().general.decimals end,
        function(v) set("general", "decimals", v) end)
    rowY = rowY - 26
    check(gen, T.hideOwn, 12, rowY, function() return db().general.hideOwnPlate end,
        function(v) set("general", "hideOwnPlate", v) end)
    rowY = rowY - 26
    check(gen, T.limit, 12, rowY, function() return db().general.limitRange end,
        function(v) set("general", "limitRange", v) end)
    rowY = rowY - 30
    local range = slider(gen, T.maxRange, a.clamps.maxRange[1], a.clamps.maxRange[2], 5,
        function() return db().general.maxRange end, function(v) set("general", "maxRange", v) end, rowY)
    rowY = rowY - 46
    local reset = CreateFrame("Button", nextName("Reset"), gen, "UIPanelButtonTemplate")
    reset:SetSize(220, 22)
    reset:SetPoint("TOPLEFT", 16, rowY)
    reset:SetText(T.reset)
    reset:SetScript("OnClick", function() api().reset(); ACVar:UpdateAllUI() end)
    rowY = rowY - 34
    gen:SetHeight(-rowY + 10)
    addRefresh(function()
        if db().general.limitRange then range:Enable() else range:Disable() end
    end)
    y = y - gen:GetHeight() - 12

    for _, key in ipairs({ "players", "npcs", "target", "focus" }) do
        local box = elementBlock(content, y, T[key], key)
        y = y - box:GetHeight() - 12
    end

    statusLine = content:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    statusLine:SetPoint("TOPLEFT", 12, y - 6)
    statusLine:SetPoint("TOPRIGHT", -26, y - 6)
    statusLine:SetJustifyH("LEFT")
    content:SetHeight(-y + 34)
    built = true
end

function ACVar:UpdateDistancePanel()
    local a = api()
    if not content then return end
    if not a then
        if notice then
            notice:SetText(T.off)
            notice:Show()
        end
        return
    end
    if notice then notice:Hide() end
    if not built then
        build()
        if not built then return end
    end
    for _, fn in ipairs(widgets) do fn() end
    if statusLine then
        local shown, err = a.status()
        local line = err or ("%s: %s"):format(T.labelsShown, tostring(shown))
        if not err and a.isBroken() then line = line .. " | " .. T.broken end
        statusLine:SetText(line)
    end
end

-- The tab itself. AwesomeCVar's window builds one of these after its CVar categories (UI.lua), with the
-- same tab strip, the same scroll frame and the same backdrop as the CVar panels get.
ACVar.CUSTOM_PANELS = ACVar.CUSTOM_PANELS or {}
ACVar.CUSTOM_PANELS[#ACVar.CUSTOM_PANELS + 1] = {
    name = L.CATEGORY_DISTANCE or "Distance",
    build = function(builtContent, subPanel)
        content = builtContent
        notice = builtContent:CreateFontString(nil, "OVERLAY", "GameFontNormal")
        notice:SetPoint("TOPLEFT", 16, -20)
        notice:SetPoint("TOPRIGHT", -16, -20)
        notice:SetJustifyH("LEFT")
        notice:SetText(T.off)
    end,
    refresh = function() ACVar:UpdateDistancePanel() end,
}
