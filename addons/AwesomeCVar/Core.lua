-- File: Core.lua
-- Main addon logic, event handling, and slash command processing.

local addonName, ACVar = ...
local L = ACVar.L or {}
local CONSTANTS = ACVar.CONSTANTS

local _G = _G
local tonumber = tonumber
local tostring = tostring
local lower = string.lower
local format = string.format
--! WotLK fix: string.trim появился в Lua-обвязке WoW только в 9.x; в 3.3.5 (Lua 5.1) его нет, и
-- `lower(trim(msg))` падало на первой же слэш-команде.
local trim = string.trim or function(s)
    if type(s) ~= "string" then return s end
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end
local math_cos = math.cos
local math_sin = math.sin
local math_rad = math.rad
local math_deg = math.deg
local math_atan2 = math.atan2

local GetCVar = GetCVar
local SetCVar = SetCVar
local GetCVarDefault = GetCVarDefault
local pcall = pcall
local CreateFrame = CreateFrame
local SlashCmdList = SlashCmdList
local GetCursorPosition = GetCursorPosition
local InterfaceOptions_AddCategory = InterfaceOptions_AddCategory

ACVar.reloadIsPending = false

--! WotLK fix: существование CVar'а надо проверять, а не верить GetCVar.
--
-- GetCVar по несуществующему имени возвращает "" (пустую строку), а "" в Lua -- истина, поэтому прежний
-- guard `if self:GetCVarValue(name) then SetCVar(...)` пропускал запись в любую переменную: 3.3.5 молча
-- заводит её в Config.wtf, и «настройка, которая ничего не делает» выглядит как сломанная фича dll.
-- GetCVarDefault документирован как «causes an error if the named CVar does not exist» (кодекс 3.3.5a,
-- стр. 715) -- это и есть честная проверка: pcall ловит ошибку, а наличие строки-результата означает, что
-- переменную зарегистрировал клиент или наша dll (ensureCustomCVars).
--
-- Кэшируются только положительные ответы: если опрос случится раньше, чем dll зарегистрирует свои CVar'ы
-- (наш пул идёт вместе с loading'ом Lua-библиотек на заставке), отрицательный ответ не должен
-- застревать на всю сессию.
local probe
if type(GetCVarDefault) == "function" then
    probe = function(name)
        local ok, defaultValue = pcall(GetCVarDefault, name)
        return ok and defaultValue ~= nil
    end
elseif type(GetCVarInfo) == "function" then
    probe = function(name)
        local ok, value = pcall(GetCVarInfo, name)
        return ok and value ~= nil
    end
else
    -- GetCVar по несуществующему имени возвращает "", а не ошибку -- годится последним аргументом
    probe = function(name)
        local value = GetCVar(name)
        return type(value) == "string" and value ~= ""
    end
end

function ACVar:cvarExists(cvarName)
    if type(cvarName) ~= "string" or cvarName == "" then return false end
    self._cvarExists = self._cvarExists or {}
    if self._cvarExists[cvarName] == nil then
        if not probe(cvarName) then return false end
        self._cvarExists[cvarName] = true
    end
    return self._cvarExists[cvarName]
end

local function formatMessage(template, ...)
    return CONSTANTS.COLORS.SUCCESS..L.ADDON_NAME..":"..CONSTANTS.COLORS.RESET.." "..string.format(template, ...)
end

function ACVar:PrintMessage(message, ...)
    _G.DEFAULT_CHAT_FRAME:AddMessage(formatMessage(message, ...))
end

-- Отдельная функция, а не цикл в OnLoad: так её видно в поведенческом гейте (tools/run_addon_behavior.js),
-- который вызывает PrintGreeting() на заглушечном DEFAULT_CHAT_FRAME и сверяет строки посимвольно.
function ACVar:PrintGreeting()
    for _, line in ipairs(CONSTANTS.GREETING or {}) do
        _G.DEFAULT_CHAT_FRAME:AddMessage(line)
    end
end

--! Клик по ссылке-адресу. 3.3.5a не открывает браузер, а схема `url` для него чужая: оригинальный
-- SetItemRef (FrameXML ItemRef.lua:2, ветка в конце -- :176-183) не знает ни player:, ни channel:, ни
-- GMChat, поэтому проваливается до ShowUIPanel(ItemRefTooltip) + ItemRefTooltip:SetHyperlink(link) и
-- показывает пустое окно тултипа. Тем же пост-хуком чинит этот дефект Cell (`Comm/Comm.lua:457-487`).
-- Наш хук делает две вещи: снимает это окно и кладёт адрес в поле отправки выделенным -- поведение
-- снято с ElvUI (`Modules/Chat/Chat.lua:820-843`: `SetChatEditBoxMessage` + `HyperLinkedURL`), оттуда же
-- и схема, чтобы в клиенте с ElvUI ссылка работала даже без этого файла.
function ACVar:PutUrlInChatBox(url)
    if type(url) ~= "string" or url == "" then return end
    local box = _G.ChatEdit_ChooseBoxForSend and _G.ChatEdit_ChooseBoxForSend()
    if not box then return end
    if not box:IsShown() and _G.ChatEdit_ActivateChat then _G.ChatEdit_ActivateChat(box) end
    -- В клиенте с ElvUI её обработчик живёт внутри оригинального SetItemRef, то есть отрабатывает ДО
    -- нашего пост-хука и уже положил адрес в поле. Без этой проверки клик вставлял бы ссылку дважды.
    if box:GetText() ~= url then
        if box:GetText() ~= "" then box:SetText("") end
        box:Insert(url)
    end
    box:HighlightText()
    box:SetFocus()
end

hooksecurefunc("SetItemRef", function(link)
    local scheme = CONSTANTS.LINK_SCHEME..":"
    if type(link) ~= "string" or string.sub(link, 1, string.len(scheme)) ~= scheme then return end
    -- Чужие схемы (item:, spell:, achievement:) тултип показывать обязаны, поэтому окно снимается только
    -- для своей: иначе клик по предмету в чате терял бы описание.
    if _G.ItemRefTooltip and _G.ItemRefTooltip:IsShown() then _G.ItemRefTooltip:Hide() end
    ACVar:PutUrlInChatBox(string.sub(link, string.len(scheme) + 1))
end)

function ACVar:PrintCVarChange(cvarName, value, label)
    ACVar:PrintMessage(format(
        L.MSG_SET_VALUE,
        CONSTANTS.COLORS.HIGHLIGHT..cvarName..CONSTANTS.COLORS.RESET,
        CONSTANTS.COLORS.VALUE..tostring(value)..(label and format(" (%s)", label) or "")..CONSTANTS.COLORS.RESET
    ))
end

function ACVar:GetCVarValue(cvarName)
    if not self:cvarExists(cvarName) then return nil end
    local value = GetCVar(cvarName)
    return tonumber(value) or value
end

function ACVar:SetCVarValue(cvarName, value, cvarDef)
    if self:cvarExists(cvarName) then
        SetCVar(cvarName, value)
        if cvarDef and cvarDef.reloadRequired then
            self.reloadIsPending = true
        end
    end
end

function ACVar.FormatNumber(value)
    return tonumber(format("%.2f", value or 0)) or 0
end

-- ### Slash Command Handler ###
local function processSlashCommand(msg)
    msg = lower(trim(msg))

    if msg == "" or msg == "toggle" then
        ACVar:ToggleFrame()
    elseif msg == "show" then
        ACVar:ShowFrame()
    elseif msg == "hide" then
        ACVar:HideFrame()
    elseif msg == "reset" or msg == "resetposition" then
        ACVar:ResetFramePosition()
    elseif msg == "help" then
        ACVar:PrintMessage(L.MSG_HELP_HEADER)
        ACVar:PrintMessage(L.MSG_HELP_TOGGLE)
        ACVar:PrintMessage(L.MSG_HELP_SHOW)
        ACVar:PrintMessage(L.MSG_HELP_HIDE)
        ACVar:PrintMessage(L.MSG_HELP_RESET)
        ACVar:PrintMessage(L.MSG_HELP_HELP)
    else
        _G.DEFAULT_CHAT_FRAME:AddMessage(CONSTANTS.COLORS.ERROR..L.MSG_UNKNOWN_COMMAND)
    end
end

-- ### Minimap Logic ###
function ACVar:UpdateMinimapButton()
    if not self.MinimapButton then return end
    if self.DB.minimap.hide then
        self.MinimapButton:Hide()
    else
        self.MinimapButton:Show()
    end
end

function ACVar:CreateMinimapButton()
    local button = CreateFrame("Button", "AwesomeCVarMinimapButton", Minimap)
    self.MinimapButton = button
    button:SetFrameStrata("MEDIUM")
    button:SetSize(31, 31)
    button:SetFrameLevel(8)
    button:RegisterForClicks("AnyUp")
    button:RegisterForDrag("LeftButton")
    button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

    local overlay = button:CreateTexture(nil, "OVERLAY")
    overlay:SetWidth(53)
    overlay:SetHeight(53)
    overlay:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
    overlay:SetPoint("TOPLEFT")

    local icon = button:CreateTexture(nil, "BACKGROUND")
    icon:SetWidth(20)
    icon:SetHeight(20)
    icon:SetTexture("Interface\\Icons\\Trade_Engineering")
    icon:SetTexCoord(0.05, 0.95, 0.05, 0.95)
    icon:SetPoint("TOPLEFT", 7, -5)

    local function updatePosition()
        local angle = math_rad(self.DB.minimap.minimapPos or 220)
        local x = math_cos(angle) * 80
        local y = math_sin(angle) * 80
        button:SetPoint("CENTER", Minimap, "CENTER", x, y)
    end

    button:SetScript("OnDragStart", function(self)
        self:LockHighlight()
        self:SetScript("OnUpdate", function()
            local mx, my = Minimap:GetCenter()
            local px, py = GetCursorPosition()
            local scale = Minimap:GetEffectiveScale()
            px, py = px / scale, py / scale
            local angle = math_deg(math_atan2(py - my, px - mx))
            ACVar.DB.minimap.minimapPos = angle
            updatePosition()
        end)
    end)

    button:SetScript("OnDragStop", function(self)
        self:UnlockHighlight()
        self:SetScript("OnUpdate", nil)
    end)

    button:SetScript("OnClick", function()
        ACVar:ToggleFrame()
    end)

    button:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_LEFT")
        GameTooltip:AddLine(L.ADDON_NAME)
        GameTooltip:AddLine(L.MINIMAP_TOOLTIP, 1, 1, 1)
        GameTooltip:Show()
    end)

    button:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)

    updatePosition()
    self:UpdateMinimapButton()
end

-- ### Blizz UI Options Entry ###
function ACVar:CreateBlizzOptions()
    local panel = CreateFrame("Frame", "AwesomeCVarBlizzPanel", UIParent)
    panel.name = L.ADDON_NAME_SHORT or addonName

    local title = panel:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    title:SetPoint("TOPLEFT", 16, -16)
    title:SetText(panel.name)

    local openBtn = CreateFrame("Button", "AwesomeCVarBlizzOpenBtn", panel, "UIPanelButtonTemplate")
    openBtn:SetWidth(150)
    openBtn:SetHeight(30)
    openBtn:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -20)
    openBtn:SetText(L.OPEN_ADDON)
    openBtn:SetScript("OnClick", function()
        if InterfaceOptionsFrame and InterfaceOptionsFrame:IsShown() then
            HideUIPanel(InterfaceOptionsFrame)
        end
        ACVar:ShowFrame()
    end)

    InterfaceOptions_AddCategory(panel)
end

-- ### Game Menu Dynamic Update ###
function ACVar:UpdateGameMenuButton()
    if not self.GameMenuButton then return end
    if self.DB.showGameMenuButton then
        self.GameMenuButton:Show()
    else
        self.GameMenuButton:Hide()
    end
end

-- ### Initialization and Event Handling ###
function ACVar:OnLoad()
    if self.isLoaded then return end
    self:CreateMainFrame()
    self:CreateReloadPopup()
    self:CreateDefaultConfirmationPopup()
    self:AddGameMenuButton()
    self:CreateMinimapButton()
    self:CreateBlizzOptions()
    self:PrintMessage(L.MSG_LOADED)
    self:PrintGreeting()
    self.isLoaded = true
end

local eventFrame = CreateFrame("Frame")
eventFrame:RegisterEvent("ADDON_LOADED")
eventFrame:RegisterEvent("PLAYER_ENTERING_WORLD")
eventFrame:SetScript("OnEvent", function(self, event, arg)
    if event == "ADDON_LOADED" then
		if arg == addonName then
			_G.AwesomeCVarDB = _G.AwesomeCVarDB or {}
			_G.AwesomeCVarDB.minimap = _G.AwesomeCVarDB.minimap or {}

			if _G.AwesomeCVarDB.minimap.hide == nil then _G.AwesomeCVarDB.minimap.hide = false end
			if _G.AwesomeCVarDB.minimap.minimapPos == nil then _G.AwesomeCVarDB.minimap.minimapPos = 220 end
			if _G.AwesomeCVarDB.showGameMenuButton == nil then _G.AwesomeCVarDB.showGameMenuButton = true end

			ACVar.DB = _G.AwesomeCVarDB
			ACVar:OnLoad()
		end
    elseif event == "PLAYER_ENTERING_WORLD" then
        for _, f in pairs(ACVar.Skins or {}) do
            f()
        end
        self:UnregisterEvent(event)
    end
end)

-- Register Slash Commands
SLASH_AWESOME1 = "/awesome"
SLASH_AWESOME2 = "/awesomecvar"
SlashCmdList["AWESOME"] = processSlashCommand