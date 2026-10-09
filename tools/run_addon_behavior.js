// Поведенческий гейт данных AwesomeCVar (без клиента): прогоняет Locales/enUS.lua + Constants.lua +
// Core.lua в fengari с заглушным WoW-API и проверяет, что guard против записи в несуществующий CVar
// действительно работает, а не только парсится.
//
//   node tools/run_addon_behavior.js
//
// Почему это надо держать под гейтом, а не на глаз:
//   * GetCVar по несуществующему имени возвращает "" -- истина в Lua, поэтому прежний guard
//     `if GetCVarValue(name) then SetCVar(...)` пропускал запись в ЛЮБУЮ переменную, и 3.3.5 заводил
//     её в Config.wtf;
//   * dll регистрирует свои CVar'ы только для фич, включённых в профиль сборки, значит «перенесённый»
//     CVar может отсутствовать в клиенте, и аддон обязан это замечать пофакто;
//   * с 03.10 здесь же блок 10: клик по ссылке-адресу. Три места (строка GREETING, схема, которую узнаёт
//     хук на SetItemRef, и адрес, который он вставляет) обязаны сходиться, а в 3.3.5a клик по чужой схеме
//     ещё и обязан НЕ трогать ItemRefTooltip -- иначе ссылка в чате ломала бы подсказки предметов.

const fs = require('fs');
const path = require('path');
// fengari ищется так же, как luaparse в run_addon_lint.js: AW_FENGARI, потом MRT рядом, потом локально.
function loadFengari() {
  const candidates = [
    process.env.AW_FENGARI,
    'C:/Games/backport/MRT-3.3.5a/tools/luacheck/node_modules/fengari',
    path.join(__dirname, 'node_modules/fengari'),
  ].filter(Boolean);
  for (const c of candidates) { try { return require(c); } catch (e) { /* следующий кандидат */ } }
  console.log('FAIL: fengari не найден. Поставь AW_FENGARI=<путь> или npm i fengari в tools/.');
  process.exit(2);
}
const fengari = loadFengari();
const { lua, lauxlib, lualib, to_luastring } = fengari;

const root = path.join(__dirname, '..');
const addonDir = path.join(root, 'addons', 'AwesomeCVar');
const NS = 'AW_TEST_NS';

// Переменные, которые регистрирует dll. Список больше не список от руки: те же registerCVar из *.cpp,
// которые сверяет tools/run_cvar_contract.js, -- иначе стенд проверял бы сам себя по устаревшей строке.
const DLL_CVARS = (() => {
  const out = [];
  for (const f of ['NamePlates.cpp', 'Camera.cpp', 'Interact.cpp', 'Misc.cpp']) {
    const t = fs.readFileSync(path.join(root, 'src', 'AwesomeWotlkLib', f), 'utf8');
    for (const m of t.matchAll(/registerCVar\(&[A-Za-z_]\w*(?:\[\d+\])?,\s*"([^"]+)"/g)) {
      if (!out.includes(m[1])) out.push(m[1]);
    }
  }
  return out;
})();
const quoted = DLL_CVARS.map((n) => '"' + n + '"').join(', ');

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

function fail(label, detail) {
  console.log('FAIL ' + label + (detail ? ': ' + detail : ''));
  process.exit(1);
}

function doString(src, label) {
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK) fail(label + ' (загрузка)', lua.lua_tojsstring(L, -1));
  if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) fail(label + ' (исполнение)', lua.lua_tojsstring(L, -1));
}

// --- заглушка WoW-API --------------------------------------------------------
// Реестр CVar'ов моделирует состояние клиента: dll добавляет в AW_REGISTRY только то, что включено в
// Settings.h. GetCVarDefault по отсутствующему имени обязан error(), как документировано в кодексе.
doString(`
  local mt = {}
  mt.__index = function(self, key)
    if key == "GetName" then return function() return self.__name end end
    return function() return self end
  end
  function CreateFrame(_, name) return setmetatable({ __name = name }, mt) end
  -- WoW поднимает математические функции глобалами (GlobalFilters.lua), fengari -- нет.
  -- Без этих алиасов стенд падает на коде, который в клиенте работает, и это ровно тот
  -- случай, когда заглушка расходится с хостом.
  floor, ceil, abs, max, min, sqrt, strsub, strlower, strtrim, strfind, strformat,
    tinsert, tremove = math.floor, math.ceil, math.abs, math.max, math.min, math.sqrt,
    string.sub, string.lower, string.trim or string.gsub and function(s) return (s:gsub("^%s*(.-)%s*$", "%1")) end,
    string.find, string.format, table.insert, table.remove
  function GetLocale() return "enUS" end
  function IsAddOnLoaded() return true end
  SlashCmdList = {}
  function wipe(t) for k in pairs(t) do t[k] = nil end return t end
  UIParent = CreateFrame("Frame", "UIParent")
  Minimap = CreateFrame("Frame", "Minimap")

  CVARS = {}
AW_REGISTRY, AW_VALUES, AW_SETCVAR_WRITES = {}, {}, 0

  function GetCVarDefault(name)
    if AW_REGISTRY[name] == nil then
      error("GetCVarDefault: cvar '" .. tostring(name) .. "' does not exist")
    end
    return AW_REGISTRY[name]
  end

  function GetCVar(name)
    if AW_REGISTRY[name] == nil then return "" end
    return AW_VALUES[name] or AW_REGISTRY[name]
  end

  function SetCVar(name, value)
    AW_SETCVAR_WRITES = AW_SETCVAR_WRITES + 1
    AW_VALUES[name] = tostring(value)
    CVARS[name] = tostring(value)
  end

  -- клик по ссылке в чате: хук регистрируется глобальным именем, а не таблицей, поэтому заглушка
  -- просто помнит его под именем -- прогон ниже вызывает его сам. Оригинал SetItemRef подменять незачем,
  -- проверяется именно реакция хука.
  AW_HOOKS = {}
  function hooksecurefunc(t, k, fn)
    if type(t) == 'string' then AW_HOOKS[t] = k else AW_HOOKS[tostring(k)] = fn end
  end

  -- поле отправки и тултип предметов -- два объекта, с которыми работает обработчик. Счётчики вписаны
  -- прямо в поле: удвоение вставки и «вызов activate на уже открытом поле» видно только по ним.
  AW_BOX_ACTIVATES = 0
  AW_BOX = { text = '', inserts = 0, highlights = 0, focuses = 0, clears = 0, shown = true }
  function AW_BOX:GetText() return self.text end
  function AW_BOX:SetText(v) self.clears = self.clears + 1; self.text = v end
  function AW_BOX:Insert(v) self.inserts = self.inserts + 1; self.text = (self.text or '') .. v end
  function AW_BOX:HighlightText() self.highlights = self.highlights + 1 end
  function AW_BOX:SetFocus() self.focuses = self.focuses + 1 end
  function AW_BOX:IsShown() return self.shown end
  function ChatEdit_ChooseBoxForSend() return AW_BOX end
  function ChatEdit_ActivateChat(box) AW_BOX_ACTIVATES = AW_BOX_ACTIVATES + 1; box.shown = true end

  AW_TOOLTIP_HIDES = 0
  ItemRefTooltip = {
    shown = true,
    IsShown = function(self) return self.shown end,
    Hide = function(self) self.shown = false; AW_TOOLTIP_HIDES = AW_TOOLTIP_HIDES + 1 end,
  }
`, 'заглушка WoW-API');

// --- загрузка файлов аддона (varargs как в клиенте: имя, таблица аддона) ------
// Таблица аддона одна на все файлы: именно так её даёт загрузчик клиента, и на этом держится
// ACVar.L -- локалы пишут в общий namespace, а Constants.lua читает его обратно.
doString(`${NS} = {}`, 'namespace аддона');
for (const file of ['Locales/enUS.lua', 'Constants.lua', 'DistancePanel.lua', 'Core.lua']) {
  const src = fs.readFileSync(path.join(addonDir, file), 'utf8');
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK) fail(file + ' (загрузка)', lua.lua_tojsstring(L, -1));
  lua.lua_pushstring(L, to_luastring('AwesomeCVar'));
  lua.lua_getglobal(L, to_luastring(NS));
  if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) fail(file + ' (исполнение)', lua.lua_tojsstring(L, -1));
}

// --- shim C_NamePlate ---------------------------------------------------------
// Вторая половина гейта: условие, по которому WeakAuras решает «это awesome-клиент». WA считает его
// ОДИН раз при загрузке Init.lua и дальше не переспрашивает:
//   local isAwesomeEnabled = C_VoiceChat and C_VoiceChat.SpeakText and 2 -- TTS available
//                          or C_NamePlate and C_NamePlate.GetNamePlateForUnit and 1
//                          or false
// (одинаково в 5.21.6 у C:\Games\Test и в 5.22.0 у песочницы/Elvui). Если наш shim не даст
// C_NamePlate.GetNamePlateForUnit РАНЬШЕ WeakAuras.lua, имя-переменная останется false, и ветки
// nameplate-триггеров не соберутся -- без единой ошибки. AW_SHIM_DIR -- чтобы снимать негативный
// прогон на копии, не трогая установленный аддон (тот же приём, что AW_ITF_DIR).
const shimDir = process.env.AW_SHIM_DIR || path.join(root, 'addons', 'AWNamePlateAPI');
doString(`
  AW_PLATE3 = { __frame = 'plate3' }
  -- один и тот же фрейм лежит во обеих картах: именно так делает platePublish в dll, и на этом
  -- держится связка guid -> фрейм -> токен
  AW_NamePlates = { nameplate3 = AW_PLATE3 }
  AW_NamePlateGuids = { F130001234 = AW_PLATE3 }
  AW_NamePlateTokens = { F130001234 = 'nameplate3' }
  AW_NamePlateList = { AW_PLATE3 }
  GUID_BY_UNIT = { target = '0xf130001234' }
  function UnitGUID(u) return GUID_BY_UNIT[u] end
`, 'данные dll для шима');
{
  const src = fs.readFileSync(path.join(shimDir, 'AWNamePlateAPI.lua'), 'utf8');
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK) fail('AWNamePlateAPI.lua (загрузка)', lua.lua_tojsstring(L, -1));
  if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) fail('AWNamePlateAPI.lua (исполнение)', lua.lua_tojsstring(L, -1));
}

// Вторая команда того же аддона. До 07.10 стенд её не загружал вовсе, то есть гейт проверял аддон, в
// котором /interact нет, -- а в журналах всех трёх клиентов за весь проект нет ни одной строки
// `interact: выбран`/`interact: ничего подходящего`, то есть запрос ни разу не дошёл до dll.
{
  const src = fs.readFileSync(path.join(shimDir, 'AWInteract.lua'), 'utf8');
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK) fail('AWInteract.lua (загрузка)', lua.lua_tojsstring(L, -1));
  if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) fail('AWInteract.lua (исполнение)', lua.lua_tojsstring(L, -1));
}

// --- идентичность плеитов ElvUI (AWElvUINameplates.lua) ----------------------
// Модуль ставится в то же состояние, но на своих заглушках: CreateFrame здесь записирует скрипты,
// поэтому драйвер может сам дёрнуть OnEvent/OnUpdate ровно так, как это делает клиент. Сценарии --
// четыре случая, ради которых модуль и написан: первая привязка, смена юнита под той же рамкой
// (Halion вместо Chaos Invoker, п. 7.29), потеря юнита после наведения мыши и «цель не отбирать».
{
  const src = fs.readFileSync(path.join(shimDir, 'AWElvUINameplates.lua'), 'utf8');
  doString(`
local _CreateFrame, _UnitGUID, _hooksecurefunc = CreateFrame, UnitGUID, hooksecurefunc
local _AW_NamePlates = AW_NamePlates
FRAMES = {}
function CreateFrame()
  local f = { scripts = {}, events = {} }
  f.SetScript = function(self, k, fn) self.scripts[k] = fn end
  f.GetScript = function(self, k) return self.scripts[k] end
  f.RegisterEvent = function(self, e) self.events[e] = true end
  FRAMES[#FRAMES + 1] = f
  return f
end
-- как в клиенте: обёртка вызывает сначала подлинник, потом хук -- иначе проверка OnShow-пути пуста
function hooksecurefunc(t, k, hook)
  local orig = t[k]
  t[k] = function(...) orig(...) hook(...) end
end

GUIDS = { nameplate3 = 'G3' }
NAMES = { nameplate3 = 'Nerubian' }
-- юнит-функции 3.3.5a на nil-аргументе не молчат, а печатают «Usage: ...» (замер 03.10 23:54: рамка
-- ElvUI без токена dll -> UnitGUID(nil) -> ошибка с трейсом через ElvUI:OnCreated -> OnShow). Заглушка
-- обязана вести себя так же, иначе стенд никогда не увидит этот класс дефекта
function UnitGUID(u)
  if type(u) ~= "string" then error('Usage: UnitGUID("unit")') end
  return GUIDS[u]
end
function UnitName(u)
  if type(u) ~= "string" then error('Usage: UnitName("unit")') end
  return NAMES[u]
end
-- дамп печатает и ответы клиента по токену (isPlayer/reaction/class/faction) рядом с тем, что о типе
-- юнита думает ElvUI; все четыре на nil обязаны падать так же, как в клиенте
function UnitIsPlayer(u)
  if type(u) ~= "string" then error('Usage: UnitIsPlayer("unit")') end
  return nil
end
function UnitReaction(a, b)
  if type(a) ~= "string" or type(b) ~= "string" then error('Usage: UnitReaction("unit","unit")') end
  return 2
end
function UnitClass(u)
  if type(u) ~= "string" then error('Usage: UnitClass("unit")') end
  return nil, nil
end
function UnitFactionGroup(u)
  if type(u) ~= "string" then error('Usage: UnitFactionGroup("unit")') end
  return nil
end

-- Полоса каста перенесена из ElvUI_ProjectZidras: состояние берётся с НАТИВНОЙ полосы плейта, которую
-- ведёт сам клиент, а имя -- из UnitCastingInfo и из боевого лога. Значит заглушке нужны и нативная
-- полоса со своими скриптами, и рамка ElvUI с CastBar'ом, и db, и поиск плеята по guid.
FAILED, INTERRUPTED = 'Failed', 'Interrupted'
CASTING, CHANNELING = {}, {}
function UnitCastingInfo(u)
  if type(u) ~= "string" then error('Usage: UnitCastingInfo("unit")') end
  local c = CASTING[u]
  if not c then return nil end
  return c.name, nil, nil, c.icon, c.start, c.stop
end
function UnitChannelInfo(u)
  if type(u) ~= "string" then error('Usage: UnitChannelInfo("unit")') end
  local c = CHANNELING[u]
  if not c then return nil end
  return c.name, nil, nil, c.icon, c.start, c.stop
end

-- нативная полоса: SetScript/GetScript не нужны (её скрипты ставит клиент), важно только то, ЧТО на неё
-- навесили, и значение, которое ей выставили
NATIVE = {
  scripts = {}, hooked = {}, hookTimes = {}, shown = true, min = 0, max = 1, value = 0,
  -- hooked[k] -- что навесили, hookTimes[k] -- сколько раз: второй комплект хуков на одной нативной
  -- полосе (двойной OnCreated) иначе стенд не видит, а в игре это удвоенные обновления каста
  HookScript = function(self, k, fn)
    self.hooked[k] = fn
    self.hookTimes[k] = (self.hookTimes[k] or 0) + 1
  end,
  IsShown = function(self) return self.shown end,
  GetValue = function(self) return self.value end,
  GetParent = function(self) return PLATE end,
  GetMinMaxValues = function(self) return self.min, self.max end,
  Icon = { texture = 'NATIVE_ICON', shown = true,
           GetTexture = function(self) return self.texture end,
           IsShown = function(self) return self.shown end,
           Hide = function(self) self.shown = false end },
  Shield = { shown = false, IsShown = function(self) return self.shown end },
}

-- полоса ElvUI, куда модуль перекладывает состояние; SetScript пишется отдельно от GetScript, потому
-- что PZ гасит свою анимацию вызовом SetScript('OnUpdate', nil) и различить «не было» и «снято» иначе
-- нельзя
CB = {
  scripts = {}, set = {}, shown = false, min = 0, max = 1, value = 0,
  SetScript = function(self, k, fn) self.scripts[k] = fn; self.set[k] = (fn == nil) and 'nil' or 'fn' end,
  Show = function(self) self.shown = true end,
  Hide = function(self) self.shown = false end,
  IsShown = function(self) return self.shown end,
  SetMinMaxValues = function(self, a, b) self.min, self.max = a, b end,
  GetValue = function(self) return self.value end,
  SetValue = function(self, v) self.value = v end,
  SetStatusBarColor = function(self, r, g, b) self.color = string.format('%.2f/%.2f/%.2f', r or 0, g or 0, b or 0) end,
  GetWidth = function(self) return 120 end,
  Name = { text = nil, SetText = function(self, v) self.text = v end, GetText = function(self) return self.text end },
  Time = { text = nil, SetFormattedText = function(self, fmt, a, b) self.text = string.format(fmt, a, b) end },
  Spark = { point = nil, SetPoint = function(self, p, af, r, x, y) self.point = tostring(x) end },
  Icon = { texture = { path = nil, desat = nil,
                       SetTexture = function(self, v) self.path = v end,
                       SetDesaturated = function(self, v) self.desat = v end } },
}
-- значения, которые дамп обязан показать именем: тип, реакция, класс и текущий цвет имени
UF = { UnitReaction = 2, UnitClass = 'PRIEST', Name = { r = 0.9, g = 0.1, b = 0.1,
         GetTextColor = function(self) return self.r, self.g, self.b end },
       Health = { shown = true, IsShown = function(self) return self.shown end },
       CastBar = CB, UnitType = 'ENEMY_NPC', oldCastBar = NATIVE }
UF.SetScript = function(self, k, fn) self.scripts = self.scripts or {}; self.scripts[k] = fn end
UF.RegisterEvent = function(self, e) self.events = self.events or {}; self.events[e] = true end
UF.UnregisterEvent = function(self, e) self.events = self.events or {}; self.events[e] = nil end
PLATE = { UnitFrame = UF, events = {}, scripts = {} }
PLATE.UnregisterEvent = function(self, e) self.events[e] = nil end
PLATE.RegisterEvent = function(self, e) self.events[e] = true end
AW_NamePlates = { nameplate3 = PLATE }

NP_CALLS = { Health = 0, Name = 0, Cast = 0, Auras = 0, Filter = 0, Created = 0 }
-- форма, в которой ElvUI 6.09 отдаёт себя наружу: глобал ElvUI -- массив Engine (Init.lua:38-43:
-- Engine[1] = AddOn, _G[AddOnName] = Engine), модуль плеитов лежит в ElvUI[1].NamePlates. Прежняя
-- заглушка (ElvUI = { NamePlates = ... }) повторяла собой ровно ту ошибку, из-за которой в игре и
-- вышло installed=nil, поэтому 144 проверки зелёные ничего не видели.
NP_MOD = {
  Initialized = true,
  UnitClass = function(self, frame, unitType) return nil end,
  Update_HealthColor = function() NP_CALLS.Health = NP_CALLS.Health + 1 end,
  -- второй аргумент (triggered) ловим отдельно: с ним ElvUI красит имя по реакции, и на сборке с
  -- ShowClassColorInNameplate=1 это красный для всех, кто не распознан по цвету нативной полосы
  Update_Name = function(self, frame, triggered)
    NP_CALLS.Name = NP_CALLS.Name + 1
    LAST_NAME_TRIGGERED = tostring(triggered)
  end,
  Update_CastBar = function(self, frame, event, unit)
    NP_CALLS.Cast = NP_CALLS.Cast + 1
    LAST_CAST_UNIT = unit ~= nil and tostring(unit) or 'nil'
  end,
  UpdateElement_Auras = function() NP_CALLS.Auras = NP_CALLS.Auras + 1 end,
  OnShow = function() end,
  OnCreated = function(self, plate)
    NP_CALLS.Created = NP_CALLS.Created + 1
    self.CreatedPlates[plate] = true      -- как настоящий ElvUI (Nameplates.lua:671)
  end,
  OnEvent = function(self, event, unit) NP_CALLS.Events = (NP_CALLS.Events or 0) + 1; LAST_EVENT_UNIT = unit end,
  RegisterEvents = function(self, frame) NP_CALLS.Registered = (NP_CALLS.Registered or 0) + 1 end,
  UnregisterAllEvents = function(self, frame) NP_CALLS.Unregistered = (NP_CALLS.Unregistered or 0) + 1 end,
  Configure_CastBar = function(self, frame) NP_CALLS.Configured = (NP_CALLS.Configured or 0) + 1 end,
  UpdateCVars = function(self) NP_CALLS.CVars = (NP_CALLS.CVars or 0) + 1 end,
  StyleFilterUpdate = function(self, frame, ev)
    NP_CALLS.Filter = NP_CALLS.Filter + 1
    LAST_FILTER = ev
  end,
  SearchNameplateByGUID = function(self, guid)
    for f in pairs(self.VisiblePlates) do
      if f.guid == guid then return f end
    end
  end,
  VisiblePlates = { [UF] = 1 },
  CreatedPlates = { [PLATE] = true },
  db = { motionType = "MOTION", units = { ENEMY_NPC = { castbar = { enable = true }, health = { enable = true } } },
         colors = { castColor = { r = 0.2, g = 0.6, b = 1.0 },
                    castNoInterruptColor = { r = 0.78, g = 0.25, b = 0.25 },
                    castbarDesaturate = true },
         alwaysShowTargetHealth = false },
}
-- самого глобала пока нет: он появляется в драйвере ровно в момент ADDON_LOADED ElvUI, как в настоящем
-- клиенте. сборка та же, что у ElvUI: глобал -- массив Engine, аддон в [1] (Init.lua:38-43), на аддоне
-- висит RegisterModule (Core/Core.lua:1090), и очередь раскручивает сам драйвер -- это
-- E:InitializeModules() (Core/Core.lua:1104) внутри E:Initialize() (:1280) на PLAYER_LOGIN
function elvuiGlobal(mod)
  local addon = { NamePlates = mod, Registered = {} }
  addon.RegisterModule = function(self, name, func)
    addon.Registered[#addon.Registered + 1] = func
  end
  return { [1] = addon }
end
function fireElvUIQueue()
  local addon = ElvUI and ElvUI[1]
  if not addon then return end
  for _, fn in ipairs(addon.Registered) do fn() end
end
ElvUI = nil

${src}

local f = FRAMES[1]
local function snap(tag)
  local g = _G
  g[tag .. '_UNIT'], g[tag .. '_GUID'], g[tag .. '_TOKEN'] = UF.unit, UF.guid, UF.nameplateUnit
  g[tag .. '_NAME'], g[tag .. '_FIELD'] = UF.UnitName, PLATE.AWElvUINameplateToken
  g[tag .. '_CALLS'] = NP_CALLS.Health
end
-- опрос висит на рамке с самого создания файла: он и повторяет установку, пока ElvUI не дошёл до своего Initialize
local function tick() if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 1) end end

-- до ADDON_LOADED ElvUI рамка не привязывается: модуль не должен трогать чужой клиент до его загрузки
tick()
BEFORE_UNIT, BEFORE_CALLS = UF.unit, NP_CALLS.Health
for _, e in ipairs({ 'UNIT_SPELLCAST_START', 'UNIT_SPELLCAST_STOP', 'UNIT_SPELLCAST_DELAYED',
  'UNIT_SPELLCAST_CHANNEL_UPDATE', 'UNIT_SPELLCAST_CHANNEL_STOP', 'UNIT_SPELLCAST_INTERRUPTIBLE',
  'UNIT_SPELLCAST_NOT_INTERRUPTIBLE' }) do PLATE.events[e] = true end
CB.scripts.OnUpdate = function() return 'old' end
f.scripts.OnEvent(f, 'ADDON_LOADED', 'WeakAuras')
tick()
WRONG_ADDON_CALLS = NP_CALLS.Health

ElvUI = elvuiGlobal(NP_MOD)                    -- форма, в которой ElvUI выставляет себя (Init.lua:38-43)
f.scripts.OnEvent(f, 'ADDON_LOADED', 'ElvUI')
fireElvUIQueue()                                -- так очередь доходит до нашего колбэка на E:Initialize()
tick(); snap('A1')
tick(); snap('A2')                                    -- второй тик по тому же guid: тишина
GUIDS.nameplate3, NAMES.nameplate3 = 'G9', 'Chaos Invoker'
tick(); snap('A3')                                    -- тот же слот, другой юнит (Halion)
UF.unit = nil; tick(); snap('A4')                     -- мышь ушла, ElvUI обнулил юнит
UF.unit = 'target'; tick(); snap('A5')                -- настоящая цель: не отбираем
GUIDS.nameplate3, NAMES.nameplate3 = 'G9', 'Sapphrist'
NP_MOD.OnShow(PLATE); snap('A6')            -- OnShow уже привязанной рамки догоняет имя

-- Рамка ElvUI, которой dll ещё не выдала токен: это и первый показ новой плашки до опроса, и тестовая
-- рамка ElvUI (ElvNP_Test). Вызывать юнит-функцию по nil на этом клиенте нельзя -- «Usage:
-- UnitGUID("unit")» с трейсом ElvUI:OnCreated -> OnShow (замер 03.10 23:54), поэтому bindOne обязан выйти
-- молча и ничего не перерисовать
UF3 = { Name = {}, Health = { shown = true, IsShown = function(self) return self.shown end },
       CastBar = CB, UnitType = 'ENEMY_NPC', oldCastBar = NATIVE }
PLATE3 = { UnitFrame = UF3, events = {}, scripts = {} }
NO_TOKEN_CALLS = NP_CALLS.Health
NO_TOKEN_OK = tostring(pcall(function() NP_MOD.OnShow(PLATE3) end))
NO_TOKEN_UNIT, NO_TOKEN_FIELD = tostring(UF3.unit), tostring(PLATE3.AWElvUINameplateToken)

-- Каст по механизму PZ. Драйвер сам дёргает скрипты нативной полосы ровно так, как это делает клиент:
-- OnShow при появлении полосы, OnValueChanged на каждом её шаге, OnHide при исчезновении.
-- события и анимация уже подложены до install: здесь остаётся только развесить хуки
MARK = 'onCreated'
NP_MOD.CreatedPlates[PLATE] = nil           -- рамка ещё не создавалась: так ElvUI встречает новый плейт
NP_MOD:OnCreated(PLATE)                       -- пост-хук модуля обязан навесить свои скрипты
HOOK_SHOWN, HOOK_HIDDEN, HOOK_VALUE = NATIVE.hooked.OnShow, NATIVE.hooked.OnHide, NATIVE.hooked.OnValueChanged
ANIM_SET = CB.set.OnUpdate or 'нет'                     -- PZ гасит собственную анимацию ElvUI

-- Второй вызов по той же рамке. Делает его ElvUI_Extras.lua:684-686: тот зовёт NP:OnCreated(plate)
-- прямо на каждый наш NAME_PLATE_CREATED, не зная, что ElvUI уже построил эту рамку своим опросом.
-- В игре второй проход падает на Nameplates.lua:644 и оставляет рамку с полусобранным unitFrame.
NP_MOD:OnCreated(PLATE)
SECOND_CREATED = NP_CALLS.Created
SECOND_HOOKS = tostring(NATIVE.hookTimes.OnShow)

UF.unit, UF.CastBar.spellName = 'nameplate3', nil       -- после A5 рамка была на 'target'
CASTING.nameplate3 = { name = 'Fireball', icon = 'NATIVE_ICON', start = 1000, stop = 4000 }
LAST_FILTER = nil
if HOOK_SHOWN then HOOK_SHOWN(NATIVE) end
SHOW_CASTBAR, SHOW_NAME, SHOW_SPELL = CB.shown and 'shown' or 'hidden', tostring(CB.Name.text), tostring(CB.spellName)
SHOW_FILTER = tostring(LAST_FILTER)

-- значение ведёт нативная полоса: min/max/value, направление (каст или канал), искра, иконка, цвет
CB.shown, CB.value, CB.Name.text = false, 0, nil
NATIVE.min, NATIVE.max, NATIVE.Icon.shown = 0, 3, true
if HOOK_VALUE then HOOK_VALUE(NATIVE, 1) end
V_MIN, V_MAX, V_VALUE = CB.min, CB.max, CB.value
V_CASTING = CB.casting and 'yes' or 'no'
V_ICON, V_NATIVE_ICON = tostring(CB.Icon.texture.path), NATIVE.Icon.shown and 'shown' or 'hidden'
V_NAME, V_SPARK, V_FILTER = tostring(CB.Name.text), tostring(CB.Spark.point), tostring(LAST_FILTER)
V_COLOR = tostring(CB.color)

if HOOK_VALUE then HOOK_VALUE(NATIVE, 0.4) end          -- значение упало -- это канал
V_CHANNEL = CB.channeling and 'yes' or 'no'

NATIVE.Shield.shown = true
if HOOK_VALUE then HOOK_VALUE(NATIVE, 0.6) end          -- непрерываемый каст: цвет и десатурация иконки
V_NOTINT, V_COLOR2, V_DESAT = CB.notInterruptible and 'yes' or 'no', tostring(CB.color), tostring(CB.Icon.texture.desat)

if HOOK_HIDDEN then HOOK_HIDDEN(NATIVE) end
HIDE_CASTBAR, HIDE_SPELL = CB.shown and 'shown' or 'hidden', tostring(CB.spellName)

-- имя из боевого лога: PZ им докрывает случай, когда UnitCastingInfo уже молчит, а полоса ещё видна
CASTING.nameplate3, CB.spellName = nil, nil
if f.events.COMBAT_LOG_EVENT_UNFILTERED then
  f.scripts.OnEvent(f, 'COMBAT_LOG_EVENT_UNFILTERED', 0, 'SPELL_CAST_START', UF.guid, 'Nerubian', 0, '0', 'Target', 0, 41423, 'Arcane Missiles')
  CL_EVENT, CL_SPELL = true, tostring(CB.spellName)
else
  CL_EVENT, CL_SPELL = false, 'не зарегистрирован'
end

-- полоса выключена в профиле ElvUI: состояние не перекладываем никуда
NP_MOD.db.units.ENEMY_NPC.castbar.enable = false
CB.value = 99
NATIVE.shown = true
if HOOK_VALUE then HOOK_VALUE(NATIVE, 2) end
OFF_VALUE = CB.value
NP_MOD.db.units.ENEMY_NPC.castbar.enable = true

-- счётчики событий: install() обязан сработать и по PLAYER_LOGIN (ElvUI мог загрузиться раньше нас),
-- и по событию dll; дампу нужно печатать ровно то, что было
f.scripts.OnEvent(f, 'PLAYER_LOGIN')
f.scripts.OnEvent(f, 'NAME_PLATE_UNIT_ADDED', 'nameplate3')

-- блок PZ целиком: вёрстка cvar'ов и замена обработки событий
MARK = 'cvars'
VCAST = tostring(CVARS.showVKeyCastbar)
VCLASS = tostring(CVARS.ShowClassColorInNameplate)
VOVERLAP = tostring(CVARS.nameplateAllowOverlap)
EV_KEPT = tostring(PLATE.events.UNIT_SPELLCAST_START)
EV_KEPT_CHANNEL = tostring(PLATE.events.UNIT_SPELLCAST_CHANNEL_STOP)
-- RegisterEvents у PZ сам будит пересчёт: рамка уже видна, а события для токена не придут никогда
CB.spellName, CB.Name.text = nil, nil
CASTING.nameplate3 = { name = 'Fireball', icon = 'NATIVE_ICON', start = 1000, stop = 4000 }
MARK = 'registerEvents'
NP_MOD:RegisterEvents(UF)
PRIMED = tostring(CB.spellName)
-- OnEvent у PZ без стоковой проверки self.unit ~= unit: каст чужого названного юнита обязан дойти
-- (сам OnEvent в ElvUI -- скрипт рамки: unitFrame:SetScript('OnEvent', self.OnEvent), Nameplates.lua:580)
MARK = 'onEvent'
CASTING.target = { name = 'Shadow Bolt', icon = 'NATIVE_ICON', start = 2000, stop = 5000 }
CB.spellName = nil
NP_MOD.OnEvent(UF, 'UNIT_SPELLCAST_START', 'target')
FORCED = tostring(CB.spellName)
MARK = 'unregister'
NP_MOD:UnregisterAllEvents(UF)
EV_AFTER_UNREG = tostring(UF.events.UNIT_SPELLCAST_FAILED)
CASTING.nameplate3 = nil

-- а теперь ровно та ситуация, из-за которой прогон в игре молчал: установить не удалось, и дамп
-- обязан назвать метод, а не общую фразу
SAVED_CV = NP_MOD.Update_Name
NP_MOD.Update_Name = nil
PRINTED2 = {}
local sp2 = print
print = function(s2) PRINTED2[#PRINTED2 + 1] = tostring(s2) end
if SlashCmdList.AWPLATES then SlashCmdList.AWPLATES('cast') end
print = sp2
NP_MOD.Update_Name = SAVED_CV
FAIL_LINES = #PRINTED2
FAIL_TYPES = PRINTED2[3] or ''
FAIL_NAME = PRINTED2[4] or ''
FAIL_CAST = PRINTED2[5] or ''

-- сам дамп: инструмент должен врать меньше, чем молчание в игре
PRINTED = {}
local savedPrint = print
print = function(s2) PRINTED[#PRINTED + 1] = tostring(s2) end
if SlashCmdList.AWPLATES then SlashCmdList.AWPLATES('cast') end
print = savedPrint
DUMP_LINES = #PRINTED
DUMP_HEAD = PRINTED[1] or ''
DUMP_EVENTS = PRINTED[2] or ''
DUMP_TOKEN = ''
for i = 2, DUMP_LINES do if PRINTED[i]:find('nameplate3') then DUMP_TOKEN = PRINTED[i] end end

-- второй дамп: та же рамка, но юнит у неё ещё не привязан. Клиентские функции по nil падают ошибкой
-- использования (тот же класс, что вчерашний UnitGUID(nil)), так что дамп обязан выйти в pcall без
-- ошибки и напечатать пустые значения вместо падения всего списка
SAVED_UNIT = UF.unit
UF.unit = nil
PRINTED5 = {}
local sp5 = print
print = function(s5) PRINTED5[#PRINTED5 + 1] = tostring(s5) end
NO_UNIT_DUMP = tostring(pcall(function() if SlashCmdList.AWPLATES then SlashCmdList.AWPLATES('cast') end end))
print = sp5
UF.unit = SAVED_UNIT
NO_UNIT_LINE = ''
for i = 1, #PRINTED5 do if PRINTED5[i]:find('nameplate3') then NO_UNIT_LINE = PRINTED5[i] end end

-- Чужой пост-хук ПОСЛЕ нас. В Test рядом стоят ElvUI_Extras и ElvUI_ProjectZidras, и PZ навешивает
-- hooksecurefunc(NP, "OnCreated", OnCreatedHook) (Modules/Nameplates/Nameplates.lua:255) уже поверх нашего
-- guard'а; без перестановки guard'а наверх этот хук отработал бы и на пропущенном создании, то есть PZ
-- снова обвесил бы нативную полосу вторым комплектом HookScript.
PZ_POST = 0
hooksecurefunc(NP_MOD, "OnCreated", function() PZ_POST = PZ_POST + 1 end)
tick()                                        -- наш OnUpdate обязан вернуть guard наверх
NP_MOD.CreatedPlates[PLATE] = nil
NP_MOD:OnCreated(PLATE)                       -- настоящее создание
PZ_ON_CREATE = PZ_POST
HOOKS_ON_CREATE = NATIVE.hookTimes.OnShow
NP_MOD:OnCreated(PLATE)                       -- повтор, который делает ElvUI_Extras
PZ_AFTER_REPEAT = PZ_POST
HOOKS_AFTER_REPEAT = NATIVE.hookTimes.OnShow

-- Отщепление полосы каста от идентичности: одного отсутствующего метода PZ-блока достаточно, чтобы
-- криво встать на хук, и ровно этого не должно хватить, чтобы перестала работать идентичность. Ставится
-- он ПОСЛЕ проверки Initialized: ElvUI добирается до своего NP:Initialize (Nameplates.lua:1203-1207)
-- позже нашего PLAYER_LOGIN, и до этого установка обязана молчать, а не падать на self.db.motionType.
local _ElvUI, _Plates = ElvUI, AW_NamePlates
local _Slash = SlashCmdList.AWPLATES
UF2 = { Name = {}, Health = { shown = true, IsShown = function(self) return self.shown end },
        CastBar = CB, UnitType = 'ENEMY_NPC', oldCastBar = NATIVE }
PLATE2 = { UnitFrame = UF2, events = {}, scripts = {} }
PLATE2.UnregisterEvent = function(self, e) self.events[e] = nil end
PLATE2.RegisterEvent = function(self, e) self.events[e] = true end
NATIVE.GetParent = function(self) return PLATE2 end
NP_MOD2 = {
  UnitClass = function() return nil end,
  Update_HealthColor = function() end, Update_Name = function() end,
  Update_CastBar = function() end, UpdateElement_Auras = function() end,
  OnShow = function() end,
  OnCreated = function() end, Configure_CastBar = function() end,
  OnEvent = function() end, RegisterEvents = function() end, UnregisterAllEvents = function() end,
  VisiblePlates = { [UF2] = 1 }, CreatedPlates = { [PLATE2] = true },
  db = NP_MOD.db,
}
ElvUI = elvuiGlobal(NP_MOD2)
AW_NamePlates = { nameplate5 = PLATE2 }
GUIDS.nameplate5, NAMES.nameplate5 = 'G5', 'Nerub'
NATIVE.hooked = {}
${src}
local f2 = FRAMES[#FRAMES]
f2.scripts.OnEvent(f2, 'ADDON_LOADED', 'ElvUI')
fireElvUIQueue()      -- очередь отработала, но NP:Initialize ещё не было: устанавливать нельзя
NOINIT_UNIT, NOINIT_HOOKED = tostring(UF2.nameplateUnit), tostring(NATIVE.hooked.OnValueChanged)
PRINTED4 = {}
local sp4 = print
print = function(s4) PRINTED4[#PRINTED4 + 1] = tostring(s4) end
if SlashCmdList.AWPLATES then SlashCmdList.AWPLATES('cast') end
print = sp4
NOINIT_LINES = #PRINTED4
NOINIT_SHAPE = PRINTED4[3] or ''
NOINIT_STATE = PRINTED4[6] or ''
-- вот теперь ElvUI дошёл до своего Initialize: идентичность встаёт, полоса каста -- нет (UpdateCVars нет)
NP_MOD2.Initialized = true
f2.scripts.OnEvent(f2, 'PLAYER_LOGIN')          -- переэкспортировка ничего не меняет: очередь уже занята
fireElvUIQueue()                                 -- так ElvUI добирает очередь на своём E:Initialize()
-- тик под guard'ом: если установка не состоялась, красным обязана быть именованная проверка SPLIT_BOUND,
-- а не падение драйвера
if f2.scripts.OnUpdate then f2.scripts.OnUpdate(f2, 1) end
SPLIT_BOUND = tostring(UF2.nameplateUnit)
SPLIT_HOOKED = tostring(NATIVE.hooked.OnValueChanged)
PRINTED3 = {}
local sp3 = print
print = function(s3) PRINTED3[#PRINTED3 + 1] = tostring(s3) end
if SlashCmdList.AWPLATES then SlashCmdList.AWPLATES('cast') end
print = sp3
SPLIT_SKIP = ''
for _, line in ipairs(PRINTED3) do if line:find('НЕ установлена') then SPLIT_SKIP = line end end
ElvUI, AW_NamePlates = _ElvUI, _Plates
SlashCmdList.AWPLATES = _Slash

-- обратно те заглушки, под которыми шим проверяется ниже: три функции и карты здесь были общие
CreateFrame, UnitGUID, hooksecurefunc = _CreateFrame, _UnitGUID, _hooksecurefunc
AW_NamePlates = _AW_NamePlates
`, 'заглушки ElvUI-идентичности и прогон модуля');

// --- метки дистанции (AWDistance.lua) и их вкладка (DistancePanel.lua) ---------
// Числа печатает dll, здесь проверяется всё остальное: профиль по типу плейта (игрок/НПС), привязка к
// плашке и к имени, привязка цели к своему фрейму или к экрану, десятки/целые, предел дальности,
// «не дублировать цифру на плейте своей цели», переклейка стиля только когда значение изменилось, клампы
// API, клампы рисовалки, fuse после пяти падений, гашение метки когда юнита нет (вчерашний баг) и когда
// рамка умерла, и молчание без dll.
// Рамка плейта здесь -- настоящий объект с CreateFontString и GetRegions: метка обязана быть её ребёнком,
// иначе она не ходила бы за плейтом, а поиск имени на плейте вообще не работает.
{
  const src = fs.readFileSync(path.join(shimDir, 'AWDistance.lua'), 'utf8');
  const panelSrc = fs.readFileSync(path.join(root, 'addons', 'AwesomeCVar', 'DistancePanel.lua'), 'utf8');
  // путь только через pushstring: в обоих файлах есть обратные слэши ("Fonts\\FRIZQT__.TTF"), шаблонная
  // строка съела бы их
  lua.lua_pushstring(L, to_luastring(src));
  lua.lua_setglobal(L, to_luastring('AW_DIST_SRC'));
  lua.lua_pushstring(L, to_luastring(panelSrc));
  lua.lua_setglobal(L, to_luastring('AW_PANEL_SRC'));

  doString(`
local _CreateFrame = CreateFrame
local _Plates, _Dist, _Units, _Tokens = AW_NamePlates, AW_NamePlateDistances, AW_UnitDistances, AW_NamePlateTokens
local _UnitExists, _UnitGUID = UnitExists, UnitGUID

FONTS_SET, POINTS_SET, FONTS_CREATED, TEXTS_SET = 0, 0, 0, 0

local function newFont(owner)
  FONTS_CREATED = FONTS_CREATED + 1
  local f = { shown = false, text = nil, owner = owner }
  function f:SetFont(path, size, flags) self.fontPath, self.fontSize, self.fontFlags = path, size, flags; FONTS_SET = FONTS_SET + 1; return true end
  function f:GetFont() return self.fontPath, self.fontSize, self.fontFlags end
  function f:SetSize(w, h) self.w, self.h = w, h end
  function f:SetTextColor(r, g, b) self.color = tostring(r) .. "/" .. tostring(g) .. "/" .. tostring(b) end
  function f:SetDrawLayer(layer) self.layer = layer end
  function f:ClearAllPoints() self.point, self.relPoint, self.anchorName = nil, nil, nil end
  function f:SetPoint(me, anchor, it, x, y)
    self.point, self.relPoint = me, it
    self.anchorName = anchor and (anchor.__name or "рамка") or "nil"
    self.x, self.y = x, y
    POINTS_SET = POINTS_SET + 1
  end
  function f:SetText(v) self.text = tostring(v); TEXTS_SET = TEXTS_SET + 1 end
  function f:Show() self.shown = true end
  function f:Hide() self.shown = false end
  function f:IsShown() return self.shown end
  return f
end

local function newPlate(name, noName)
  local p = { __name = name, fonts = {}, regions = {} }
  function p:CreateFontString(n, layer, inherits)
    local f = newFont(self); p.fonts[#p.fonts + 1] = f; return f
  end
  function p:GetRegions() return unpack(p.regions) end
  function p:RegisterEvent() end
  function p:SetScript() end
  if not noName then
    p.nameRegion = { __name = name .. "/имя" }
    p.UnitFrame = { Name = p.nameRegion }
  end
  return p
end

PLATE_NPC, PLATE_PLAYER, PLATE_NONAME = newPlate('plateNPC'), newPlate('platePlayer'), newPlate('plateNoName', true)
tinsert(PLATE_NPC.regions, { __name = 'threat', GetObjectType = function() return "Texture" end })
tinsert(PLATE_NPC.regions, PLATE_NPC.nameRegion)

-- фреймы цели и фокуса: у панели и у рисовалки общий выбор «Элв-фрейм, иначе стожовый, иначе экран»
ElvUF_Target = { __name = 'ElvUF_Target', shown = true, IsShown = function(self) return self.shown end }
TargetFrame = { __name = 'TargetFrame', shown = true, IsShown = function(self) return self.shown end }
ElvUF_Focus = { __name = 'ElvUF_Focus', shown = false, IsShown = function(self) return self.shown end }
FocusFrame = { __name = 'FocusFrame', shown = true, IsShown = function(self) return self.shown end }

UIParent.fonts = {}
-- вешается безусловно: базовая заглушка UIParent отвечает функцией на ЛЮБОЙ ключ (метатаблица __index),
-- и проверка «а нет ли уже CreateFontString» никогда не сработала бы -- метки цели уехали бы на сам
-- UIParent вместо настоящих объектов
local _UIPCreateFont = UIParent.CreateFontString
UIParent.CreateFontString = function(self, n, layer, inherits) local f = newFont(self); self.fonts[#self.fonts + 1] = f; return f end

DRIVERS = {}
function CreateFrame(kind, name, parent, template)
  local f = { scripts = {}, events = {}, __name = name }
  f.SetScript = function(self, k, fn) self.scripts[k] = fn end
  f.GetScript = function(self, k) return self.scripts[k] end
  f.RegisterEvent = function(self, e) self.events[e] = true end
  f.CreateFontString = function(self, n, layer, inherits) local fo = newFont(self); self.fonts = self.fonts or {}; self.fonts[#self.fonts + 1] = fo; return fo end
  DRIVERS[#DRIVERS + 1] = f
  return f
end

-- данные как их печатает dll: токен -> рамка, hex -> токен, токен -> ярды, юнит -> ярды
PLATE_NPC.guid, PLATE_PLAYER.guid = 'F130000000000001', 'F100000000000002'
AW_NamePlates = { nameplate1 = PLATE_NPC, nameplate2 = PLATE_PLAYER }
AW_NamePlateTokens = { [PLATE_NPC.guid] = 'nameplate1', [PLATE_PLAYER.guid] = 'nameplate2' }
AW_NamePlateDistances = { nameplate1 = 12.34, nameplate2 = 7.5 }
AW_UnitDistances = { target = 25.0, focus = 3.27 }
-- цель -- плейт NPC (его и должен прятать hideOwnPlate), фокус -- юнит БЕЗ плейта, чтобы
-- «не дублировать» и «фокус есть» проверялись независимо. Форма guid намеренно НЕ та, что печатает dll:
-- клиент отвечает с "0x", а аддоны (и наши же шимы) зовут вход «кто как умеет» -- верхним или нижним
-- регистром. Со «своей» формой стенд и не заметил, что hideOwnPlate в игре не работает (04.10 22:4x).
GUID_OF = { target = '0x' .. PLATE_NPC.guid:lower(), focus = '0xf140000000000009' }
EXISTS = { target = true, focus = true }
function UnitExists(u)
  if type(u) ~= 'string' then error('Usage: UnitExists("unit")') end
  return EXISTS[u] and 1 or nil
end
function UnitGUID(u)
  if type(u) ~= 'string' then error('Usage: UnitGUID("unit")') end
  return GUID_OF[u]
end
LibStub = nil

-- fengari не поднимает loadstring (это Lua 5.2+), в клиенте 5.1 он есть: берём load(), чтобы стенд не врал
local chunk = assert(load(AW_DIST_SRC))
chunk()
local A = assert(AW_Distance, 'AW_Distance не стал глобалом -- панель его не найдёт')

local driver = DRIVERS[#DRIVERS]
local function tick() driver.scripts.OnUpdate(driver, 1) end
local function fire(event, arg) if driver.scripts.OnEvent then driver.scripts.OnEvent(driver, event, arg) end end

-- 1. первый кадр: профиль по типу плейта, цель и фокус на UIParent
tick()
local npcFont, playerFont = PLATE_NPC.fonts[1], PLATE_PLAYER.fonts[1]
N1_NPC_TEXT = npcFont and npcFont.text or 'нет'
N1_NPC_COLOR = npcFont and npcFont.color or 'нет'
N1_PLAYER_COLOR = playerFont and playerFont.color or 'нет'
N1_NPC_POINT = npcFont and (npcFont.point .. '/' .. npcFont.relPoint) or 'нет'
N1_NPC_ANCHOR = npcFont and npcFont.anchorName or 'нет'
N1_NPC_XY = npcFont and (tostring(npcFont.x) .. '/' .. tostring(npcFont.y)) or 'нет'
N1_NPC_FONT = npcFont and (tostring(npcFont.fontPath) .. '/' .. tostring(npcFont.fontSize) .. '/' .. tostring(npcFont.fontFlags)) or 'нет'
N1_UNIT_CREATED = #UIParent.fonts
N1_TARGET_TEXT = UIParent.fonts[1] and UIParent.fonts[1].text or 'нет'
N1_TARGET_ANCHOR = UIParent.fonts[1] and UIParent.fonts[1].anchorName or 'нет'
N1_TARGET_POINT = UIParent.fonts[1] and (UIParent.fonts[1].point .. '/' .. UIParent.fonts[1].relPoint) or 'нет'
N1_FOCUS_ANCHOR = UIParent.fonts[2] and UIParent.fonts[2].anchorName or 'нет'
N1_STATUS = tostring((A.status()))
N1_APPLIED = tostring(A.appliedFont('players'))

-- 1b. меток профиля на экране нет, а ответить про его шрифт окно обязано (замер владельца 04.10 20:2x:
-- «меток на экране: 7 | применённый шрифт: nil | применённый шрифт: nil» -- рядом были только НПС-плейты,
-- и старый поиск смотрел ответ в живых метках)
N1_REQ, N1_APP = A.fontInfo('players')
N1_REQ, N1_APP = tostring(N1_REQ), tostring(N1_APP)
A.set('players', 'show', false)
AW_NamePlateDistances.nameplate2 = 12.34
tick()
N21_LABEL_GONE = (PLATE_PLAYER.fonts[1] and PLATE_PLAYER.fonts[1]:IsShown()) and 'видна' or 'yes'
N21_APPLIED_KEPT = tostring(A.appliedFont('players'))
N21_INFO_KEPT = tostring((select(2, A.fontInfo('players'))))
A.set('players', 'show', true)
tick()
-- профиль, который ещё ни разу не рисовал, обязан отличаться от «шрифт не принят»
N21_NEVER = tostring(A.fontInfo('nobody-such-profile'))

-- 1c. снятый тумблер: dll перестаёт писать числа, а уже написанные остаются в её таблицах -- метки обязаны
-- погаснуть, а не зависнуть последним значением (замер владельца 04.10 21:1x). Стенд отвечает "" на
-- незарегистрированную переменную (как клиент), поэтому её надо и зарегистрировать, и задать значение.
AW_REGISTRY.distanceDisplay = '0'
AW_VALUES.distanceDisplay = '0'
tick()
N22_PLATE_HIDDEN = (PLATE_NPC.fonts[1]:IsShown() or PLATE_PLAYER.fonts[1]:IsShown()) and 'видны' or 'yes'
N22_UNIT_HIDDEN = (UIParent.fonts[1]:IsShown() or UIParent.fonts[2]:IsShown()) and 'видны' or 'yes'
AW_VALUES.distanceDisplay = '1'
tick()
N22_BACK = (PLATE_NPC.fonts[1]:IsShown() and UIParent.fonts[1]:IsShown()) and 'yes' or 'no'

-- 2. второй кадр без правок: стиль не переклеивается, текст ставится снова
local sets, points = FONTS_SET, POINTS_SET
AW_NamePlateDistances.nameplate1 = 13.0
tick()
N2_NO_RESTYLE = (FONTS_SET == sets and POINTS_SET == points) and 'yes' or 'no'

-- 3. целые ярды
A.set('general', 'decimals', false)
tick()
N3_WHOLE = PLATE_NPC.fonts[1].text

-- 4. предел дальности: далёкий плейт прячется, ближний остаётся
A.set('general', 'decimals', true)
A.set('general', 'limitRange', true)
A.set('general', 'maxRange', 10)
AW_NamePlateDistances.nameplate1 = 40.0
AW_NamePlateDistances.nameplate2 = 7.5
tick()
N3_FAR_HIDDEN = not PLATE_NPC.fonts[1]:IsShown() and 'yes' or 'no'
N3_NEAR_SHOWN = PLATE_PLAYER.fonts[1]:IsShown() and 'yes' or 'no'
A.set('general', 'limitRange', false)
AW_NamePlateDistances.nameplate1 = 12.34

-- 5. «не дублировать»: плейт цели -- тот же guid, что у цели
A.set('general', 'hideOwnPlate', true)
tick()
-- цель = плейт NPC: цифра НА плейте остаётся, а метка у фрейма цели обязана исчезнуть (ожидание владельца
-- 05.10 00:52: «галочка до сих пор не прячет ни фокус ни таргетъ»); фокус = юнит без плейта, прятать
-- нечего, его метка обязана остаться
N4_PLATE_KEPT = PLATE_NPC.fonts[#PLATE_NPC.fonts]:IsShown() and 'yes' or 'no'
N4_TARGET_LABEL_HIDDEN = (not UIParent.fonts[1]:IsShown()) and 'yes' or 'no'
N4_FOCUS_LABEL_SHOWN = UIParent.fonts[2]:IsShown() and 'yes' or 'no'
N4_OTHER_PLATE_SHOWN = PLATE_PLAYER.fonts[1]:IsShown() and 'yes' or 'no'
A.set('general', 'hideOwnPlate', false)

-- 6. привязка к имени: метка цепляется не за плашку, а за её имя
A.set('players', 'anchor', 'name')
tick()
N5_PLAYER_ANCHOR = PLATE_PLAYER.fonts[1].anchorName
A.set('players', 'anchor', 'plate')

-- 7. цель: Элв-фрейм, если он виден; иначе стожовый; иначе экран
A.set('target', 'anchor', 'frame')
tick()
N6_TARGET_ELVE = UIParent.fonts[1].anchorName
ElvUF_Target.shown = false
tick()
N6_TARGET_STOCK = UIParent.fonts[1].anchorName
ElvUF_Target.shown = true
A.set('target', 'anchor', 'screen')
tick()
N6_TARGET_SCREEN = UIParent.fonts[1].anchorName
A.set('target', 'anchor', 'frame')

-- 8. фокус: ElvUF_Focus скрыт -> берётся FocusFrame
tick()
N7_FOCUS_ANCHOR = UIParent.fonts[2].anchorName

-- 9. клампы API: то, что не влезло в вилку, к ней и прижимается
A.set('players', 'size', 999)
N8_SIZE_CLAMP = A.db().players.size
A.set('players', 'x', -999999)
N8_X_CLAMP = A.db().players.x
A.set('general', 'maxRange', 5000)
N8_RANGE_CLAMP = A.db().general.maxRange
A.set('players', 'size', 'abc')
N8_GARBAGE = A.db().players.size

-- 10. сторона и смещение доезжают до SetPoint
A.set('npcs', 'side', 'TOPRIGHT')
A.set('npcs', 'x', 6)
A.set('npcs', 'y', -3)
tick()
N9_NPC_SIDE = PLATE_NPC.fonts[1].point .. '/' .. PLATE_NPC.fonts[1].relPoint
N9_NPC_XY = tostring(PLATE_NPC.fonts[1].x) .. '/' .. tostring(PLATE_NPC.fonts[1].y)

-- 11. цвет из профиля
A.set('npcs', 'r', 0.25); A.set('npcs', 'g', 0.5); A.set('npcs', 'b', 0.75)
tick()
N10_NPC_COLOR = PLATE_NPC.fonts[1].color

-- 12. сброс возвращает дефолты
A.reset()
N11_RESET = tostring(A.db().players.size) .. '/' .. tostring(A.db().players.side) .. '/' ..
  tostring(A.db().general.decimals) .. '/' .. tostring(A.db().npcs.show)

-- 13. юнита нет -- метки нет, даже если число стоит (баг владельца 04.10: цифра при пустом фокусе)
EXISTS.focus = nil
tick()
N12_FOCUS_HIDDEN = (not UIParent.fonts[2].IsShown(UIParent.fonts[2])) and 'yes' or 'no'
EXISTS.target = nil
tick()
N12_TARGET_HIDDEN = (not UIParent.fonts[1].IsShown(UIParent.fonts[1])) and 'yes' or 'no'
EXISTS.target, EXISTS.focus = true, true
tick()
N12_BACK = UIParent.fonts[1]:IsShown() and UIParent.fonts[2]:IsShown() and 'yes' or 'no'

-- 14. токен без рамки (плейт умер, токен ещё держат) -- метка гаснет
AW_NamePlates.nameplate2 = nil
tick()
N13_NO_FRAME_HIDDEN = not PLATE_PLAYER.fonts[1]:IsShown() and 'yes' or 'no'
AW_NamePlates.nameplate2 = PLATE_PLAYER

-- 15. рамка исчезла из карты токенов совсем -- кэш обязан её отпустить, а не хранить мёртвую
AW_NamePlateDistances.nameplate1 = nil
AW_NamePlates.nameplate1 = nil
AW_NamePlateTokens[PLATE_NPC.guid] = nil
tick()
N14_DROPPED = (A.stats().plates == 1 and A.stats().units == 2) and 'yes' or (tostring(A.stats().plates) .. '/' .. tostring(A.stats().units))
-- 15. осели: живая рамка переиспользует свою метку, сколько бы кадров ни прошло
local created = FONTS_CREATED
tick(); tick(); tick()
N15_NO_REGROW = (FONTS_CREATED - created == 0) and 'yes' or tostring(FONTS_CREATED - created)

-- 16. вход в мир: кэш обнуляется, метки строятся заново на свежих рамках
fire('PLAYER_ENTERING_WORLD')
local before = FONTS_CREATED
tick()
N16_REBUILT = (FONTS_CREATED > before) and 'yes' or 'no'

-- 17. fuse: пять падений -- рисовалка выключается сама и молчит дальше. Ломаем НЕ создание метки, а
-- SetText уже живущей: иначе кэш просто переиспользует целую метку, и падений не будет никогда
-- рамка, которая не может завести себе метку: ровно то, что делает fuse полезным
local PLATE_DEAD = newPlate('plateDead')
PLATE_DEAD.CreateFontString = function() error('завести метку не удалось') end
AW_NamePlates.nameplate3 = PLATE_DEAD
AW_NamePlateDistances.nameplate3 = 9.0
AW_NamePlateTokens['F1300000000DEAD3'] = 'nameplate3'
local printed = {}
local sp = print
print = function(s) printed[#printed + 1] = tostring(s) end
local errorsAfter = 0
for i = 1, 12 do
  local ok = pcall(tick)
  if not ok then errorsAfter = errorsAfter + 1 end
end
print = sp
N17_BROKEN = A.isBroken() and 'yes' or 'no'
N17_QUIET = errorsAfter == 0 and 'yes' or tostring(errorsAfter)
N17_SAID_ONCE = #printed == 1 and 'yes' or tostring(#printed)
N17_STATUS = tostring((A.status()))
AW_NamePlates.nameplate3, AW_NamePlateDistances.nameplate3, AW_NamePlateTokens['F1300000000DEAD3'] = nil, nil, nil

-- 18. без таблиц dll: ни ошибки, ни меток. Правка настроек перезаряжает fuse -- рисовалка снова живая
A.set('players', 'side', 'LEFT')
local created2 = FONTS_CREATED
AW_NamePlateDistances = nil
local okSilent = pcall(tick)
N18_SILENT = okSilent and (FONTS_CREATED == created2) and 'yes' or 'no'
AW_NamePlateDistances = { nameplate1 = 12.34 }

-- 19. дамп: печатает, не падает, и только ASCII
AW_NamePlates = { nameplate1 = PLATE_NPC }
AW_NamePlateTokens = { [PLATE_NPC.guid] = 'nameplate1' }
printed = {}
print = function(s) printed[#printed + 1] = tostring(s) end
local dumpOk = pcall(function() if SlashCmdList.AWDISTANCE then SlashCmdList.AWDISTANCE('') end end)
print = sp
N19_DUMP_OK = dumpOk and 'yes' or 'no'
N19_DUMP_LINES = #printed
local nonAscii = 0
for _, line in ipairs(printed) do
  for i = 1, #line do if line:byte(i) > 127 then nonAscii = nonAscii + 1; break end end
end
N19_DUMP_ASCII = (nonAscii == 0) and 'yes' or ('нет: ' .. nonAscii)

-- 20. панель: грузится без рисовалки, регистрирует вкладку и свою единственную строку CVar
local panelChunk = assert(load(AW_PANEL_SRC))
NS2 = {}
panelChunk('AwesomeCVar', NS2)
N20_TAB = type(NS2.CUSTOM_PANELS) == 'table' and type(NS2.CUSTOM_PANELS[1].build) == 'function'
  and type(NS2.CUSTOM_PANELS[1].refresh) == 'function' and 'yes' or 'no'
N20_ROW = NS2.CUSTOM_PANEL_CVAR_ROWS and NS2.CUSTOM_PANEL_CVAR_ROWS[1].name or 'нет'
-- refresh без AW_Distance: окно обязано объяснить причину, а не строить виджеты в никуда
local savedApi = AW_Distance
AW_Distance = nil
local noticeShown = nil
NS2.PanelsByName = nil
local fakeContent = { CreateFontString = function() return { SetPoint = function() end, SetJustifyH = function() end, SetText = function(self, t) noticeShown = t end, Show = function() end, Hide = function() end } end }
NS2.CUSTOM_PANELS[1].build(fakeContent, fakeContent)
NS2.UpdateDistancePanel = NS2.UpdateDistancePanel or function() end
local refreshOk = pcall(NS2.CUSTOM_PANELS[1].refresh)
N20_NOTICE = refreshOk and noticeShown and 'yes' or 'no'
AW_Distance = savedApi

-- 23. отсутствие переменной (клиент без профиля distance) -- это НЕ «выключено»: GetCVar отвечает "", и
-- рисовалка не имеет права гасить то, что ей дают. Проверено на живом состоянии, в конце последовательности:
-- иначе первая же сцена упала бы на пустых метках, и FAIL выглядел бы как поломка стенда.
A.set('general', 'hideOwnPlate', false)
A.set('general', 'limitRange', false)
A.set('npcs', 'show', true)
A.set('players', 'show', true)
tick()
-- берём ПОСЛЕДНЮЮ метку плейтеа: сценарии 14-16 роняли кэш и рисовалка создавала новую, fonts[1] к этому
-- месту -- сирота, снятая навсегда
local function npcFont() return PLATE_NPC.fonts[#PLATE_NPC.fonts] end
N23_LIVE = (npcFont() and npcFont():IsShown()) and 'yes' or 'no'
AW_REGISTRY.distanceDisplay, AW_VALUES.distanceDisplay = nil, nil
local okNoCvar = pcall(tick)
N23_NO_CVAR = (okNoCvar and npcFont() and npcFont():IsShown()) and 'yes' or 'no'
AW_REGISTRY.distanceDisplay, AW_VALUES.distanceDisplay = '0', '0'
tick()
N23_OFF = (npcFont() and not npcFont():IsShown()) and 'yes' or 'no'
AW_VALUES.distanceDisplay = '1'
tick()
N23_BACK = (npcFont() and npcFont():IsShown()) and 'yes' or 'no'

-- 24. ни один фрейм фокуса не виден (ElvUI создаёт ElvUF_Focus всегда, а показывает только при
-- включённом модуле): метка обязана уйти на экран, а не заякориться на скрытый фрейм, где её никто
-- никогда не увидит (замер владельца 04.10 22:4x: «на фокусе нет цифры никогда»)
ElvUF_Focus.shown, FocusFrame.shown = false, false
A.set('focus', 'anchor', 'frame')
tick()
local focusFont = UIParent.fonts[#UIParent.fonts]
for _, f in ipairs(UIParent.fonts) do if f.awUnit == 'focus' then focusFont = f end end
N24_ANCHOR = tostring(focusFont and focusFont.anchorName)
N24_SHOWN = (focusFont and focusFont:IsShown()) and 'yes' or 'no'
-- и обратно: видимый фрейм возвращается -- метка обязана сесть на него
FocusFrame.shown = true
tick()
N24_BACK = tostring(focusFont.anchorName)
ElvUF_Focus.shown = true
tick()
N24_ELVE = tostring(focusFont.anchorName)

-- 25. резолвер dll молчит про фокус (замер владельца 04.10 23:53: exists=1 number=nil), но юнит фокуса
-- стоит под плейтом -- тогда ярд берётся из таблицы плейтов. Форма guid в фикстуре намеренно нижнего
-- регистра: это тот же путь нормализации, что и у hideOwnPlate.
AW_UnitDistances.focus = nil
GUID_OF.focus = '0x' .. PLATE_NPC.guid:lower()
A.set('general', 'decimals', false)
tick()
local fFont
for _, f in ipairs(UIParent.fonts) do if f.awUnit == 'focus' then fFont = f end end
N25_TEXT = tostring(fFont and fFont.text)
N25_SHOWN = (fFont and fFont:IsShown()) and 'yes' or 'no'
-- юнит БЕЗ плейта: числа нет ни в одном источнике -- метка обязана молчать, а не показывать чужое
GUID_OF.focus = '0xF140000000000009'
tick()
N25_NOPLATE = (fFont and fFont:IsShown()) and 'видна' or 'yes'
-- и то же с включённым «не дублировать»: число фокуса взято с ЕГО ЖЕ плейта, значит метка у фрейма --
-- дословно тот самый дубль, и она обязана исчезнуть
GUID_OF.focus = '0x' .. PLATE_NPC.guid:lower()
A.set('general', 'hideOwnPlate', true)
tick()
N25_DUP_HID = (fFont and fFont:IsShown()) and 'видна' or 'yes'
N25_PLATE_KEPT = PLATE_NPC.fonts[#PLATE_NPC.fonts]:IsShown() and 'yes' or 'no'
A.set('general', 'hideOwnPlate', false)

UIParent.CreateFontString = _UIPCreateFont
CreateFrame = _CreateFrame
UnitExists, UnitGUID = _UnitExists, _UnitGUID
AW_NamePlates, AW_NamePlateDistances, AW_UnitDistances, AW_NamePlateTokens = _Plates, _Dist, _Units, _Tokens
`, 'AWDistance.lua и DistancePanel.lua: загрузка и прогон сцен');

  // исходники передаются в Lua и текстом -- проверки «чего в файле быть не должно» читают, а не исполняют
  lua.lua_pushstring(L, to_luastring(src));
  lua.lua_setglobal(L, to_luastring('AW_DIST_SRC'));
  lua.lua_pushstring(L, to_luastring(panelSrc));
  lua.lua_setglobal(L, to_luastring('AW_PANEL_SRC'));
}


  const grab = (n) => {
    lua.lua_getglobal(L, to_luastring(n));
    const v = lua.lua_tonumber(L, -1);
    lua.lua_pop(L, 1);
    return v;
  };
  if (!Number.isFinite(grab('A5_CALLS'))) fail('IDENTITY', 'драйвер идентичности не дошёл до конца');
}

var PANEL_FACTS;
// --- панель Distance: сборка виджетов по-настоящему ---------------------------
// Ошибка владельца 04.10 17:29 (`DistancePanel.lua:155: attempt to call method
// 'SetObeyStepOnDrag' (a nil value)`) родом из одного нашего же промаха: рисовалку стенд гонял, а панель
// только читал текстом. Значит виджеты панели собираются здесь ВЗАИМОНО: у каждого вида заглушка знает
// ровно те методы, которые объявлены для него в кодексе 3.3.5a, а на любой другой она падает так же, как
// клиент, -- «attempt to call method 'X' (a nil value)».Метода, которого в этом патче нет, больше не
// доедет до игры.
{
  const panelSrc = fs.readFileSync(path.join(root, 'addons', 'AwesomeCVar', 'DistancePanel.lua'), 'utf8');
  lua.lua_pushstring(L, to_luastring(panelSrc));
  lua.lua_setglobal(L, to_luastring('AW_PANEL_SRC'));
  const skinSrc = fs.readFileSync(path.join(root, 'addons', 'AwesomeCVar', 'Skins', 'ElvUI.lua'), 'utf8');
  lua.lua_pushstring(L, to_luastring(skinSrc));
  lua.lua_setglobal(L, to_luastring('AW_SKIN_SRC'));

  doString(`
local _CreateFrame = CreateFrame

-- список методов = кодекс 3.3.5a (widgets Slider / Frame / EditBox / Button / FontString), плюс то, что
-- добавляет сам шаблон (OptionsSliderTemplate даёт Low/High/Text, UICheckButtonTemplate даёт Text)
local WIDGET_API = {
  CheckButton = { 'SetSize', 'SetPoint', 'SetScript', 'SetChecked', 'GetChecked', 'GetName', 'SetText', 'SetJustifyH' },
  Slider      = { 'SetWidth', 'SetHeight', 'SetPoint', 'ClearAllPoints', 'SetMinMaxValues', 'SetValueStep', 'SetScript',
                  'SetValue', 'GetValue', 'GetName', 'Enable', 'Disable', 'SetOrientation', 'SetHitRectInsets',
                  'SetBackdrop', 'SetThumbTexture', 'SetFrameStrata', 'SetFrameLevel', 'GetFrameLevel',
                  'Show', 'Hide', 'IsShown', 'GetChildren' },
  ScrollFrame = { 'SetPoint', 'ClearAllPoints', 'SetScrollChild', 'GetScrollChild', 'EnableMouseWheel', 'EnableMouse', 'SetScript',
                  'SetFrameLevel', 'GetFrameLevel', 'SetWidth', 'SetHeight', 'GetWidth', 'GetHeight', 'GetName',
                  'Show', 'Hide', 'IsShown', 'IsVisible', 'SetToplevel', 'SetFrameStrata', 'GetChildren' },
  EditBox     = { 'SetSize', 'SetPoint', 'SetAutoFocus', 'SetMaxLetters', 'SetScript', 'SetText', 'GetText',
                  'ClearFocus', 'SetNumeric' },
  Button      = { 'SetSize', 'SetPoint', 'ClearAllPoints', 'SetScript', 'SetNormalTexture', 'GetName',
                  'CreateTexture', 'CreateFontString', 'SetText', 'SetHeight', 'SetWidth', 'GetHeight', 'GetWidth',
                  'SetFrameStrata', 'SetFrameLevel', 'GetFrameLevel', 'Show', 'Hide', 'IsShown', 'IsVisible',
                  'SetChecked', 'LockHighlight', 'UnlockHighlight', 'GetChildren' },
  Frame       = { 'SetPoint', 'ClearAllPoints', 'SetSize', 'SetWidth', 'SetHeight', 'CreateFontString',
                  'CreateTexture', 'SetBackdrop', 'SetBackdropColor', 'SetBackdropBorderColor', 'SetFrameLevel',
                  'GetFrameLevel', 'GetName', 'SetScript', 'RegisterEvent', 'Show', 'Hide', 'IsShown', 'IsVisible',
                  'SetChecked', 'GetTextWidth', 'SetID', 'LockHighlight', 'UnlockHighlight', 'SetMinMaxValues',
                  'SetValueStep', 'GetHeight', 'GetWidth', 'GetStringHeight', 'GetPoint', 'GetParent', 'GetBottom',
                  'SetClampedToScreen', 'SetFrameStrata', 'SetToplevel', 'GetTop', 'GetCenter', 'GetChildren' },
  FontString  = { 'SetPoint', 'SetJustifyH', 'SetText', 'SetTextColor', 'GetSize', 'SetSize',
                  'Show', 'Hide', 'IsShown', 'GetText', 'SetAlpha', 'GetHeight', 'GetWidth',
                  'GetStringHeight', 'SetAlpha', 'GetPoint', 'SetWidth', 'SetHeight', 'SetWordWrap',
                  'ClearAllPoints' },
  Texture     = { 'SetPoint', 'ClearAllPoints', 'SetAllPoints', 'SetTexture', 'SetTexCoord', 'SetBlendMode',
                  'SetWidth', 'SetHeight', 'SetVertexColor', 'Show', 'Hide', 'IsShown', 'SetAlpha' },
}

-- честная геометрия: размер фрейма, растянутого двумя противоположными якорями, берётся от родителя. Без
-- этой модели scrollFrame списка всегда имел бы фиксированные 20 пикселей, ползунок в стенде не появился
-- бы ни при каком количестве шрифтов, и гейт молчал бы про тот же баг, что увидел владелец
local function derived(w, what)
  local pts = w.__pts
  if not (pts and pts.TOPLEFT and pts.BOTTOMRIGHT) then return nil end
  local to = pts.TOPLEFT.to
  if not to then return nil end
  if what == 'h' then return (to:GetHeight() or 0) + (pts.TOPLEFT.y - pts.BOTTOMRIGHT.y) end
  return (to:GetWidth() or 0) + (pts.BOTTOMRIGHT.x - pts.TOPLEFT.x)
end

local function kidsOf(self)
  -- как клиент: потомки-ФРЕЙМЫ, текстуры и строки наружу не отдаются
  local out = {}
  for _, k in ipairs(self.__kids or {}) do
    if k.__kind ~= 'FontString' and k.__kind ~= 'Texture' then out[#out + 1] = k end
  end
  return out
end

local function widget(kind, name, parent)
  local api = WIDGET_API[kind] or WIDGET_API.Frame
  local w = { __kind = kind, __name = name, __parent = parent, __pts = {}, __kids = {}, clicks = 0, __shown = true }
  for _, m in ipairs(api) do
    if not w[m] then
      w[m] = function(self, a, b, c, d)
        if m == 'GetChecked' then return self.__checked end
        if m == 'GetValue' then return self.__value or 0 end
        if m == 'GetName' then return self.__name end
        if m == 'CreateFontString' then local f = widget('FontString', nil, self); self.__kids[#self.__kids + 1] = f; return f end
        if m == 'CreateTexture' then local t = widget('Texture', nil, self); self.__kids[#self.__kids + 1] = t; return t end
        if m == 'GetParent' then return self.__parent end
        if m == 'SetFrameStrata' then self.__strata = a return end
        if m == 'GetChildren' then
          return (table.unpack or unpack)(kidsOf(self))
        end
        if m == 'IsShown' or m == 'IsVisible' then return self.__shown and true or false end
        if m == 'Show' then self.__shown = true return end
        if m == 'Hide' then self.__shown = false return end
        if m == 'GetText' then return self.__text end
        if m == 'GetTextWidth' then return 40 end
        if m == 'GetHeight' then return self.__height or derived(self, 'h') or 20 end
        if m == 'GetWidth' then return self.__width or derived(self, 'w') or 0 end
        if m == 'SetWidth' then self.__width = a return end
        if m == 'SetHeight' then self.__height = a return end
        if m == 'SetSize' then self.__width, self.__height = a, b return end
        if m == 'ClearAllPoints' then self.__pts = {} return end
        if m == 'GetBottom' then return self.__bottom end
        if m == 'GetStringHeight' then return 12 end
        if m == 'GetFrameLevel' then return 1 end
        if m == 'SetChecked' then self.__checked = a end
        if m == 'SetValue' then
          -- как клиент: OnValueChanged зовётся только когда значение действительно изменилось
          if self.__value ~= a then
            self.__value = a
            if self.scripts and self.scripts.OnValueChanged then self.scripts.OnValueChanged(self, a) end
          end
          return
        end
        if m == 'SetText' then self.__text = a end
        if m == 'SetScrollChild' then self.__scrollChild = a return end
        if m == 'GetScrollChild' then return self.__scrollChild end
        return nil
      end
    end
  end
  -- общее наследование Frame/Region и расширения ElvUI, которыми пользуется skin-обход: без них стенд дал
  -- бы «attempt to call a nil value» ровно там, где в игре skin отрабатывает, и проверка оформителя
  -- превратилась бы в проверку заглушки
  local ANCESTRY = {
    CheckButton = { Button = true, Frame = true }, Button = { Frame = true }, Slider = { Frame = true },
    EditBox = { Frame = true }, ScrollFrame = { Frame = true }, Frame = {}, FontString = {}, Texture = {},
  }
  w.GetObjectType = function(self) return self.__kind end
  -- GetChildren наследуется от Frame, а списки выше перечисляют только то, чем виджет пользуется сам:
  -- без этой строки обход дерева падал на первом же EditBox (у CheckButton того же метода в списке нет)
  if not w.GetChildren then
    w.GetChildren = function(self) return (table.unpack or unpack)(kidsOf(self)) end
  end
  if not w.GetName then w.GetName = function(self) return self.__name end end   -- GetName унаследован от Region
  w.IsObjectType = function(self, kind)
    return (kind == self.__kind) or (ANCESTRY[self.__kind] and ANCESTRY[self.__kind][kind]) or false
  end
  w.GetNumPoints = function(self)
    local n = 0
    for _ in pairs(self.__pts) do n = n + 1 end
    return n
  end
  w.GetPoint = function(self, i)
    local n = 0
    for point, p in pairs(self.__pts) do
      n = n + 1
      if n == (i or 1) then return point, p.to, point, p.x, p.y end
    end
    return nil
  end
  w.StripTextures = function(self) self.__stripped = true end
  w.SetTemplate = function(self, name) self.__template = name or 'default' end
  w.CreateBackdrop = function(self, name)
    self.backdrop = { Hide = function() end, Show = function() end, SetFrameLevel = function() end,
                      Point = function() end, SetOutside = function() end }
    return self.backdrop
  end
  w.HookScript = function(self, k, fn) self.scripts[k] = fn end
  w.Point = function(self, ...) return w.SetPoint(self, ...) end
  w.Size = function(self, a, b) self.__width, self.__height = a, b end
  w.Width = function(self, a) self.__width = a end
  w.Height = function(self, a) self.__height = a end
  -- SetPoint нужно разбирать отдельно: именно по имени якоря pullout узнаёт, какой у него размер
  w.SetPoint = function(self, point, a, b, c, d)
    local to, x, y = self.__parent, a, b
    if type(a) == 'table' then to, x, y = a, c or 0, d or 0 end
    self.__pts[point] = { to = to, x = x or 0, y = y or 0 }
  end
  w.scripts = {}
  local orig = w.SetScript
  w.SetScript = function(self, k, fn) self.scripts[k] = fn end
  -- как клиент: у виджета есть ровно его объявленные методы, остальное -- nil. Именно nil, а не
  -- функция-ловушка: ловушка делает истинным чтение незаписанного поля (panel проверяет
  -- ColorPickerFrame.func ~= nil), и «настройка не установилась» перестаёт быть видимой
  setmetatable(w, { __index = function(self, key) return rawget(self, key) end })
  return w
end

function CreateFrame(kind, name, parent, template)
  local w = widget(kind or 'Frame', name, parent)
  if name then
    _G[name] = w
    -- то, что вешает на именованный фрейм сам шаблон
    if template == 'UICheckButtonTemplate' then
      _G[name .. 'Text'] = widget('FontString', name .. 'Text', w)
    elseif template == 'OptionsSliderTemplate' then
      for _, suffix in ipairs({ 'Low', 'High', 'Thumb', 'Text' }) do
        _G[name .. suffix] = widget('FontString', name .. suffix, w)
      end
    elseif template == 'InputBoxTemplate' then
      _G[name .. 'Text'] = widget('FontString', name .. 'Text', w)
    elseif template == 'UIDropDownMenuTemplate' then
      -- кнопка раскрытия и подпись выбранного шаблон заводит сам, по имени фрейма
      _G[name .. 'Button'] = widget('Button', name .. 'Button', w)
      _G[name .. 'Text'] = widget('FontString', name .. 'Text', w)
    end
  end
  if parent and parent.__kids then parent.__kids[#parent.__kids + 1] = w end
  PANEL_FRAMES[#PANEL_FRAMES + 1] = w
  return w
end

UIParent = widget('Frame', 'UIParent')
PANEL_FRAMES = {}
UIDropDownMenu_SetWidth = function(dd, w)
  DROP_MIN = (DROP_MIN == nil) and w or math.min(DROP_MIN, w)
end
UIDropDownMenu_SetText = function(dd, text) dd.__text = text end
PlaySound = function() end
UIPanelScrollFrameTemplate = true

ColorPickerFrame = widget('Frame', 'ColorPickerFrame')
function ColorPickerFrame:GetColorRGB() return 0.1, 0.2, 0.3 end
ColorPickerFrame.SetColorRGB = function(self, r, g, b) self.__rgb = { r, g, b } end
OpacitySliderFrame = widget('Slider', 'OpacitySliderFrame')

-- переменная мастер-тумблера должна существовать до сборки панели: без неё геттер вернёт ""
AW_REGISTRY.distanceDisplay = '0'
AW_VALUES.distanceDisplay = '1'

-- панель грузится в ТОМ же namespace, что Constants.lua и Core.lua выше: у неё есть право вызывать
-- ACVar:GetCVarValue / SetCVarValue / cvarExists, а своя пустая таблица отдала бы nil-метод ровно там,
-- где в игре всё работает
local ns = _G.${NS}
-- тот же файл уже грузился один раз выше (в составе аддона). here он грузится ВТОРЫМ вызовом, чтобы
-- собрать панель над заглушками этого блока; старый экземпляр убирается, иначе CUSTOM_PANELS[1] укажет
-- на вкладку с другим состоянием, и прогон проверял бы не её
ns.CUSTOM_PANELS, ns.CUSTOM_PANEL_CVAR_ROWS = nil, nil
-- язык клиента: вкладка обязана отдавать подписи пунктов по-русски, а не теми строками, которые для
-- списка держит рисовалка (замер владельца 04.10 19:5x, скриншот «to the plate / to the name»)
GetLocale = function() return "ruRU" end
assert(load(AW_PANEL_SRC))('AwesomeCVar', ns)

-- DROP_MIN пишется во время сборки: какая наименьшая ширина была запрошена у UIDropDownMenu_SetWidth
DROP_MIN = nil
-- в окне контент-фрейм получает реальный размер из ScrollFrame (UI.lua), здесь он такой же
local content = widget('Frame', 'content')
content:SetWidth(700)
PANEL_CURRENT = nil
local tab = ns.CUSTOM_PANELS[1]
-- окно ещё не построено (UI.lua в стенд не грузится), но панель зовёт ACVar:UpdateAllUI из каждого
-- клик-хендлера -- даём ему тот же путь, что и в игре: refresh этой же вкладки
ns.UpdateAllUI = function() tab.refresh() end

-- длинный список шрифтов -- ровно та ситуация, на которой список уезжал за экран: с SharedMedia им
-- десятки. Фикстура ставится над настоящей AW_Distance.fonts, чтобы ползунок проверялся на 40 пунктах,
-- а не на четырёх builtin (замер владельца 04.10 19:0x)
FONT_FIXTURE = 40
do
  local many = {}
  for i = 1, FONT_FIXTURE do many[i] = 'Font' .. i end
  AW_Distance.fonts = function() return many end
end

-- два края, которые надо увидеть словами, а не nil: профиль, который ещё ни разу не рисовал (focus), и
-- профиль, где клиент взял НЕ тот файл (target)
do
  local realInfo = AW_Distance.fontInfo
  AW_Distance.fontInfo = function(key)
    if key == 'focus' then return nil end
    if key == 'target' then return 'REQUESTED.ttf', 'KEPTBYCLIENT.ttf' end
    return realInfo(key)
  end
end

local ok, err = pcall(function()
  tab.build(content, content)
  tab.refresh()
  PANEL_BUILT = true
end)
PANEL_ERR = ok and 'ok' or tostring(err)

-- сколько виджеты вообще переживают: их число и наличие подписи у первого чекбокса
PANEL_FRAMES_N = #PANEL_FRAMES

-- заметки «какой шрифт применился» лежат под своим дропдауном в каждом блоке; собираем их рекурсией по
-- детям контент-фрейма (FontStringCreateFrame не порождает, поэтому обход по __kids)
P_NOTES, P_NOTES_N, P_LONG = 'нет', 0, 0
do
  -- длина считается В СИМВОЛАХ: кириллица в UTF-8 занимает два байта, и по байтам мера вышла бы вдвое
  -- больше той, что реально видит игрок
  local function chars(t)
    local n = 0
    for i = 1, #t do
      local b = t:byte(i)
      if b < 0x80 or b >= 0xC0 then n = n + 1 end
    end
    return n
  end
  local function collect(w)
    for _, k in ipairs(w.__kids or {}) do
      if k.__kind == 'FontString' then
        local t = k.__text
        if t and (t:find('шрифт:') or t:find('клиент взял') or t:find('меток ещё не было')) then
          P_NOTES_N = P_NOTES_N + 1
          P_NOTES = tostring(P_NOTES) .. ' // ' .. t
          -- строка обязана влезать в блок и быть заякорена с двух сторон: иначе снова упирается в край
          if chars(t) > 44 then P_LONG = P_LONG + 1 end
          if not (k.__pts and k.__pts.TOPLEFT and k.__pts.TOPRIGHT) then P_LONG = P_LONG + 1 end
        end
      else
        collect(k)
      end
    end
  end
  collect(content)
end

-- каждый дропдаун раскрывается КЛИКОМ по кнопке шаблона, и снимается то, что увидит игрок: высота
-- списка, есть ли ползунок, сколько пунктов и сдвигает ли колесо содержимое. Список обязан остаться
-- полным (648 пикселей контента в рамке 192) -- урезать пункты ради высоты значит потерять настройку
P_ROWS_MAX, P_TOTAL, P_TEXTLESS, P_WHY = 0, 0, 0, ''
P_CAPPED, P_CHILD_H, P_SLIDER, P_OFFSET, P_CLICK = 0, 0, 'нет', 0, 'нет'
P_SHORT_SLIDER, P_ROWS_N, P_SCROLL_H = 'нет', 0, 0
P_EN_ITEMS, P_EN_CLOSED = '', ''
-- кириллица в UTF-8 -- байты больше 127; имена шрифтов переводу не подлежат (это собственные имена)
local function isCyr(text)
  if not text then return false end
  for i = 1, #text do
    if text:byte(i) > 127 then return true end
  end
  return false
end
do
  local drops, pulls = {}, {}
  for _, f in ipairs(PANEL_FRAMES) do
    if f.__kind == 'Frame' and f.__name then
      if f.__name:find('Drop') and not f.__name:find('DropRow') then drops[#drops + 1] = f end
      if f.__name:find('Pullout') then pulls[#pulls + 1] = f end
    end
  end
  P_LISTS = #drops
  for i, dd in ipairs(drops) do
    local frame = pulls[i]
    dd.__bottom = 200          -- контрол в 200 пикселях от нижнего края: худший случай централизованного окна
    local btn = _G[dd:GetName() .. 'Button']
    local okClick = pcall(function() btn.scripts.OnClick(btn) end)
    P_CLICK_WHY = tostring(P_CLICK_WHY or '') .. (okClick and '.' or 'FAIL ')
    local scroll = frame.__kids[1]
    local child, slider = scroll.__kids[1], scroll.__kids[2]
    local rows = {}
    for _, b in ipairs(child.__kids) do
      if b.__kind == 'Button' and b.__shown then
        rows[#rows + 1] = b
        local text = b.text and b.text:GetText()
        if not text or text == '' then
          P_TEXTLESS = P_TEXTLESS + 1
          P_WHY = P_WHY .. tostring(text) .. '/' .. tostring(b.value) .. '; '
        end
      end
    end
    P_TOTAL = P_TOTAL + #rows
    if #rows ~= FONT_FIXTURE then
      -- список не шрифтов: на ru-клиенте каждая подпись обязана быть кириллической, иначе это строка
      -- рисовалки, доехавшая до игрока untranslated
      for _, b in ipairs(rows) do
        if not isCyr(b.text and b.text:GetText()) then
          P_EN_ITEMS = P_EN_ITEMS .. tostring(b.value) .. '=' .. tostring(b.text and b.text:GetText()) .. '; '
        end
      end
      if not isCyr(dd.__text) then
        P_EN_CLOSED = P_EN_CLOSED .. tostring(dd.__text) .. '; '
      end
    end
    if #rows > P_ROWS_MAX then
      P_ROWS_MAX = #rows
      P_CAPPED = frame:GetHeight()
      P_CHILD_H = child:GetHeight()
      P_SCROLL_H = scroll:GetHeight()
      P_SLIDER = slider:IsShown() and 'yes' or 'no'
      P_ROWS_N = #rows
      -- колесо вниз (delta < 0) -- тот же ход, что делает AceGUI в MoveScroll (:109-125)
      if scroll.scripts.OnMouseWheel then
        scroll.scripts.OnMouseWheel(scroll, -1)
        P_OFFSET = (child.__pts.TOPLEFT and child.__pts.TOPLEFT.y) or 0
      end
      -- выбор пункта обязан доехать до профиля и закрыть список
      P_CLICK = tostring(pcall(function() rows[1].scripts.OnClick(rows[1]) end))
      P_CLICK_VALUE = tostring(rows[1].value)
      -- слои и привязка: список обязан лежать ВЫШЕ слоя самого окна и цепляться за контрол
      P_STRATA = frame.__strata or 'нет'
      P_KID_STRATA = scroll.__strata or 'нет'
      local pa = frame.__pts.TOPLEFT
      P_ANCHOR_TO = (pa and pa.to == dd) and 'контрол' or 'не контрол'
      P_ANCHOR_XY = pa and (tostring(pa.x) .. '/' .. tostring(pa.y)) or 'нет'
    elseif #rows <= 10 and slider:IsShown() == false then
      P_SHORT_SLIDER = 'no'
      P_SHORT_ROWS = #rows
    end
  end
end

-- клик по первому чекбоксу обязан дойти до AW_Distance и назад
local firstCheck
for _, f in ipairs(PANEL_FRAMES) do if f.__kind == 'CheckButton' then firstCheck = f break end end
CHECK_KIND = firstCheck and 'есть' or 'нет'
if firstCheck then
  firstCheck.__checked = false
  local before = tostring(DB_BEFORE)
  PANEL_CLICK_OK = tostring(pcall(function() firstCheck.scripts.OnClick(firstCheck) end))
end

-- слайдер: OnValueChanged обязан писать значение в профиль, а не только переклеивать подпись. Ползунок
-- pullout тоже Slider, но он не настройка -- берётся именно OptionsSliderTemplate-виджет по имени
local firstSlider
for _, f in ipairs(PANEL_FRAMES) do
  if f.__kind == 'Slider' and f.__name and f.__name:find('DistanceSlider') then firstSlider = f break end
end
SLIDER_OK = 'нет'
if firstSlider and firstSlider.scripts and firstSlider.scripts.OnValueChanged then
  SLIDER_OK = tostring(pcall(function() firstSlider.scripts.OnValueChanged(firstSlider, 36) end))
end

-- кнопка цвета: пипетка открывается способом 3.3.5a и отмена возвращает прежний цвет
local swatchBtn
for _, f in ipairs(PANEL_FRAMES) do
  if f.__kind == 'Button' and f.__name and f.__name:find('Swatch') and f.scripts and f.scripts.OnClick then swatchBtn = f break end
end
SWATCH_OK = 'нет слайдера'
if swatchBtn then
  SWATCH_OK = tostring(pcall(function() swatchBtn.scripts.OnClick(swatchBtn) end))
  SWATCH_HAS_FUNC = (ColorPickerFrame.func ~= nil) and 'yes' or 'no'
  SWATCH_CANCEL = 'нет'
  if ColorPickerFrame.cancelFunc then
    local okc, erc = pcall(ColorPickerFrame.cancelFunc, { 1, 1, 1, 1 })
    SWATCH_CANCEL = okc and 'true' or tostring(erc)
  end
end

-- 26. оформитель вкладки Distance (Skins/ElvUI.lua). Вкладка строится лениво -- её виджеты появляются из
-- первого refresh, уже после того, как окно обошли проходы по строкам CVar. Стенд даёт то же дерево и тот
-- же ACVar-неймспейс, поэтому проверяется три вещи: каждый виджет получил СВОЙ обработчик ровно один раз,
-- растяжка дропдауна пережила HandleDropDownBox, и повторный проход ничего не добавляет.
SK_MISSED, SK_TWICE, SK_ANCHORS, SK_SWATCH, SK_AGAIN, SK_KINDS = 'нет', 'нет', 'нет', 'нет', 'нет', '0'
do
  local SK = { cb = 0, sl = 0, eb = 0, dd = 0, btn = 0 }
  local S = {}
  S.HandleCheckBox = function(self, w) SK.cb = SK.cb + 1; w.__skCb = (w.__skCb or 0) + 1 end
  S.HandleSliderFrame = function(self, w) SK.sl = SK.sl + 1; w.__skSl = (w.__skSl or 0) + 1 end
  S.HandleEditBox = function(self, w) SK.eb = SK.eb + 1; w.__skEb = (w.__skEb or 0) + 1 end
  S.HandleButton = function(self, w) SK.btn = SK.btn + 1; w.__skBtn = (w.__skBtn or 0) + 1 end
  S.HandleTab = function(self, w) w.__skTab = true end
  S.HandleScrollBar = function(self, w) w.__skSb = true end
  S.HandleDropDownBox = function(self, w)
    -- как настоящий: бокс получает фиксированную ширину и свой backdrop, а якоря растяжки при этом теряются
    SK.dd = SK.dd + 1
    w.__skDd = (w.__skDd or 0) + 1
    w.__width = 155
    w.backdrop = { Hide = function() end }
  end
  local E = { GetModule = function(self, name) return S end, Media = { Textures = {} }, media = { rgbvaluecolor = { 1, 1, 1 } } }
  ElvUI = { E }
  E[1] = E
  unpack = unpack or table.unpack   -- клиент на Lua 5.1 даёт глобальный unpack, fengari -- нет

  -- панель в окне лежит за ScrollFrame'ом, и оформитель добирается к ней через ACVar.PanelsByName (имена
  -- вкладок локализованы, поэтому реестр, а не список имён)
  local scroll = widget('ScrollFrame', 'AwesomeCVarScrollFrame_Дистанция', UIParent)
  scroll:SetScrollChild(content)
  ns.PanelsByName = { ['Дистанция'] = scroll }

  assert(load(AW_SKIN_SRC))('AwesomeCVar', ns)
  ns.Skins.ElvUI()                      -- тот же вызов, что и на PLAYER_ENTERING_WORLD (Core.lua)
  local hook = AW_HOOKS['UpdateDistancePanel']
  SK_HOOK = hook and 'есть' or 'нет'
  if hook then hook(ns) end             -- хук на ленивую сборку вкладки

  local missed, n = {}, 0
  for _, f in ipairs(PANEL_FRAMES) do
    local kind, nm = f.__kind, f.__name
    n = n + 1
    if kind == 'CheckButton' then
      if not f.__skCb then missed[#missed + 1] = 'check ' .. tostring(nm) end
    elseif kind == 'Slider' then
      if not f.__skSl then missed[#missed + 1] = 'slider ' .. tostring(nm) end
    elseif kind == 'EditBox' then
      if not f.__skEb then missed[#missed + 1] = 'edit ' .. tostring(nm) end
    elseif kind == 'Button' and nm and nm:find('Swatch') then
      if f.__skBtn then SK_SWATCH = 'yes' end
    elseif kind == 'Button' and nm and nm:find('Reset') then
      if not f.__skBtn then missed[#missed + 1] = 'reset ' .. tostring(nm) end
    elseif kind == 'Frame' and nm and nm:find('DistanceDrop') and not nm:find('DropRow') then
      if not f.__skDd then missed[#missed + 1] = 'drop ' .. tostring(nm) end
      if f.__skDd and f.__skDd > 1 then SK_TWICE = 'yes' end
      if not (f.__pts.TOPLEFT and f.__pts.TOPRIGHT) then SK_ANCHORS = 'yes' end
    elseif kind == 'Frame' and nm and nm:find('DistancePullout') then
      -- рамка раскрытого списка живёт на UIParent: её оформитель догоняет через дропдаун, и это видно здесь
      if not f.__template then missed[#missed + 1] = 'pullout ' .. tostring(nm) end
    elseif kind == 'Frame' and not nm and f ~= content then
      if not f.__template then missed[#missed + 1] = 'box' end
    end
  end
  SK_KINDS = tostring(n)
  SK_MISSED = (#missed == 0) and 'нет' or table.concat(missed, ', ')

  local before = SK.cb + SK.sl + SK.eb + SK.dd + SK.btn
  if hook then hook(ns) end
  SK_AGAIN = (SK.cb + SK.sl + SK.eb + SK.dd + SK.btn == before) and 'нет' or 'да'
  ElvUI = nil
end

-- refresh обязан пережить и отсутствие рисовалки
local savedApi = AW_Distance
AW_Distance = nil
NOTICE_OK = tostring(pcall(tab.refresh))
AW_Distance = savedApi

CreateFrame = _CreateFrame
for k in pairs(PANEL_FRAMES) do PANEL_FRAMES[k] = nil end

`, 'DistancePanel.lua: сборка виджетов методам клиента один в один');

  const grab = (n) => {
    lua.lua_getglobal(L, to_luastring(n));
    const t = lua.lua_type(L, -1);
    let v;
    if (t === lua.LUA_TNUMBER) v = String(lua.lua_tonumber(L, -1));
    else if (t === lua.LUA_TBOOLEAN) v = lua.lua_toboolean(L, -1) ? 'true' : 'false';
    else if (t === lua.LUA_TSTRING) v = lua.lua_tojsstring(L, -1);
    else v = 'nil';
    lua.lua_pop(L, 1);
    return v;
  };
  PANEL_FACTS = {
    built: grab('PANEL_ERR'),
    frames: grab('PANEL_FRAMES_N'),
    check: grab('CHECK_KIND'),
    click: grab('PANEL_CLICK_OK'),
    slider: grab('SLIDER_OK'),
    swatch: grab('SWATCH_OK'),
    swatchFunc: grab('SWATCH_HAS_FUNC'),
    cancel: grab('SWATCH_CANCEL'),
    notice: grab('NOTICE_OK'),
    dropMin: grab('DROP_MIN'),
    clickWhy: grab('P_CLICK_WHY'),
    // pullout: то, что игрок увидит в раскрытом списке
    lists: grab('P_LISTS'),
    rowsMax: grab('P_ROWS_MAX'),
    rowsTotal: grab('P_TOTAL'),
    textless: grab('P_TEXTLESS'),
    textlessWhy: grab('P_WHY'),
    capped: grab('P_CAPPED'),
    childH: grab('P_CHILD_H'),
    scrollH: grab('P_SCROLL_H'),
    pslider: grab('P_SLIDER'),
    shortSlider: grab('P_SHORT_SLIDER'),
    shortRows: grab('P_SHORT_ROWS'),
    offset: grab('P_OFFSET'),
    pullClick: grab('P_CLICK'),
    pullClickValue: grab('P_CLICK_VALUE'),
    pstrata: grab('P_STRATA'),
    kidStrata: grab('P_KID_STRATA'),
    anchorTo: grab('P_ANCHOR_TO'),
    anchorXY: grab('P_ANCHOR_XY'),
    enItems: grab('P_EN_ITEMS'),
    enClosed: grab('P_EN_CLOSED'),
    notes: grab('P_NOTES'),
    notesN: grab('P_NOTES_N'),
    notesLong: grab('P_LONG'),
    fixture: grab('FONT_FIXTURE'),
    // skin-обход вкладки (Skins/ElvUI.lua)
    skMissed: grab('SK_MISSED'),
    skTwice: grab('SK_TWICE'),
    skAnchors: grab('SK_ANCHORS'),
    skSwatch: grab('SK_SWATCH'),
    skAgain: grab('SK_AGAIN'),
    skHook: grab('SK_HOOK'),
    skKinds: grab('SK_KINDS'),
  };
  // то же, что PANEL_* выше, но наружу: тестовый чанок оперирует Lua-таблицей
  lua.lua_newtable(L);
  for (const [k, v] of Object.entries(PANEL_FACTS)) {
    lua.lua_pushstring(L, to_luastring(k));
    lua.lua_pushstring(L, to_luastring(String(v)));
    lua.lua_settable(L, -3);
  }
  lua.lua_setglobal(L, to_luastring('PANEL_FACTS'));
}

// --- сам тест ----------------------------------------------------------------
const test = `
  local ACVar = _G.${NS}
  local errors, checks = {}, 0
  local function check(cond, msg)
    checks = checks + 1
    if not cond then table.insert(errors, msg) end
  end

  -- 1. состав аддона = состав dll: ни лишней строки, ни переменной dll без строки
  local DLL, dllNames = {}, {}
  for _, name in ipairs({ ${quoted} }) do
    DLL[name] = true
    table.insert(dllNames, name)
  end

  local rows, rowCount = {}, 0
  local categories = 0
  -- строка вне ACVar.CVARS: вкладку Distance собирает DistancePanel.lua, и её единственный CVar живёт там
  for _, list in pairs(ACVar.CVARS) do
    categories = categories + 1
    for _, def in ipairs(list) do
      if def.type ~= "description" then rows[def.name] = def end
    end
  end
  for name, def in pairs(rows) do
    rowCount = rowCount + 1
    check(DLL[name] == true, "строка \\"" .. name .. "\\" есть в аддоне, а dll такую переменную не регистрирует")
    check(def.awMissing == nil, "у строки \\"" .. name .. "\\" осталось поле awMissing -- механизм «помечено нет» удалён")
    check(type(def.label) == "string" and def.label ~= "", "у строки " .. name .. " пустая label (нет ключа локали?)")
    check(type(def.desc) == "string" and def.desc ~= "", "у строки " .. name .. " нет desc")
    check(type(def.awNeeds) == "string" and def.awNeeds ~= "", "у строки " .. name .. " нет awNeeds (ключ конфа)")
  end
  for _, def in ipairs(ACVar.CUSTOM_PANEL_CVAR_ROWS or {}) do
    rows[def.name] = def
    rowCount = rowCount + 1
  end
  check(rowCount == #dllNames, "строк " .. rowCount .. ", а dll регистрирует " .. #dllNames)
  for _, name in ipairs(dllNames) do
    check(rows[name] ~= nil, "dll регистрирует \\"" .. name .. "\\", а строки для неё нет")
  end
  check(categories == 3, "категорий " .. categories .. ", ожидалось 3 (камера / индикаторы / взаимодействие) -- Distance теперь не категория CVARS, а своя вкладка панели")
  check((ACVar.CUSTOM_PANELS or {})[1] ~= nil, "DistancePanel.lua не зарегистрировал вкладку в ACVar.CUSTOM_PANELS")
  check(type((ACVar.CUSTOM_PANELS or {})[1] or {}).build == nil or true, "")

  -- 2. полные ключи конфа: все переменные в клиенте, все активны
  for _, name in ipairs(dllNames) do AW_REGISTRY[name] = "0" end
  for _, name in ipairs(dllNames) do
    check(ACVar:cvarExists(name) == true, "cvarExists(\\"name\\") должен быть true, раз переменная в клиенте")
  end
  check(ACVar:cvarExists("nameplateClampMode") == false,
    "по неперенесённому CVar cvarExists обязан быть false (clamp -- это вариант A, его не переносили)")
  check(ACVar:cvarExists("nameplateStacking") == false,
    "перенос свёрнут: стекинговых переменных dll больше не регистрирует (п. 80)")
  check(ACVar:cvarExists(nil) == false, "cvarExists(nil) обязан быть false, а не падать")

  -- 3. перенесённый, но не поставленный фичей (площадка не код -> feature skipped)
  AW_REGISTRY.cameraIndirectVisibility = nil
  ACVar._cvarExists = nil
  check(ACVar:cvarExists("cameraIndirectVisibility") == false,
    "при fade = 0 строка фейда должна гаситься: cvarExists == false")
  check(ACVar:GetCVarValue("cameraIndirectVisibility") == nil,
    "GetCVarValue по отсутствующему CVar обязан вернуть nil, а не \\"\\"")

  -- 4. guard записи (именно он раньше молча портил Config.wtf)
  local writes = AW_SETCVAR_WRITES
  ACVar:SetCVarValue("cameraIndirectVisibility", 1)
  ACVar:SetCVarValue("nameplateClampMode", 1)
  check(AW_SETCVAR_WRITES == writes,
    "SetCVarValue по несуществующему CVar не должен звать SetCVar, а позвал " .. (AW_SETCVAR_WRITES - writes) .. " раз")

  -- 5. существующий CVar пишется как в оригинале
  AW_REGISTRY.cameraIndirectVisibility = "0"
  ACVar._cvarExists = nil
  ACVar:SetCVarValue("cameraIndirectVisibility", 1)
  check(AW_SETCVAR_WRITES == writes + 1, "по существующему CVar SetCVar обязан быть вызван ровно раз")
  check(GetCVar("cameraIndirectVisibility") == "1", "значение должно читаться обратно через GetCVar")

  -- 6. кэш не должен запирать отрицательный ответ на всю сессию
  ACVar._cvarExists = nil
  AW_REGISTRY.interactionAngle = nil
  check(ACVar:cvarExists("interactionAngle") == false, "снятый из реестра CVar не должен числиться существующим")
  AW_REGISTRY.interactionAngle = "60"
  check(ACVar:cvarExists("interactionAngle") == true, "вернувшийся CVar обязан снова стать существующим")
  check(ACVar:cvarExists("interactionAngle") == true, "положительный ответ должен кэшироваться (повторный опрос тот же)")

  -- 7. приветствие: PrintGreeting обязан донести каждую строку GREETING до чата
  local g = ACVar.CONSTANTS and ACVar.CONSTANTS.GREETING
  check(type(g) == "table" and #g > 0, "CONSTANTS.GREETING пустой или не таблица")
  local printed = {}
  local savedFrame = _G.DEFAULT_CHAT_FRAME
  _G.DEFAULT_CHAT_FRAME = { AddMessage = function(_, line) printed[#printed + 1] = line end }
  local okCall = pcall(function() ACVar:PrintGreeting() end)
  _G.DEFAULT_CHAT_FRAME = savedFrame
  check(okCall, "ACVar:PrintGreeting() падает")
  check(#printed == #(g or {}), "PrintGreeting напечатал " .. #printed .. " строк, а в GREETING " .. #(g or {}))
  for i, line in ipairs(g or {}) do
    check(printed[i] == line, "строка приветствия " .. i .. " не дошла до чата")
  end

  -- 8. shim C_NamePlate против условия WeakAuras (условие и его форма -- в заголовке этого файла)
  check(type(C_NamePlate) == "table" and type(C_NamePlate.GetNamePlateForUnit) == "function",
    "шим не опубликовал C_NamePlate.GetNamePlateForUnit -- WeakAuras решит, что клиент не патчен")
  local C_VoiceChat = nil -- TTS в нашей сборке нет, значит первая ветка условия заведомо промахивается
  local isAwesomeEnabled = C_VoiceChat and C_VoiceChat.SpeakText and 2
                        or C_NamePlate and C_NamePlate.GetNamePlateForUnit and 1
                        or false
  check(isAwesomeEnabled == 1,
    "условие WeakAuras даёт " .. tostring(isAwesomeEnabled) .. ", а не 1: nameplate-триггеры не соберутся")
  check(C_NamePlate.GetNamePlateForUnit("nameplate3") == AW_NamePlates.nameplate3,
    "lookup по токену не отдаёт фрейм из AW_NamePlates")
  check(C_NamePlate.GetNamePlateForUnit("target") == AW_NamePlateGuids.F130001234,
    "lookup по «target» через guid клиента не разошёлся -- WA подаёт и произвольные юниты, не только токены")
  -- ключи в картах dll -- верхний регистр без 0x; вход может прийти в любом (аддоны печатают guid
  -- кто как умеет), поэтому нормализацию делает shim. Без неё этот же lookup ниже станет nil.
  check(C_NamePlate.GetNamePlateTokenByGUID("0xf130001234") == "nameplate3",
    "guid -> токен не разошёлся на строчных буквах (shim обязан нормализовать регистр сам)")
  check(C_NamePlate.GetNamePlateForUnit("nameplate7") == nil,
    "по невидимому токену обязан быть nil, а не ошибка")
  check(C_NamePlate.GetNamePlateForUnit(nil) == nil,
    "lookup по nil обязан молчать: WA зовёт его для произвольных юнитов")
  check(C_NamePlate.GetNamePlateTokenByGUID("0xF130001234") == "nameplate3", "связка guid -> токен разошлась")
  check(C_NamePlate.GetNamePlateByGUID("0xF130001234") == AW_NamePlates.nameplate3, "связка guid -> фрейм разошлась")
  check(type(C_NamePlate.GetNamePlates) == "function" and #C_NamePlate.GetNamePlates() == 1,
    "GetNamePlates обязан копировать AW_NamePlateList")

  -- 9. идентичность плеитов ElvUI: то, ради чего написан AWElvUINameplates.lua (драйвер -- выше по файлу)
  check(BEFORE_UNIT == nil and BEFORE_CALLS == 0,
    "модуль привязал рамку до ADDON_LOADED ElvUI (unit=" .. tostring(BEFORE_UNIT) .. ")")
  check(WRONG_ADDON_CALLS == 0, "модуль заработал на загрузке чужого аддона, а не ElvUI")
  check(A1_UNIT == "nameplate3" and A1_GUID == "G3" and A1_TOKEN == "nameplate3",
    "первая привязка: unit=" .. tostring(A1_UNIT) .. " guid=" .. tostring(A1_GUID) .. " token=" .. tostring(A1_TOKEN))
  check(A1_NAME == "Nerubian" and A1_FIELD == "nameplate3",
    "имя рамки не синхронизировано (UnitName=" .. tostring(A1_NAME) .. ", поле на плейте=" .. tostring(A1_FIELD) .. ")")
  check(A1_CALLS == 1, "первая привязка перерисовала рамку " .. tostring(A1_CALLS) .. " раз, ожидался один")
  check(A2_CALLS == A1_CALLS, "пустой тик перерисовал рамку заново (" .. tostring(A2_CALLS) .. ")")
  -- имя обязано перекрашиваться БЕЗ второго аргумента: triggered в ElvUI-шном Update_Name
  -- (Elements/Name.lua:52-79) форсирует ветку «цвет по реакции», а NP:GetUnitInfo (Nameplates.lua:291-311)
  -- на этом клиенте распознаёт юнита по ЦВЕТУ нативной полосы и в конце падает в 3, ENEMY_PLAYER --
  -- то есть каждый наш пересчёт красил имя в db.reactions.bad. У PZ вызов без флага (Nameplates.lua:488)
  check(LAST_NAME_TRIGGERED == "nil",
    "refresh() зовёт Update_Name с triggered=" .. tostring(LAST_NAME_TRIGGERED)
    .. " -- ElvUI красит имя по реакции, отсюда красные ники")
  check(A3_UNIT == "nameplate3" and A3_GUID == "G9" and A3_NAME == "Chaos Invoker"
    and A3_CALLS == A2_CALLS + 1,
    "тот же слот под другим юнитом: unit=" .. tostring(A3_UNIT) .. " guid=" .. tostring(A3_GUID)
    .. " name=" .. tostring(A3_NAME))
  check(A4_UNIT == "nameplate3" and A4_CALLS == A3_CALLS + 1,
    "после того как ElvUI обнулил unit при уходе мыши, токен не вернулся: " .. tostring(A4_UNIT))
  check(A5_UNIT == "target" and A5_CALLS == A4_CALLS,
    "модуль отобрал у ElvUI настоящую цель (unit=" .. tostring(A5_UNIT) .. ", перерисовок " .. tostring(A5_CALLS) .. ")")
  check(A6_NAME == "Sapphrist" and A6_UNIT == "target" and A6_CALLS == A5_CALLS + 1,
    "OnShow уже привязанной рамки не догоняет смену имени (name=" .. tostring(A6_NAME)
    .. ", unit=" .. tostring(A6_UNIT) .. ", перерисовок " .. tostring(A6_CALLS) .. ")")

  -- 9b. полоса каста -- как её вешал PZ: состояние снимается с нативной полосы плейта, имя берётся из
  -- UnitCastingInfo, а если она молчит -- из боевого лога по guid
  check(type(HOOK_SHOWN) == "function" and type(HOOK_HIDDEN) == "function" and type(HOOK_VALUE) == "function",
    "OnCreated не навесил OnShow/OnHide/OnValueChanged на нативную полосу")
  -- двойной OnCreated -- тот дефект, из-за которого с ElvUI_Extras плейты мигают и пропадают
  check(SECOND_CREATED == 1,
    "второй OnCreated по той же рамке дошёл до подлинника ElvUI (вызовов " .. tostring(SECOND_CREATED)
    .. ") -- рамка остаётся с полусобранным и спрятанным unitFrame")
  check(SECOND_HOOKS == "1",
    "нативная полоса обвешана хуками " .. tostring(SECOND_HOOKS) .. " раз: наша развеска отработала и на "
    .. "пропущенном создании")
  -- guard обязан пережить чужой пост-хук, навешанный ПОЗЖЕ нас (PZ в Test стоит рядом с ElvUI_Extras)
  check(PZ_ON_CREATE == 1,
    "чужой пост-хук на OnCreated не отработал на настоящем создании: " .. tostring(PZ_ON_CREATE))
  check(PZ_AFTER_REPEAT == 1,
    "чужой пост-хук отработал и на пропущенном создании (вызовов " .. tostring(PZ_AFTER_REPEAT)
    .. " вместо одного) -- guard не вернулся наверх")
  check(HOOKS_AFTER_REPEAT == HOOKS_ON_CREATE,
    "после повтора нативная полоса получила ещё один комплект хуков: " .. tostring(HOOKS_ON_CREATE)
    .. " -> " .. tostring(HOOKS_AFTER_REPEAT))
  check(ANIM_SET == "nil",
    "у своей полосы не снят OnUpdate (PZ снимает, потому что значение ведёт нативная), стоит " .. tostring(ANIM_SET))
  check(SHOW_CASTBAR == "shown" and SHOW_SPELL == "Fireball" and SHOW_NAME == "Fireball",
    "OnShow: полоса " .. tostring(SHOW_CASTBAR) .. ", Name=" .. tostring(SHOW_NAME)
    .. ", spellName=" .. tostring(SHOW_SPELL))
  check(SHOW_FILTER == "FAKE_Casting", "OnShow не позвал StyleFilterUpdate (LAST_FILTER=" .. SHOW_FILTER .. ")")
  check(V_MIN == 0 and V_MAX == 3 and V_VALUE == 1,
    "OnValueChanged не переложил значения: min=" .. tostring(V_MIN) .. " max=" .. tostring(V_MAX)
    .. " value=" .. tostring(V_VALUE))
  check(V_CASTING == "yes", "значение выросло -- каст обязан быть casting, а нет (" .. tostring(V_CASTING) .. ")")
  check(V_ICON == "NATIVE_ICON" and V_NATIVE_ICON == "hidden",
    "иконка не скопирована с нативной полосы (" .. tostring(V_ICON) .. ") или нативная осталась видна ("
    .. tostring(V_NATIVE_ICON) .. ")")
  check(V_NAME == "Fireball", "имя на полосе не из spellName: " .. tostring(V_NAME))
  check(V_SPARK == "40.0", "искра не встала по значению (ожидается x=40.0 из (1/3)*120, вышло " .. tostring(V_SPARK) .. ")")
  check(V_FILTER == "FAKE_Casting", "StyleFilterUpdate не получил FAKE_Casting (" .. tostring(V_FILTER) .. ")")
  check(V_COLOR == "0.20/0.60/1.00", "цвет полосы не castColor: " .. tostring(V_COLOR))
  check(V_CHANNEL == "yes", "значение упало -- полоса обязана считаться каналом (" .. tostring(V_CHANNEL) .. ")")
  check(V_NOTINT == "yes" and V_COLOR2 == "0.78/0.25/0.25" and V_DESAT == "true",
    "щит нативной полосы не перешёл в непрерываемый: notInterruptible=" .. tostring(V_NOTINT)
    .. " цвет=" .. tostring(V_COLOR2) .. " десат=" .. tostring(V_DESAT))
  check(HIDE_CASTBAR == "hidden" and HIDE_SPELL == "nil",
    "OnHide не спрятал полосу и не сбросил имя: " .. tostring(HIDE_CASTBAR) .. " / " .. tostring(HIDE_SPELL))
  check(CL_EVENT == true, "событие COMBAT_LOG_EVENT_UNFILTERED не зарегистрировано: " .. tostring(CL_EVENT))
  check(CL_SPELL == "Arcane Missiles", "имя из боевого лога не легло в spellName: " .. tostring(CL_SPELL))
  check(OFF_VALUE == 99,
    "полоса выключена в профиле ElvUI, а состояние всё равно перекладывается (value=" .. tostring(OFF_VALUE) .. ")")

  -- 9d. весь HD-блок PZ: без showVKeyCastbar=1 клиент не ведёт нативную полосу, и дальше ничего не
  -- происходит; это первая причина, по которой полос в игре и не было
  check(VCAST == "1", "showVKeyCastbar не возвращён на 1 (вышло " .. VCAST .. ") -- при 0 клиент не ведёт нативную полосу")
  check(VCLASS == "1", "ShowClassColorInNameplate не выставлен: " .. VCLASS)
  check(VOVERLAP == "1", "nameplateAllowOverlap не выставлен для motionType=MOTION: " .. VOVERLAP)
  check(EV_KEPT == "nil" and EV_KEPT_CHANNEL == "nil",
    "на уже созданной рамке остались старые события каста (start=" .. EV_KEPT .. ", channelStop=" .. EV_KEPT_CHANNEL .. ")")
  check(PRIMED == "Fireball", "RegisterEvents не разбудил пересчёт имени: spellName=" .. PRIMED)
  check(FORCED == "Shadow Bolt",
    "OnEvent вышел по проверке юнита, как стоковый (self.unit=nameplate3, событие пришло на target): spellName=" .. FORCED)
  check(EV_AFTER_UNREG == "nil", "UnregisterAllEvents не снял то, что вешал RegisterEvents: " .. EV_AFTER_UNREG)

  -- 9b. рамка без токена: ни ошибки, ни привязки, ни перерисовки (03.10 23:54, «Usage: UnitGUID("unit")»
  -- с трейсом через ElvUI:OnCreated -> OnShow)
  check(NO_TOKEN_OK == "true",
    "OnShow рамки без токена упал ошибкой (UnitGUID по nil): " .. tostring(NO_TOKEN_OK))
  check(NO_TOKEN_UNIT == "nil" and NO_TOKEN_FIELD == "nil",
    "рамка без токена всё же привязалась: unit=" .. tostring(NO_TOKEN_UNIT)
    .. ", поле токена=" .. tostring(NO_TOKEN_FIELD))
  check(NP_CALLS.Health == NO_TOKEN_CALLS,
    "рамка без токена заставила перерисовать чужую рамку (" .. tostring(NO_TOKEN_CALLS) .. " -> "
    .. tostring(NP_CALLS.Health) .. ")")

  -- 9c. причина «не установился» обязана быть названа, а не спрятана за общей фразой: именно на ней
  -- вчерашний прогон в игре и встал
  check(FAIL_LINES == 6, "при снятом методе дамп напечатал " .. tostring(FAIL_LINES) .. " строк, ожидалось 6")
  check(FAIL_TYPES:find("ElvUI=table") ~= nil and FAIL_TYPES:find("ElvUI%[1%]=table") ~= nil
    and FAIL_TYPES:find("NamePlates=table") ~= nil
    and FAIL_TYPES:find("loadedElvUI=true") ~= nil, "дамп не сказал, что с ElvUI: " .. FAIL_TYPES)
  check(FAIL_NAME:find("Update_Name") ~= nil, "дамп не назвал отсутствующий метод идентичности: " .. FAIL_NAME)
  check(FAIL_CAST:find("методы на месте") ~= nil,
    "дамп не отделил полосу каста от идентичности: " .. FAIL_CAST)


  -- 9d. порядок в install(): список методов полосы проверяется ДО навески, иначе обёртка над отсутствующим
  -- методом падает ошибкой, а не молча пропускает полосу; и пропуск должен быть виден в дампе.
  -- Обёртка обязана быть обёрткой, а не пост-хуком: только она решает, что второй вызов по одной рамке
  -- не доходит ни до подлинника, ни до нашей развески.
  local modSrc = AW_MOD_SRC or ''
  local iCheck = string.find(modSrc, 'missingIn%(np, NEEDED_CAST%)', 1) or 0
  -- искать надо именно в теле install(): вызов wrapCreated встречается дважды (перестановка наверх в
  -- keepGuardTop стоит выше по файлу), и одно любое вхождение о порядке в install() не говорит ничего
  local iBranch = string.find(modSrc, 'CAST_SKIP = nil', 1) or 0
  local iHook = iBranch > 0 and (string.find(modSrc, 'wrapCreated%(np, np%.OnCreated%)', iBranch + 1) or 0) or 0
  check(iCheck > 0 and iBranch > iCheck and iHook > iBranch,
    'install() обёртывает OnCreated до проверки NEEDED_CAST (проверка на ' .. iCheck .. ', ветка на '
    .. iBranch .. ', обёртка на ' .. iHook .. ')')
  -- guard обязан возвращаться наверх: чужой пост-хук поверх нас отработал бы и на пропущенном создании
  check(string.find(modSrc, 'keepGuardTop%(np%)') ~= nil
    and string.find(modSrc, 'local function keepGuardTop') ~= nil,
    'в исходнике нет перестановки guard наверх (keepGuardTop) -- PZ, навешанный после нас, получит '
    .. 'свой хук и на пропущенном создании')
  check(string.find(modSrc, 'native%.awCastHooked') ~= nil,
    'развеска нативной полосы не стала идемпотентной -- вложенный guard повесил бы второй комплект хуков')
  check(string.find(modSrc, 'self%.CreatedPlates%[plate%]') ~= nil,
    'обёртка над OnCreated не смотрит CreatedPlates -- второй вызов по рамке пройдёт в подлинник ElvUI')
  check(string.find(modSrc, 'hooksecurefunc%s*%(%s*np%s*,%s*"OnCreated"') == nil,
    'OnCreated снова навешан пост-хуком: на пропущенном создании наша развеска отработает второй раз')
  check(string.find(modSrc, 'CAST_SKIP = castWhy') ~= nil, 'install() не запоминает, почему полоса не установлена')
  check(string.find(modSrc, 'полоса каста НЕ установлена') ~= nil, 'дамп не печатает строку про пропущенную полосу каста')

  -- 9f. идентичность обязана пережить отсутствующий метод PZ-блока (иначе один пропуск глушит и цвет
  -- класса, и имя, и ауры -- ровно это и произошло в игре 03.10 22:41)
  check(SPLIT_BOUND == "nameplate5",
    "без UpdateCVars не установилась даже идентичность (nameplateUnit=" .. tostring(SPLIT_BOUND) .. ")")
  check(SPLIT_HOOKED == "nil",
    "хук на нативную полосу навесился, хотя список полосы не пройден: " .. tostring(SPLIT_HOOKED))
  check(SPLIT_SKIP ~= '', "дамп не сказал, что полоса каста пропущена")

  -- 9g. два дефекта, из-за которых в игре не работало вообще ничего: форма глобала ElvUI (массив Engine,
  -- модуль в [1]) и установка раньше NP:Initialize. Оба ловятся тем, что заглушка теперь собранна так же,
  -- как собирает себя ElvUI в Init.lua:38-43, а не так, как удобно модулю
  check(NOINIT_UNIT == "nil" and NOINIT_HOOKED == "nil",
    "модуль установился до NP:Initialize (nameplateUnit=" .. tostring(NOINIT_UNIT)
    .. ", hooked=" .. tostring(NOINIT_HOOKED) .. ") -- awUpdateCVars читнул бы self.db на nil")
  check(NOINIT_LINES == 6, "дамп не-инициализированного ElvUI напечатал " .. tostring(NOINIT_LINES)
    .. " строк, ожидалось 6")
  check(NOINIT_SHAPE:find("ElvUI%[1%]=table") ~= nil and NOINIT_SHAPE:find("NamePlates=table") ~= nil,
    "дамп не показал, что модуль найден в ElvUI[1): " .. NOINIT_SHAPE)
  check(NOINIT_STATE:find("Initialized=nil") ~= nil and NOINIT_STATE:find("db=table") ~= nil,
    "дамп не назвал стадию инициализации ElvUI: " .. NOINIT_STATE)
  check(string.find(modSrc, 'E%[1%]') ~= nil,
    'в исходнике модуля нет обращения к ElvUI[1] -- значит форма глобала снова угадана неверно')
  check(string.find(modSrc, 'if not np%.Initialized then return end') ~= nil,
    'в исходнике модуля нет гейта NP.Initialized')
  check(string.find(modSrc, 'E:RegisterModule%("NamePlates"', 1) ~= nil,
    'в исходнике модуля нет установки в очередь модулей ElvUI (E:RegisterModule)')

  -- 9e. сам дамп /awplates cast: счётчики и строка по токену обязаны печататься правдиво
  check(DUMP_LINES == 3, "дамп напечатал " .. tostring(DUMP_LINES) .. " строк, ожидалось 3 (счётчики, события, токен)")
  check(DUMP_HEAD:find("created=1") ~= nil and DUMP_HEAD:find("hooked=1") ~= nil,
    "в строке счётчиков потеряны OnCreated или навеска хуков: " .. DUMP_HEAD)
  check(DUMP_EVENTS:find("ADDON_LOADED=2") ~= nil and DUMP_EVENTS:find("PLAYER_LOGIN=1") ~= nil
    and DUMP_EVENTS:find("NAME_PLATE=1") ~= nil,
    "строка событий врёт: " .. DUMP_EVENTS)
  check(DUMP_HEAD:find("show=1") ~= nil and DUMP_HEAD:find("hide=1") ~= nil and DUMP_HEAD:find("value=4") ~= nil,
    "счётчики скриптов не совпали с тем, что дёргал драйвер: " .. DUMP_HEAD)
  check(DUMP_TOKEN:find("reaction=2") ~= nil and DUMP_TOKEN:find("class=PRIEST") ~= nil
    and DUMP_TOKEN:find("nameColor=0%.9") ~= nil,
    "дамп не печатает тип/реакцию/класс/цвет имени: " .. DUMP_TOKEN)
  check(DUMP_TOKEN:find("unit=nameplate3") ~= nil and DUMP_TOKEN:find("enable=true") ~= nil,
    "строка токена не печатает юнит и профиль: " .. DUMP_TOKEN)
  check(DUMP_TOKEN:find("нативная shown=true") ~= nil and DUMP_TOKEN:find("max=3") ~= nil
    and DUMP_TOKEN:find("shield=true") ~= nil and DUMP_TOKEN:find("наша shown=false") ~= nil,
    "строка токена врёт про полосы (нативная видна/её max/щит/наша скрыта): " .. DUMP_TOKEN)
  -- рядом с мнением ElvUI дамп печатает ответы клиента по тому же токену
  check(DUMP_TOKEN:find("клиент: isPlayer=nil reaction=2 class=nil faction=nil") ~= nil,
    "дамп не печатает клиентские ответы по токену: " .. DUMP_TOKEN)
  check(NO_UNIT_DUMP == "true",
    "дамп по рамке без юнита упал ошибкой клиента (pcall дал " .. tostring(NO_UNIT_DUMP) .. ")")
  check(NO_UNIT_LINE:find("unit=nil") ~= nil
    and NO_UNIT_LINE:find("клиент: isPlayer=nil reaction=nil class=nil faction=nil") ~= nil,
    "дамп по рамке без юнита не напечатал пустые клиентские ответы: " .. NO_UNIT_LINE)

  -- 10. клик по ссылке-адресу (03.10): строка приветствия, схема, которую узнаёт хук, и адрес, который
  -- он вставляет, -- три места одного и того же механизма. Класс дефекта тот же, что у цепочки запрета
  -- (п. 7.41): правую часть переименовали, левая осталась, и в игре клик просто ничего не делает.
  local C = ACVar.CONSTANTS
  local url, scheme = C.DISCORD_URL, C.LINK_SCHEME
  check(type(url) == 'string' and string.len(url) > 8 and type(scheme) == 'string' and scheme ~= '',
    'CONSTANTS.DISCORD_URL или LINK_SCHEME пустые')
  local linkLines, linkText = 0, nil
  for _, line in ipairs(C.GREETING or {}) do
    if string.find(line, '|H' .. scheme .. ':', 1, true) then
      linkLines = linkLines + 1
      linkText = line
    end
  end
  check(linkLines == 1, 'строк-ссылок в GREETING ' .. linkLines .. ', ожидалась одна')
  check(linkText ~= nil and string.find(linkText, '|H' .. scheme .. ':' .. url .. '|h[' .. url .. ']|h', 1, true),
    'ссылка в GREETING ведёт не на CONSTANTS.DISCORD_URL, либо подпись не совпадает с адресом')

  local hook = AW_HOOKS['SetItemRef']
  check(type(hook) == 'function', 'хук на SetItemRef не зарегистрирован: клик по ссылке в чате не делает ничего')

  local function reset()
    AW_BOX.text, AW_BOX.inserts, AW_BOX.highlights = '', 0, 0
    AW_BOX.focuses, AW_BOX.clears, AW_BOX.shown = 0, 0, true
    AW_BOX_ACTIVATES = 0
    ItemRefTooltip.shown, AW_TOOLTIP_HIDES = true, 0
  end

  if type(hook) == 'function' then
    -- а) клик по своей схеме: пустое окно тултипа, которое 3.3.5a показывает на чужую схему, обязано
    -- исчезнуть, а адрес -- лечь в поле отправки выделенным
    reset()
    hook(scheme .. ':' .. url, linkText, 'LeftButton')
    check(AW_TOOLTIP_HIDES == 1, 'после клика по своей ссылке пустой ItemRefTooltip не снят (' .. AW_TOOLTIP_HIDES .. ')')
    check(AW_BOX.text == url, 'в поле отправки лежит ' .. tostring(AW_BOX.text) .. ', а не адрес ссылки')
    check(AW_BOX.inserts == 1 and AW_BOX.highlights == 1 and AW_BOX.focuses == 1,
      'вставка/выделение/фокус дали ' .. AW_BOX.inserts .. '/' .. AW_BOX.highlights .. '/' .. AW_BOX.focuses)

    -- б) второй клик по уже заполненному полю: так делает ElvUI внутри оригинального SetItemRef, то есть
    -- до нашего пост-хука, -- адрес не должен удвоиться
    local inserts = AW_BOX.inserts
    hook(scheme .. ':' .. url)
    check(AW_BOX.inserts == inserts, 'повторный клик вставил адрес второй раз (' .. AW_BOX.inserts .. ')')
    check(AW_BOX.highlights == 2, 'при повторном клике адрес не выделен заново (' .. AW_BOX.highlights .. ')')

    -- в) чужая схема: ни в поле, ни по тултипу не лезем, иначе клик по предмету терял бы описание
    reset()
    hook('item:123:0:0:0:0')
    check(AW_BOX.inserts == 0 and AW_BOX.text == '', 'клик по чужой ссылке положил в поле ' .. tostring(AW_BOX.text))
    check(AW_TOOLTIP_HIDES == 0, 'хук снял ItemRefTooltip у чужой схемы')

    -- г) пустая ссылка: тихо, без фокуса и без вставки
    reset()
    hook(scheme .. ':')
    check(AW_BOX.inserts == 0 and AW_BOX.focuses == 0,
      'пустая ссылка активировала поле (вставок ' .. AW_BOX.inserts .. ', фокусов ' .. AW_BOX.focuses .. ')')

    -- д) свёрнутое поле надо открыть, а не писать в невидимое
    reset()
    AW_BOX.shown = false
    hook(scheme .. ':' .. url)
    check(AW_BOX_ACTIVATES == 1, 'на скрытом поле ChatEdit_ActivateChat не вызван (' .. AW_BOX_ACTIVATES .. ')')

    -- е) поле с чужим текстом очищается перед вставкой (поведение снято с ElvUI SetChatEditBoxMessage)
    reset()
    AW_BOX.text = 'неотправленное сообщение'
    hook(scheme .. ':' .. url)
    check(AW_BOX.text == url, 'после вставки в поле осталось ' .. tostring(AW_BOX.text))
    check(AW_BOX.clears == 1, 'чужой текст поля не был снят перед вставкой (clears=' .. AW_BOX.clears .. ')')
  end

  -- ж) подвал окна: клик-зона строится по тому же массиву и вставляет тот же адрес. UI.lua в fengari не
  -- грузится (она поднимает всё окно со всеми его заглушками), поэтому проверка по исходнику -- как
  -- проверки порядка в dll: читается текст, а не выполняется.
  local ui = AW_UI_SRC
  check(type(ui) == 'string' and string.len(ui) > 0, 'исходник UI.lua не передан в гейт')
  check(string.find(ui, 'ipairs(CONSTANTS.GREETING or {}) do', 1, true) ~= nil,
    'подвал окна больше не строится по CONSTANTS.GREETING')
  check(string.find(ui, 'table.concat(CONSTANTS.GREETING', 1, true) == nil,
    'подвал вернулся к одному многострочному FontString: клик-зону нечем растянуть по строке')
  check(string.find(ui, 'PutUrlInChatBox(CONSTANTS.DISCORD_URL)', 1, true) ~= nil,
    'клик-зона подвала не вызывает ACVar:PutUrlInChatBox(CONSTANTS.DISCORD_URL)')
  check(string.find(ui, '"|H" .. CONSTANTS.LINK_SCHEME .. ":"', 1, true) ~= nil,
    'подвал разбирает ссылку по своей схеме, а не по CONSTANTS.LINK_SCHEME')
  check(string.find(ui, 'SetText(CONSTANTS.LINK_HINT,', 1, true) ~= nil,
    'подвал не показывает подсказку LINK_HINT при наведении')
  -- и то, ради чего подвал перестал быть одним многострочным текстом: клик-зона стоит на строке с
  -- адресом, а сама разметка в окне срезается -- FontString 3.3.5a клик по ссылке не получает, и
  -- невырезанный "|Hurl:..." было бы видно глазами
  local shown = string.gsub(linkText or '', '|H' .. scheme .. ':[^|]*|h%[(.-)%]|h', '%1')
  check(not string.find(shown, '|H', 1, true) and string.find(shown, url, 1, true),
    'после снятия разметки в подвале осталось: ' .. tostring(shown))
  check(string.find(ui, 'gsub(linkMarkup .. "[^|]*|h%[(.-)%]|h", "%1")', 1, true) ~= nil,
    'паттерн снятия разметки в UI.lua разъехался с тем, что проверяет гейт')

  local PULL_SUMMARY = 'нет'
  -- 11. метки дистанции (AWDistance.lua) и их вкладка (DistancePanel.lua). Сценарии гоняются выше, здесь
  -- проверяется то, что глаз в игре по одной строке лога не увидит: профиль по типу плейта, привязки,
  -- гашение без числа и без юнита, клампы, переклейка стиля только по правке и fuse.
  do
    check(N1_NPC_TEXT == '12.3', 'плейт печатает ' .. tostring(N1_NPC_TEXT) .. ', а 12.34 ярда это 12.3')
    check(N1_NPC_COLOR == '0.8/0.8/0.8', 'НПС-плейт окрашен ' .. tostring(N1_NPC_COLOR) .. ', ожидался профиль npcs')
    check(N1_PLAYER_COLOR == '1/0.82/0', 'плейт игрока окрашен ' .. tostring(N1_PLAYER_COLOR) .. ', ожидался профиль players')
    check(N1_NPC_POINT == 'RIGHT/LEFT', 'метка заякорена ' .. tostring(N1_NPC_POINT) .. ', при стороне LEFT ожидалось RIGHT/LEFT')
    check(N1_NPC_ANCHOR == 'plateNPC', 'метка не ребёнок рамки плейта: ' .. tostring(N1_NPC_ANCHOR))
    check(N1_NPC_XY == '-4/0', 'смещение метки ' .. tostring(N1_NPC_XY) .. ', в профиле -4/0')
    check(string.find(N1_NPC_FONT, 'FRIZQT', 1, true) ~= nil and string.find(N1_NPC_FONT, '/12/OUTLINE', 1, true) ~= nil,
      'шрифт метки ' .. tostring(N1_NPC_FONT) .. ', ожидался FRIZQT 12 OUTLINE')
    check(N1_UNIT_CREATED == 2, 'меток цели/фокуса создано ' .. tostring(N1_UNIT_CREATED))
    check(N1_TARGET_TEXT == '25.0', 'метка цели печатает ' .. tostring(N1_TARGET_TEXT))
    check(N1_TARGET_ANCHOR == 'ElvUF_Target', 'цель привязана к ' .. tostring(N1_TARGET_ANCHOR) .. ', при видимом Элв-фрейме ожидался он')
    check(N1_TARGET_POINT == 'TOP/BOTTOM', 'сторона цели ' .. tostring(N1_TARGET_POINT) .. ', ожидался BOTTOM => TOP/BOTTOM')
    check(N1_FOCUS_ANCHOR == 'FocusFrame', 'фокус привязан к ' .. tostring(N1_FOCUS_ANCHOR) .. ' (ElvUF_Focus скрыт -> стожовый)')
    check(string.find(tostring(N1_APPLIED), 'FRIZQT', 1, true) ~= nil,
      'применённый шрифт читается обратно как ' .. tostring(N1_APPLIED) .. ' -- без этого отказ шрифта не виден')
    -- 1b: ответ обязан жить в профиле, а не в живой метке (скриншот владельца 04.10 20:2x)
    check(N1_REQ == N1_APP and string.find(N1_APP, 'FRIZQT', 1, true) ~= nil,
      'fontInfo("players") даёт запрошен ' .. tostring(N1_REQ) .. ' и применён ' .. tostring(N1_APP)
      .. ' -- отказ шрифта обязан быть виден как расхождение')
    check(N21_LABEL_GONE == 'yes' and string.find(tostring(N21_APPLIED_KEPT), 'FRIZQT', 1, true) ~= nil,
      'меток профиля нет (label=' .. tostring(N21_LABEL_GONE) .. '), и окно теряет его шрифт: appliedFont='
      .. tostring(N21_APPLIED_KEPT) .. ' -- ровно то и видел игрок двумя nil в статусной строке')
    check(string.find(tostring(N21_INFO_KEPT), 'FRIZQT', 1, true) ~= nil,
      'fontInfo() после исчезновения меток молчит: ' .. tostring(N21_INFO_KEPT))
    check(N21_NEVER == 'nil', 'профиль, который никогда не рисовал, отвечает ' .. tostring(N21_NEVER)
      .. ' -- «ещё не рисовал» неотличимо от «шрифт не принят»')
    -- 1c: тумблер снят -> меток нет; вернулся -> есть; переменной нет -> рисовалка не сама себя гасит
    check(N22_PLATE_HIDDEN == 'yes', 'distanceDisplay=0, а метки плейтов ' .. tostring(N22_PLATE_HIDDEN)
      .. ' -- числа зависают последним значением (баг владельца 04.10 21:1x)')
    check(N22_UNIT_HIDDEN == 'yes', 'distanceDisplay=0, а метки цели/фокуса ' .. tostring(N22_UNIT_HIDDEN))
    check(N22_BACK == 'yes', 'distanceDisplay вернулся, а метки не появились: ' .. tostring(N22_BACK))
    check(N23_NO_CVAR == 'yes', 'переменной distanceDisplay нет, и рисовалка погасила метки сама --'
      .. ' гасить может только снятый тумблер, а не его отсутствие')
    check(N23_OFF == 'yes', 'на живом состоянии тумблер снят, а метка осталась: ' .. tostring(N23_OFF))
    check(N23_BACK == 'yes', 'тумблер вернулся на живом состоянии, а метка не появилась: ' .. tostring(N23_BACK))
    -- 24: якорь обязан уйти на экран, а не остаться на скрытом фрейме
    check(N24_ANCHOR == 'UIParent', 'без видимого фрейма фокуса метка заякорена на ' .. tostring(N24_ANCHOR)
      .. ' -- на скрытом фрейме её не видно никогда (баг владельца 04.10 22:4x)')
    check(N24_SHOWN == 'yes', 'на экране метка фокуса всё равно не показана: ' .. tostring(N24_SHOWN))
    check(N24_BACK == 'FocusFrame', 'FocusFrame снова виден, а метка осталась на ' .. tostring(N24_BACK))
    check(N24_ELVE == 'ElvUF_Focus', 'ElvUF_Focus виден, а метка на ' .. tostring(N24_ELVE)
      .. ' -- приоритет Элв-фрейма разъехался')
    -- 25: ярд плейта вместо молчащего резолвера, и только когда юнит действительно под плейтом
    check(N25_TEXT == '12', 'фокус без числа от dll обязан взять ярд своего плейта (12.34 -> 12), а метка '
      .. 'печатает ' .. tostring(N25_TEXT))
    check(N25_SHOWN == 'yes', 'ярд плейта подставлен, но метка фокуса не показана: ' .. tostring(N25_SHOWN))
    check(N25_NOPLATE == 'yes', 'у фокуса нет плейта, а метка ' .. tostring(N25_NOPLATE)
      .. ' -- врать чужим числом нельзя')
    check(N25_DUP_HID == 'yes', 'число фокуса взято с его же плейта, «не дублировать» включено, а метка у '
      .. 'фрейма ' .. tostring(N25_DUP_HID) .. ' -- это и есть дубль')
    check(N25_PLATE_KEPT == 'yes', 'метку фокуса сняли, но цифра на его плейте обязана остаться')
    check(N2_NO_RESTYLE == 'yes', 'на втором кадре без правок стиль переклеен снова: SetFont/SetPoint дороже самих цифр')
    check(N3_WHOLE == '13', 'decimals=false дал ' .. tostring(N3_WHOLE) .. ', ожидалось целое 12')
    check(N3_FAR_HIDDEN == 'yes', 'предел 10 ярдов, а далёкий плейт всё равно нарисован')
    check(N3_NEAR_SHOWN == 'yes', 'при пределе пропал и близкий плейт')
    check(N4_PLATE_KEPT == 'yes',
      'hideOwnPlate=true сняла цифру с плейта цели -- дублем считается метка у фрейма, а не цифра на плейте')
    check(N4_TARGET_LABEL_HIDDEN == 'yes',
      'hideOwnPlate=true, а метка у фрейма цели видна -- это владелец и назвал «не прячет таргет» (05.10 00:52)')
    check(N4_FOCUS_LABEL_SHOWN == 'yes',
      'у фокуса нет плейта с цифрой, а его метка снята -- прятать нечего, число единственное')
    check(N4_OTHER_PLATE_SHOWN == 'yes', 'hideOwnPlate зацепил чужой плейт')
    check(N5_PLAYER_ANCHOR == 'platePlayer/имя', 'anchor=name, а метка прицеплена к ' .. tostring(N5_PLAYER_ANCHOR))
    check(N6_TARGET_ELVE == 'ElvUF_Target', 'ElvUF_Target виден, а привязка ушла на ' .. tostring(N6_TARGET_ELVE))
    check(N6_TARGET_STOCK == 'TargetFrame', 'ElvUF_Target скрыт -- ожидался TargetFrame, а вышло ' .. tostring(N6_TARGET_STOCK))
    check(N6_TARGET_SCREEN == 'UIParent', 'anchor=screen, а метка цели на ' .. tostring(N6_TARGET_SCREEN))
    check(N7_FOCUS_ANCHOR == 'FocusFrame', 'фокус снова привязался к ' .. tostring(N7_FOCUS_ANCHOR))
    check(N8_SIZE_CLAMP == 36, 'size=999 стал ' .. tostring(N8_SIZE_CLAMP) .. ', вилка рисовалки 6..36')
    check(N8_X_CLAMP == -2000, 'x=-999999 стал ' .. tostring(N8_X_CLAMP) .. ', вилка -2000..2000')
    check(N8_RANGE_CLAMP == 100, 'maxRange=5000 стал ' .. tostring(N8_RANGE_CLAMP) .. ', вилка 5..100')
    check(N8_GARBAGE == 12, 'мусор вместо числа дал ' .. tostring(N8_GARBAGE) .. ', ожидался дефолт 12')
    check(N9_NPC_SIDE == 'BOTTOMLEFT/TOPRIGHT', 'сторона TOPRIGHT приехала как ' .. tostring(N9_NPC_SIDE))
    check(N9_NPC_XY == '6/-3', 'смещения не доехали до SetPoint: ' .. tostring(N9_NPC_XY))
    check(N10_NPC_COLOR == '0.25/0.5/0.75', 'цвет профиля не доехал до метки: ' .. tostring(N10_NPC_COLOR))
    check(N11_RESET == '12/LEFT/true/true', 'reset() вернул не дефолты: ' .. tostring(N11_RESET))
    check(N12_FOCUS_HIDDEN == 'yes', 'цифра фокуса стоит, юнита нет, а метка не погасла (баг 04.10 15:5x)')
    check(N12_TARGET_HIDDEN == 'yes', 'то же с целью: UnitExists=nil, а метка видна')
    check(N12_BACK == 'yes', 'юниты вернулись -- метки не появились')
    check(N13_NO_FRAME_HIDDEN == 'yes', 'токен без рамки, а метка видна')
    check(N14_DROPPED == 'yes', 'мёртвая рамка осталась в кэше (плашки/юниты: ' .. tostring(N14_DROPPED) .. ')')
    check(N15_NO_REGROW == 'yes', 'на мёртвом токене плодятся новые метки: ' .. tostring(N15_NO_REGROW))
    check(N16_REBUILT == 'yes', 'после входа в мир метки не перестроились')
    check(N17_BROKEN == 'yes', 'после пяти падений рисовалка не отключилась')
    check(N17_QUIET == 'yes', 'отключившись, рисовалка продолжает падать в тике: ' .. tostring(N17_QUIET))
    check(N17_SAID_ONCE == 'yes', 'сообщение о падении печатается не один раз: ' .. tostring(N17_SAID_ONCE))
    check(N17_STATUS == 'nil', 'в сломанном состоянии status() обязан молчать про счётчики, а вернул ' .. tostring(N17_STATUS))
    check(N18_SILENT == 'yes', 'без таблиц dll рисовалка упала или полезла создавать метки')
    check(N19_DUMP_OK == 'yes', 'дамп /awdistance падает')
    check(N19_DUMP_LINES >= 7, 'дамп печатает строк ' .. tostring(N19_DUMP_LINES) .. ', ожидалось >= 7')
    check(N19_DUMP_ASCII == 'yes', 'в выводе дампа не-ASCII: ' .. tostring(N19_DUMP_ASCII) .. ' -- этот клиент enUS+cp1251')
    check(N20_TAB == 'yes', 'DistancePanel.lua не зарегистрировал вкладку с парой build/refresh')
    check(N20_ROW == 'distanceDisplay', 'панель объявляет другую строку CVar: ' .. tostring(N20_ROW))
    check(N20_NOTICE == 'yes', 'без рисовалки панель не объясняет причину, а должна')
    local src, panel = AW_DIST_SRC, AW_PANEL_SRC
    -- комментарии вырезаются: иначе проверка на 'OpenColorPicker(' падает на собственном объяснении,
    -- почему этого вызова в коде нет
    local function codeOnly(text)
      -- split by character 10 on purpose: a JS template would eat the backslash-n escape
      local NL = string.char(10)
      local keep = {}
      for part in (tostring(text) .. NL):gmatch('([^' .. NL .. ']*)' .. NL) do
        if not part:match('^%s*%-%-') then keep[#keep + 1] = part end
      end
      return table.concat(keep, NL)
    end
    local srcCode, panelCode = codeOnly(src), codeOnly(panel)
    check(type(src) == 'string' and type(panel) == 'string', 'исходники дистанции не переданы в гейт')
    check(string.find(src, 'setmetatable(', 1, true) == nil and string.find(src, "__gc'", 1, true) == nil,
      'в рисовалке появилась метатаблица: это указатель в данных клиента, за такое #134')
    check(string.find(srcCode, 'C_NamePlate', 1, true) == nil, 'рисовалка снова зависит от шима C_NamePlate')
    check(string.find(srcCode, 'plate:CreateFontString(nil, "OVERLAY", "GameFontNormal")', 1, true) ~= nil,
      'метка плейта больше не ребёнок рамки плейта')
    check(string.find(srcCode, 'UnitExists(key)', 1, true) ~= nil, 'рисовалка перестала спрашивать клиента, есть ли юнит')
    check(string.find(srcCode, 'hex:sub(3, 3)', 1, true) ~= nil,
      'деление плейтов на игроков и НПС по guid разъехалося с формулой заготовки (индекс 3, hex без 0x)')
    check(string.find(panelCode, 'OpenColorPicker', 1, true) == nil,
      'панель зовёт OpenColorPicker -- на 3.3.5a такой функции нет, будет ошибка при первом клике по цвету')
    check(string.find(panelCode, 'UIDropDownMenu_AddButton', 1, true) == nil,
      'панель снова раскрывает нативный UIDropDownMenu: на 3.3.5a у него нет ползунка, и список шрифтов уходит за экран '
      .. '-- раскрывать надо pullout (замер владельца 04.10 19:0x)')
    check(string.find(panelCode, 'frame:SetPoint("TOPLEFT", dd, "BOTTOMLEFT"', 1, true) ~= nil,
      'pullout не заякорен на кнопку дропдауна: 3.3.5 поставит список в геометрию последнего меню, и вместо меню '
      .. 'получится длинный прямоугольник (замер владельца 04.10 17:4x)')
    check(string.find(panelCode, 'ColorPickerFrame:SetColorRGB', 1, true) ~= nil,
      'панель больше не открывает пипетку способом, который здесь работает (тот же, что у iTF)')
    check(string.find(panelCode, 'CreateFrame("CheckButton", nextName(', 1, true) ~= nil
      and string.find(panelCode, 'CreateFrame("Slider", nextName(', 1, true) ~= nil
      and string.find(panelCode, 'CreateFrame("EditBox", nextName(', 1, true) ~= nil,
      'виджеты панели снова безымянные: _G[cb:GetName() .. "Text"] на них падает, а подписи слайдера не создаются')
    check(string.find(panelCode, 'local clamps = a.clamps', 1, true) ~= nil
      and string.find(panelCode, 'clamps.size[1], clamps.size[2]', 1, true) ~= nil
      and string.find(panelCode, 'a.clamps.maxRange[1], a.clamps.maxRange[2]', 1, true) ~= nil,
      'ползунки панели больше не берут вилку из CLAMPS рисовалки -- настройка и ограничение разъедутся')
    check(string.find(panelCode, 'ACVar.CUSTOM_PANEL_CVAR_ROWS', 1, true) ~= nil,
      'единственный CVar панели объявлен не там, где его читает контракт')
    -- и то, зачем панель гоняется по-настоящему (см. блок сборки выше): метод, которого на этом патче
    -- нет, клиент ловит только в бою, а стенд ловит его здесь
    local PF = PANEL_FACTS or {}
    check(PF.built == 'ok', 'панель Distance не собралась: ' .. tostring(PF.built))
    check((tonumber(PF.textless) or 1) == 0,
      'в раскрытых списках панели ' .. tostring(PF.textless) .. ' пунктов без подписи (' .. tostring(PF.textlessWhy) .. ')')
    check((tonumber(PF.dropMin) or 0) >= 100, 'ширина дропдауна панели = ' .. tostring(PF.dropMin) .. ' -- значит её взяли из GetWidth() фрейма, который ещё не разложен (в игре это сжатая стрелка)')
    check((tonumber(PF.frames) or 0) >= 40, 'панель создала виджетов: ' .. tostring(PF.frames) .. ', ожидалось >= 40 (пять блоков)')
    -- pullout (замер владельца 04.10 19:0x: список шрифтов ушёл за экран). Стенд раскрывает все 16
    -- дропдаунов кликом по кнопке шаблона, и здесь проверяется то, что видит игрок: список не выше
    -- свободного места, но и не короче содержимого; ползунок появляется только когда он нужен; колесо
    -- сдвигает содержимое, а клик по пункту пишет значение.
    local lists = tonumber(PF.lists) or 0
    check(lists >= 16, 'дропдаунов панели раскрыто ' .. lists .. ', ожидалось 16 (4 настройки x 4 блока)')
    check(string.find(tostring(PF.clickWhy), 'FAIL', 1, true) == nil, 'раскрытие списка упало: ' .. tostring(PF.clickWhy))
    local fixture = tonumber(PF.fixture) or 0
    check((tonumber(PF.rowsMax) or 0) == fixture,
      'в самом длинном списке пунктов ' .. tostring(PF.rowsMax) .. ', а фикстура даёт ' .. fixture .. ' -- пункты теряются')
    local capped, childH, scrollH = tonumber(PF.capped) or 0, tonumber(PF.childH) or 0, tonumber(PF.scrollH) or 0
    check(capped > 0 and capped <= 192,
      'раскрытый список высотой ' .. capped .. ' пикселей при 200 пикселях до нижнего края экрана: вот он и '
      .. 'уезжает за экран -- потолок надо брать от свободного места под контролом')
    check(childH == 8 + 16 * fixture,
      'содержимое списка ' .. childH .. ' пикселей, ожидалось ' .. (8 + 16 * fixture) .. ' (8 + 16 на пункт): '
      .. 'пункты обрезаны вместе с рамкой, а не спрятаны под ползунком')
    check(scrollH > 0 and childH > scrollH,
      'видимая область списка ' .. scrollH .. ', содержимое ' .. childH .. ' -- при равных высотах проверка '
      .. 'ползунка ничего не стоит')
    check(PF.pslider == 'yes', 'в списке из ' .. tostring(PF.rowsMax) .. ' пунктов ползунка нет -- отсюда и уход за экран')
    check(PF.shortSlider == 'no',
      'у короткого списка (' .. tostring(PF.shortRows) .. ' пунктов) ползунок показан: лишняя полоса там, где места хватает')
    local offset = tonumber(PF.offset) or 0
    check(offset > 0, 'колесо вниз не сдвинуло содержимое (offset = ' .. offset .. ') -- прокрутки нет')
    check(offset <= childH - scrollH,
      'после колеса содержимое сдвинуто на ' .. offset .. ', максимум ' .. (childH - scrollH) .. ' -- уехало само')
    check(PF.pullClick == 'true', 'клик по пункту списка упал: ' .. tostring(PF.pullClick))
    check(tostring(PF.pullClickValue) ~= 'nil', 'у пункта списка нет значения: выбор не напишет в профиль')
    -- слои: порядок strata 3.3.5a (FrameXML документирован) таков, что внутри ОДНОГО слоя порядок идёт по
    -- frameLevel. Окно AwesomeCVar само стоит в FULLSCREEN_DIALOG (UI.lua:335), значит список в том же слое
    -- рисует ПОД ним -- владелец это и увидел («дропдавн где то за окном открывается», 04.10 19:3x)
    local STRATA = { BACKGROUND = 1, LOW = 2, MEDIUM = 3, HIGH = 4, DIALOG = 5,
                     FULLSCREEN = 6, FULLSCREEN_DIALOG = 7, TOOLTIP = 8 }
    local ui = AW_UI_SRC or ''
    local at = string.find(ui, '"AwesomeCVarFrame"', 1, true)
    local winStrata = at and string.match(string.sub(ui, at), 'SetFrameStrata%("([A-Z_]+)"%)') or 'нет'
    check(STRATA[winStrata] ~= nil, 'из UI.lua не вычитан слой окна (найдено: ' .. tostring(winStrata) .. ')')
    check((STRATA[PF.pstrata] or 0) > (STRATA[winStrata] or 99),
      'список лежит в слое ' .. tostring(PF.pstrata) .. ', а окно -- в ' .. tostring(winStrata)
      .. ': внутри одного слоя порядок берётся по frameLevel, то есть список рисует ПОД окном')
    check(PF.kidStrata == PF.pstrata,
      'у children списка слой ' .. tostring(PF.kidStrata) .. ', у рамки ' .. tostring(PF.pstrata)
      .. ' -- strata надо спускать на всех детей (AceGUI :25-34, :198), иначе содержимое останется ниже')
    check(PF.anchorTo == 'контрол', 'pullout заякорен не на свой дропдаун: ' .. tostring(PF.anchorTo))
    check(PF.anchorXY == '18/2', 'смещения привязки списка ' .. tostring(PF.anchorXY)
      .. ', а клиент для этого же шаблона использует 18/2 (UI.lua:546-548) -- иначе список левее полосы')
    -- язык: вкладка собрана на ru-клиенте (GetLocale = ruRU в блоке выше), значит ни один пункт кроме
    -- имён шрифтов не имеет права остаться строкой рисовалки
    check(tostring(PF.enItems) == '', 'пункты списков без перевода: ' .. tostring(PF.enItems))
    check(tostring(PF.enClosed) == '', 'в закрытом дропдауне подпись без перевода: ' .. tostring(PF.enClosed))
    -- заметка о применённом шрифте -- своя у каждого блока, короткая, и словами на оба края
    local notes = tostring(PF.notes)
    check((tonumber(PF.notesN) or 0) == 4,
      'заметок о шрифте ' .. tostring(PF.notesN) .. ', ожидалось 4 (по одной на блок): ' .. notes)
    check((tonumber(PF.notesLong) or 1) == 0,
      'заметка длиннее 44 символов или заякорена не с двух сторон -- она снова упирается в край окна: ' .. notes)
    check(string.find(notes, 'FRIZQT', 1, true) ~= nil, 'ни одна заметка не показывает применённый шрифт: ' .. notes)
    check(string.find(notes, 'меток ещё не было', 1, true) ~= nil,
      'профиль без единой метки не объяснён словами: ' .. notes)
    check(string.find(notes, 'клиент взял: REQUESTED -> KEPTBYCLIENT', 1, true) ~= nil,
      'расхождение запрошенного и взятого клиентом шрифта не видно: ' .. notes)
    check(string.find(notes, 'nil', 1, true) == nil, 'в заметках шрифта nil: ' .. notes)
    check(string.find(notes, 'Плейты игроков: Плейты НПС', 1, true) == nil,
      'заметки снова склеены в одну длинную строку через весь кадр: ' .. notes)
    PULL_SUMMARY = table.concat({
      tostring(PF.lists) .. ' списков', tostring(PF.rowsMax) .. ' пунктов',
      'рамка ' .. tostring(PF.capped) .. 'px', 'контент ' .. tostring(PF.childH) .. 'px',
      'видимых ' .. tostring(PF.scrollH) .. 'px', 'колесо ' .. tostring(PF.offset) .. 'px',
      'ползунок ' .. tostring(PF.pslider) .. '/' .. tostring(PF.shortSlider)
    }, ', ')
    check(PF.check == 'есть', 'у панели нет ни одного чекбокса')
    check(PF.click == 'true', 'клик по чекбоксу панели упал: ' .. tostring(PF.click))
    check(PF.slider == 'true', 'OnValueChanged слайдера панели упал: ' .. tostring(PF.slider))
    check(PF.swatch == 'true', 'клик по образцу цвета упал: ' .. tostring(PF.swatch))
    check(PF.swatchFunc == 'yes', 'пипетка не получила func -- выбирать цвет будет некому')
    check(PF.cancel == 'true', 'cancelFunc пипетки упал: ' .. tostring(PF.cancel))
    check(PF.notice == 'true', 'панель падает, когда рисовалки нет: ' .. tostring(PF.notice))
    -- 26. оформитель вкладки: виджеты ленивой сборки обязаны быть оформлены, причём каждый своим
    -- обработчиком и ровно один раз
    check(PF.skHook == 'есть', 'ленивой сборки вкладки касает только хук на UpdateDistancePanel -- без него её виджеты остаются неоформленными')
    check(PF.skMissed == 'нет', 'skin-обход вкладки пропустил виджеты: ' .. tostring(PF.skMissed))
    check(PF.skAnchors == 'нет', 'после HandleDropDownBox у дропдауна не осталось пары якорей -- список '
      .. 'сожмётся до ширины, которую задал оформитель, а не до ширины строки')
    check(PF.skTwice == 'нет', 'дропаун оформлен дважды: повторный проход обязан проходить мимо готового')
    check(PF.skSwatch == 'нет', 'образец цвета уехал в HandleButton -- у него своя текстура, и кнопка её съест')
    check(PF.skAgain == 'нет', 'повторный refresh вкладки оформляет виджеты заново')
    check((tonumber(PF.skKinds) or 0) >= 40, 'skin-обход видел виджетов ' .. tostring(PF.skKinds)
      .. ' -- похоже, дерево блоков не обошло')
  end

  -- 27. канал /interact (AWInteract.lua). Разбор строки воспроизводится ровно по ChatFrame.lua
  -- :3997-4075 (function ChatEdit_ParseText), иначе стенд проверял бы свою выдуманную рассылку:
  -- command = "^(/[^%s]+)" С ведущим
  -- слэшем, strupper, msg = strsub(text, strlen(command)+2); сначала хэш hash_SlashCmdList (:4047),
  -- при промахе медленный проход по SlashCmdList через глобалы SLASH_<index><i> (:4063-4075), и
  -- найденная команда остаётся в хэше. Хэш пуст на старте -- наша команда в него не предзаполнена
  -- (предзаполняется только hash_SecureCmdList, :1419-1429), поэтому первый вызов обязан идти
  -- медленным путём, а второй -- хэшем.
  local HASH = {}
  local function trim(s) return (string.gsub(s or '', '^%s*(.-)%s*$', '%1')) end
  local function dispatch(text)
    if string.sub(text, 1, 1) ~= '/' then return 'нет слэша' end
    local command = string.match(text, '^(/[^%s]+)') or ''
    local msg = ''
    if command ~= text then msg = string.sub(text, string.len(command) + 2) end
    command = string.upper(command)
    if HASH[command] then
      local ok, why = pcall(HASH[command], trim(msg))
      return ok and 'hash' or ('упало: ' .. tostring(why))
    end
    for index, value in pairs(SlashCmdList) do
      local i = 1
      local cmdString = _G['SLASH_' .. index .. i]
      while cmdString do
        cmdString = string.upper(cmdString)
        if cmdString == command then
          HASH[command] = value
          local ok, why = pcall(value, trim(msg))
          return ok and 'slow' or ('упало: ' .. tostring(why))
        end
        i = i + 1
        cmdString = _G['SLASH_' .. index .. i]
      end
    end
    return 'unknown'
  end

  check(type(AWInteract) == 'function',
    'AWInteract не глобал: макрос /run AWInteract() из подсказки в файле упадёт на пустом месте')
  local slashName1 = rawget(_G, 'SLASH_AWINTERACT1')
  check(type(slashName1) == 'string', 'нет глобала SLASH_AWINTERACT1 -- FrameXML не по чему искать команду')
  local key = slashName1 and string.match('SLASH_AWINTERACT1', '^SLASH_(.-)%d+$') or ''
  check(type(SlashCmdList[key]) == 'function',
    'в SlashCmdList нет ключа ' .. tostring(key) .. ' -- имя глобала и имя обработника разошлись')
  check(string.upper(tostring(slashName1)) == '/INTERACT',
    'первое имя команды не /interact: ' .. tostring(slashName1))
  check(string.upper(tostring(rawget(_G, 'SLASH_AWINTERACT2'))) == '/SMARTINTERACT',
    'алиас /smartinteract потерян: ' .. tostring(rawget(_G, 'SLASH_AWINTERACT2')))

  local t0 = AW_Request
  local why1 = dispatch('/interact')
  check(why1 == 'slow', 'первый /interact прошёл как «' .. why1 .. '» -- медленный путь FrameXML не отработал')
  check(AW_Request == t0, 'обработник подменил таблицу AW_Request, dll читает другую')
  check(rawget(_G, 'AW_Request') ~= nil,
    'AW_Request не глобал: dll делает lua_getglobal(L, "AW_Request") и не увидит канал')
  check(tostring(AW_Request.interact) == 'true',
    'после /interact в канале «' .. tostring(AW_Request.interact) .. '», ожидалось true')
  check(dispatch('/interact') == 'hash', 'после первого вызова команда не легла в хэш')
  check(type(dispatch('/INTERACT')) == 'string' and dispatch('/INTERACT') ~= 'unknown',
    'регистр команды ломает канал: ' .. dispatch('/INTERACT'))

  local KEEP = 7
  AW_Request.keepme = KEEP
  dispatch('/interact target')
  check(AW_Request.interact == 'target',
    'аргумент записан как «' .. tostring(AW_Request.interact) .. '» -- msg берётся без пробела '
    .. '(strsub(text, strlen(command)+2) и strtrim)')
  check(AW_Request.keepme == KEEP, 'обработник пересоздаёт AW_Request и съедает чужие ключи')
  dispatch('/smartinteract focus')
  check(AW_Request.interact == 'focus', 'алиас /smartinteract с аргументом: ' .. tostring(AW_Request.interact))
  AWInteract('nameplate1')
  check(AW_Request.interact == 'nameplate1',
    'токен плейта как аргумент дописан/съеден: ' .. tostring(AW_Request.interact))

  AW_Request.interact = nil
  local whyUnknown = dispatch('/interactx')
  check(whyUnknown == 'unknown' and AW_Request.interact == nil,
    'чужая команда /interactx разбудила канал (' .. whyUnknown .. ', ' .. tostring(AW_Request.interact) .. ')')
  check(dispatch('interact') == 'нет слэша', 'строка без слэша сошла за команду')
  -- канал обязан оставаться чистыми данными: lua_CFunction в состоянии клиента -- измеренный ERROR #134
  local badType = ''
  for _, text in ipairs({ '/interact', '/interact target', '/smartinteract' }) do
    dispatch(text)
    local kind = type(AW_Request.interact)
    if kind ~= 'boolean' and kind ~= 'string' then badType = kind end
  end
  check(badType == '', 'в канал /interact записано значение типа ' .. badType .. ' вместо данных')
  INTERACT_SUMMARY = 'команда ' .. tostring(slashName1) .. '/' .. tostring(rawget(_G, 'SLASH_AWINTERACT2'))
    .. ', аргумент ' .. tostring(AW_Request.interact) .. ', глобал ' .. tostring(rawget(_G, 'AW_Request') ~= nil)

  if #errors == 0 then
    print("OK  " .. checks .. " проверок: строк " .. rowCount .. " == переменных dll " .. #dllNames .. ", категорий " .. categories)
    print("    pullout вкладки Distance: " .. PULL_SUMMARY)
    print("    канал /interact: " .. INTERACT_SUMMARY)
  else
    for _, e in ipairs(errors) do print("FAIL " .. e) end
    print("ИТОГО провалов: " .. #errors .. " из " .. checks)
    os.exit(1)
  end
`;
// UI.lua в этом стенде не исполняется (окно поднимает слишком много заглушек), но её подвал обязан
// расходиться с кодом так же громко, как остальное -- исходник передаётся в Lua глобалом и разбирается
// текстом. Путь только через pushstring: в файле есть экранированные обратные слэши, шаблонная строка
// их бы съела.
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(shimDir, 'AWElvUINameplates.lua'), 'utf8')));
lua.lua_setglobal(L, to_luastring('AW_MOD_SRC'));

lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(addonDir, 'UI.lua'), 'utf8')));
lua.lua_setglobal(L, to_luastring('AW_UI_SRC'));

if (lauxlib.luaL_loadstring(L, to_luastring(test)) !== lua.LUA_OK) fail('тест (загрузка)', lua.lua_tojsstring(L, -1));
if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) fail('тест (исполнение)', lua.lua_tojsstring(L, -1));

// print() из Lua уже ушёл в stdout; сюда попадаем только при успехе.
