-- File: Constants.lua
-- Holds all static definitions for the addon.

local _, ACVar = ...
local L = ACVar.L or {} -- Get the locale table loaded previously
_G["AwesomeCVar"] = {} -- Public API table

-- This table holds constants used throughout the addon.

--! Адрес и схема ссылки -- один источник на весь аддон: строку приветствия собираем отсюда, обработчик
-- клика (Core.lua) узнаёт эту же схему, клик-зона в подвале окна (UI.lua) вставляет этот же адрес.
-- Схема `url` взята у ElvUI (`Modules/Chat/Chat.lua:763` `CH:PrintURL`), чтобы в клиенте с ElvUI ссылка
-- работала и без нашего хука; в клиенте без ElvUI клик по ней обрабатывает только наш хук.
local DISCORD_URL = "https://discord.gg/sKpJbUrsvR"
local LINK_SCHEME = "url"

ACVar.CONSTANTS = {
    ADDON_NAME = L.ADDON_NAME,
    DISCORD_URL = DISCORD_URL,
    LINK_SCHEME = LINK_SCHEME,
    -- Тоже вне Locales и тоже ASCII: подсказка при наведении на ссылку в окне должна читаться одинаково
    -- на любой локали клиента, как и блок кредитов ниже.
    LINK_HINT = "Click to put the link into the chat box",
    COLORS = {
        SUCCESS = "|cff00ff00",
        HIGHLIGHT = "|cffffd100",
        VALUE = "|cff00ccff",
        ERROR = "|cffff0000",
        RESET = "|r",
        TAB_ACTIVE = {1, 1, 0},
        TAB_INACTIVE = {0.8, 0.8, 0.8},
        DESC_TEXT = {0.6, 0.6, 0.6}
    },
    -- Greeting printed on load and reused by the window footer (UI.lua). Kept out of Locales on purpose:
    -- authorship and the Discord link should read the same on any client locale (01.10). These lines are
    -- ASCII English: the client here is enUS and cp1251, so a UTF-8 Cyrillic byte shows up in chat as
    -- mojibake (measured 22.09: "ВКЛ" printed as "ÂÊË"). Non-ASCII sources do load -- that is how
    -- Locales/zhCN.lua and zhTW.lua ship -- they just must not be shown on a different-codepoint client.
    -- Character names carry the faction colour: Alliance blue, Horde red.
    GREETING = {
        "|cff9d9d9dPlaying on |cff00ccffIcecrown|r|cff9d9d9d.|r",
        "|cff9d9d9dMade by |cffffd100Keoo|r |cff9d9d9dfor Warmane.|r",
        "|cff9d9d9dDiscord: |cff00ccff|H" .. LINK_SCHEME .. ":" .. DISCORD_URL .. "|h[" .. DISCORD_URL .. "]|h|r",
        "|cff9d9d9dAlliance: |cff0070ddEgorxxl|r    |cff9d9d9dHorde: |cffff0000Egormashina|r",
    },
    FRAME = {
        MAIN_WIDTH = 768,
        MAIN_HEIGHT = 620,
        POPUP_WIDTH = 350,
        POPUP_HEIGHT = 120,
        BUTTON_WIDTH = 100,
        BUTTON_HEIGHT = 25,
        TAB_HEIGHT = 25
    }
}

-- This table defines every CVar control that will appear in the UI.
--
-- Состав = ровно то, что регистрирует наша dll (перечислено в `registerCVar(` по src/AwesomeWotlkLib/*.cpp).
-- Строки фич, которых у нас нет, из аддона удалены 30.09 по решению владельца: 3.3.5 молча заводит
-- неизвестный CVar в Config.wtf, поэтому «настройка, которая ничего не делает» хуже, чем её отсутствие.
-- Профиль сборки (что включено) зашит в Settings.h; читать настройки из файла dll не умеет с 01.10.
-- Гейт `node tools/run_cvar_contract.js` сверяет вилки/дефолты с клампами, вытащенными из *.cpp, и следит
-- за обеими сторонами: нет строки без переменной dll и нет переменной dll без строки.
--
-- awNeeds: какой ключ ПРОФИЛЯ СБОРКИ (Settings.h) регистрирует этот CVar. Внешних настроек у dll больше
-- нет, поэтому отсутствовать переменная может только если фича сама пропустила площадку (в журнале тогда
-- "... is not executable client code, feature skipped"). UI гасит такую строку по факту (ACVar:cvarExists),
-- а awNeeds нужен, чтобы сказать, из какого переключателя сборки она пришла.

ACVar.CVARS = {
    [L.CATEGORY_CAMERA] = {
        { name = "cameraFov", label = L.CVAR_LABEL_CAMERA_FOV, desc = L.DESC_CAMERA_FOV, type = "slider", min = 60, max = 150, step = 1, default = 100, awNeeds = "профиль: camera" },
        { name = "cameraIndirectVisibility", label = L.CVAR_LABEL_CAMERA_INDIRECT_VISIBILITY, desc = L.DESC_CAMERA_INDIRECT_VISIBILITY, type = "toggle", min = 0, max = 1, default = 0, awNeeds = "профиль: fade" },
        { name = "cameraIndirectAlpha", label = L.CVAR_LABEL_CAMERA_INDIRECT_ALPHA, desc = L.DESC_CAMERA_INDIRECT_ALPHA, type = "slider", min = 0.6, max = 1, step = 0.05, default = 0.6, awNeeds = "профиль: fade" },
    },
    [L.CATEGORY_NAMEPLATES] = {
        { name = "info", label = L.CVAR_LABEL_INFO, desc = L.DESC_INFO, type = "description" },
        { name = "nameplateDistance", label = L.CVAR_LABEL_NAMEPLATE_DISTANCE, desc = L.DESC_NAMEPLATE_DISTANCE, type = "slider", min = 41, max = 100, step = 1, default = 43, awNeeds = "профиль: scope=4" },
        -- Строки ядра стекинга сняты 08.10: перенос свёрнут (TECHNICAL п. 80), переменных dll под них нет.
    },
    [L.CATEGORY_INTERACTION] = {
        { name = "interactionMode", label = L.CVAR_LABEL_INTERACTION_MODE, desc = L.DESC_INTERACTION_MODE, type = "mode", modes = { { value = 0, label = L.MODE_LABEL_PLAYER_RADIUS }, { value = 1, label = L.MODE_LABEL_CONE_ANGLE } }, default = 1, awNeeds = "профиль: interact" },
        { name = "interactionAngle", label = L.CVAR_LABEL_INTERACTION_ANGLE, desc = L.DESC_INTERACTION_ANGLE, type = "slider", min = 15, max = 160, step = 1, default = 60, awNeeds = "профиль: interact" },
    },
    -- Вкладка Distance в этом окне -- не строка CVar: настройки цифр живут в AWDistanceDB, а единственную
    -- переменную консоли (distanceDisplay) объявляет addons/AwesomeCVar/DistancePanel.lua, и гейт читает
    -- строки из обоих файлов. Категории дистанции здесь нет намеренно: двух мест, где настраивают одно,
    -- не должно быть даже ради одной галки.
}
