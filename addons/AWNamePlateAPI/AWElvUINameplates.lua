-- Идентичность плеитов ElvUI по токенам dll: какой юнит стоит ЗА этой рамкой, и полоса каста для этой
-- рамки -- как её делал ElvUI_ProjectZidras.
--
-- Зачем. ElvUI 6.09 (порт под 3.3.5a, `Interface: 30300`) про awesome не знает ничего: во всём его
-- дереве ноль обращений к `C_NamePlate`. Юнит рамки он угадывает по подписи (`NP:GetUnitByName` ->
-- `NP.UnitByName[frame.UnitName]`, `Nameplates.lua:225` и `:336-360`), а не угадав -- берёт guid из
-- списка, накопленного комбат-логом. Отсюда те же симптомы, что чинили в iTargetingFrames: моб,
-- пришедший на уже показанную рамку, остаётся именем, класс-цветом и аурами предыдущего (замер 02.10 в
-- Ruby Sanctum: Halion под табличкой Chaos Invoker, п. 7.29); наведение мыши и вовсе сбрасывает
-- `frame.unit` в nil (`SetMouseoverFrame`, `:830`), и до следующего наведения рамка живёт без юнита.
--
-- Почему модулём здесь, а не правкой ElvUI. Точек в чужом дереве было бы несколько в `Nameplates.lua`
-- на 1291 строку, и каждое обновление ElvUI затирает дифф. Надстройка через `hooksecurefunc` живёт у
-- нас, покрывается нашими гейтами и не мешает обновлять ElvUI.
--
-- Что не трогается сознательно: `frame.isGroupUnit`. По нему ElvUI решает, перетаскивать ли `unit` на
-- `mouseover`/`target`; выставить его всем рамкам -- значит сломать и подсветку цели, и
-- `alwaysShowTargetHealth`. Поэтому идентичность возвращается постфактум (тот же приём, что
-- `restoreNameplateUnitAfterMouseover` в ElvUI_ProjectZidras), а семантика ElvUI не подменяется.

local POLL = 0.3

local abs = math.abs

-- Методы ElvUI, без которых смысла нет: проверяются один раз при установке, чтобы при смене API аддон
-- молчал, а не печатал ошибку каждые 0.3 с (`hooksecurefunc` по несуществующему методу на этом клиенте
-- -- ошибка, а не тихий noop). Списки разделены: полоса каста требует шести замен PZ, и отсутствовать
-- должна именно полоса, а не вся надстройка -- при общем списке одного снятого метода PZ хватало, чтобы
-- не установилось ничего (прогон 03.10 22:41, `installed=nil`). Настоящей причиной того прогона оказался,
-- впрочем, не список, а форма глобала `ElvUI` -- см. `engine()` ниже.
local NEEDED_IDENTITY = {
	"Update_HealthColor", "Update_Name", "Update_CastBar", "UpdateElement_Auras", "UnitClass",
}
local NEEDED_CAST = {
	"OnCreated", "Configure_CastBar", "OnEvent", "RegisterEvents", "UnregisterAllEvents", "UpdateCVars",
}

-- Что именно отсутствует -- наружу строкой: `/awplates cast` обязан называть причину, а не прятать её
-- за «модуль не устанавливается» (именно так вчерашний прогон и застрял)
local function missingIn(np, list)
	if type(np) ~= "table" then return nil, "нет таблицы ElvUI.NamePlates" end
	local missing
	for _, name in ipairs(list) do
		if type(np[name]) ~= "function" then
			missing = (missing and (missing .. " ") or "") .. name
		end
	end
	if missing then return nil, missing end
	return true
end

-- Обратная связь «фрейм ElvUI -> токен» живёт на самом плейте (`plate.AWToken`), а не в таблице у нас:
-- таблица с фреймами в ключах держит их от сборщика мусора, а после зонинга старые плеятьы dying --
-- получалась бы утечка на каждый заход в новую локацию.
local FIELD = "AWElvUINameplateToken"

-- Глобал `ElvUI` в этом клиенте -- не таблица аддона, а массив Engine: `Init.lua:38-43` делает
-- `Engine[1] = AddOn` и `_G[AddOnName] = Engine`. Поэтому модуль плеитов лежит в `ElvUI[1].NamePlates`, и
-- все ElvUI-плагины (ProjectZidras в их числе) берут его через `local E = unpack(ElvUI)` -- в его же
-- `Modules/Nameplates/Nameplates.lua:1-3` именно так: `local NP = E.NamePlates`, где `E` уже `ElvUI[1]`.
-- Читать `ElvUI.NamePlates` напрямую -- nil навсегда: на этом и держался прогон 03.10 22:41
-- (`installed=nil`, `created=0`, `showVKeyCastbar="0"`): модуль не устанавливался вообще.
local function engine()
	local E = rawget(_G, "ElvUI")
	if type(E) ~= "table" then return end
	if type(E.NamePlates) == "table" then return E end
	return type(E[1]) == "table" and E[1] or nil
end

local function NP()
	local E = engine()
	return E and E.NamePlates
end

local function npReady()
	local np = NP()
	if not missingIn(np, NEEDED_IDENTITY) then return end
	-- гейт PZ (`Nameplates.lua:513`: `if not NP.Initialized then return end`): `db` у модуля появляется
	-- только внутри `NP:Initialize()` (`ElvUI/Modules/Nameplates/Nameplates.lua:1203-1207`), а зовёт её
	-- ElvUI из своего `E:Initialize()` (`Core/Core.lua:1280`) на PLAYER_LOGIN. Наш аддон грузится раньше
	-- ElvUI, поэтому без этого условия `awUpdateCVars` читал бы `self.db.motionType` по nil -- ошибка Lua
	-- посреди установки, и всё, что стоит после неё, не выполнялось бы вовсе.
	if not np.Initialized then return end
	return np
end

-- ElvUI сам создаёт дочерний фрейм рамки (`frame.UnitFrame = unitFrame` в `OnCreated`) и вешает на
-- плейте `OnShow -> NP:OnShow`, где `self` -- сам плейт. Значит от токена до фрейма ElvUI один шаг:
-- таблица токенов dll -> фрейм плеята -> его UnitFrame. `rawget` здесь не годится: фрейм в Lua 5.1 --
-- userdata, и rawget(frame, ...) падает на «table expected».
local function frameOf(plate)
	local uf = plate and plate.UnitFrame
	if uf and uf.Name and uf.Health then return uf end
end

--! Полоса каста. Это перенос того, что делал ElvUI_ProjectZidras, а не своя схема: его
-- `Modules/Nameplates/Elements/CastBar.lua:16-21, 78-194` и `Modules/Nameplates/Nameplates.lua:195-206`.
-- Смысл приёма: ElvUI 6.09 ведёт полосу по событиям UNIT_SPELLCAST_* и по своему OnUpdate, а для
-- nameplateN таких событий нет (тот же замер, что заставил опрашивать здоровье и ауры). PZ вместо этого
-- снимал состояние с НАТИВНОЙ полосы плейта -- её заполняет сам клиент, и её скрипты живут независимо от
-- того, какой юнит подставлен в рамку. Своё гадание по таймеру здесь сознательно не делаем: нативная
-- полоса даёт направление (каст или канал), прерывание, «непрерываемость» по щиту и точное значение.
local FAILED = FAILED
local INTERRUPTED = INTERRUPTED

--! Счётчики для диагностики в игре (03.10 22:1x). Полосы в игре по-прежнему нет, а офлайн не видно, где
-- обрывается цепочка: клиент не двигает нативную полосу (ElvUI прячет её при создании рамки,
-- `Nameplates.lua:678-689` `QueueObject -> object:Hide()`), или двигает, но наши обработчики не проходят
-- проверку профиля и StyleFilter. Печатает их `/awplates cast` вместе с состоянием каждого токена.
local STAT = { created = 0, hooked = 0, show = 0, hide = 0, value = 0, loaded = 0, login = 0, plates = 0 }

-- PZ Elements/CastBar.lua:16-21
local function resetAttributes(self)
	self.casting = nil
	self.channeling = nil
	self.notInterruptible = nil
	self.spellName = nil
end

-- PZ Elements/CastBar.lua:78-146. `self` здесь -- нативная полоса плейта: HookScript передаёт фрейм,
-- а не наш модуль, поэтому `GetParent().UnitFrame` -- рамка ElvUI, а `self.Icon` -- нативная иконка
local function onNativeValueChanged(self, value)
	STAT.value = STAT.value + 1
	local frame = self:GetParent().UnitFrame
	if not frame.UnitType then return end

	local np = NP()
	if not np then return end

	-- нативную иконку прячем (PZ делает то же: SetParent в HiddenFrame ломает количество регионов
	-- плейта, а на нём держится поиск плеятов у WeakAuras)
	if frame.oldCastBar and frame.oldCastBar.Icon:IsShown() then
		frame.oldCastBar.Icon:Hide()
	end

	local db = np.db.units[frame.UnitType]
	if not db.castbar.enable or (not db.health.enable and not (frame.isTarget and np.db.alwaysShowTargetHealth)) then return end

	local castBar = frame.CastBar

	local min, max = self:GetMinMaxValues()
	local cur = castBar:GetValue()

	castBar.casting = value > cur
	castBar.channeling = value < cur
	castBar.notInterruptible = frame.oldCastBar.Shield:IsShown()

	castBar:SetMinMaxValues(min, max)
	castBar:SetValue(value)

	if castBar.channeling then
		if castBar.channelTimeFormat == "CURRENT" then
			castBar.Time:SetFormattedText("%.1f", abs(value - max))
		elseif castBar.channelTimeFormat == "CURRENTMAX" then
			castBar.Time:SetFormattedText("%.1f / %.2f", abs(value - max), max)
		elseif castBar.channelTimeFormat == "REMAINING" then
			castBar.Time:SetFormattedText("%.1f", value)
		elseif castBar.channelTimeFormat == "REMAININGMAX" then
			castBar.Time:SetFormattedText("%.1f / %.2f", value, max)
		end
	else
		if castBar.castTimeFormat == "CURRENT" then
			castBar.Time:SetFormattedText("%.1f", value)
		elseif castBar.castTimeFormat == "CURRENTMAX" then
			castBar.Time:SetFormattedText("%.1f / %.2f", value, max)
		elseif castBar.castTimeFormat == "REMAINING" then
			castBar.Time:SetFormattedText("%.1f", abs(value - max))
		elseif castBar.castTimeFormat == "REMAININGMAX" then
			castBar.Time:SetFormattedText("%.1f / %.2f", abs(value - max), max)
		end
	end

	if castBar.Spark then
		local sparkPosition = (value / max) * castBar:GetWidth()
		castBar.Spark:SetPoint("CENTER", castBar, "LEFT", sparkPosition, 0)
	end

	local colors = np.db.colors
	if castBar.notInterruptible then
		castBar:SetStatusBarColor(colors.castNoInterruptColor.r, colors.castNoInterruptColor.g, colors.castNoInterruptColor.b)
		castBar.Icon.texture:SetDesaturated(colors.castbarDesaturate and true or false)
	else
		castBar:SetStatusBarColor(colors.castColor.r, colors.castColor.g, colors.castColor.b)
		castBar.Icon.texture:SetDesaturated(false)
	end

	castBar.Name:SetText(castBar.spellName)
	castBar.Icon.texture:SetTexture(self.Icon:GetTexture())

	-- PZ: «первый каст плейта почему-то скрывается в цепочке исполнения» -- перепроверяем видимость здесь
	if not castBar:IsShown() then
		castBar:Show()
	end

	if np.StyleFilterUpdate then np:StyleFilterUpdate(frame, "FAKE_Casting") end
end

-- PZ Elements/CastBar.lua:148-164
local function onNativeShow(self)
	STAT.show = STAT.show + 1
	local frame = self:GetParent().UnitFrame
	local np = NP()
	if not np then return end

	local db = np.db.units[frame.UnitType]
	if not db then return end

	if db.castbar.enable then
		local healthShown = db.health.enable or (frame.isTarget and np.db.alwaysShowTargetHealth)
		local noFilter = frame.NameOnlyChanged == nil and frame.IconOnlyChanged == nil

		if healthShown and noFilter then
			resetAttributes(frame.CastBar)
			frame.CastBar:Show()
			np:Update_CastBar(frame, nil, frame.unit)
			if np.StyleFilterUpdate then np:StyleFilterUpdate(frame, "FAKE_Casting") end
		end
	end
end

-- PZ Elements/CastBar.lua:166-173
local function onNativeHide(self)
	STAT.hide = STAT.hide + 1
	local frame = self:GetParent().UnitFrame
	local np = NP()

	resetAttributes(frame.CastBar)
	frame.CastBar:Hide()

	if np and np.StyleFilterUpdate then np:StyleFilterUpdate(frame, "FAKE_Casting") end
end

-- PZ Elements/CastBar.lua:175-194. Заменяет собой ElvUI-шный `NP:Update_CastBar`: значения и анимацию
-- теперь даёт нативная полоса выше, от этой функции нужен только имя заклинания (и подпись при
-- прерывании), которую ElvUI иначе берёт из событий, не приходящих для токенов.
local function awUpdateCastBar(self, frame, event, unit)
	if frame.CastBar.spellName then return end

	if not (self.db.units[frame.UnitType].castbar.enable and frame.Health:IsShown()) then return end

	if (not event and unit)
		or event == "UNIT_SPELLCAST_START"
		or event == "UNIT_SPELLCAST_CHANNEL_START"
	then
		local name = UnitCastingInfo(unit) or UnitChannelInfo(unit)
		if name then
			frame.CastBar.spellName = name
			frame.CastBar.Name:SetText(name)
		end
	elseif event == "UNIT_SPELLCAST_FAILED" or event == "UNIT_SPELLCAST_INTERRUPTED" then
		if frame.CastBar:IsShown() then
			frame.CastBar.Name:SetText(event == "UNIT_SPELLCAST_FAILED" and FAILED or INTERRUPTED)
		end
	end
end

-- PZ Nameplates.lua:180-192: имя приходит из боевого лога по guid, потому что в момент, когда клиент
-- показывает нативную полосу, UnitCastingInfo по токену уже может быть пуст (заклинание кончилось, а
-- полоса ещё дотягивает анимацию), и наоборот -- каст начался, а рамка ещё не привязана.
local function onCombatLog(_, _, event, sourceGUID, sourceName, _, _, _, _, _, spellName)
	if event ~= "SPELL_CAST_START" then return end
	if not (sourceName and sourceGUID) then return end

	local np = NP()
	if not np or not np.SearchNameplateByGUID then return end

	local frame = np:SearchNameplateByGUID(sourceGUID)
	if frame and frame.CastBar then
		frame.CastBar.spellName = spellName
	end
end

-- PZ Nameplates.lua:240-266 -- весь его HD-блок замен, а не только три хука на нативной полосе.
-- Разница, из-за которой полосы и не было: стоковый ElvUI в `UpdateCVars` пишет
-- `SetCVar("showVKeyCastbar", "0")` (`Nameplates.lua:924-928`), то есть клиент не ведёт нативную полосу
-- каста вообще, и наши `OnShow`/`OnValueChanged` на ней не вызываются никогда. PZ в своей замене
-- (`Nameplates.lua:233-237`) возвращает ей `1` -- дефолт переменной по кодексу тоже `1`.
--
-- `OnEvent` он заменял потому, что стоковый вариант выходит при `self.unit ~= unit`
-- (`Nameplates.lua:635-639`): рамка с уже закешированным юнитом теряла каст другого юнита.
local function awOnEvent(self, event, unit, ...)
	if not unit then return end
	local np = NP()
	if not np then return end
	np:Update_CastBar(self, event, unit, ...)
end

-- PZ Nameplates.lua:213-226
local function awRegisterEvents(self, frame)
	if not frame.unit then return end

	local np = NP()
	if not np then return end

	if np.db.units[frame.UnitType].health.enable or (frame.isTarget and np.db.alwaysShowTargetHealth) then
		if np.db.units[frame.UnitType].castbar.enable then
			frame:RegisterEvent("UNIT_SPELLCAST_INTERRUPTED")
			frame:RegisterEvent("UNIT_SPELLCAST_CHANNEL_START")
			frame:RegisterEvent("UNIT_SPELLCAST_FAILED")
			frame.isEventsRegistered = true
		end
		-- prime: рамка уже видна, а события для токена не придут никогда
		awOnEvent(frame, nil, frame.unit)
	end
end

-- PZ Nameplates.lua:228-232
local function awUnregisterAllEvents(self, frame)
	frame:UnregisterEvent("UNIT_SPELLCAST_INTERRUPTED")
	frame:UnregisterEvent("UNIT_SPELLCAST_CHANNEL_START")
	frame:UnregisterEvent("UNIT_SPELLCAST_FAILED")
	frame.isEventsRegistered = nil
end

-- PZ Nameplates.lua:233-237
local function awUpdateCVars(self)
	SetCVar("ShowClassColorInNameplate", "1")
	SetCVar("showVKeyCastbar", "1")
	SetCVar("nameplateAllowOverlap", self.db.motionType == "STACKED" and "0" or "1")
end

-- PZ Nameplates.lua:241 (hook на Configure_CastBar) и его Elements/CastBar.lua:224-227: имя
-- заклинания не должно залезать на время каста
local function awConfigureCastBar(self, frame)
	local castBar = frame.CastBar
	if castBar and castBar.Name and castBar.Time then
		castBar.Name:SetPoint("BOTTOMRIGHT", castBar.Time, "BOTTOMLEFT")
	end
end

-- PZ Nameplates.lua:195-206: развеска на каждую новую рамку. Зовётся из нашей обёртки над OnCreated
-- (см. install() ниже), а не пост-хуком: `oldCastBar` присваивается внутри стокового OnCreated
-- (Nameplates.lua:647), так что к этому моменту он уже есть.
-- Идемпотентность обязательна: наш guard может оказаться вложенным (см. keepGuardTop ниже), и тогда одна
-- рамка проходит через него дважды. Флаг ставится на нативную полосу -- на то, чего касается второй
-- комплект HookScript.
local function onCreated(_, plate)
	local np = NP()
	if not np then return end

	local uf = plate.UnitFrame
	local native = uf and uf.oldCastBar
	if not native or not uf.CastBar then return end
	if native.awCastHooked then return end
	native.awCastHooked = true

	STAT.created = STAT.created + 1
	STAT.hooked = STAT.hooked + 1
	native:HookScript("OnShow", onNativeShow)
	native:HookScript("OnHide", onNativeHide)
	native:HookScript("OnValueChanged", onNativeValueChanged)

	-- свою анимацию ElvUI выключаем: полосу ведёт нативная (PZ Elements/CastBar.lua:205)
	uf.CastBar:SetScript("OnUpdate", nil)
end

-- Обёртка над OnCreated держится на уровне файла, а не внутри install(): её надо уметь переставить наверх
-- и после того, как свои пост-хуки навесили другие аддоны (ElvUI_ProjectZidras
-- `Modules/Nameplates/Nameplates.lua:255` делает `hooksecurefunc(NP, "OnCreated", OnCreatedHook)`).
local guarded
local function wrapCreated(np, base)
	local w = function(self, plate)
		if self.CreatedPlates and self.CreatedPlates[plate] then return end
		base(self, plate)
		onCreated(self, plate)
	end
	np.OnCreated = w
	guarded = w
end

-- Чужой wrapper поверх нашего значит, что чужой пост-хук отработает и на пропущенном создании: PZ в этом
-- же коде снова обвешивает нативную полосу вторым комплектом хуков. Раз в тик проверяем, что guard
-- остался самым верхним слоем, и иначе встаём над ним. Вложенность при этом безвредна: развеска
-- идемпотентна (флаг выше), а guard во второй раз просто не находит чего добавлять.
local function keepGuardTop(np)
	if not np or np.OnCreated == guarded then return end
	wrapCreated(np, np.OnCreated)
end

local function refresh(np, uf)
	local class = np:UnitClass(uf, uf.UnitType)
	if class then uf.UnitClass = class end
	np:Update_HealthColor(uf)
	-- без второго аргумента, ровно как у PZ (`Nameplates.lua:488 NP:Update_Name(frame)`): `triggered` в
	-- ElvUI-шном `Update_Name` (Elements/Name.lua:52-79) заставляет брать цвет ПО РЕАКЦИИ и не писать
	-- кэш `frame.Name.r/g/b`. При включённом `ShowClassColorInNameplate` (`Nameplates.lua:924`) нативная
	-- полоса друга окрашена в цвет класса, `NP:GetUnitInfo` (`Nameplates.lua:291-311`) её не распознаёт и
	-- отдаёт `3, ENEMY_PLAYER` -- то есть каждый наш пересчёт красил имя в `db.reactions.bad`, красный
	np:Update_Name(uf)
	np:Update_CastBar(uf, nil, uf.unit)
	np:UpdateElement_Auras(uf)
end

-- Одна рамка за проход. Возвращает true, если что-то из идентичности изменилось и рамку надо перерисовать.
local function bind(uf, token, guid, name)
	local changed = false

	if uf.nameplateUnit ~= token then
		uf.nameplateUnit = token
		changed = true
	end

	if uf.guid ~= guid then
		uf.guid = guid
		uf.unit = token
		changed = true
	elseif not uf.unit then
		-- мышь ушла и ElvUI обнулил юнит: без токена каст и ауры больше не обновятся
		uf.unit = token
		changed = true
	end
	-- "target"/"mouseover"/"focus" не отбираем: там юнит назван клиентом честно

	-- ElvUI берёт подпись из текста самой рамки (`frame.oldName:GetText()`), то есть наследует тот же
	-- stale-случай. UnitName(токена) -- данные клиента, они свежее
	if name and uf.UnitName ~= name then
		uf.UnitName = name
		changed = true
	end

	return changed
end

local function bindOne(np, plate, token)
	-- ElvUI зовёт OnShow и на рамке, которой dll ещё не выдала токен (первый показ до опроса, и своя
	-- тестовая рамка ElvNP_Test): `UnitGUID(nil)` на этом клиенте -- ошибка использования, а не nil
	if not token then return end
	local uf = frameOf(plate)
	if not uf then return end
	plate[FIELD] = token
	local guid = UnitGUID and UnitGUID(token)
	local name = UnitName and UnitName(token)
	if guid and bind(uf, token, guid, name) then
		refresh(np, uf)
	end
end

local function sweep()
	local np = npReady()
	if not np then return end
	local plates = rawget(_G, "AW_NamePlates")
	if type(plates) ~= "table" then return end

	for token, plate in pairs(plates) do
		bindOne(np, plate, token)
	end
end

local frame
local installed
local CAST_SKIP
local queueRegistered
local install

local elapsed = 0
local function onUpdate(_, e)
	elapsed = elapsed + (e or 0)
	if elapsed < POLL then return end
	elapsed = 0
	local np = NP()
	if np then keepGuardTop(np) end
	sweep()
end

install = function()
	if installed then return end
	local np = npReady()
	if not np then return end
	installed = true

	if np.OnShow then
		-- первое: привязать в момент появления рамки, иначе цвет класса догоняет опросом -- до POLL секунды
		hooksecurefunc(np, "OnShow", function(plate)
			bindOne(np, plate, plate and plate[FIELD])
		end)
	end

	-- Полоса каста -- блок PZ целиком (его Nameplates.lua:240-276): замена Update_CastBar, обёртка над
	-- OnCreated для нативной полосы, замена OnEvent/RegisterEvents/UnregisterAllEvents/UpdateCVars,
	-- зачистка старых событий на уже созданных рамках и снятая собственная анимация. Список методов
	-- проверяется здесь, а не в npReady: без одного из этих шести идентичность обязана остаться рабочей.
	local castOk, castWhy = missingIn(np, NEEDED_CAST)
	if not castOk then
		CAST_SKIP = castWhy
	else
		CAST_SKIP = nil
		-- OnCreated обязан отработать ровно один раз на рамку. Сам ElvUI guard-ит только свой опрос
		-- (`findNewPlate` смотрит `CreatedPlates[frame]`, Nameplates.lua:880-888), а сторонний потребитель
		-- нашего NAME_PLATE_CREATED зовёт метод напрямую и про этот guard не знает:
		-- ElvUI_Extras.lua:684-686 на каждое событие вызывает `NP:OnCreated(plate)`. Второй проход читает
		-- `frame:GetRegions()` у рамки, из которой первый проход уже перепривязал RaidIcon в свой unitFrame
		-- (Nameplates.lua:655), -- областей стало на одну меньше, одиннадцатая (EliteIcon) nil, и OnCreated
		-- падает на Nameplates.lua:644, не дойдя до :646-671. Рамка остаётся с полусобранным и спрятанным
		-- unitFrame, который больше никто не достроит: плейты мигают и пропадают. Замер тестера 07.10:
		-- именно этот error, Count 68.
		-- Обёртка, а не пост-хук: hooksecurefunc вызывает хук даже когда обёртка вышла раньше подлинника,
		-- и нативная полоса обросла бы вторым комплектом HookScript. Сама обёртка и её перестановка наверх
		-- (keepGuardTop) -- выше по файлу, у onCreated.
		wrapCreated(np, np.OnCreated)
		hooksecurefunc(np, "Configure_CastBar", awConfigureCastBar)
		np.Update_CastBar = awUpdateCastBar
		np.OnEvent = awOnEvent
		np.RegisterEvents = awRegisterEvents
		np.UnregisterAllEvents = awUnregisterAllEvents
		np.UpdateCVars = awUpdateCVars

		-- PZ Nameplates.lua:265-276: рамки, созданные до этого момента (первый прогон после смены
		-- профиля), остаются со старыми событиями и со своей анимацией -- приводим к тому же состоянию
		if np.CreatedPlates then
			for plate in pairs(np.CreatedPlates) do
				local uf = plate.UnitFrame
				plate:UnregisterEvent("UNIT_SPELLCAST_DELAYED")
				plate:UnregisterEvent("UNIT_SPELLCAST_CHANNEL_UPDATE")
				plate:UnregisterEvent("UNIT_SPELLCAST_CHANNEL_STOP")
				plate:UnregisterEvent("UNIT_SPELLCAST_INTERRUPTIBLE")
				plate:UnregisterEvent("UNIT_SPELLCAST_NOT_INTERRUPTIBLE")
				plate:UnregisterEvent("UNIT_SPELLCAST_START")
				plate:UnregisterEvent("UNIT_SPELLCAST_STOP")
				if uf and uf.CastBar then
					uf.CastBar:SetScript("OnUpdate", nil)
				end
			end
		end

		-- главное в этом блоке: ElvUI пишет showVKeyCastbar = 0, при такой переменной клиент не ведёт
		-- нативную полосу, и ни один хук на ней не сработает. PZ возвращал ей 1 -- возвращаем и мы, и
		-- тут же пересчитываем профиль, чтобы замена UpdateCVars сработала сразу, а не со следующего захода
		awUpdateCVars(np)

		frame:RegisterEvent("COMBAT_LOG_EVENT_UNFILTERED")
	end

	frame:SetScript("OnUpdate", onUpdate)
end

-- Пуск -- механизм PZ, а не мой: он не гадал по PLAYER_LOGIN и не опрашивал, а встраивался в очередь
-- модулей самого ElvUI (`E:RegisterModule(ZNP:GetName(), InitializeCallback)`, `Nameplates.lua:542-546`).
-- Очередь раскручивает `E:InitializeModules()` (`ElvUI/Core/Core.lua:1104`) из `E:Initialize()` (`:1280`) на
-- PLAYER_LOGIN, и запись самого ElvUI стоит в этой очереди раньше нашей (она дописывается при загрузке его
-- файлов, наша -- на ADDON_LOADED), поэтому к нашему колбэку `NP:Initialize()` (`Nameplates.lua:1203-1207`)
-- уже отработал: `db` и `Initialized` есть, и `awUpdateCVars` читает `self.db.motionType` легально.
local function queueInstall()
	if queueRegistered then return end
	local E = engine()
	if not E or type(E.RegisterModule) ~= "function" then return end
	queueRegistered = true
	E:RegisterModule("NamePlates", function() install() end)
end

local function onEvent(_, event, arg1, ...)
	if event == "ADDON_LOADED" then
		STAT.loaded = STAT.loaded + 1
		-- самого install тут нет намеренно: он приходит из очереди модулей ElvUI, когда та отработала
		if arg1 == "ElvUI" then queueInstall() end
	elseif event == "PLAYER_LOGIN" then
		STAT.login = STAT.login + 1
		-- ElvUI мог загрузиться раньше этого аддона: порядок считается по зависимостям, а не по алфавиту
		queueInstall()
	elseif event == "NAME_PLATE_UNIT_ADDED" or event == "NAME_PLATE_UNIT_REMOVED" then
		STAT.plates = STAT.plates + 1
		-- события шлёт dll (scope >= 3); без них аддон живёт на одном опросе
		if not installed then install() end
		sweep()
	elseif event == "COMBAT_LOG_EVENT_UNFILTERED" then
		-- arg1 здесь уже не имя аддона, а timestamp: у боя аргументы свои (кодекс, стр. 387)
		onCombatLog(nil, arg1, ...)
	end
end

frame = CreateFrame("Frame", "AW_ElvUINameplates")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("NAME_PLATE_UNIT_ADDED")
frame:RegisterEvent("NAME_PLATE_UNIT_REMOVED")
frame:SetScript("OnEvent", onEvent)

--! `/awplates cast` -- дамп полосы каста по каждому токену dll. Печатает счётчики (доезжают ли скрипты
-- нативной полосы вообще) и по токену: юнит рамки, тип юнита, `castbar.enable` из профиля ElvUI, состояние
-- нативной полосы (видима/мин/макс/значение/щит), состояние нашей полосы (видима/имя на ней) и два флага
-- StyleFilter, без которых обработчик ElvUI-шной полосы ничего не показывает (`noFilter` у PZ).
local function dumpCast()
	_G.print(string.format('AWplates: created=%d hooked=%d show=%d hide=%d value=%d installed=%s queued=%s',
		STAT.created, STAT.hooked, STAT.show, STAT.hide, STAT.value, tostring(installed),
		tostring(queueRegistered)))
	_G.print(string.format('AWplates: событий ADDON_LOADED=%d PLAYER_LOGIN=%d NAME_PLATE=%d',
		STAT.loaded, STAT.login, STAT.plates))

	local np = npReady()
	-- полоса каста может быть выключена отдельно: идентичность тогда работает, а каста нет -- и в дампе
	-- это должно читаться одной строкой, а не угадываться по нулям
	if np and CAST_SKIP then
		_G.print('AWplates: полоса каста НЕ установлена, не хватает: ' .. tostring(CAST_SKIP))
	end
	-- причина «не установился» обязана быть названа: в первом прогоне общая фраза «модуль не
	-- устанавливается» ровно ничего и не сказала
	if not np then
		local E = rawget(_G, 'ElvUI')
		local module = NP()
		-- форма глобала -- первое, что надо увидеть: `ElvUI` это массив Engine, а не аддон
		_G.print(string.format('AWplates: ElvUI=%s ElvUI[1]=%s NamePlates=%s loadedElvUI=%s',
			type(E), type(engine()), type(module),
			tostring(_G.IsAddOnLoaded and IsAddOnLoaded('ElvUI'))))
		local okIdentity, whyIdentity = missingIn(module, NEEDED_IDENTITY)
		_G.print('AWplates: идентичность -- ' .. (okIdentity and 'методы на месте' or tostring(whyIdentity)))
		local okCast, whyCast = missingIn(module, NEEDED_CAST)
		_G.print('AWplates: полоса каста -- ' .. (okCast and 'методы на месте' or tostring(whyCast)))
		-- методы на месте, а установки всё нет -- значит ElvUI ещё не дошёл до своего Initialize
		_G.print(string.format('AWplates: Initialized=%s db=%s -- пока нет, установка повторяется опросом',
			tostring(module and module.Initialized), tostring(module and module.db)))
		return
	end
	local plates = rawget(_G, 'AW_NamePlates')
	if type(plates) ~= 'table' then
		_G.print('AWplates: таблицы токенов AW_NamePlates нет -- шим или dll не загрузились')
		return
	end

	for token, plate in pairs(plates) do
		local uf = plate.UnitFrame
		local native = uf and uf.oldCastBar
		local mine = uf and uf.CastBar
		local dbu = uf and uf.UnitType and np.db and np.db.units and np.db.units[uf.UnitType]
		local mn, mx, val
		if native then
			if native.GetMinMaxValues then mn, mx = native:GetMinMaxValues() end
			if native.GetValue then val = native:GetValue() end
		end
		local nr, ng, nb
		if uf and uf.Name and uf.Name.GetTextColor then
			nr, ng, nb = uf.Name:GetTextColor()
		end
		-- ответы КЛИЕНТА по токену рядом с тем, что о типе юнита думает ElvUI: он определяет тип по цвету
		-- нативной полосы (`GetUnitInfo`), и если клиент по токену отвечает иначе, классификацию можно
		-- брать из клиента -- это единственный известный нам способ перестать красить союзников в красный
		local u = uf and uf.unit
		local cPlayer, cReaction, cClass, cFaction
		if u then
			cPlayer = UnitIsPlayer and UnitIsPlayer(u)
			cReaction = UnitReaction and UnitReaction("player", u)
			_, cClass = UnitClass and UnitClass(u)
			cFaction = UnitFactionGroup and UnitFactionGroup(u)
		end
		_G.print(string.format(
			'AWplates: %s unit=%s type=%s reaction=%s class=%s nameColor=%s/%s/%s enable=%s | нативная shown=%s min=%s max=%s value=%s shield=%s | '
			.. 'наша shown=%s name=%s | nameOnly=%s iconOnly=%s health=%s | клиент: isPlayer=%s reaction=%s class=%s faction=%s',
			token,
			tostring(uf and uf.unit), tostring(uf and uf.UnitType),
			tostring(uf and uf.UnitReaction), tostring(uf and uf.UnitClass),
			tostring(nr), tostring(ng), tostring(nb),
			tostring(dbu and dbu.castbar and dbu.castbar.enable),
			native and tostring(native:IsShown()) or 'нет',
			tostring(mn), tostring(mx), tostring(val),
			tostring(native and native.Shield and native.Shield:IsShown()),
			mine and tostring(mine:IsShown()) or 'нет',
			tostring(mine and mine.Name and mine.Name:GetText()),
			tostring(uf and uf.NameOnlyChanged), tostring(uf and uf.IconOnlyChanged),
			tostring(uf and uf.Health and uf.Health:IsShown()),
			tostring(cPlayer), tostring(cReaction), tostring(cClass), tostring(cFaction)))
	end
end

SLASH_AWPLATES1 = '/awplates'
SlashCmdList['AWPLATES'] = function(msg)
	msg = ((msg or ''):gsub('^%s*(.-)%s*$', '%1')):lower()
	if msg == '' or msg == 'cast' then
		dumpCast()
	else
		_G.print('AWplates: /awplates cast -- дамп полосы каста по токенам dll')
	end
end
