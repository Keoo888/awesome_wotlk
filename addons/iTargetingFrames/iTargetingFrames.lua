--[[
TO DO LIST:
	priorityNPCs: Broadcast All
	custom borders
	options for border size
--]]
local _, iTF = ...
iTF.barTex = 'Interface\\Buttons\\WHITE8x8'
iTF.font = NumberFont_Shadow_Small:GetFont()
iTF.fontSize = 11
local L = LibStub('AceLocale-3.0'):GetLocale('iTargetingFrames', true)
local AceTimer = LibStub("AceTimer-3.0") --added
-- Was: WorldFrame.GetChildren/GetNumChildren aliases and a child-count watch. The only thing it fed was
-- plateID, and plateID was dead weight on this client (see the currentTarget branch below), so the whole
-- scan is gone: it rebuilt the full WorldFrame child list on every change of its length.
-- Was: `local C_NamePlate = C_NamePlate`. Our dll registers that global from its per-frame callback, which
-- runs AFTER addons load, so the alias captured nil on a fresh Lua state and every later use died with
-- "attempt to index upvalue 'C_NamePlate' (a nil value)" (measured: this file, line 389, on a click). Keep the
-- same local name so nothing else in the file changes, but resolve it through the global at call time.
local function nameplateAPI() return rawget(_G, "C_NamePlate") end
local C_NamePlate = setmetatable({}, { __index = function(_, key)
	local api = nameplateAPI()
	if api then return api[key] end
end })

local specID = {
	id = 0,
}
local conditionals = {
	['onUpdate'] = {},
	['onAura'] = {},
	['onCast'] = {},
	['onHealth'] = {},
	['targetChanged'] = {},
	['focusUpdate'] = {},
	['threat'] = {},
	['onShow'] = {},
}
local customConditionals = {}
local durationShowDecimals = 5
iTF.indicatorUpdateFuncs = {
	['interruptRange'] = 'onUpdate',
	['currentTarget'] = 'targetChanged',
	['outOfCombat'] = 'onUpdate',
	['maxRange'] = 'onUpdate',
	['maxRangeDPS'] = 'onUpdate',
	['losingAggro'] = 'threat',
	['aggro'] = 'threat',
	['gainingAggro'] = 'threat',
	['focusTarget'] = 'focusUpdate',
}
local indicatorPrios = {}
iTF.backdrop = {
	bgFile = 'Interface\\Buttons\\WHITE8x8',
	edgeFile = 'Interface\\Buttons\\WHITE8x8',
	edgeSize = 1,
	insets = {
		left = -1,
		right = -1,
		top = -1,
		bottom = -1,
	}
}
local addon = CreateFrame('frame')
addon:RegisterEvent('ADDON_LOADED')
addon:SetScript('OnEvent', function(self, event, ...)
	self[event](self, ...)
end)
local function spairs(t, order)
    -- collect the keys
    local keys = {}
    for k in pairs(t) do keys[#keys+1] = k end

    -- if order function given, sort by it by passing the table and keys a, b,
    -- otherwise just sort the keys
    if order then
        table.sort(keys, function(a,b) return order(t, a, b) end)
    else
        table.sort(keys)
    end

    -- return the iterator function
    local i = 0
    return function()
        i = i + 1
        if keys[i] then
            return keys[i], t[keys[i]]
        end
    end
end
local function getFunction(str)
	--local f, err = loadstring('return ' .. str .. ' ', unitID)
	local f, err = loadstring('return ' .. str)
	if f then return f() else return f, err end
end
-- Состояние индикаторов одной рамки. Раньше его строил только iTF:updateUnitID, а тот выходит по guard'у,
-- если юнита или плеята уже нет -- рамка к этому моменту стоит в iTF.frames (её создаёт iTF:CreateNew на
-- старте для каждого слота), и первый же PLAYER_TARGET_CHANGED индексировал nil:
-- `iTargetingFrames.lua:129: attempt to index field 'waitingFor' (a nil value)` (замер 04.10 02:11, цель --
-- nameplate1). Теперь таблица живёт вместе с рамкой, а updateUnitID только обновляет её.
local function newIndicatorState()
	return {
		['border'] = {},
		['alpha'] = {},
		['statusbar'] = {},
		['glowLeft'] = {},
		['glowRight'] = {},
		['glowTop'] = {},
		['glowBottom'] = {},
	}
end
local indicatorFuncs = {}
function indicatorFuncs:getHighest(t)
	local w = -100
	local c
	for k,v in pairs(t) do
		if v.weight > w then
			w = v.weight
			c = k
		end
	end
	return w,c
end
function indicatorFuncs:border(cond, unitID, color, hideCurrentCond, forceRefresh)
	if not iTF.frames[unitID] then
		return
	end
	if iTF.frames[unitID].borderInUse == cond and not hideCurrentCond and not forceRefresh then
		return
	end
	if hideCurrentCond then
		iTF.frames[unitID].waitingFor.border[cond] = nil
		local _, c = indicatorFuncs:getHighest(iTF.frames[unitID].waitingFor.border)
		if c then
			cond = c
			color = iTF.frames[unitID].waitingFor.border[cond].color
			iTF.frames[unitID].borderInUse = cond
		else
			iTF.frames[unitID].borderInUse = false
		end
	else
		if iTF.frames[unitID].borderInUse == cond and forceRefresh then
			iTF.frames[unitID].waitingFor.border[cond].color = color
		else
			iTF.frames[unitID].waitingFor.border[cond] = {
				['weight'] = indicatorPrios[cond],
				['color'] = color
			}
			local _, c = indicatorFuncs:getHighest(iTF.frames[unitID].waitingFor.border)
			if c == iTF.frames[unitID].borderInUse then
				return
			end
			cond = c
			color = iTF.frames[unitID].waitingFor.border[cond].color
			iTF.frames[unitID].borderInUse = cond
		end
	end
	if iTF.frames[unitID].borderInUse then
		iTF.frames[unitID]:SetBackdropBorderColor(unpack(color))
	else
		iTF.frames[unitID]:SetBackdropBorderColor(unpack(iTFConfig.layout.colors.statusbar.border))
	end
end
function indicatorFuncs:opacity(cond, unitID, alpha, hideCurrentCond, forceRefresh)
	if not iTF.frames[unitID] then
		return
	end
	if iTF.frames[unitID].alphaInUse == cond and not hideCurrentCond and not forceRefresh then
		return
	end
	if hideCurrentCond then
		iTF.frames[unitID].waitingFor.alpha[cond] = nil
		local _, c = indicatorFuncs:getHighest(iTF.frames[unitID].waitingFor.alpha)
		if c then
			cond = c
			alpha = iTF.frames[unitID].waitingFor.alpha[cond].alpha
			iTF.frames[unitID].alphaInUse = cond
		else
			iTF.frames[unitID].alphaInUse = false
		end
	else
		if iTF.frames[unitID].alphaInUse == cond and forceRefresh then
			iTF.frames[unitID].waitingFor.alpha[cond].alpha = alpha
		else
			iTF.frames[unitID].waitingFor.alpha[cond] = {
				['weight'] = indicatorPrios[cond],
				['alpha'] = alpha
			}
			local _, c = indicatorFuncs:getHighest(iTF.frames[unitID].waitingFor.alpha)
			if c == iTF.frames[unitID].alphaInUse then
				return
			end
			cond = c
			alpha = iTF.frames[unitID].waitingFor.alpha[cond].alpha
			iTF.frames[unitID].alphaInUse = cond
		end
	end
	if iTF.frames[unitID].alphaInUse then
		iTF.frames[unitID]:SetAlpha(alpha or 1)
	else
		iTF.frames[unitID]:SetAlpha(1)
	end
end
function indicatorFuncs:glows(k, cond, unitID, color, hideCurrentCond, forceRefresh)
	if not iTF.frames[unitID] then
		return
	end
	if iTF.frames[unitID].topFrame[k].inUse == cond and not hideCurrentCond and not forceRefresh then
		return
	end
	if hideCurrentCond then
		iTF.frames[unitID].waitingFor[k][cond] = nil
		local _, c = indicatorFuncs:getHighest(iTF.frames[unitID].waitingFor[k])
		if c then
			cond = c
			color = iTF.frames[unitID].waitingFor[k][cond].color
			iTF.frames[unitID].topFrame[k].inUse = cond
		else
			iTF.frames[unitID].topFrame[k].inUse = false
		end
	else
		if iTF.frames[unitID].topFrame[k].inUse == cond and forceRefresh then
			iTF.frames[unitID].waitingFor[k][cond].color = color
		else
			iTF.frames[unitID].waitingFor[k][cond] = {
				['weight'] = indicatorPrios[cond],
				['color'] = color
			}
			local _, c = indicatorFuncs:getHighest(iTF.frames[unitID].waitingFor[k])
			if c == iTF.frames[unitID].topFrame[k].inUse then
				return
			end
			cond = c
			color = iTF.frames[unitID].waitingFor[k][cond].color
			iTF.frames[unitID].topFrame[k].inUse = cond
		end
	end
	if iTF.frames[unitID].topFrame[k].inUse then
		iTF.frames[unitID].topFrame[k]:SetVertexColor(unpack(color))
		iTF.frames[unitID].topFrame[k]:Show()
	else
		iTF.frames[unitID].topFrame[k]:Hide()
	end
	
end
function indicatorFuncs:statusbar(cond, unitID, color, hideCurrentCond, forceRefresh)
	if not iTF.frames[unitID] then
		return
	end
	if iTF.frames[unitID].healthBar.inUse == cond and not hideCurrentCond and not forceRefresh then
		return
	end
	if hideCurrentCond then
		iTF.frames[unitID].waitingFor.statusbar[cond] = nil
		local _, c = indicatorFuncs:getHighest(iTF.frames[unitID].waitingFor.statusbar)
		if c then
			cond = c
			color = iTF.frames[unitID].waitingFor.statusbar[cond].color
			iTF.frames[unitID].healthBar.inUse = cond
		else
			iTF.frames[unitID].healthBar.inUse = false
		end
	else
		if iTF.frames[unitID].healthBar.inUse == cond and forceRefresh then
			iTF.frames[unitID].waitingFor.statusbar[cond].color = color
		else
			iTF.frames[unitID].waitingFor.statusbar[cond] = {
				['weight'] = indicatorPrios[cond],
				['color'] = color
			}
			local _, c = indicatorFuncs:getHighest(iTF.frames[unitID].waitingFor.statusbar)
			if c == iTF.frames[unitID].healthBar.inUse then
				return
			end
			cond = c
			color = iTF.frames[unitID].waitingFor.statusbar[cond].color
			iTF.frames[unitID].healthBar.inUse = cond
		end
	end
	if iTF.frames[unitID].healthBar.inUse then
		iTF.frames[unitID].healthBar:SetStatusBarColor(unpack(color))
	else
		if iTFConfig.layout.colors.classColor and iTF.frames[unitID].isPlayer then
			--local color = RAID_CLASS_COLORS[iTF.frames[unitID].isPlayer]
			--local color = iTF.frames[unitID].isPlayer.color
			iTF.frames[unitID].healthBar:SetStatusBarColor(iTF.frames[unitID].isPlayer.color.r, iTF.frames[unitID].isPlayer.color.g, iTF.frames[unitID].isPlayer.color.b, iTFConfig.layout.colors.statusbar.main.a)
		else
			iTF.frames[unitID].healthBar:SetStatusBarColor(unpack(iTFConfig.layout.colors.statusbar.main))
		end
	end
end
local function updateIndicator(unitID, cond, customCondIndicators, showCustom)
	if cond == 'interruptRange' then
		if conditionals.onUpdate.interruptRange then
			if specID.interrupt then
				local show = false
				if conditionals.onUpdate.interruptRange.invert then
					if IsSpellInRange(specID.interrupt, unitID) == 0 then
						show = true
					end
				elseif IsSpellInRange(specID.interrupt, unitID) == 1 then
					show = true
				end
				for k in pairs(conditionals.onUpdate.interruptRange.indicators) do
					if k == 'border' then
						if show then
							indicatorFuncs:border(cond, unitID, conditionals.onUpdate.interruptRange.color)
						else
							indicatorFuncs:border(cond, unitID, nil, true)
						end
					elseif k == 'alpha' then
						if show then
							indicatorFuncs:opacity(cond, unitID, conditionals.onUpdate.interruptRange.alpha)
						else
							indicatorFuncs:opacity(cond, unitID, nil, true)
						end
					elseif k == 'statusbar' then
						if show then
							indicatorFuncs:statusbar(cond, unitID, conditionals.onUpdate.interruptRange.color)
						else
							indicatorFuncs:statusbar(cond, unitID, nil, true)
						end
					elseif string.find(k, 'glow') then
						if show then
							indicatorFuncs:glows(k, cond, unitID, conditionals.onUpdate.interruptRange.color)
						else
							--! WotLK fix: glows() takes (k, cond, unitID, ...) and bails on a nil unitID, so the
							-- old (k, nil, nil, true) call returned at once and the glow never went out.
							indicatorFuncs:glows(k, cond, unitID, nil, true)
						end
					end
				end
			end
		end
	elseif cond == 'maxRangeDPS' then
		if conditionals.onUpdate.maxRangeDPS then
			if specID.dps then
				local show = false
				if conditionals.onUpdate.maxRangeDPS.invert then
					if IsSpellInRange(specID.dps, unitID) == 0 then
						show = true
					end
				elseif IsSpellInRange(specID.dps, unitID) == 1 then
					show = true
				end
				for k in pairs(conditionals.onUpdate.maxRangeDPS.indicators) do
					if k == 'border' then
						if show then
							indicatorFuncs:border(cond, unitID,conditionals.onUpdate.maxRangeDPS.color)
						else
							indicatorFuncs:border(cond, unitID, nil, true)
						end
					elseif k == 'alpha' then
						if show then
							indicatorFuncs:opacity(cond, unitID, conditionals.onUpdate.maxRangeDPS.alpha)
						else
							indicatorFuncs:opacity(cond, unitID, nil, true)
						end
					elseif k == 'statusbar' then
						if show then
							indicatorFuncs:statusbar(cond, unitID, conditionals.onUpdate.maxRangeDPS.color)
						else
							indicatorFuncs:statusbar(cond, unitID, nil, true)
						end
					elseif string.find(k, 'glow') then
						if show then
							indicatorFuncs:glows(k, cond, unitID, conditionals.onUpdate.maxRangeDPS.color)
						else
							--! WotLK fix: same swapped-argument hide call as in interruptRange above.
							indicatorFuncs:glows(k, cond, unitID, nil, true)
						end
					end
				end
			end
		end
	elseif cond == 'outOfCombat' then
		if conditionals.onUpdate.outOfCombat and unitID then
			local show = false
			--! WotLK fix: dropped the iTF.encounterInProgress term -- 3.3.5a has no ENCOUNTER_START/STOP
			-- event, so the flag was always false and the test did nothing.
			if not UnitAffectingCombat(unitID) then
				show = true
			end
			for k in pairs(conditionals.onUpdate.outOfCombat.indicators) do
				if k == 'border' then
					if show then
						indicatorFuncs:border(cond, unitID, conditionals.onUpdate.outOfCombat.color)
					else
						indicatorFuncs:border(cond, unitID, nil, true)
					end
				elseif k == 'alpha' then
					if show then
						indicatorFuncs:opacity(cond, unitID, conditionals.onUpdate.outOfCombat.alpha)
					else
						indicatorFuncs:opacity(cond, unitID, nil, true)
					end
				elseif k == 'statusbar' then
					if show then
						indicatorFuncs:statusbar(cond, unitID, conditionals.onUpdate.outOfCombat.color)
					else
						indicatorFuncs:statusbar(cond, unitID, nil, true)
					end
				elseif string.find(k, 'glow') then
					if show then
						indicatorFuncs:glows(k, cond, unitID, conditionals.onUpdate.outOfCombat.color)
					else
						indicatorFuncs:glows(k, cond, unitID, nil, true)
					end
				end
			end
		end
	elseif cond == 'currentTarget' then
		if conditionals.targetChanged.currentTarget then
			local show = false
			--! WotLK fix: розница связывает цель с фреймом через UnitFrame.plateID / UnitFrame.unit, и на
			-- 3.3.5a непригодны обе ветки: plateID в этом файле никогда не увеличивается (единственная
			-- запись -- в iTF:NewPlate, значение 0, ключ получался 'nameplate-1'), а в .unit лежит строка
			-- запроса -- замер 01.10 23:14: у индикатора манекена там "target", а не токен. Ключ фрейма
			-- берётся из карты guid->токен, которую публикует dll: GetNamePlateTokenByGUID(UnitGUID("target"))
			-- ответил "nameplate1", а iTF строит фреймы под эти же ключи (CreateNew('nameplate'..i)).
			if UnitExists('target') then
				local getToken = C_NamePlate.GetNamePlateTokenByGUID
				local guid = UnitGUID('target')
				local token = getToken and guid and getToken(guid)
				if token then
					unitID = token
					show = true
				elseif unitID and UnitIsUnit(unitID, 'target') then
					show = true
				end
			end
			for k in pairs(conditionals.targetChanged.currentTarget.indicators) do
				if k == 'border' then
					if iTF.currentTarget then
						indicatorFuncs:border(cond, iTF.currentTarget, nil, true)
					end
					if show then
						indicatorFuncs:border(cond, unitID, conditionals.targetChanged.currentTarget.color)
					elseif unitID then
						indicatorFuncs:border(cond, unitID, nil, true)
					end
				elseif k == 'alpha' then
					if iTF.currentTarget then
						indicatorFuncs:opacity(cond, iTF.currentTarget, nil, true)
					end
					if show then
						indicatorFuncs:opacity(cond, unitID, conditionals.targetChanged.currentTarget.alpha)
					elseif unitID then
						indicatorFuncs:opacity(cond, unitID, nil, true)
					end
				elseif k == 'statusbar' then
					if iTF.currentTarget then
						indicatorFuncs:statusbar(cond, iTF.currentTarget, nil, true)
					end
					if show then
						indicatorFuncs:statusbar(cond, unitID, conditionals.targetChanged.currentTarget.color)
					elseif unitID then
						indicatorFuncs:statusbar(cond, unitID, nil, true)
					end
				elseif string.find(k, 'glow') then
					if iTF.currentTarget then
						indicatorFuncs:glows(k,cond, iTF.currentTarget, nil, true)
					end
					if show then
						indicatorFuncs:glows(k, cond, unitID, conditionals.targetChanged.currentTarget.color)
					elseif unitID then
						indicatorFuncs:glows(k, cond, unitID, nil, true)
					end
				end
			end
			--! WotLK fix: в памяти держим только тот фрейм, который реально подсветили. Прежняя строка
			-- записывала и юнит, который только что погасили, -- при пересчёте чужого фрейма (updateUnitID
			-- и цикл OnUpdate) следующий сброс приходился на неверный ключ, и подсветка оставалась на старой цели.
			iTF.currentTarget = show and unitID or nil
		end
	elseif cond == 'maxRange' then
		if conditionals.onUpdate.maxRange then
			local show = false
			--[[if type(specID.utility) == 'table' then
				if IsSpellInRange(specID.utility.min, k) == 0 or IsSpellInRange(specID.utility.min, k) == 0 then
					show = true
				end
			elseif IsSpellInRange(specID.utility, unitID) == 0 then
				show = true
			end]]
			if conditionals.onUpdate.maxRange.invert then
				if type(specID.utility) == 'table' then
					--! WotLK fix: was IsSpellInRange(specID.utility.min, k) twice -- k is not in scope here
					-- (nil), and .max was never read. Both copies of this branch had it.
					if IsSpellInRange(specID.utility.min, unitID) == 0 or IsSpellInRange(specID.utility.max, unitID) == 0 then
						show = true
					end
				elseif IsSpellInRange(specID.utility, unitID) == 0 then
					show = true
				end
			else
				if type(specID.utility) == 'table' then
					if IsSpellInRange(specID.utility.min, unitID) == 1 or IsSpellInRange(specID.utility.max, unitID) == 1 then
						show = true
					end
				elseif IsSpellInRange(specID.utility, unitID) == 1 then
					show = true
				end
			end
			for k in pairs(conditionals.onUpdate.maxRange.indicators) do
				if k == 'border' then
					if show then
						indicatorFuncs:border(cond, unitID, conditionals.onUpdate.maxRange.color)
					else
						indicatorFuncs:border(cond, unitID, nil, true)
					end
				elseif k == 'alpha' then
					if show then
						indicatorFuncs:opacity(cond, unitID, conditionals.onUpdate.maxRange.alpha)
					else
						indicatorFuncs:opacity(cond, unitID, nil, true)
					end
				elseif k == 'statusbar' then
					if show then
						indicatorFuncs:statusbar(cond, unitID, conditionals.onUpdate.maxRange.color)
					else
						indicatorFuncs:statusbar(cond, unitID, nil, true)
					end
				elseif string.find(k, 'glow') then
					if show then
						indicatorFuncs:glows(k, cond, unitID, conditionals.onUpdate.maxRange.color)
					else
						indicatorFuncs:glows(k, cond, unitID, nil, true)
					end
				end
			end
		end
	elseif cond == 'aggro' or cond == 'gainingAggro' or cond == 'losingAggro' then
		local threat = UnitThreatSituation('player', unitID)
		local threatTable = {
			['gainingAggro'] = 1,
			['losingAggro'] = 2,
			['aggro'] = 3,				
		}
		local show = false
		if threat and threat > 0 and threatTable[cond] == threat then
			if conditionals.threat[cond].roles == 1 then --All
				show = true
			elseif conditionals.threat[cond].roles == 2 and specID.tank then --Tank
				show = true
			elseif (not specID.tank) and conditionals.threat[cond].roles == 3 then --non tanks
				show = true
			end
		end
		for k in pairs(conditionals.threat[cond].indicators) do
			if k == 'border' then
				if show then
					indicatorFuncs:border(cond, unitID, conditionals.threat[cond].color)
				else
					indicatorFuncs:border(cond, unitID, nil, true)
				end
			elseif k == 'alpha' then
				if show then
					indicatorFuncs:opacity(cond, unitID, conditionals.threat[cond].alpha)
				else
					indicatorFuncs:opacity(cond, unitID, nil, true)
				end
			elseif k == 'statusbar' then
				if show then
					indicatorFuncs:statusbar(cond, unitID, conditionals.threat[cond].color)
				else
					indicatorFuncs:statusbar(cond, unitID, nil, true)
				end
			elseif string.find(k, 'glow') then
				if show then
					indicatorFuncs:glows(k,cond, unitID, conditionals.threat[cond].color)
				else
					indicatorFuncs:glows(k, cond, unitID, nil, true)
				end
			end
		end
	elseif cond == 'focusTarget' then
		if conditionals.focusUpdate.focusTarget then
			local show = false
			--! WotLK fix: та же связка, что и для currentTarget выше: guid фокуса -> токен из данных dll.
			-- Прежняя ветка к тому же индексировала nameplate.UnitFrame.unit без проверки UnitFrame.
			if UnitExists('focus') then
				local getToken = C_NamePlate.GetNamePlateTokenByGUID
				local guid = UnitGUID('focus')
				local token = getToken and guid and getToken(guid)
				if token then
					unitID = token
					show = true
				elseif unitID and UnitIsUnit(unitID, 'focus') then
					show = true
				end
			end
			for k in pairs(conditionals.focusUpdate.focusTarget.indicators) do
				if k == 'border' then
					if iTF.focusTarget then
						indicatorFuncs:border(cond, iTF.focusTarget, nil, true)
					end
					if show then
						indicatorFuncs:border(cond, unitID, conditionals.focusUpdate.focusTarget.color)
					elseif unitID then
						indicatorFuncs:border(cond, unitID, nil, true)
					end
				elseif k == 'alpha' then
					if iTF.focusTarget then
						indicatorFuncs:opacity(cond, iTF.focusTarget, nil, true)
					end
					if show then
						indicatorFuncs:opacity(cond, unitID, conditionals.focusUpdate.focusTarget.alpha)
					elseif unitID then
						indicatorFuncs:opacity(cond, unitID, nil, true)
					end
				elseif k == 'statusbar' then
					if iTF.focusTarget then
						indicatorFuncs:statusbar(cond, iTF.focusTarget, nil, true)
					end
					if show then
						indicatorFuncs:statusbar(cond, unitID, conditionals.focusUpdate.focusTarget.color)
					elseif unitID then
						indicatorFuncs:statusbar(cond, unitID, nil, true)
					end
				elseif string.find(k, 'glow') then
					if iTF.focusTarget then
						indicatorFuncs:glows(k, cond, iTF.focusTarget, nil, true)
					end
					if show then
						indicatorFuncs:glows(k, cond, unitID, conditionals.focusUpdate.focusTarget.color)
					elseif unitID then
						indicatorFuncs:glows(k, cond, unitID, nil, true)
					end
				end
			end
			--! WotLK fix: как в currentTarget -- держать в памяти только подсвеченный фрейм.
			iTF.focusTarget = show and unitID or nil
		end
	elseif cond and customConditionals[cond] then
		--! WotLK fix (06.10): отсюда убраны шесть закомментированных строк -- прошлый подход, который звал
		-- getFunction (loadstring) на КАЖДУЮ оценку условия. Компиляция теперь одна, при загрузке списка
		-- (`iTargetingFrames.lua:2056`), а здесь зовётся уже готовая `.funct`; текст ошибки печатается там же.
		-- A custom conditional reads through customData, which only exists once updateUnitID has filled the
		-- frame. Until then there is nothing to evaluate, and indexing the nil is what spammed the error.
		local customData = iTF.frames[unitID] and iTF.frames[unitID].customData
		if not customData then
			return
		end
		local show, color, alpha = customConditionals[cond].funct(unitID, customData)
		for k in pairs(customConditionals[cond].indicators) do
			if k == 'border' then
				if show then
					indicatorFuncs:border(cond, unitID, (color or customConditionals[cond].color), nil, (color or alpha))
				else
					indicatorFuncs:border(cond, unitID, nil, true)
				end
			elseif k == 'alpha' then
				if show then
					indicatorFuncs:opacity(cond, unitID,( alpha or customConditionals[cond].alpha), nil, (color or alpha))
				else
					indicatorFuncs:opacity(cond, unitID, nil, true)
				end
			elseif k == 'statusbar' then
				if show then
					indicatorFuncs:statusbar(cond, unitID, (color or customConditionals[cond].color), nil, (color or alpha))
				else
					indicatorFuncs:statusbar(cond, unitID, nil, true)
				end
			elseif string.find(k, 'glow') then
				if show then
					indicatorFuncs:glows(k, cond, unitID, (color or customConditionals[cond].color), nil, (color or alpha))
				else
					indicatorFuncs:glows(k, cond, unitID, nil, true)
				end
			end
		end
	elseif cond == 'priorityNPCs' then
		if conditionals.onShow.priorityNPCs then
			local show = false
			if (iTF.frames[unitID].unitName and iTFConfig.priorityNPCs[iTF.frames[unitID].unitName]) or (iTF.frames[unitID].npcID and iTFConfig.priorityNPCs[iTF.frames[unitID].npcID]) then
				show = true
			end
			for k in pairs(conditionals.onShow.priorityNPCs.indicators) do
				if k == 'border' then
					if show then
						indicatorFuncs:border(cond, unitID, conditionals.onShow.priorityNPCs.color)
					else
						indicatorFuncs:border(cond, unitID, nil, true)
					end
				elseif k == 'alpha' then
					if show then
						indicatorFuncs:opacity(cond, unitID, conditionals.onShow.priorityNPCs.alpha)
					else
						indicatorFuncs:opacity(cond, unitID, nil, true)
					end
				elseif k == 'statusbar' then
					if show then
						indicatorFuncs:statusbar(cond, unitID, conditionals.onShow.priorityNPCs.color)
					else
						indicatorFuncs:statusbar(cond, unitID, nil, true)
					end
				elseif string.find(k, 'glow') then
					if show then
						indicatorFuncs:glows(k, cond, unitID, conditionals.onShow.priorityNPCs.color)
					else
						indicatorFuncs:glows(k, cond, unitID, nil, true)
					end
				end
			end
		end
	end
end
local function count(t)
	local i = 0
	for _ in pairs(t) do
		i = i + 1
	end
	return i
end
local function round(num, idp)
	local mult = 10^(idp or 0)
	return math.floor(num * mult + 0.5) / mult
end
--! WotLK fix: NPC blacklist. Keys are the same as for priority names: unit name or npcID. The frame is
-- protected, so only the snippet may hide it -- the verdict travels there in attribute 'itfdenyitfN'.
-- No leading underscore: inside a snippet GetAttribute returns nil for any '_' name, silently
-- (RestrictedFrames.lua:188-191). See docs/TECHNICAL.md item 56 (the chain itself: item 41).
function iTF:npcDenied(unitID)
	local f = iTF.frames and iTF.frames[unitID]
	if not f or not iTFConfig or not iTFConfig.npcBlacklist then return false end
	local name = f.unitName
	local id = f.npcID
	return (name and iTFConfig.npcBlacklist[name])
		or (id and id ~= '0' and iTFConfig.npcBlacklist[id])
		and true or false
end
--! WotLK fix: the attribute is written only when THIS slot's verdict changes -- sweeping the whole
-- list on every plate would cost 60 writes to a protected frame per unit.
--! WotLK fix (05.10): сверяемся с САМИМ атрибутом, а не с теневым полем f.denyAttr. Раньше «мемо не
-- заполнено» и «не запрещён» были одним и тем же nil, а refreshNpcBlacklist обнуляло мемо перед
-- проходом -- и проверка `if f.denyAttr == denied then return end` съедала ровно СТИРАЮЩУЮ запись.
-- Итог в игре: '/itf unignore' (и крестик в окне, options.lua:3452) оставлял 'itfdenyitfN' = 1,
-- '_itfupdate' продолжал освобождать клетку, а слот itfN умирал НАВСЕГДА -- любой следующий моб,
-- которому клиент выдал этот nameplateN, вечно висел в очереди (alive = 0) без рамки, и починить это
-- мог только /reload. Самолечения не было по той же причине: updateUnitID зовёт applyDenyAttr, а тот
-- снова видел nil == nil и выходил. Источник истины теперь один -- то, что реально читает сниппет.
function iTF:applyDenyAttr(unitID, noRerun)
	local f = iTF.frames[unitID]
	if not f or not iTF.mainFrame then return end
	local attr = 'itfdenyitf' .. f.nameplateID
	local denied = iTF:npcDenied(unitID) and 1 or nil
	f.denyAttr = denied -- только для дампа '/itf deny', решение на нём больше не держится
	if iTF.mainFrame:GetAttribute(attr) == denied then return end
	iTF.mainFrame:SetAttribute(attr, denied)
	--! WotLK fix: the attribute does nothing by itself -- '_itfupdate' reads it, and that snippet runs
	-- only on state transitions. Without this re-run an already filled cell would hold until the next
	-- NAME_PLATE_UNIT. Paid only on a change of verdict, not on every refill.
	if not noRerun then
		iTF.mainFrame:Execute([[control:RunAttribute('_itfupdate')]])
	end
end
-- Полный пересмотр после правки списка: игрок сам решает, когда это нужно, и моргание сетки здесь
-- оправдано -- иначе уже показанный чёрный список висел бы в клетке до следующего перехода.
function iTF:refreshNpcBlacklist()
	if not iTF.mainFrame then return end
	for unitID in pairs(iTF.frames) do
		-- мемо здесь больше не обнуляем: именно это обнуление и ломало снятие из списка (см. выше).
		-- второй аргумент: пересмотр всего списка заканчивается полной пересборкой сетки ниже, точечные
		-- перезапуски на каждую рамку были бы лишними проходами раскладки
		iTF:applyDenyAttr(unitID, true)
	end
	iTF:updateMainFrameAttributes(true)
end
--! WotLK fix: `/itf deny` -- дамп того, что цепочка запрета видит на самом деле. Зонд из чата для
-- этого не годится: `iTF` -- локал чанка, а наружу торчит только глобал-неймспейс `iTargetingFrames`
-- (03.10 прогон падал именно на `attempt to index global 'iTF'`). Печатает по каждой показанной рамке
-- имя, npcID, решение npcDenied, мемо и значение secure-атрибута -- то есть весь путь целиком.
function iTF:DebugDeny()
	local list = iTFConfig and iTFConfig.npcBlacklist
	local n = 0
	if list then for _ in pairs(list) do n = n + 1 end end
	iTF:print('deny: entries ' .. n)
	if not iTF.mainFrame then
		iTF:print('deny: mainFrame ещё нет -- атрибут ставить некуда')
		return
	end
	for unitID, f in pairs(iTF.frames) do
		if f.isShown then
			iTF:print(string.format('deny: %s name=%s id=%s denied=%s memo=%s attr=%s',
				unitID, tostring(f.unitName), tostring(f.npcID),
				iTF:npcDenied(unitID) and 'YES' or 'no', tostring(f.denyAttr),
				tostring(iTF.mainFrame:GetAttribute('itfdenyitf' .. f.nameplateID))))
		end
	end
end
function iTargetingFrames:NpcBlacklist(npc, remove)
	npc = tostring(npc)
	iTFConfig.npcBlacklist = iTFConfig.npcBlacklist or {}
	if remove then
		iTFConfig.npcBlacklist[npc] = nil
	else
		iTFConfig.npcBlacklist[npc] = true
	end
	iTF:refreshNpcBlacklist()
end
function iTargetingFrames:PrioNPC(npc, comment)
	local update = false
	if type(npc) == 'table' then
		for k,v in pairs(npc) do
			k = tostring(k)
			if iTFConfig.priorityNPCs[k] == nil then
				iTFConfig.priorityNPCs[k] = v or true
				update = true
			end
		end
	else
		npc = tostring(npc)
		if iTFConfig.priorityNPCs[npc] == nil then
			iTFConfig.priorityNPCs[npc] = comment or true
			update = true
		end
	end
	if update then
		for unitID,_ in pairs(iTF.frames) do
			if UnitExists(unitID) then
				updateIndicator(unitID,'priorityNPCs')
			end
		end
	end
end
function iTF:print(...)
	local s = {...}
	local msg = ''
	for _,v in ipairs(s) do
		msg = msg .. v
	end
	if msg == 'help' then
		print('--iTargetingFrames--\n "/itf" to toggle config window.\n "/itf reset" to reset everything to default settings.')
	else
		print('iTF: ' .. msg)
	end
end
local function utf8_charbytes (s, i)
   -- argument defaults
   i = i or 1
   local c = string.byte(s, i)
   
   -- determine bytes needed for character, based on RFC 3629
   --! WotLK fix (06.10): отсюда убраны чтения продолжающих байт (`local c2/c3/c4 = s:byte(...)`). В
   -- библиотеке utf8, откуда функция скопирована, они проверяли, что продолжение действительно 0x80..0xBF;
   -- здесь результат никуда не шёл -- ни одной проверки, ни одного возврата. То есть на каждый многобайтный
   -- символ делалось 1..3 вызова string.byte впустую, а функция зовётся из utf8_len/utf8_sub на каждый
   -- символ имени. Длину это не меняло и не меняет: решение принимает только первый байт.
   if c > 0 and c <= 127 then
      -- UTF8-1
      return 1
   elseif c >= 194 and c <= 223 then
      -- UTF8-2
      return 2
   elseif c >= 224 and c <= 239 then
      -- UTF8-3
      return 3
   elseif c >= 240 and c <= 244 then
      -- UTF8-4
      return 4
   end
end
--! WotLK fix: chars was read as a global here (always nil) -- it is a parameter in the utf8 library this
-- was copied from. Made it one again; the single caller passes no second argument, so nothing changes.
local function utf8_len (s, chars)
   local pos = 1
   local bytes = string.len(s)
   local len = 0
   
   while pos <= bytes and len ~= chars do
      -- (06.10) здесь тоже стояло `local c = string.byte(s,pos)` впустую: длину считает len, шаг -- utf8_charbytes.
      len = len + 1

      pos = pos + utf8_charbytes(s, pos)
   end
   
   if chars ~= nil then
      return pos - 1
   end
   
   return len
end
local function utf8_sub (s, i, j)
   j = j or -1

   if i == nil then
      return ""
   end
   
   local pos = 1
   local bytes = string.len(s)
   local len = 0

   -- only set l if i or j is negative
   local l = (i >= 0 and j >= 0) or utf8_len(s)
   local startChar = (i >= 0) and i or l + i + 1
   local endChar = (j >= 0) and j or l + j + 1

   -- can't have start before end!
   if startChar > endChar then
      return ""
   end
   
   -- byte offsets to pass to string.sub
   local startByte, endByte = 1, bytes
   
   while pos <= bytes do
      len = len + 1
      
      if len == startChar then
	 startByte = pos
      end
      
      pos = pos + utf8_charbytes(s, pos)
      
      if len == endChar then
	 endByte = pos - 1
	 break
      end
   end
   
   return string.sub(s, startByte, endByte)
end
function iTF:trimText(unitID, cast)
	if cast then
		while iTF.frames[unitID].castBarText:GetWidth() > iTFConfig.layout.castBar.detached_width do
			iTF.frames[unitID].castBarText:SetText(utf8_sub(iTF.frames[unitID].castBarText:GetText(), 1, -2))
		end
	else
		while iTF.frames[unitID].text:GetWidth() > iTFConfig.layout.frame.width do
			iTF.frames[unitID].text:SetText(utf8_sub(iTF.frames[unitID].text:GetText(), 1, -2))
		end
	end
end
function iTF:abbreviate(str)
	if str then
		local t = {strsplit(' ', str)}
		if #t > 1 then
			str = t[#t]
			for i = #t-1, 1, -1 do
				str = string.format('%s. %s', utf8_sub(t[i],1,1), str)
			end
		end
		return str
	end
end
function iTF:setName(unitID, setIt)
	local name = UnitName(unitID)
	if (not name and UnitExists(unitID)) or name == UNKNOWN then
		if name == UNKNOWN then
			AceTimer:ScheduleTimer(function()
				iTF:setName(unitID, true)
			end, 0.2)
		end
	end
	if iTFConfig.layout.text.abbreviateNames then
		name = iTF:abbreviate(name)
	end

	if setIt then
		iTF.frames[unitID].unitName = UnitName(unitID)
		if iTF.frames[unitID].customData then
			iTF.frames[unitID].customData.name = UnitName(unitID)
		end
	end
	iTF.frames[unitID].text:SetText(name or UNKNOWN)
	iTF:trimText(unitID)
end
function iTF:testMode(start)
	if start then
		iTF.configMode = true
		--iTF:registerEvents(true)
		--iTF:updateNameplateStateDrivers(true,true)
	else
		iTF.configMode = false
		--iTF:registerEvents()
		--iTF:updateNameplateStateDrivers(true,false)
	end
end
function iTF:updateHealth(unitID)
	if iTF.frames[unitID] then
		local hp = UnitHealth(unitID)
		local maxHP = UnitHealthMax(unitID)
		local value = 1
		if hp and maxHP then
			value = hp/maxHP
		end
		iTF.frames[unitID].healthBar:SetValue(value)
		--! WotLK fix: dropped a dead block here. It looped conditionals.onHealth.custom -- a literal key
		-- that never exists (real ones are custom1, custom2) -- and called updateIndicator with the first
		-- two arguments swapped. Every caller already loops conditionals.onHealth itself.
		if iTFConfig.layout.healthText.enabled then
			--! WotLK fix: same per-poll reformat as the aura countdown. The string only changes when the
			-- rounded percentage does, so compare first; customData.health further down still updates every
			-- poll because custom conditionals read it as a number, not as text.
			local rounded = round(value*100)
			if iTF.frames[unitID].healthValue ~= rounded then
				iTF.frames[unitID].healthValue = rounded
				iTF.frames[unitID].healthText:SetFormattedText(iTF.healthTextString, value*100)
			end
		end
		-- customData belongs to updateUnitID, and with our dll a nameplate token can resolve (UnitExists is
		-- already true) a moment before C_NamePlate.GetNamePlateForUnit has a visible plate for it. Such a
		-- frame is legitimately shown but not yet filled, so health must not assume otherwise.
		if iTF.frames[unitID].customData then
			iTF.frames[unitID].customData.health = value*100
		end
	end
end
local aurasToUpdate = {}
function iTF:sortAurasByTime(temp, unitID)
	if #temp > 0 then
		local id = 1
		local noDuration = {}
		for k,v in spairs(temp, function(t,a,b) if iTFConfig.layout.icon.sort.ascending then return t[b].expirationTime > t[a].expirationTime end return t[b].expirationTime < t[a].expirationTime end) do
			if v.expirationTime > 0 then
				if id > iTFConfig.layout.icon.max then break end -- break, not return: the hide loop below still has to run
				if not iTF.frames[unitID].auras[id] then
					iTF:CreateAuraFrame(unitID, id)
				end
				iTF.frames[unitID].auras[id].tex:SetTexture(v.icon)
				iTF.frames[unitID].auras[id].tex:SetTexCoord(.18, .82, .18, .82)
				iTF.frames[unitID].auras[id]:Show()
				iTF:setDurationInfo(unitID, id, v.expirationTime, v.stack)
				id = id + 1
			else
				table.insert(noDuration, v)
			end
		end
		for i = 1, #noDuration do -- Sort auras without duration to last
			if id > iTFConfig.layout.icon.max then break end -- break, not return: the hide loop below still has to run
			local v = noDuration[i]
			if not iTF.frames[unitID].auras[id] then
				iTF:CreateAuraFrame(unitID, id)
			end
			iTF.frames[unitID].auras[id].tex:SetTexture(v.icon)
			iTF.frames[unitID].auras[id]:Show()
			iTF:setDurationInfo(unitID, id, v.expirationTime, v.stack)
			id = id + 1
		end
		for i = id, #iTF.frames[unitID].auras do
			iTF.frames[unitID].auras[i]:Hide()
			-- was `id`: every leftover slot then cleared the duration of the SAME slot, so the others kept
			-- an expired endTime in aurasToUpdate and their text counted down through zero into negatives.
			iTF:setDurationInfo(unitID, i, nil, nil, true)
		end
	else
		for i = 1, #iTF.frames[unitID].auras do
			iTF.frames[unitID].auras[i]:Hide()
			iTF:setDurationInfo(unitID, i, nil, nil, true)
		end
	end
end
function iTF:sortAurasByName(temp, unitID)
	if #temp > 0 then
		local id = 1
		for k,v in spairs(temp, function(t,a,b) if iTFConfig.layout.icon.sort.ascending then return t[b].name > t[a].name end return t[b].name < t[a].name end) do
			if id > iTFConfig.layout.icon.max then break end -- break, not return: the hide loop below still has to run
			if not iTF.frames[unitID].auras[id] then
				iTF:CreateAuraFrame(unitID, id)
			end
			iTF.frames[unitID].auras[id].tex:SetTexture(v.icon)
			iTF.frames[unitID].auras[id]:Show()
			iTF:setDurationInfo(unitID, id, v.expirationTime, v.stack)
			id = id + 1
		end
		for i = id, #iTF.frames[unitID].auras do
			iTF.frames[unitID].auras[i]:Hide()
			-- was `id`: every leftover slot then cleared the duration of the SAME slot, so the others kept
			-- an expired endTime in aurasToUpdate and their text counted down through zero into negatives.
			iTF:setDurationInfo(unitID, i, nil, nil, true)
		end
	else
		for i = 1, #iTF.frames[unitID].auras do
			iTF.frames[unitID].auras[i]:Hide()
			iTF:setDurationInfo(unitID, i, nil, nil, true)
		end
	end
end
function iTF:setDurationInfo(unitID, aura, endTime, stack, hide)
	if iTF.frames[unitID].auras[aura].anim then
		iTF.frames[unitID].auras[aura].flash:Stop()
	end
	-- The countdown text cache in OnUpdate is per slot, so it has to be dropped whenever the slot is
	-- re-pointed at another aura or taken out of use -- otherwise the next aura reuses the previous
	-- number in its first frame.
	iTF.frames[unitID].auras[aura].textTick = nil
	if hide then
		if aura then
			if aura == 1 then
				aurasToUpdate[unitID] = nil
			elseif aurasToUpdate[unitID] then
				aurasToUpdate[unitID][aura] = nil
				if count(aurasToUpdate[unitID]) == 0 then
					aurasToUpdate[unitID] = nil
				end
			end
		else
			aurasToUpdate[unitID] = nil
		end
	else
		if stack and stack > 0 and iTFConfig.layout.icon.stackEnabled then 
			iTF.frames[unitID].auras[aura].stackText:SetText(stack)
			iTF.frames[unitID].auras[aura].stackText:Show()
		else
			iTF.frames[unitID].auras[aura].stackText:Hide()
		end
		if not aurasToUpdate[unitID] then
			aurasToUpdate[unitID] = {}
		end
		if endTime then
			if iTFConfig.layout.icon.durationEnabled then
				aurasToUpdate[unitID][aura] = endTime
				if endTime > 0 then
					iTF.frames[unitID].auras[aura].cooldownText:Show()
				else
					iTF.frames[unitID].auras[aura].cooldownText:Hide()
				end
			end
		else
			aurasToUpdate[unitID][aura] = nil
			iTF.frames[unitID].auras[aura].cooldownText:Hide()
		end
		iTF.frames[unitID].auras[aura]:SetAlpha(1)		
	end
end
function iTF:applyAuras(unitID, tempAuraTable)
	-- updateAuras() is polled from OnUpdate (0.3s), and sortAuras*() restarts the flash animation of every
	-- slot it touches (setDurationInfo stops it, the countdown plays it again). Without this check auras
	-- would stutter instead of flashing, so an unchanged set is simply not re-applied.
	local shown = iTF.frames[unitID].auraShown
	local n = #tempAuraTable
	if shown and #shown == n then
		for i = 1, n do
			local a, b = shown[i], tempAuraTable[i]
			if a.name ~= b.name or a.expirationTime ~= b.expirationTime or a.count ~= b.count then
				shown = nil
				break
			end
		end
		if shown then return end
	end
	shown = {}
	for i = 1, n do
		local v = tempAuraTable[i]
		shown[i] = { ['name'] = v.name, ['expirationTime'] = v.expirationTime, ['count'] = v.count }
	end
	iTF.frames[unitID].auraShown = shown
	if iTFConfig.layout.icon.sort.time then
		iTF:sortAurasByTime(tempAuraTable, unitID)
	else
		iTF:sortAurasByName(tempAuraTable, unitID)
	end
end
--! WotLK fix: UnitDebuff returns no spellID on 3.3.5a, so an id-keyed blacklist entry can only be matched
-- by name. Resolved once on change instead of per aura read -- updateAuras runs 3 times a second per plate.
iTF.blacklistNames = {}
function iTF:refreshBlacklist()
	local t = {}
	if iTFConfig and iTFConfig.blacklist then
		for k,v in pairs(iTFConfig.blacklist) do
			local id = v and tonumber(k)
			local name = id and GetSpellInfo(id)
			if name then t[name] = true end
		end
	end
	iTF.blacklistNames = t
end
--! WotLK fix: updateAuras runs 5 times a second per plate and used to build a fresh table plus one subtable
-- per aura on every call -- pure garbage for the collector on Lua 5.1. The buffer and its subtables are now
-- reused: only the fields are overwritten. applyAuras() copies out everything it keeps (auraShown, the sort
-- keys, the icon and duration passed to setDurationInfo), so holding the rows alive across polls is safe.
local function clearAuraBuffer(t)
	for i = #t, 1, -1 do
		t[i] = nil
	end
end
function iTF:updateAuras(unitID)
	local buffer = iTF.auraBuffer
	if not buffer then
		buffer = {}
		iTF.auraBuffer = buffer
	else
		clearAuraBuffer(buffer)
	end
	local n = 0
	for i = 1, 41 do
		--! WotLK fix: UnitDebuff returns 9 values here, not 11 -- position 11 (spellID) was always nil, so
		-- the id-keyed blacklist never matched anything; iTF.blacklistNames covers it now. The filter token
		-- also has to be upper case -- 'player' matched nothing, so every plate showed the whole raid's debuffs.
		local name, _, icon, count, _, duration, expirationTime = UnitDebuff(unitID, i, 'PLAYER')
		if not name then
			iTF:applyAuras(unitID, buffer)
			break
		else
			if not iTFConfig.blacklist[name] and not iTF.blacklistNames[name] then
				n = n + 1
				local row = buffer[n]
				if not row then
					row = {}
					buffer[n] = row
				end
				row.name = name
				row.icon = icon
				row.duration = duration
				row.expirationTime = expirationTime > 0 and expirationTime or -1
				row.count = count
				row.start = expirationTime - duration
				row.stack = count
			end
		end
	end
end
function iTF:updateCast(unitID,channel)
	if not iTFConfig.layout.castBar.enabled then return end
	local name, nameSubtext, text, texture, startTime, endTime, isTradeSkill, castID, notInterruptible
	if channel then
		name, nameSubtext, text, texture, startTime, endTime, isTradeSkill, notInterruptible = UnitChannelInfo(unitID)
	else
		name, nameSubtext, text, texture, startTime, endTime, isTradeSkill, castID, notInterruptible = UnitCastingInfo(unitID)
	end
	if name and not iTF.frames[unitID].isMe then
		if not iTFConfig.layout.castBar.detached then
			iTF.frames[unitID].healthBar:SetHeight(iTFConfig.layout.frame.height-1-iTFConfig.layout.frame.castBarHeight)
			if notInterruptible then
				iTF.frames[unitID].text:SetTextColor(unpack(iTFConfig.layout.colors.text.immune))
			else
				iTF.frames[unitID].text:SetTextColor(unpack(iTFConfig.layout.colors.text.cast))
			end
			iTF.frames[unitID].text:SetText(name)
			iTF:trimText(unitID)
		else
			if notInterruptible then
				iTF.frames[unitID].castBarText:SetTextColor(unpack(iTFConfig.layout.colors.text.immune))
			else
				iTF.frames[unitID].castBarText:SetTextColor(unpack(iTFConfig.layout.colors.text.cast))
			end
			iTF.frames[unitID].castBarText:SetText(name)
			iTF:trimText(unitID, true)
		end
		iTF.frames[unitID].castBar:Show()
		--iTF.frames[unitID].castBar:SetMinMaxValues(startTime/1000, endTime/1000)
		local starttime = startTime/1000
		local endtime =  endTime/1000
		iTF.frames[unitID].castBar:SetMinMaxValues(starttime-GetTime(), endtime-GetTime())
		iTF.frames[unitID].castBar:SetScript('OnUpdate', function()
			iTF.frames[unitID].castBar:SetValue(GetTime()-starttime)
		end)
	else
		if UnitExists(unitID) then
			iTF:setName(unitID)
			iTF.frames[unitID].text:SetTextColor(unpack(iTFConfig.layout.colors.text.main))
		end
		iTF.frames[unitID].castBar:SetScript('OnUpdate', nil)
		iTF.frames[unitID].castBar:SetValue(0)
		iTF.frames[unitID].castBar:Hide()
		iTF.frames[unitID].healthBar:SetHeight(iTFConfig.layout.frame.height)
	end
end

--! WotLK fix: опрос каста. Клиент не шлёт UNIT_SPELLCAST_* для токена nameplateN -- тот же класс
-- отсутствующих событий, из-за которого здесь же опрашиваются здоровье (выше), ауры и threat. Без этого
-- плашка отражала каст только в момент заполнения рамки: моб, начавший читать ПОСЛЕ того, как его рамка
-- появилась, не показывал ничего, а начавший до -- показывал и держал полосу после конца каста.
-- updateCast переставляет OnUpdate полосы и перетирает текст целиком, поэтому вызывается только при
-- смене состояния: ключ -- имя плюс startTime (миллисекунды, уникальны на каждый новый каст).
function iTF:refreshCast(unitID)
	local f = iTF.frames[unitID]
	if not f or not iTFConfig.layout.castBar.enabled then return end
	-- startTime у обеих функций пятый: UnitCastingInfo отдаёт ещё и castID, UnitChannelInfo -- нет
	local name, _, _, _, startTime = UnitCastingInfo(unitID)
	local channel = false
	if not name then
		local chName, _, _, _, chStart = UnitChannelInfo(unitID)
		if chName then
			name, startTime, channel = chName, chStart, true
		end
	end
	local key = name and ((channel and 'h' or 'c') .. name .. '/' .. tostring(startTime)) or nil
	if key == f.castKey then return end
	f.castKey = key
	iTF:updateCast(unitID, channel)
end

function iTF:CreateAuraFrame(unitID, id)
	--Create frame
	iTF.frames[unitID].auras[id] = CreateFrame('frame',nil,iTF.frames[unitID])
	iTF.frames[unitID].auras[id]:SetSize(iTFConfig.layout.icon.width,iTFConfig.layout.icon.height)
	--Backdrop
	iTF.frames[unitID].auras[id]:SetBackdrop(iTF.backdrop)
	iTF.frames[unitID].auras[id]:SetBackdropColor(0,0,0,1)
	iTF.frames[unitID].auras[id]:SetBackdropBorderColor(1,1,1,1)
	iTF.frames[unitID].auras[id]:SetFrameStrata('MEDIUM')
	local to = {['LEFT'] = 'Right', ['RIGHT'] = 'Left', ['TOP'] = 'Down', ['BOTTOM'] = 'Up'}
	local x,y = 0,0
	if iTFConfig.layout.icon.grow == 'LEFT' then
		x,y = iTFConfig.layout.icon.spacing,0
	elseif iTFConfig.layout.icon.grow == 'RIGHT' then
		x,y = -iTFConfig.layout.icon.spacing,0
	elseif iTFConfig.layout.icon.grow == 'TOP' then
		x,y = 0,-iTFConfig.layout.icon.spacing
	else
		x,y = 0,iTFConfig.layout.icon.spacing
	end		
	if id == 1 then
		iTF.frames[unitID].auras[id]:SetPoint(iTFConfig.layout.icon.pos, iTF.frames[unitID], iTFConfig.layout.icon.pos, iTFConfig.layout.icon.x, iTFConfig.layout.icon.y)
	else
		iTF.frames[unitID].auras[id]:SetPoint(iTFConfig.layout.icon.grow, iTF.frames[unitID].auras[id-1], to[iTFConfig.layout.icon.grow], x, y)
	end
	--Icon
	iTF.frames[unitID].auras[id].tex = iTF.frames[unitID].auras[id]:CreateTexture()
	iTF.frames[unitID].auras[id].tex:SetAllPoints(iTF.frames[unitID].auras[id])
	--Cooldown
	iTF.frames[unitID].auras[id].cooldownText = iTF.frames[unitID].auras[id]:CreateFontString()
	iTF.frames[unitID].auras[id].cooldownText:SetFont(iTFConfig.layout.icon.durationFont, iTFConfig.layout.icon.durationSize, iTFConfig.layout.icon.durationFlags)
	iTF.frames[unitID].auras[id].cooldownText:SetPoint(iTFConfig.layout.icon.durationPos, iTF.frames[unitID].auras[id], iTFConfig.layout.icon.durationPos, iTFConfig.layout.icon.durationX, iTFConfig.layout.icon.durationY)
	iTF.frames[unitID].auras[id].cooldownText:SetTextColor(unpack(iTFConfig.layout.colors.text.duration))
	iTF.frames[unitID].auras[id].cooldownText:Hide()
	--Stack
	iTF.frames[unitID].auras[id].stackText = iTF.frames[unitID].auras[id]:CreateFontString()
	iTF.frames[unitID].auras[id].stackText:SetFont(iTFConfig.layout.icon.stackFont, iTFConfig.layout.icon.stackSize, iTFConfig.layout.icon.stackFlags)
	iTF.frames[unitID].auras[id].stackText:SetPoint(iTFConfig.layout.icon.stackPos, iTF.frames[unitID].auras[id], iTFConfig.layout.icon.stackPos, iTFConfig.layout.icon.stackX, iTFConfig.layout.icon.stackY)
	iTF.frames[unitID].auras[id].stackText:SetTextColor(unpack(iTFConfig.layout.colors.text.stack))
	iTF.frames[unitID].auras[id].stackText:Hide()
	
	--Flash animation
	
	local flashSpeed = iTFConfig.layout.icon.flashSpeed/2
	iTF.frames[unitID].auras[id].flash = iTF.frames[unitID].auras[id]:CreateAnimationGroup("Flash")
	iTF.frames[unitID].auras[id].flash:SetLooping('REPEAT')
	iTF.frames[unitID].auras[id].flash:HookScript('OnPlay', function()
		iTF.frames[unitID].auras[id].anim = true
		iTF.frames[unitID].auras[id].cooldownText:SetTextColor(unpack(iTFConfig.layout.colors.text.shortDuration))
	end)
	iTF.frames[unitID].auras[id].flash:HookScript('OnStop', function()
		iTF.frames[unitID].auras[id].anim = false
		iTF.frames[unitID].auras[id].cooldownText:SetTextColor(unpack(iTFConfig.layout.colors.text.duration))
	end)
	iTF.frames[unitID].auras[id].fadeOut = iTF.frames[unitID].auras[id].flash:CreateAnimation("ALPHA")
	iTF.frames[unitID].auras[id].fadeOut:SetDuration(flashSpeed)
	iTF.frames[unitID].auras[id].fadeOut:SetChange(-1)
	iTF.frames[unitID].auras[id].fadeOut:SetOrder(1)

	iTF.frames[unitID].auras[id].fadeIn = iTF.frames[unitID].auras[id].flash:CreateAnimation("ALPHA")
	iTF.frames[unitID].auras[id].fadeIn:SetDuration(flashSpeed)
	--! WotLK fix: was fadeOut:SetChange(1), which overwrote the fade-out with a fade-in and left fadeIn at
	-- its default. The icon dimmed and stayed dim instead of pulsing.
	iTF.frames[unitID].auras[id].fadeIn:SetChange(1)
	iTF.frames[unitID].auras[id].fadeIn:SetOrder(2)

end
function iTF:getUFPos(id)
	local r = id % iTFConfig.layout.colS 
	local x = 0
	local y = 0
	if iTFConfig.layout.invertGrow then
		y = math.floor(id / iTFConfig.layout.colS) * (iTFConfig.layout.frame.height + iTFConfig.layout.frame.vspacing)
		x = (r - 1) * (iTFConfig.layout.frame.width + iTFConfig.layout.frame.hspacing)
	
		if r == 0 then
			y = (math.floor(id / iTFConfig.layout.colS) - 1) * (iTFConfig.layout.frame.height + iTFConfig.layout.frame.vspacing)
			x = (iTFConfig.layout.colS - 1) * (iTFConfig.layout.frame.width + iTFConfig.layout.frame.hspacing)
		end
	else
		x = math.floor(id / iTFConfig.layout.colS) * (iTFConfig.layout.frame.width + iTFConfig.layout.frame.hspacing)
		y = (r - 1) * (iTFConfig.layout.frame.height + iTFConfig.layout.frame.vspacing)
	
		if r == 0 then
			x = (math.floor(id / iTFConfig.layout.colS) - 1) * (iTFConfig.layout.frame.width + iTFConfig.layout.frame.hspacing)
			y = (iTFConfig.layout.colS - 1) * (iTFConfig.layout.frame.height + iTFConfig.layout.frame.vspacing)
		end
	end
	if iTFConfig.layout.grow == 'TOPRIGHT' then
		return -x, -y
	elseif iTFConfig.layout.grow == 'TOPLEFT' then
		return x, -y
	elseif iTFConfig.layout.grow ==  'BOTTOMRIGHT' then
		return -x, y
	else --BOTTOMLEFT
		return x, y
	end
end
function iTF:hideAll(frame, loop)
	if loop then
		for k in pairs(iTF.frames) do
			iTF.frames[k]:SetAlpha(1)
			iTF.frames[k].alphaInUse = false
			iTF.frames[k].topFrame.glowLeft:Hide()
			iTF.frames[k].topFrame.glowLeft.inUse = false
			iTF.frames[k].topFrame.glowRight:Hide()
			iTF.frames[k].topFrame.glowRight.inUse = false
			iTF.frames[k].topFrame.glowTop:Hide()
			iTF.frames[k].topFrame.glowTop.inUse = false
			iTF.frames[k].topFrame.glowBottom:Hide()
			iTF.frames[k].topFrame.glowBottom.inUse = false
			iTF.frames[k]:SetBackdropBorderColor(unpack(iTFConfig.layout.colors.statusbar.border))
			iTF.frames[k].borderInUse = false
			iTF.frames[k].healthBar:SetStatusBarColor(unpack(iTFConfig.layout.colors.statusbar.main))
			iTF.frames[k].healthBar.inUse = false
		end
	else
		iTF.frames[frame]:SetAlpha(1)
		iTF.frames[frame].alphaInUse = false
		iTF.frames[frame].topFrame.glowLeft:Hide()
		iTF.frames[frame].topFrame.glowLeft.inUse = false
		iTF.frames[frame].topFrame.glowRight:Hide()
		iTF.frames[frame].topFrame.glowRight.inUse = false
		iTF.frames[frame].topFrame.glowTop:Hide()
		iTF.frames[frame].topFrame.glowTop.inUse = false
		iTF.frames[frame].topFrame.glowBottom:Hide()
		iTF.frames[frame].topFrame.glowBottom.inUse = false
		iTF.frames[frame]:SetBackdropBorderColor(unpack(iTFConfig.layout.colors.statusbar.border))
		iTF.frames[frame].borderInUse = false
		iTF.frames[frame].healthBar:SetStatusBarColor(unpack(iTFConfig.layout.colors.statusbar.main))
		iTF.frames[frame].healthBar.inUse = false
	end
end
function iTF:updateRaidIcon(unitID)
	if unitID then
		local raidIcon = GetRaidTargetIndex(unitID)
		if raidIcon and raidIcon < 9 then
			iTF.frames[unitID].raidIcon:SetTexture('Interface\\TargetingFrame\\UI-RaidTargetingIcon_'..raidIcon)
			iTF.frames[unitID].raidIcon:Show()
		else
			iTF.frames[unitID].raidIcon:Hide()
		end
	else
		for k in pairs(iTF.frames) do
			if UnitExists(k) then
				local raidIcon = GetRaidTargetIndex(k)
				if raidIcon and raidIcon < 9 then
					iTF.frames[k].raidIcon:SetTexture('Interface\\TargetingFrame\\UI-RaidTargetingIcon_'..raidIcon)
					iTF.frames[k].raidIcon:Show()
				else
					iTF.frames[k].raidIcon:Hide()
				end
			end
		end
	end
end
--! WotLK fix: guid в 3.3.5a -- это '0x' + 16 hex, а не розничный 'Creature-0-2-3-4-<entry>-...'.
-- Раскладку сняли по журналу клиента, следу dll и Warmane-комбатлогу (замер 02.10, подробности --
-- docs/TECHNICAL.md, п. 7.22): 4 hex типа (F130 существо / F140 пет / F110 геймобъект), затем 6 hex
-- «какое это существо», затем 6 hex номера спавна. Поле существа постоянно для одного имени (у
-- существ -- 215/220 имён, у пэтов -- 34/37), хвост не постоянен ни для одного (0/294). Розничный
-- sub(8,12) брал пять разрядов вместо шести: у существа это численно то же самое (старшая пара поля
-- равна '00' во всех 1 803 598 guid), у пэта -- теряла разряд в 1 307 случаях из 564 081, и весь ответ
-- зависел от наличия '0x', которого в рознице нет. Префикс снимаем, поле берём шестью разрядами.
function iTF:npcIDFromGUID(guid)
	if type(guid) ~= 'string' then return nil end
	local hex = (guid:gsub('^0[xX]', ''))
	return tonumber(string.sub(hex, 5, 10), 16)
end
function iTF:updateUnitID(unitID)
	iTF:hideAll(unitID)
	-- C_NamePlate comes from the optional AWNamePlateAPI shim. Called straight from NAME_PLATE_UNIT_ADDED,
	-- this is the one path that can run with the shim disabled, and then it is a nil call, not a missing
	-- plate -- same guard the 'target'/'focus' lookups above already use.
	local getPlate = C_NamePlate.GetNamePlateForUnit
	if not getPlate or not UnitExists(unitID) or not getPlate(unitID) then
		return
	end
	iTF.frames[unitID].unitName = UnitName(unitID) or UNKNOWN
	iTF.frames[unitID].guid = UnitGUID(unitID) or '0'
	-- Число теперь гарантированно есть всегда: при UnitGUID() == nil (юнита уже нет) был пустой срез, и
	-- string.format("%i", nil) ронял весь OnShow. Раскладку -- см. iTF:npcIDFromGUID выше.
	local npcID = iTF:npcIDFromGUID(iTF.frames[unitID].guid)
	iTF.frames[unitID].npcID = npcID and string.format("%i", npcID) or '0'
	iTF.frames[unitID].waitingFor = newIndicatorState()
	if UnitIsUnit(unitID, 'player') then
		iTF.frames[unitID].isMe = true
	else
		iTF.frames[unitID].isMe = false
	end
	if iTFConfig.layout.colors.classColor and UnitIsPlayer(unitID) then
		iTF.frames[unitID].isPlayer  = {}
		local _, class = UnitClass(unitID)
		iTF.frames[unitID].isPlayer.color = RAID_CLASS_COLORS[class]
		iTF.frames[unitID].isPlayer.class = class
		iTF.frames[unitID].healthBar:SetStatusBarColor(iTF.frames[unitID].isPlayer.color.r, iTF.frames[unitID].isPlayer.color.g, iTF.frames[unitID].isPlayer.color.b, iTFConfig.layout.colors.statusbar.main.a)
	else
		iTF.frames[unitID].isPlayer = nil
		iTF.frames[unitID].healthBar:SetStatusBarColor(unpack(iTFConfig.layout.colors.statusbar.main))
	end
	iTF.frames[unitID].customData = { -- For custom conditionals
		['name'] = iTF.frames[unitID].unitName,
		['guid'] = iTF.frames[unitID].guid,
		['npcid'] = iTF.frames[unitID].npcID,
		['class'] = (iTF.frames[unitID].isPlayer and iTF.frames[unitID].isPlayer.class) or nil,
		['health'] = 0,
	}
	iTF:updateHealth(unitID)
	iTF:updateAuras(unitID)
	iTF:updateRaidIcon(unitID)
	iTF:setName(unitID)
	-- refreshCast, а не updateCast: каналы (Boost, Mind Freeze и подобные) через updateCast(unitID) без
	-- второго аргумента не читались вовсе, то есть на заполнении рамки каст-полоса появлялась только для
	-- обычных кастов.
	iTF:refreshCast(unitID)
	-- имя и npcID известны только здесь, поэтому запрет пересматривается в этом же месте
	iTF:applyDenyAttr(unitID)
	for _,v in pairs(conditionals) do --force update all
		for cond, _ in pairs(v) do
			updateIndicator(unitID,cond)
		end
	end
end
function iTF:CreateNew(unitID, i)
	if not iTF.frames then
		iTF.frames = {}
	end
	local posX, posY = iTF:getUFPos(i)
	iTF.frames[unitID] = CreateFrame('BUTTON', 'iTF_'..unitID, iTF.mainFrame, 'SecureUnitButtonTemplate,SecureHandlerEnterLeaveTemplate,SecureHandlerShowHideTemplate,SecureHandlerStateTemplate')
	iTF.frames[unitID]:SetFrameStrata('LOW')
	iTF.frames[unitID]:SetAttribute('unit', unitID)
	iTF.frames[unitID]:SetAttribute('_onenter',[[local script = self:GetAttribute('itf_onenter'); if script then control:Run(script);end]])
	iTF.frames[unitID]:SetAttribute('_onleave',[[self:ClearBindings()]])
	iTF.frames[unitID]:SetAttribute('_onshow',[[if self:IsUnderMouse() then local script = self:GetAttribute('itf_onenter');if script then control:Run(script);end;end]])
	iTF.frames[unitID]:SetAttribute('_onhide',[[self:ClearBindings()]])
	iTF.frames[unitID]:SetSize(iTFConfig.layout.frame.width+2,iTFConfig.layout.frame.height+2)
	iTF.frames[unitID]:SetPoint(iTFConfig.layout.grow, iTF.mainFrame, iTFConfig.layout.grow, posX, posY)
	
	iTF.frames[unitID].nameplateID = i
	-- Состояние индикаторов строится здесь, а не только в updateUnitID: рамка существует с этого момента, а
	-- `indicatorFuncs:border` и остальные четыре читают `waitingFor` без проверки. Раньше слот, чей юнит ещё
	-- не имел плеята (или PLAYER_TARGET_CHANGED между CreateNew и первым updateUnitID), падал с
	-- `attempt to index field 'waitingFor' (a nil value)` -- замер 04.10 02:11 на nameplate1
	iTF.frames[unitID].waitingFor = newIndicatorState()
	
	--Backdrop
	iTF.frames[unitID]:SetBackdrop(iTF.UFbd)
	iTF.frames[unitID]:SetBackdropColor(unpack(iTFConfig.layout.colors.statusbar.backdrop))
	iTF.frames[unitID]:SetBackdropBorderColor(unpack(iTFConfig.layout.colors.statusbar.border))
	
	--Health Bar
	iTF.frames[unitID].healthBar = CreateFrame('StatusBar', nil,iTF.frames[unitID])
	iTF.frames[unitID].healthBar:SetStatusBarTexture(iTFConfig.layout.statusbar.texture)
	iTF.frames[unitID].healthBar:SetWidth(iTFConfig.layout.frame.width)
	iTF.frames[unitID].healthBar:SetHeight(iTFConfig.layout.frame.height)
	iTF.frames[unitID].healthBar:SetPoint('BOTTOMLEFT', iTF.frames[unitID], 'BOTTOMLEFT', 1,1)
	iTF.frames[unitID].healthBar:SetStatusBarColor(unpack(iTFConfig.layout.colors.statusbar.main))
	iTF.frames[unitID].healthBar:SetMinMaxValues(0,1)
	
	--Name/Cast text
	iTF.frames[unitID].text = iTF.frames[unitID].healthBar:CreateFontString()
	iTF.frames[unitID].text:SetFont(iTFConfig.layout.text.font, iTFConfig.layout.text.size,  iTFConfig.layout.text.flags)
	iTF.frames[unitID].text:SetPoint(iTFConfig.layout.text.pos, iTF.frames[unitID], iTFConfig.layout.text.pos, iTFConfig.layout.text.x,iTFConfig.layout.text.y)
	iTF.frames[unitID].text:SetText('')
	iTF.frames[unitID].text:SetTextColor(unpack(iTFConfig.layout.colors.text.main))
	
	--Health Text
	iTF.frames[unitID].healthText = iTF.frames[unitID].healthBar:CreateFontString()
	iTF.frames[unitID].healthText:SetFont(iTFConfig.layout.healthText.font, iTFConfig.layout.healthText.size, iTFConfig.layout.healthText.flags)
	iTF.frames[unitID].healthText:SetPoint(iTFConfig.layout.healthText.pos, iTF.frames[unitID], iTFConfig.layout.healthText.pos, iTFConfig.layout.healthText.x,iTFConfig.layout.healthText.y)
	iTF.frames[unitID].healthText:SetText('')
	iTF.frames[unitID].healthText:SetTextColor(unpack(iTFConfig.layout.colors.text.healthText))
	
	--Cast Bar
	iTF.frames[unitID].castBar = CreateFrame('StatusBar', nil,iTF.frames[unitID])
	iTF.frames[unitID].castBar:SetStatusBarTexture(iTFConfig.layout.castBar.texture)

	if iTFConfig.layout.castBar.detached then
		iTF.frames[unitID].castBar:SetWidth(iTFConfig.layout.castBar.detached_width)
		iTF.frames[unitID].castBar:SetHeight(iTFConfig.layout.castBar.detached_height)
		iTF.frames[unitID].castBar:SetPoint(iTFConfig.layout.castBar.detached_from, iTF.frames[unitID], iTFConfig.layout.castBar.detached_to, iTFConfig.layout.castBar.detached_x,iTFConfig.layout.castBar.detached_y)

		-- Create fontstring for detached cast bar
		iTF.frames[unitID].castBarText = iTF.frames[unitID].castBar:CreateFontString()
		iTF.frames[unitID].castBarText:SetFont(iTFConfig.layout.castBar.detached_text_font, iTFConfig.layout.castBar.detached_text_size, iTFConfig.layout.castBar.detached_text_flags)
		iTF.frames[unitID].castBarText:SetPoint(iTFConfig.layout.castBar.detached_text_pos, iTF.frames[unitID].castBar, iTFConfig.layout.castBar.detached_text_pos, iTFConfig.layout.castBar.detached_text_x,iTFConfig.layout.castBar.detached_text_y)
		iTF.frames[unitID].castBarText:SetText('')
	else
		iTF.frames[unitID].castBar:SetWidth(iTFConfig.layout.frame.width)
		iTF.frames[unitID].castBar:SetHeight(iTFConfig.layout.frame.castBarHeight)
		iTF.frames[unitID].castBar:SetPoint('TOPLEFT', iTF.frames[unitID], 'TOPLEFT', 1,-1)
	end
	iTF.frames[unitID].castBar:SetBackdrop(iTF.UFbd)
	iTF.frames[unitID].castBar:SetBackdropColor(unpack(iTFConfig.layout.colors.statusbar.backdrop))
	iTF.frames[unitID].castBar:SetBackdropBorderColor(unpack(iTFConfig.layout.colors.statusbar.border))
	iTF.frames[unitID].castBar:SetStatusBarColor(unpack(iTFConfig.layout.colors.statusbar.cast))
	iTF.frames[unitID].castBar:SetMinMaxValues(0,1)
	iTF.frames[unitID].castBar:SetValue(0)
	iTF.frames[unitID].castBar:Hide()
	--Glow
	iTF.frames[unitID].topFrame = CreateFrame('frame', nil, iTF.frames[unitID]) -- anchor frame
	iTF.frames[unitID].topFrame:SetAllPoints(iTF.frames[unitID])
	iTF.frames[unitID].topFrame:SetFrameStrata('MEDIUM')
	--Top
	iTF.frames[unitID].topFrame.glowTop = iTF.frames[unitID].topFrame:CreateTexture()
	iTF.frames[unitID].topFrame.glowTop:SetPoint('TOP', iTF.frames[unitID].topFrame, 'TOP', 0,-1)
	iTF.frames[unitID].topFrame.glowTop:SetSize(iTFConfig.layout.frame.width, 8)
	iTF.frames[unitID].topFrame.glowTop:SetTexture('Interface\\AddOns\\iTargetingFrames\\media\\hGlow')
	iTF.frames[unitID].topFrame.glowTop:SetTexCoord(0, 60/64, 0, 1)
	iTF.frames[unitID].topFrame.glowTop:SetVertexColor(1,1,1,0.8)
	iTF.frames[unitID].topFrame.glowTop:Hide()
	--Bottom
	iTF.frames[unitID].topFrame.glowBottom = iTF.frames[unitID].topFrame:CreateTexture()
	iTF.frames[unitID].topFrame.glowBottom:SetPoint('BOTTOM', iTF.frames[unitID].topFrame, 'BOTTOM', 0,1)
	iTF.frames[unitID].topFrame.glowBottom:SetSize(iTFConfig.layout.frame.width, 8)
	iTF.frames[unitID].topFrame.glowBottom:SetTexture('Interface\\AddOns\\iTargetingFrames\\media\\hGlow')
	iTF.frames[unitID].topFrame.glowBottom:SetTexCoord(0, 60/64, 1, 0)
	iTF.frames[unitID].topFrame.glowBottom:SetVertexColor(1,0,1,0.8)
	iTF.frames[unitID].topFrame.glowBottom:Hide()
	--Left
	iTF.frames[unitID].topFrame.glowLeft = iTF.frames[unitID].topFrame:CreateTexture()
	iTF.frames[unitID].topFrame.glowLeft:SetPoint('LEFT', iTF.frames[unitID].topFrame, 'LEFT', 1,0)
	iTF.frames[unitID].topFrame.glowLeft:SetSize(8, iTFConfig.layout.frame.height)
	iTF.frames[unitID].topFrame.glowLeft:SetTexture('Interface\\AddOns\\iTargetingFrames\\media\\hGlow')
	iTF.frames[unitID].topFrame.glowLeft:SetTexCoord(60/64,0,0,0,60/64,1,0,1)
	iTF.frames[unitID].topFrame.glowLeft:SetVertexColor(1,1,0,0.8)
	iTF.frames[unitID].topFrame.glowLeft:Hide()
	--Right
	iTF.frames[unitID].topFrame.glowRight = iTF.frames[unitID].topFrame:CreateTexture()
	iTF.frames[unitID].topFrame.glowRight:SetPoint('RIGHT', iTF.frames[unitID].topFrame, 'RIGHT', -1,0)
	iTF.frames[unitID].topFrame.glowRight:SetSize(8, iTFConfig.layout.frame.height)
	iTF.frames[unitID].topFrame.glowRight:SetTexture('Interface\\AddOns\\iTargetingFrames\\media\\hGlow')
	iTF.frames[unitID].topFrame.glowRight:SetTexCoord(0,1,60/64,1,0,0,60/64,0)
	iTF.frames[unitID].topFrame.glowRight:SetVertexColor(0.5,1,0,0.8)
	iTF.frames[unitID].topFrame.glowRight:Hide()
	--[[
	--Top left
	iTF.frames[unitID].topFrame.glowTopLeft = iTF.frames[unitID].topFrame:CreateTexture()
	iTF.frames[unitID].topFrame.glowTopLeft:SetPoint('TOPLEFT', iTF.frames[unitID].topFrame, 'TOPLEFT', 1,-1)
	iTF.frames[unitID].topFrame.glowTopLeft:SetSize(24, 24)
	iTF.frames[unitID].topFrame.glowTopLeft:SetTexture('Interface\\AddOns\\iTargetingFrames\\media\\cGlow')
	iTF.frames[unitID].topFrame.glowTopLeft:SetTexCoord(1, 0, 0, 1)
	iTF.frames[unitID].topFrame.glowTopLeft:SetVertexColor(0,1,1,1)
	--Top right
	iTF.frames[unitID].topFrame.glowTopRight = iTF.frames[unitID].topFrame:CreateTexture()
	iTF.frames[unitID].topFrame.glowTopRight:SetPoint('TOPRIGHT', iTF.frames[unitID].topFrame, 'TOPRIGHT', -1,-1)
	iTF.frames[unitID].topFrame.glowTopRight:SetSize(24, 24)
	iTF.frames[unitID].topFrame.glowTopRight:SetTexture('Interface\\AddOns\\iTargetingFrames\\media\\cGlow')
	iTF.frames[unitID].topFrame.glowTopRight:SetTexCoord(0, 1, 0, 1)
	iTF.frames[unitID].topFrame.glowTopRight:SetVertexColor(1,0,1,1)
	--Bottom left
	iTF.frames[unitID].topFrame.glowBottomLeft = iTF.frames[unitID].topFrame:CreateTexture()
	iTF.frames[unitID].topFrame.glowBottomLeft:SetPoint('BOTTOMLEFT', iTF.frames[unitID].topFrame, 'BOTTOMLEFT', 1, 1)
	iTF.frames[unitID].topFrame.glowBottomLeft:SetSize(8, 8)
	iTF.frames[unitID].topFrame.glowBottomLeft:SetTexture('Interface\\AddOns\\iTargetingFrames\\media\\cGlow')
	iTF.frames[unitID].topFrame.glowBottomLeft:SetTexCoord(1, 0, 1, 0)
	iTF.frames[unitID].topFrame.glowBottomLeft:SetVertexColor(1,0,1,1)
	--Bottom right
	iTF.frames[unitID].topFrame.glowBottomRight = iTF.frames[unitID].topFrame:CreateTexture()
	iTF.frames[unitID].topFrame.glowBottomRight:SetPoint('BOTTOMRIGHT', iTF.frames[unitID].topFrame, 'BOTTOMRIGHT', -1, 1)
	iTF.frames[unitID].topFrame.glowBottomRight:SetSize(8, 8)
	iTF.frames[unitID].topFrame.glowBottomRight:SetTexture('Interface\\AddOns\\iTargetingFrames\\media\\cGlow')
	iTF.frames[unitID].topFrame.glowBottomRight:SetTexCoord(0, 1, 1, 0)
	iTF.frames[unitID].topFrame.glowBottomRight:SetVertexColor(1,1,0,1)
	--]]
	--Raid Icon
	iTF.frames[unitID].raidIcon = iTF.frames[unitID].topFrame:CreateTexture()
	iTF.frames[unitID].raidIcon:SetSize(iTFConfig.layout.raidIcon.size, iTFConfig.layout.raidIcon.size)
	iTF.frames[unitID].raidIcon:SetPoint(iTFConfig.layout.raidIcon.pos, iTF.frames[unitID].topFrame, iTFConfig.layout.raidIcon.pos, iTFConfig.layout.raidIcon.x,iTFConfig.layout.raidIcon.y)
	iTF.frames[unitID].raidIcon:Hide()
	--Auras
	iTF.frames[unitID].auras = {}
	--Hide & Scripts
	iTF.frames[unitID]:Hide()
	iTF.frames[unitID]:HookScript('OnShow',function()
		iTF.frames[unitID].isShown = true
		if iTF.frames[unitID].added and (GetTime() - iTF.frames[unitID].added > 0.1) and not iTF.configMode then
			iTF:updateUnitID(unitID)
		end
	end)
	iTF.frames[unitID]:HookScript('OnHide', function()
		iTF.frames[unitID].isPlayer = nil
		iTF.frames[unitID].isShown = false
	end)
	--RegisterUnitWatch(iTF.frames[unitID], true)
end

local onUpdateTotal = 0
function iTF:OnUpdate(elapsed)

	if not iTF.playerSpecLoaded then
		if not nameplateAPI() then
			print('-- Error iTargetingFrames --\nRequires a patched client with the AwesomeWotlkLib.dll. If units are shown more than once, you need the modified file with fixed nameplate units.')
		end
		iTF:CheckTalents()
	end

	onUpdateTotal = onUpdateTotal + elapsed
	local cTime = GetTime()
	local icon = iTFConfig.layout.icon
	for unitID,v in pairs(aurasToUpdate) do
		local slots = iTF.frames[unitID].auras
		for id, endTime in pairs(v) do
			if endTime > 0 then
				local showTime = endTime - cTime
				--! WotLK fix: slot and the icon config are resolved once. This body runs every frame for
				-- every tracked aura, and it used to walk iTF.frames[unitID].auras[id] up to three times
				-- and iTFConfig.layout.icon twice on each pass.
				local slot = slots[id]
				if showTime <= 0 then
					-- Expired: clear the entry here too. Whatever path forgot to do it, a dead entry must not
					-- sit in aurasToUpdate printing a counter that runs through zero into negatives.
					slot.cooldownText:Hide()
					v[id] = nil
				else
					if icon.flashEnabled and showTime <= icon.flashTimer then
						if not slot.anim then
							slot.flash:Play()
						end
					end
					--! WotLK fix: the countdown was re-formatted every frame for every aura, though the visible
					-- number changes 1-10 times a second. Compare the rounded number, not the string: the
					-- previous form still called string.format 60 times a second per aura and only saved the
					-- SetText. Measured under real Lua 5.1, 10 plates x 3 auras x 600 frames: this body
					-- costs 71% less time, 14.0 ms -> 4.0 ms (no garbage either way -- Lua interns equal
					-- strings). slot.textTick is cleared wherever a slot is shown, hidden or reused
					-- (setDurationInfo).
					local tenths = showTime < icon.durationDecimals
					local tick = tenths and math.floor(showTime*10 + 0.5) or math.floor(showTime + 0.5)
					if slot.textTick ~= tick or slot.textTenths ~= tenths then
						slot.textTick, slot.textTenths = tick, tenths
						slot.cooldownText:SetText(string.format(tenths and '%.1f' or '%.0f', showTime))
					end
				end
			end
		end
	end
	if onUpdateTotal >= 0.3 then
		--! WotLK fix: tank role is a stance on 3.3.5a, so it is re-read here rather than taken from the
		-- spec. Skipped entirely while no threat conditional is on, which is the default.
		if next(conditionals.threat) then
			iTF:updateTankRole()
		end
		--! WotLK fix: resolved once per tick, not once per frame. nameplateAPI() is a call plus a rawget,
		-- and the method was a second table lookup -- both ran up to 60 times a tick and cannot change
		-- mid-loop, because only ADDON_LOADED of the shim installs C_NamePlate.
		local getPlate = nameplateAPI() and C_NamePlate.GetNamePlateForUnit
		for k,v in pairs(iTF.frames) do
			if UnitExists(k) then
				if v.isShown then
					-- OnShow's own guard (iTF.frames[...].added) can fire before C_NamePlate has a visible
					-- plate for the token, which is exactly the case with our dll: the token resolves first.
					-- Fill the frame here, but only when updateUnitID will accept it -- so it runs once per
					-- plate, never re-enters hideAll, and does not flicker on plates that stay invisible.
					-- nameplateAPI() rather than the proxy, because the proxy table is always truthy.
					--! WotLK fix: 'not v.customData' alone refilled a frame exactly once per frame object.
					-- The client can hand the same nameplateN slot to another unit without a second
					-- NAME_PLATE_UNIT_ADDED, and then the frame kept the old name, guid, npcID and class
					-- colour while health and auras stayed live (they are polled by token) -- reported
					-- 02.10 in Ruby Sanctum: Halion's plate was labelled "Chaos Invoker" until the plate
					-- refreshed by itself. So refill on an identity change too. One UnitGUID call, and
					-- only for a filled frame; defaulting to v.guid keeps a unit in transit (nil guid)
					-- from retriggering this every tick.
					if getPlate and (not v.customData or (UnitGUID(k) or v.guid) ~= v.guid) and getPlate(k) then
						iTF:updateUnitID(k)
					end
					iTF:updateHealth(k) --Health onUpdate, Since no UnitHealth events for nameplate unit
					-- Same reason as the health poll right above: the client never sends UNIT_AURA for a
					-- nameplate token, so updateAuras() ran exactly twice -- on plate creation and on the
					-- rare event for another unit. A debuff that expired afterwards kept its icon forever
					-- (measured 29.09 ~23:5x: an icon with no duration text on a training dummy -- the text
					-- was gone because the countdown hit zero, the icon was left behind by the missing poll).
					iTF:updateAuras(k)
					--! WotLK fix: каст опрашивается здесь же по той же причине, что health/auras/threat выше:
					-- для nameplateN клиент UNIT_SPELLCAST_* не рассылает. Две C-функции на показанную рамку
					-- за тик 0.3 с; перерисовка -- только при смене имени/startTime каста (iTF:refreshCast).
					iTF:refreshCast(k)
					for l,_ in pairs(conditionals.onHealth) do
						updateIndicator(k, l)
					end

					--! WotLK fix: the client sends no UNIT_THREAT_LIST_UPDATE for a nameplate token either,
					-- so the threat conditionals were evaluated once per plate -- at spawn, when threat is
					-- still 0. aggro / losingAggro / gainingAggro never lit up at all.
					for cond,_ in pairs(conditionals.threat) do
						updateIndicator(k, cond)
					end

					for cond,_ in pairs(conditionals.onUpdate) do
						updateIndicator(k, cond)
					end
				end
			end
		end
		onUpdateTotal = 0
	end
end--! WotLK fix: какой слот сетки занят этим фреймом ПРЯМО СЕЙЧАС. Ведёт его безопасный драйвер в
-- iTFCurrentlyAlive ('itfN' -> слот, 0 -- свободен); после стягивания при смерти юнита это уже не индекс
-- создания из nameplateID. Якорить по индексу создания -- значит разбросать фреймы по сетке заново, то
-- есть вернуть ровно те дырки, из-за которых стягивание и делалось (обе ветки, 'size' и 'pos', раньше
-- брали position именно по nameplateID). Хозяин таблицы -- secure-среда iTF.mainFrame, и наружу таблицу
-- она не отдаёт (RestrictedExecution.lua:583-593: читает base[k] or working[k], пишет только в working),
-- поэтому слот зеркалируется атрибутом 'itfslot<токен>' внутри '_itfupdate' -- см. там же, число через
-- границу ходит. Прогон, который это решает, -- п. 13 д листа TEST-NAMEPLATE.
local function frameSlot(frame)
	-- имя целиком: писатель клеит 'itfslot'..токен, а токен -- это 'itf3', не '3' (тот же порядок, что у
	-- 'itfdenyitfN' в цепочке запрета)
	local mf = iTF.mainFrame
	local slot = mf and mf:GetAttribute('itfslotitf' .. frame.nameplateID)
	if type(slot) == 'number' and slot > 0 then return slot end
	return frame.nameplateID
end
function iTF:updateFrames(toUpdate)
	if not toUpdate or toUpdate == 'size' then
		--Update background size
		local width = (iTFConfig.layout.frame.width+iTFConfig.layout.frame.hspacing)*(iTFConfig.layout.invertGrow and iTFConfig.layout.colS or math.ceil(iTFConfig.layout.maxUnits/iTFConfig.layout.colS)) --! WotLK fix: оси фона берутся из той же раскладки, что и позиции: getUFPos при invertGrow кладёт colS клеток по горизонтали, а прежняя формула всегда рисовала ceil(maxUnits/colS) колонок, то есть при invertGrow серый прямоугольник был транспонирован относительно сетки и не покрывал часть рамок. Ловит run_itf_layout_check.js, п. 7.25.
		local height = (iTFConfig.layout.frame.height+iTFConfig.layout.frame.vspacing)*(iTFConfig.layout.invertGrow and math.ceil(iTFConfig.layout.maxUnits/iTFConfig.layout.colS) or iTFConfig.layout.colS)
		iTF.mainFrame:SetSize(width, height)
		local i = 1
		for k,v in pairs(iTF.frames) do
			local posX, posY = iTF:getUFPos(frameSlot(v))
			if UnitExists(k) then
				iTF:setName(k)
			end
			--iTF:trimText(k)
			iTF.frames[k]:SetSize(iTFConfig.layout.frame.width+2,iTFConfig.layout.frame.height+2)
			iTF.frames[k]:ClearAllPoints()
			iTF.frames[k]:SetPoint(iTFConfig.layout.grow, iTF.mainFrame, iTFConfig.layout.grow, posX, posY)
			iTF.frames[k].healthBar:SetWidth(iTFConfig.layout.frame.width)
			iTF.frames[k].healthBar:SetHeight(iTFConfig.layout.frame.height)
			if not iTFConfig.layout.castBar.detached then
				iTF.frames[k].castBar:SetWidth(iTFConfig.layout.frame.width)
				iTF.frames[k].castBar:SetHeight(iTFConfig.layout.frame.castBarHeight)
			end
			iTF.frames[k].topFrame.glowTop:SetWidth(iTFConfig.layout.frame.width)
			iTF.frames[k].topFrame.glowBottom:SetWidth(iTFConfig.layout.frame.width)
			iTF.frames[k].topFrame.glowLeft:SetHeight(iTFConfig.layout.frame.height)
			iTF.frames[k].topFrame.glowRight:SetHeight(iTFConfig.layout.frame.height)
			i = i + 1
		end
		iTF:updateMainFrameAttributes(true)
	end
	if not toUpdate or toUpdate == 'castbar' then
		for k,v in pairs(iTF.frames) do
			if not iTFConfig.layout.castBar.detached then
				iTF.frames[k].castBar:ClearAllPoints()
				iTF.frames[k].castBar:SetWidth(iTFConfig.layout.frame.width)
				iTF.frames[k].castBar:SetHeight(iTFConfig.layout.frame.castBarHeight)
				iTF.frames[k].castBar:SetPoint('TOPLEFT', iTF.frames[k], 'TOPLEFT', 1,-1)
				if iTF.frames[k].castBarText then
					iTF.frames[k].castBarText:SetText('')
					iTF.frames[k].castBarText:Hide()
				end
			else
				if not iTF.frames[k].castBarText then
					-- Create fontstring for detached cast bar
					iTF.frames[k].castBarText = iTF.frames[k].castBar:CreateFontString()
				end
				iTF.frames[k].castBarText:ClearAllPoints()
				iTF.frames[k].castBarText:SetFont(iTFConfig.layout.castBar.detached_text_font, iTFConfig.layout.castBar.detached_text_size, iTFConfig.layout.castBar.detached_text_flags)
				iTF.frames[k].castBarText:SetPoint(iTFConfig.layout.castBar.detached_text_pos, iTF.frames[k].castBar, iTFConfig.layout.castBar.detached_text_pos, iTFConfig.layout.castBar.detached_text_x,iTFConfig.layout.castBar.detached_text_y)
				iTF.frames[k].castBarText:SetText('')
				if not v.isShown then
					iTF.frames[k].castBarText:Hide()
				else
					iTF.frames[k].castBarText:Show()
				end
				iTF.frames[k].castBar:ClearAllPoints()
				iTF.frames[k].castBar:SetWidth(iTFConfig.layout.castBar.detached_width)
				iTF.frames[k].castBar:SetHeight(iTFConfig.layout.castBar.detached_height)
				iTF.frames[k].castBar:SetPoint(iTFConfig.layout.castBar.detached_from, iTF.frames[k], iTFConfig.layout.castBar.detached_to, iTFConfig.layout.castBar.detached_x,iTFConfig.layout.castBar.detached_y)
			end
		end
	end
	if not toUpdate or toUpdate == 'border' then
		--iTF.UFbd.edgeSize = iTFConfig.layout.frame.borderSize
		--for k in pairs(iTF.frames) do
		--	iTF.frames[k]:SetBackdrop(iTF.UFbd)
		--	iTF.frames[k]:SetBackdropColor(unpack(iTFConfig.layout.colors.statusbar.backdrop))
		--	iTF.frames[k]:SetBackdropBorderColor(unpack(iTFConfig.layout.colors.statusbar.border))
		--end
	end
	if not toUpdate or toUpdate == 'pos' then
		iTF.mainFrame:ClearAllPoints()
		iTF.mainFrame:SetPoint(iTFConfig.layout.grow, UIParent, 'BOTTOMLEFT', iTFConfig.layout.anchor.x, iTFConfig.layout.anchor.y)
		local width = (iTFConfig.layout.frame.width+iTFConfig.layout.frame.hspacing)*(iTFConfig.layout.invertGrow and iTFConfig.layout.colS or math.ceil(iTFConfig.layout.maxUnits/iTFConfig.layout.colS)) --! WotLK fix: оси фона берутся из той же раскладки, что и позиции: getUFPos при invertGrow кладёт colS клеток по горизонтали, а прежняя формула всегда рисовала ceil(maxUnits/colS) колонок, то есть при invertGrow серый прямоугольник был транспонирован относительно сетки и не покрывал часть рамок. Ловит run_itf_layout_check.js, п. 7.25.
		local height = (iTFConfig.layout.frame.height+iTFConfig.layout.frame.vspacing)*(iTFConfig.layout.invertGrow and math.ceil(iTFConfig.layout.maxUnits/iTFConfig.layout.colS) or iTFConfig.layout.colS)
		iTF.mainFrame:SetSize(width, height)
		for k,v in pairs(iTF.frames) do
			local posX, posY = iTF:getUFPos(frameSlot(v))
			iTF.frames[k]:ClearAllPoints()
			iTF.frames[k]:SetPoint(iTFConfig.layout.grow, iTF.mainFrame, iTFConfig.layout.grow, posX, posY)
		end
		iTF:updateMainFrameAttributes(true)
	end
	if not toUpdate or toUpdate == 'glow' then
		for k in pairs(iTF.frames) do
			iTF.frames[k].topFrame.glowTop:Hide()
			iTF.frames[k].topFrame.glowBottom:Hide()
			iTF.frames[k].topFrame.glowLeft:Hide()
			iTF.frames[k].topFrame.glowRight:Hide()
		end
	end
	if not toUpdate or toUpdate == 'text' then
		for k,v in pairs(iTF.frames) do
			iTF.frames[k].text:SetFont(iTFConfig.layout.text.font, iTFConfig.layout.text.size, iTFConfig.layout.text.flags)
			if UnitExists(k) then
				iTF:setName(k)
			end
			iTF.frames[k].text:ClearAllPoints()
			iTF.frames[k].text:SetPoint(iTFConfig.layout.text.pos, iTF.frames[k], iTFConfig.layout.text.pos, iTFConfig.layout.text.x, iTFConfig.layout.text.y)
			iTF:updateCast(k)
		end
	end
	if not toUpdate or toUpdate == 'healthText' then
		iTF.healthTextString = '%.0f'
		if iTFConfig.layout.healthText.decimal then
			iTF.healthTextString = '%.1f'
		end
		if iTFConfig.layout.healthText.percentage then
			iTF.healthTextString = iTF.healthTextString .. '%%'
		end
		for k,v in pairs(iTF.frames) do
			iTF.frames[k].healthText:SetFont(iTFConfig.layout.healthText.font, iTFConfig.layout.healthText.size, iTFConfig.layout.healthText.flags)
			iTF.frames[k].healthText:ClearAllPoints()
			iTF.frames[k].healthText:SetPoint(iTFConfig.layout.healthText.pos, iTF.frames[k], iTFConfig.layout.healthText.pos, iTFConfig.layout.healthText.x, iTFConfig.layout.healthText.y)
			iTF.frames[k].healthText:SetTextColor(unpack(iTFConfig.layout.colors.text.healthText))
			if v.isShown and iTFConfig.layout.healthText.enabled then
				iTF:updateHealth(k)
			else
				iTF.frames[k].healthText:SetText('')
			end
		end
	end
	if not toUpdate or toUpdate == 'statusBarColor' then
		for k in pairs(iTF.frames) do
			if iTFConfig.layout.colors.classColor and UnitExists(k) and UnitIsPlayer(k) then
				local _, class = UnitClass(k)
				local color = RAID_CLASS_COLORS[class]
				iTF.frames[k].healthBar:SetStatusBarColor(color.r, color.g, color.b, iTFConfig.layout.colors.statusbar.main.a)
			else
				iTF.frames[k].healthBar:SetStatusBarColor(unpack(iTFConfig.layout.colors.statusbar.main))
			end
		end
	end
	if not toUpdate or toUpdate == 'statusbar' then
		for k in pairs(iTF.frames) do
			iTF.frames[k].healthBar:SetStatusBarTexture(iTFConfig.layout.statusbar.texture)
			iTF.frames[k].castBar:SetStatusBarTexture(iTFConfig.layout.castBar.texture)
		end
	end
	if not toUpdate or toUpdate == 'frameColor' then
		for k in pairs(iTF.frames) do
			iTF.frames[k]:SetBackdropColor(unpack(iTFConfig.layout.colors.statusbar.backdrop))
			iTF.frames[k]:SetBackdropBorderColor(unpack(iTFConfig.layout.colors.statusbar.border))
			iTF.frames[k].castBar:SetBackdropColor(unpack(iTFConfig.layout.colors.statusbar.backdrop))
			iTF.frames[k].castBar:SetBackdropBorderColor(unpack(iTFConfig.layout.colors.statusbar.border))
		end
	end
	if not toUpdate or toUpdate == 'castBarColor' then
		for k in pairs(iTF.frames) do
			iTF.frames[k].castBar:SetStatusBarColor(unpack(iTFConfig.layout.colors.statusbar.cast))
		end
	end
	if not toUpdate or toUpdate == 'target' then
		--! WotLK fix: updateIndicator takes (unitID, cond) -- the condition name was passed as the unitID,
		-- so this refresh did nothing and the target indicator only caught up on the next target change.
		updateIndicator(nil, 'currentTarget')
	end
	if not toUpdate or toUpdate == 'raidIcon' then
		for k in pairs(iTF.frames) do
			iTF.frames[k].raidIcon:SetSize(iTFConfig.layout.raidIcon.size,iTFConfig.layout.raidIcon.size)
			iTF.frames[k].raidIcon:ClearAllPoints()
			iTF.frames[k].raidIcon:SetPoint(iTFConfig.layout.raidIcon.pos, iTF.frames[k].topFrame, iTFConfig.layout.raidIcon.pos, iTFConfig.layout.raidIcon.x, iTFConfig.layout.raidIcon.y)
		end
	end
	if not toUpdate or toUpdate == 'auraIcon' then
		local to = {['LEFT'] = 'Right', ['RIGHT'] = 'Left', ['TOP'] = 'Down', ['BOTTOM'] = 'Up'}
		local x,y = 0,0
		local grow = iTFConfig.layout.icon.grow
		if grow == 'LEFT' then
			x,y = iTFConfig.layout.icon.spacing,0
		elseif grow == 'RIGHT' then
			x,y = -iTFConfig.layout.icon.spacing,0
		elseif grow == 'TOP' then
			x,y = 0,-iTFConfig.layout.icon.spacing
		else
			x,y = 0,iTFConfig.layout.icon.spacing
		end
		
		for k in pairs(iTF.frames) do
			for id = 1, #iTF.frames[k].auras do
				iTF.frames[k].auras[id]:SetSize(iTFConfig.layout.icon.width, iTFConfig.layout.icon.height)
				iTF.frames[k].auras[id]:ClearAllPoints()
				if id == 1 then
					iTF.frames[k].auras[id]:SetPoint(iTFConfig.layout.icon.pos, iTF.frames[k], iTFConfig.layout.icon.pos, iTFConfig.layout.icon.x, iTFConfig.layout.icon.y)
				else
					iTF.frames[k].auras[id]:SetPoint(grow, iTF.frames[k].auras[id-1], to[grow], x, y)
				end
			end
		end
	end
	if not toUpdate or toUpdate == 'flash' then
		local flashSpeed = iTFConfig.layout.icon.flashSpeed/2
		for k in pairs(iTF.frames) do
			for id = 1, #iTF.frames[k].auras do
				iTF.frames[k].auras[id].fadeOut:SetDuration(flashSpeed)
				iTF.frames[k].auras[id].fadeIn:SetDuration(flashSpeed)
			end
		end
	end
	if not toUpdate or toUpdate == 'auraText' then
		for unitID,v in pairs(iTF.frames) do
			for id in pairs(v.auras) do
				iTF.frames[unitID].auras[id].cooldownText:SetFont(iTFConfig.layout.icon.durationFont, iTFConfig.layout.icon.durationSize, iTFConfig.layout.icon.durationFlags)
				iTF.frames[unitID].auras[id].cooldownText:ClearAllPoints()
				iTF.frames[unitID].auras[id].cooldownText:SetPoint(iTFConfig.layout.icon.durationPos, iTF.frames[unitID].auras[id], iTFConfig.layout.icon.durationPos, iTFConfig.layout.icon.durationX, iTFConfig.layout.icon.durationY)
				iTF.frames[unitID].auras[id].cooldownText:SetTextColor(unpack(iTFConfig.layout.colors.text.duration))
				iTF.frames[unitID].auras[id].stackText:SetFont(iTFConfig.layout.icon.stackFont, iTFConfig.layout.icon.stackSize, iTFConfig.layout.icon.stackFlags)
				iTF.frames[unitID].auras[id].stackText:ClearAllPoints()
				iTF.frames[unitID].auras[id].stackText:SetPoint(iTFConfig.layout.icon.stackPos, iTF.frames[unitID].auras[id], iTFConfig.layout.icon.stackPos, iTFConfig.layout.icon.stackX, iTFConfig.layout.icon.stackY)
				iTF.frames[unitID].auras[id].stackText:SetTextColor(unpack(iTFConfig.layout.colors.text.stack))
			end
		end
	end
	if not toUpdate or toUpdate == 'conditionals' then
		conditionals = nil
		conditionals = {
			['onUpdate'] = {},
			['onAura'] = {},
			['onCast'] = {},
			['onHealth'] = {},
			['targetChanged'] = {},
			['threat'] = {},
			['focusUpdate'] = {},
			['onShow'] = {},
		}
		--! WotLK fix: was customCondtionals -- a typo, i.e. a separate global nobody reads. The real table
		-- was never cleared, so a custom conditional kept firing after being switched off, until /reload.
		customConditionals = {}
		iTF:hideAll(nil,true)
		for k,v in pairs(iTFConfig.layout.conditionals) do
			if v.enable then
				indicatorPrios[k] = v.weight
				if v.update then --nil check for earlier versions TO DO: remove on v0.5 or something
					conditionals[v.update][k] = v
				else
					iTF:print('Update function not found for ',k,', adding ',iTF.indicatorUpdateFuncs[k],'.')
					iTFConfig.layout.conditionals[k].update = iTF.indicatorUpdateFuncs[k]
					conditionals[iTF.indicatorUpdateFuncs[k]][k] = v
				end
			end
		end
		for k,v in pairs(iTFConfig.custom) do
			if v.enable then
				local ignore = false
				if v.loadFor then
					if count(v.loadFor) > 0 and not v.loadFor[iTF.specID] then
						ignore = true
					end
				end
				if not ignore then
					indicatorPrios[k] = v.weight
					if v.update then --nil check for earlier versions TO DO: remove on v0.5 or something
						--! WotLK fix (06.10): второе значение getFunction -- это текст ошибки loadstring
						-- (`iTargetingFrames.lua:91`). Раньше он попадал в локал с именем `error` -- заодно
						-- затеняя стандартную функцию в этой области -- и никуда не шёл. Игрок получал
						-- «something is wrong with Custom conditional: X» без причины, хотя причина уже была
						-- на руках. Теперь она в самом сообщении; при пустой причине хвост не рисуем -- чанк
						-- может скомпилироваться и вернуть nil, тогда err тоже nil.
						local func, err = getFunction(v.func)
						if func then
							conditionals[v.update][k] = v
							customConditionals[k] = v
							customConditionals[k].funct = func
						else
							iTF:print('Error, something is wrong with Custom conditional: ' .. k
								.. (err and (' -- ' .. tostring(err)) or ''))
						end
					else
						iTF:print('Update function not found for ',k,', adding ',iTF.indicatorUpdateFuncs[k],'.')
						v.update = iTF.indicatorUpdateFuncs[k]
					end
				end
			end
		end
		for unitID in pairs(iTF.frames) do
			if UnitExists(unitID) then
				iTF:updateUnitID(unitID)
			end
		end
	end
	if not toUpdate or toUpdate == 'bindings' then
		if InCombatLockdown() then
			AceTimer:ScheduleTimer(function()
				iTF:updateFrames('bindings')
			end, 2)
		else
			for k in pairs(iTF.frames) do
				local keys = {}
				local mouseKeys = {'LeftButtonDown'}
				local mousewheel = false
				local function applyBindings(t)
					if t then
						local function isMouse(button)
							if button == 'LeftButton' then
								return 1
							elseif button == 'RightButton' then
								return 2
							elseif button == 'MiddleButton' then
								return 3
							elseif button == 'Button4' then
								return 4
							elseif button == 'Button5' then
								return 5
							else
								return false
							end
						end
						for key,v in pairs(t) do
							local unModifiedKey = key
							local modifier = ''
							local mouseKey = isMouse(unModifiedKey)
							if mouseKey then
								--alt-ctrl-shift-type
								if key:find('ALT') then
									modifier = modifier .. 'alt-'
									unModifiedKey = unModifiedKey:gsub('ALT%-', '')
								end
								if key:find('CTRL') then
									modifier = modifier .. 'ctrl-'
									unModifiedKey = unModifiedKey:gsub('CTRL%-', '')
								end
								if key:find('SHIFT') then
									modifier = modifier .. 'shift-'
									unModifiedKey = unModifiedKey:gsub('SHIFT%-', '')
								end
								table.insert(mouseKeys, unModifiedKey .. 'Down')
							end
							if not mousewheel then
								if key:find('MouseWheel') then
									mousewheel = true
								end
							end
							if not v.text then --Target, Focus
								if mouseKey then
									iTF.frames[k]:SetAttribute(modifier..'type'..mouseKey,v.type)
								else
									iTF.frames[k]:SetAttribute(string.format([[type-itf%s]],key),v.type)
								end
							else
								if mouseKey then
									iTF.frames[k]:SetAttribute(modifier..'type'..mouseKey,v.type)
								else
									iTF.frames[k]:SetAttribute(string.format([[type-itf%s]],key),v.type)
								end
								if v.type == 'macro' then
									if mouseKey then
										iTF.frames[k]:SetAttribute(modifier..'macrotext'..mouseKey,v.text)
									else
										iTF.frames[k]:SetAttribute(string.format([[macrotext-itf%s]],key),v.text)
									end
								else
									if mouseKey then
										iTF.frames[k]:SetAttribute(string.format([[%s%s%s]],modifier,v.type,mouseKey),v.text)
									else
										iTF.frames[k]:SetAttribute(string.format([[%s-itf%s]],v.type,key),v.text)
									end
								end							
							end
							if not mouseKey then
								keys[key] = true
							end
						end
					end
				end
				--prio: general < class < spec
				if not iTFConfig.bindings[iTF.class] then iTFConfig.bindings[iTF.class] = {['b'] = {}} end
				applyBindings(iTFConfig.bindings.general)
				applyBindings(iTFConfig.bindings[iTF.class].b)
				applyBindings(iTFConfig.bindings[iTF.class][specID.specID])
				local bind = ''
				for key in pairs(keys) do
					bind = bind .. string.format([[self:SetBindingClick(true, '%s', self, 'itf%s');]], key,key)
				end
				iTF.frames[k]:RegisterForClicks(unpack(mouseKeys))
				if mousewheel then
					iTF.frames[k]:EnableMouseWheel(true)
				else
					iTF.frames[k]:EnableMouseWheel(false)
				end
				iTF.frames[k]:SetAttribute('itf_onenter', bind)
			end
		end
	end
end
function iTF:updateMainFrameAttributes(newMax)
	iTF.mainFrame:SetAttribute('_itfupdate', string.format([[
		-- Показ юнита занимает первый свободный слот, а при его смерти слот просто пустеет: до конца сетки
		-- оставалась дырка, пока в этот же индекс не попадал новый плейт. Сначала стягиваем показанные в
		-- начало (1..n без пропусков), потом уже раздаём свободные. Идея -- из вилки
		-- vanvonlj/iTargetingFrames-wotlk, коммит "Compact frames on death to remove gaps" (#2).
		local writeSlot = 1
		for i = 1, %d do
			local tok = iTFCurrentlyShowing[i]
			if tok then
				--! WotLK fix: 'itfdenyitfN' is set by the addon when the NPC is blacklisted. Such a token
				-- must not hold a cell: the slot is freed, the frame hidden, and the token stays queued
				-- (alive = 0) so it returns when the entry is removed.
				if self:GetAttribute('itfdeny'..tok) then
					iTFCurrentlyShowing[i] = nil
					iTFCurrentlyAlive[tok] = 0
					local hf = self:GetFrameRef(tok)
					if hf then
						hf:Hide()
					end
				elseif i ~= writeSlot then
					iTFCurrentlyShowing[writeSlot] = tok
					iTFCurrentlyShowing[i] = nil
					iTFCurrentlyAlive[tok] = writeSlot
					local mf = self:GetFrameRef(tok)
					if mf then
						mf:ClearAllPoints()
						mf:SetPoint('%s', self, '%s', iTFUnitPositions[writeSlot][1], iTFUnitPositions[writeSlot][2])
					end
					writeSlot = writeSlot + 1
				else
					writeSlot = writeSlot + 1
				end
			end
		end
		for i = 1, %d do
			if not iTFCurrentlyShowing[i] then
				local f
				for k,v in pairs(iTFCurrentlyAlive) do
					-- same ban here: the queue must not push a blacklisted token into a free cell
					if v == 0 and not self:GetAttribute('itfdeny'..k) then
						f = k
						iTFCurrentlyAlive[k] = i
						iTFCurrentlyShowing[i] = k
						break
					end
				end
				if f then
					f = self:GetFrameRef(f)
					f:ClearAllPoints()
					f:SetPoint('%s',self,'%s',iTFUnitPositions[i][1], iTFUnitPositions[i][2])
					f:Show()
				end
			end
		end

		--! WotLK fix: зеркало карты слотов наружу. Таблицы через границу secure/insecure не едут
		-- (RestrictedExecution.lua:583-593: среда сниппета читает base[k] or working[k], пишет только в
		-- working), то есть iTFCurrentlyAlive для аддона навсегда nil -- и frameSlot якорил по индексу
		-- создания, ровно по той причине, из-за которой в сетке и оставались дырки. ЧИСЛА через границу
		-- ходят: атрибут ставит сам сниппет и читает его же insecure-код (что чтение работает, показывает
		-- дамп /itf deny -- он именно так видит 'itfdenyitfN'). Пишется только изменившийся слот.
		for k,v in pairs(iTFCurrentlyAlive) do
			if self:GetAttribute('itfslot'..k) ~= v then
				self:SetAttribute('itfslot'..k, v)
			end
		end
	]], iTFConfig.layout.maxUnits,iTFConfig.layout.grow,iTFConfig.layout.grow,iTFConfig.layout.maxUnits,iTFConfig.layout.grow,iTFConfig.layout.grow))
	local tempTable = [[iTFUnitPositions = table.new();]]
	for i = 1, 60 do
		local x,y = iTF:getUFPos(i)
		tempTable = tempTable .. string.format([[iTFUnitPositions[%d] = table.new(%d,%d);]],i,x,y)
	end
	iTF.mainFrame:Execute(tempTable) -- Unitframe positions
	if newMax then
		iTF.mainFrame:Execute([[
		local f
		iTFCurrentlyShowing = table.new()
		for i = 1, 60 do
			f = self:GetFrameRef('itf'..i)
			f:Hide()
			if iTFCurrentlyAlive['itf'..i] then
				iTFCurrentlyAlive['itf'..i] = 0
			end
		end
		control:RunAttribute('_itfupdate')
		]])
	end			
end
function iTF:updateNameplateStateDrivers(update, configMode)
	if configMode then
		for i = 1, 60 do
			--! WotLK fix: same order as the live branch below -- handler first, driver second. Here the
			-- condition is constant, so the only transition it ever makes is the one at registration:
			-- with the handler second it was lost and config mode showed nothing. docs/TECHNICAL.md item 23.
			iTF.mainFrame:SetAttribute('_onstate-itf'..i,[=[
			local f = self:GetFrameRef(stateid)
			if newstate == 'true' then
				iTFCurrentlyAlive[stateid] = 0
			else
				if iTFCurrentlyAlive[stateid] and iTFCurrentlyAlive[stateid] > 0 then
					iTFCurrentlyShowing[iTFCurrentlyAlive[stateid]] = nil
					f:Hide()
				end
				iTFCurrentlyAlive[stateid] = nil
			end
			control:RunAttribute('_itfupdate')
			]=])
			RegisterStateDriver(iTF.mainFrame, 'itf'..i, '[@nameplate'..i..', exists] true;true')
		end
	else
		local conds = ''
		if iTFConfig.layout.onlyShowInCombat then
			conds = ',combat'
		end
		if iTFConfig.layout.onlyEnemies then
			conds = conds .. ',harm'
		end
		for i = 1, 60 do
			if not update then
			iTF:CreateNew('nameplate' .. i,i)
			iTF.mainFrame:SetFrameRef('itf' .. i, iTF.frames['nameplate' .. i])
			end
			--! WotLK fix: order must be SetFrameRef -> SetAttribute('_onstate-…') -> RegisterStateDriver.
			-- Registration evaluates the condition synchronously, and the handler only runs if its
			-- attribute already exists, so a handler installed second lost the first transition of all
			-- 60 drivers. Why that matters, with the FrameXML lines, is docs/TECHNICAL.md item 23.
			iTF.mainFrame:SetAttribute('_onstate-itf'..i,[=[
			local f = self:GetFrameRef(stateid)

			if newstate == 'true' then
				iTFCurrentlyAlive[stateid] = 0
			else
				if iTFCurrentlyAlive[stateid] and iTFCurrentlyAlive[stateid] > 0 then
					iTFCurrentlyShowing[iTFCurrentlyAlive[stateid]] = nil
					f:Hide()
				end
				iTFCurrentlyAlive[stateid] = nil
			end
			control:RunAttribute('_itfupdate')
			]=])
			--! WotLK fix: the branch after ';' is mandatory. The state manager assigns the attribute only
			-- for a truthy new value, so '] true;' never delivered "plate gone" and the slot stayed
			-- occupied forever -- that was the hole in the grid. See docs/TECHNICAL.md item 23.
			RegisterStateDriver(iTF.mainFrame, 'itf'..i, '[@nameplate'..i..', exists, nodead'..conds..'] true;false')
		end
	end
end
function iTF:CreateMainFrame()
	iTF.mainFrame = CreateFrame('frame', 'iTFMainFrame', UIParent, 'SecureHandlerStateTemplate')
	local width = (iTFConfig.layout.frame.width+iTFConfig.layout.frame.hspacing)*(iTFConfig.layout.invertGrow and iTFConfig.layout.colS or math.ceil(iTFConfig.layout.maxUnits/iTFConfig.layout.colS)) --! WotLK fix: background axes follow the same scheme as getUFPos under invertGrow (detail in the 'size' branch below)
	local height = (iTFConfig.layout.frame.height+iTFConfig.layout.frame.vspacing)*(iTFConfig.layout.invertGrow and math.ceil(iTFConfig.layout.maxUnits/iTFConfig.layout.colS) or iTFConfig.layout.colS)
	iTF.mainFrame:SetSize(width, height)
	iTF.mainFrame:SetPoint(iTFConfig.layout.grow, UIParent, 'BOTTOMLEFT', iTFConfig.layout.anchor.x, iTFConfig.layout.anchor.y)
	iTF.mainFrame.tex = iTF.mainFrame:CreateTexture()
	iTF.mainFrame.tex:SetAllPoints(iTF.mainFrame)
	iTF.mainFrame.tex:SetTexture('Interface\\Buttons\\WHITE8x8')
	iTF.mainFrame.tex:SetVertexColor(0.5,0.5,0.5,0.5)	
	iTF.mainFrame.tex:Hide()
	iTF.mainFrame:Execute([[iTFCurrentlyAlive = table.new()]])
	iTF.mainFrame:Execute([[iTFCurrentlyShowing = table.new()]])
	iTF:updateMainFrameAttributes()
	iTF:updateNameplateStateDrivers()
	iTF.mainFrame:SetScript('OnUpdate', iTF.OnUpdate)
end
function iTF:registerEvents(unregister)
	--! WotLK fix: six names dropped. UNIT_HEALTH_FREQUENT, ENCOUNTER_START and ENCOUNTER_STOP do not exist
	-- on 3.3.5a at all; UNIT_HEALTH, UNIT_AURA and UNIT_THREAT_LIST_UPDATE never carry a nameplate token, so
	-- their handlers could never match -- that work is done by the 0.3s poll in OnUpdate instead.
	local events = {'UNIT_SPELLCAST_START','UNIT_SPELLCAST_STOP','UNIT_SPELLCAST_INTERRUPTED','UNIT_SPELLCAST_CHANNEL_START','UNIT_SPELLCAST_CHANNEL_STOP','RAID_TARGET_UPDATE','PLAYER_LOGIN','PLAYER_TARGET_CHANGED','PLAYER_FOCUS_CHANGED','PLAYER_REGEN_DISABLED', 'NAME_PLATE_UNIT_ADDED', 'NAME_PLATE_UNIT_REMOVED', 'CHAT_MSG_ADDON'}
	if unregister then
		for i = 1, #events do
			addon:UnregisterEvent(events[i])
		end
	else
		for i = 1, #events do
			addon:RegisterEvent(events[i])
		end
	end
end
function addon:ADDON_LOADED(addonName)
	if addonName == 'iTargetingFrames' then
		iTFConfig = iTFConfig or {}
		iTF.class = select(2,UnitClass('player')) --number
		conditionals = nil
		conditionals = {
			['onUpdate'] = {},
			['onAura'] = {},
			['onCast'] = {},
			['onHealth'] = {},
			['targetChanged'] = {},
		}
		iTF:LoadDefaults()
		--! WotLK fix: карта имён чёрного списка строится по iTFConfig.blacklist, а вызывается только из
		-- интерфейса чёрного списка (options.lua). Без этого вызова на старте запись, добавленную в прошлой
		-- сессии, весь следующий коннект не фильтровала ничего: iTF.blacklistNames оставался пустым.
		iTF:refreshBlacklist()
		addon:UnregisterEvent('ADDON_LOADED')
		durationShowDecimals = iTFConfig.layout.icon.durationDecimals
		iTF.UFbd = {
			bgFile = 'Interface\\Buttons\\WHITE8x8',
			edgeFile = 'Interface\\Buttons\\WHITE8x8',
			edgeSize = 2,
			insets = {
				left = 0,
				right = 0,
				top = 0,
				bottom = 0,
			}
		}
		iTF:CreateMainFrame()
		iTF:updateFrames('conditionals')
		-- update health string
		iTF.healthTextString = '%.0f'
		if iTFConfig.layout.healthText.decimal then
			iTF.healthTextString = '%.1f'
		end
		if iTFConfig.layout.healthText.percentage then
			iTF.healthTextString = iTF.healthTextString .. '%%'
		end
		iTF:registerEvents()
		addon:RegisterEvent('ACTIVE_TALENT_GROUP_CHANGED')
		--RegisterAddonMessagePrefix('iTargetingFrames')
	end
end
function addon:UNIT_HEALTH(unitID)
	if iTF.frames[unitID] and iTF.frames[unitID].isShown then
		iTF:updateHealth(unitID)
		for k,_ in pairs(conditionals.onHealth) do
			updateIndicator(unitID, k)
		end
	end
end
function addon:UNIT_AURA(unitID)
	if iTF.frames[unitID] and iTF.frames[unitID].isShown then
		for k,_ in pairs(conditionals.onAura) do
			updateIndicator(unitID, k)
		end
		iTF:updateAuras(unitID)
	end
end
function addon:UNIT_SPELLCAST_START(unitID)
	if iTF.frames[unitID] and iTF.frames[unitID].isShown then
		for k,_ in pairs(conditionals.onCast) do
			updateIndicator(unitID, k)
		end
		iTF:updateCast(unitID)
	end
end
function addon:UNIT_SPELLCAST_STOP(unitID)
	if iTF.frames[unitID] and iTF.frames[unitID].isShown then
		for k,_ in pairs(conditionals.onCast) do
			updateIndicator(unitID, k)
		end
		iTF:updateCast(unitID)
	end
end
function addon:UNIT_SPELLCAST_INTERRUPTED(unitID)
	if iTF.frames[unitID] and iTF.frames[unitID].isShown then
		for k,_ in pairs(conditionals.onCast) do
			updateIndicator(unitID, k)
		end
		iTF:updateCast(unitID)
	end
end
function addon:UNIT_SPELLCAST_CHANNEL_START(unitID)
	if iTF.frames[unitID] and iTF.frames[unitID].isShown then
		for k,_ in pairs(conditionals.onCast) do
			updateIndicator(unitID, k)
		end
		iTF:updateCast(unitID, true)
	end
end
function addon:UNIT_SPELLCAST_CHANNEL_STOP(unitID)
	if iTF.frames[unitID] and iTF.frames[unitID].isShown then
		for k,_ in pairs(conditionals.onCast) do
			updateIndicator(unitID, k)
		end
		iTF:updateCast(unitID, true)
	end
end
function addon:RAID_TARGET_UPDATE()
	iTF:updateRaidIcon()
end

-- list of class to specs
local specsTable = {
	MAGE = {62, 63, 64},
	PRIEST = {256, 257, 258},
	ROGUE = {259, 260, 261},
	WARLOCK = {265, 266, 267},
	WARRIOR = {71, 72, 73},
	PALADIN = {65, 66, 70},
	DEATHKNIGHT = {250, 251, 252},
	DRUID = {102, 103, 105},
	HUNTER = {253, 254, 255},
	SHAMAN = {262, 263, 264}
}

local MAX_TALENT_TABS = _G.MAX_TALENT_TABS or 3

function iTF:PlayerSpec()
	local _, class = UnitClass("player")
	if not class or not specsTable[class] then return end

	local talentGroup = GetActiveTalentGroup()
	local maxPoints, index = 0, 0

	for i = 1, MAX_TALENT_TABS do
		local _, _, pointsSpent = GetTalentTabInfo(i, nil, nil, talentGroup)
		if pointsSpent ~= nil then
			if maxPoints < pointsSpent then
				maxPoints = pointsSpent
				index = i
			end
		end
	end

	local spec = specsTable[class][index]
	return spec
end

--! WotLK fix: tanking on 3.3.5a is a stance, not a spec -- bear and cat are the same talent tab, and all
-- three DK specs tanked -- so the retail spec id cannot express the role. Read from the active
-- form/stance/presence aura instead; names come from ids so it works on any client locale.
local tankAuraIds = {
	DRUID = {5487, 9634},  --Bear Form, Dire Bear Form
	WARRIOR = {71},        --Defensive Stance
	PALADIN = {25780},     --Righteous Fury
	DEATHKNIGHT = {48263}, --Frost Presence
}
local tankAuraNames
function iTF:updateTankRole()
	if not iTF.class then return end
	if not tankAuraNames then
		tankAuraNames = {}
		if tankAuraIds[iTF.class] then
			for _,id in ipairs(tankAuraIds[iTF.class]) do
				local name = GetSpellInfo(id)
				if name then
					table.insert(tankAuraNames, name)
				end
			end
		end
	end
	local tank = false
	for i = 1, #tankAuraNames do
		if UnitBuff('player', tankAuraNames[i]) then
			tank = true
			break
		end
	end
	specID.tank = tank
end

function iTF:CheckTalents()
	iTF.class = select(2,UnitClass('player')) --number
	iTF.specID = iTF:PlayerSpec()
	--! WotLK fix: привязки готовы применяться и без спека. Была пара строк ниже, и на персонаже без
	-- определённого спека (низкий уровень, до выбора талантов) ветка не выполнялась вовсе: клавиши
	-- работали до первого /reload. Столбик класса создаём заранее. Правка из
	-- vanvonlj/iTargetingFrames-wotlk, коммит "Fix click-to-target lost after /reload".
	if not iTFConfig.bindings[iTF.class] then
		iTFConfig.bindings[iTF.class] = {['b'] = {}}
	end
	if iTF.specID then
		specID = {
			['specID'] = iTF.specID,
			['utility'] = iTF.spells.range[iTF.specID].utility,
			['interrupt'] = iTF.spells.range[iTF.specID].interrupt,
			['dps'] = iTF.spells.range[iTF.specID].dps,
			--! WotLK fix: the tank flag was never carried over, so specID.tank stayed nil for everyone and
			-- the threat role filters were inverted. Starting value only -- updateTankRole() refines it.
			['tank'] = iTF.spells.range[iTF.specID].tank,
		}
		if not iTFConfig.bindings[iTF.class][specID.specID] then
			iTFConfig.bindings[iTF.class][specID.specID] = {}
		end
	end
	iTF:updateTankRole()
	iTF.playerSpecLoaded = true
	iTF:updateFrames('bindings')
end

function addon:PLAYER_LOGIN()
	iTF.playerSpecLoaded = false
end

function addon:ACTIVE_TALENT_GROUP_CHANGED()
	iTF:CheckTalents()
end
function addon:UNIT_THREAT_LIST_UPDATE(unitID)
	if iTF.frames[unitID] and iTF.frames[unitID].isShown then
		for k,_ in pairs(conditionals.threat) do
			updateIndicator(unitID, k)
		end
		--updateIndicator(unitID, 'threat')
	end
end
function addon:PLAYER_TARGET_CHANGED()
	updateIndicator(nil, 'currentTarget')
	for k,_ in pairs(conditionals.targetChanged) do
		updateIndicator(nil, k)
	end
end
function addon:PLAYER_FOCUS_CHANGED()
	for k,_ in pairs(conditionals.focusUpdate) do
			updateIndicator(nil, k)
	end
	--updateIndicator(nil, 'focusTarget')
end
function addon:PLAYER_REGEN_DISABLED()
	iTF:toggleConfig(true)
end
function addon:NAME_PLATE_UNIT_ADDED(unitID)
	if iTF.frames[unitID] then
		iTF.frames[unitID].added = GetTime()
		iTF:updateUnitID(unitID)
	end
end
function addon:NAME_PLATE_UNIT_REMOVED(unitID)
	if iTF.frames[unitID] then
		iTF.frames[unitID].isPlayer = nil
	end
end
function addon:CHAT_MSG_ADDON(prefix, msg, chatType)
	if prefix ~= 'iTargetingFrames' or not (chatType == 'RAID' or chatType == 'PARTY') or not iTFConfig.layout.conditionals.priorityNPCs.receive then return end
	local npc, comment = strsplit('::', msg)
	iTargetingFrames:PrioNPC(npc, comment)
end
SLASH_ITF1 = "/itf"
SLASH_ITF2 = '/itargetingframes'
SlashCmdList["ITF"] = function(msg)
	local raw = (msg:gsub('^%s*(.-)%s*$', '%1'))
	msg = string.lower(raw)
	if string.len(msg) == 0 then
		msg = nil
	end
	if msg and msg == 'reset' then
		iTF:LoadDefaults(true)
	elseif msg and msg == 'deny' then
		iTF:DebugDeny()
	elseif msg and (msg == 'ignore' or msg == 'unignore' or msg:find('^ignore ') or msg:find('^unignore ') or msg == 'ignorelist') then
		--! WotLK fix: команды чёрного списка NPC. Имя юнита берётся без приведения регистра -- ключ
		-- списка должен совпадать с UnitName(), а msg ниже уже строчный.
		iTFConfig.npcBlacklist = iTFConfig.npcBlacklist or {}
		local arg = (raw:match('^[Ii][Gg][Nn][Oo][Rr][Ee]%s+(.+)$') or raw:match('^[Uu][Nn][Ii][Gg][Nn][Oo][Rr][Ee]%s+(.+)$'))
		-- пробел по краям аргумента дал бы запись, которая никогда не совпадёт с UnitName()
		arg = arg and arg:gsub('^%s*(.-)%s*$', '%1')
		if msg == 'ignorelist' then
			local n = 0
			for k in pairs(iTFConfig.npcBlacklist) do
				iTF:print('blacklist: ' .. tostring(k))
				n = n + 1
			end
			iTF:print('blacklist entries: ' .. n)
		elseif InCombatLockdown() and (msg == 'ignore' or msg == 'unignore' or arg) then
			-- полный пересмотр сетки в бою недоступен по той же причине, что и `/itf reset` (п. 7.24)
			iTF:print(L.combatLockdown)
		else
			local keys = {}
			if arg then
				keys[1] = arg
			elseif UnitExists('target') then
				keys[1] = UnitName('target')
				local id = iTF:npcIDFromGUID(UnitGUID('target'))
				if id then keys[2] = tostring(id) end
			else
				iTF:print('no target and no name given')
				return
			end
			local remove = msg:find('^unignore') and true or false
			for _,k in pairs(keys) do
				if k then
					iTargetingFrames:NpcBlacklist(k, remove)
				end
			end
			iTF:print((remove and 'unignored: ' or 'ignored: ') .. tostring(keys[1]))
		end
	elseif msg then
		iTF:print('help')
	else
		if not InCombatLockdown() then
			iTF:toggleConfig()
		else
			iTF:print(L.combatLockdown)
		end
	end
end
