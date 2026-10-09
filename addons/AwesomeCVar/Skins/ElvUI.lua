local _, ACVar = ...
if not ACVar.Skins then
    ACVar.Skins = {}
end

ACVar.Skins.ElvUI = function()
    if not ElvUI then return end

    --! WotLK fix (06.10): из стандартной шапки `local E, L, V, P, G = unpack(ElvUI)` остался только E.
    -- L/V/P/G -- локали и три таблицы дефолтов профиля; скин в них не пишет и из них не читает, своих
    -- настроек у него нет. Тот же приём, что в AWElvUINameplates.lua:59. Понадобятся -- вернуть в строку.
    local E = unpack(ElvUI)
    local S = E:GetModule("Skins")
    local _G = _G
    local match = string.match

    local function SkinCVarControl(cvarDef)
        local name = cvarDef.name
        local PREFIX = "AwesomeCVar_"

        local control = _G[PREFIX..name.."Control"]
        if control and not control.__elvSkinned then
            control:StripTextures()
            control:SetTemplate("Transparent")
            control.__elvSkinned = true
        end

        if cvarDef.type == "slider" then
            local slider = _G[PREFIX..name.."Slider"]
            if slider and not slider.__elvSkinned then
                S:HandleSliderFrame(slider)
                slider.__elvSkinned = true
            end

            local resetBtn = _G[PREFIX..name.."ResetButton"]
            if resetBtn and not resetBtn.__elvSkinned then
                S:HandleButton(resetBtn)
                resetBtn.__elvSkinned = true
            end

        elseif cvarDef.type == "toggle" then
            local checkbox = _G[PREFIX..name.."Checkbox"]
            if checkbox and not checkbox.__elvSkinned then
                S:HandleCheckBox(checkbox, true)
                checkbox.__elvSkinned = true
            end

        elseif cvarDef.type == "dropdown" then
            local dropdown = _G[PREFIX..name.."Dropdown"]
            if dropdown and not dropdown.__elvSkinned then
                S:HandleDropDownBox(dropdown)
                dropdown:SetTemplate("Transparent")
                dropdown.backdrop:Hide()
                local btn = _G[dropdown:GetName().."Button"]
                btn:ClearAllPoints()
                btn:Point("RIGHT", dropdown, "RIGHT", -8, 0)
                btn:Size(20, 20)
                local _, p = dropdown:GetPoint()
                dropdown:ClearAllPoints()
                dropdown:SetPoint("TOPLEFT", p)
                dropdown:SetPoint("TOPRIGHT", p)
                dropdown.xOffset = 1
                dropdown.__elvSkinned = true
            end

            local resetBtn = _G[PREFIX..name.."ResetButton"]
            if resetBtn and not resetBtn.__elvSkinned then
                S:HandleButton(resetBtn)
                resetBtn.__elvSkinned = true
            end

        elseif cvarDef.type == "mode" then
            if cvarDef.modes then
                for i = 1, #cvarDef.modes do
                    local radio = _G[PREFIX..name.."Radio"..i]
                    if radio and not radio.__elvSkinned then
                        S:HandleCheckBox(radio, true)
                        radio.__elvSkinned = true
                    end
                end
            end
        end
    end

    -- Вкладка Distance: её контролы строит DistancePanel.lua лениво (build() из первого refresh), то есть
    -- уже после того, как отработали проходы по окну и по строкам CVar. Поэтому обход свой -- по дереву:
    -- у вкладки контрол лежит на два уровня глубже (box -> DropRow -> dropdown), чем у строки CVar, и
    -- часть виджетов появляется позже самого списка. Каждый фрейм оформляется один раз, флаг на нём же.
    local function savePoints(frame)
        local points = {}
        for i = 1, frame:GetNumPoints() do
            points[i] = { frame:GetPoint(i) }
        end
        return points
    end

    local function skinDropDownBox(dd)
        local points = savePoints(dd)
        S:HandleDropDownBox(dd)
        dd:SetTemplate("Transparent")
        if dd.backdrop then dd.backdrop:Hide() end
        local btn = _G[dd:GetName() .. "Button"]
        if btn then
            btn:ClearAllPoints()
            btn:Point("RIGHT", dd, "RIGHT", -8, 0)
            btn:Size(20, 20)
        end
        -- HandleDropDownBox зовёт frame:Width(), а наши дропдауны растянуты двумя якорями по ширине
        -- строки -- возвращаем якоря как были, иначе список сжимается до 155 пикселей
        dd:ClearAllPoints()
        for _, p in ipairs(points) do
            dd:SetPoint(p[1], p[2], p[3], p[4], p[5])
        end
        dd.xOffset = 1
        dd.__elvSkinned = true

        local list, bar = dd.awPulloutFrame, dd.awPulloutSlider
        if list and not list.__elvSkinned then
            list:StripTextures()
            list:SetTemplate("Transparent")
            list.__elvSkinned = true
        end
        if bar and not bar.__elvSkinned then
            S:HandleSliderFrame(bar)
            bar.__elvSkinned = true
        end
    end

    local function skinTree(parent)
        for _, child in ipairs({ parent:GetChildren() }) do
            if not child.__elvSkinned then
                local name = child:GetName()
                if child:IsObjectType("CheckButton") then
                    S:HandleCheckBox(child, true)
                    child.__elvSkinned = true
                elseif child:IsObjectType("Slider") then
                    S:HandleSliderFrame(child)
                    child.__elvSkinned = true
                elseif child:IsObjectType("EditBox") then
                    S:HandleEditBox(child)
                    child.__elvSkinned = true
                elseif child:IsObjectType("Frame") and name and _G[name .. "Button"] and _G[name .. "Text"] then
                    skinDropDownBox(child)
                elseif child:IsObjectType("Button") and name and not match(name, "Swatch") then
                    S:HandleButton(child)
                    child.__elvSkinned = true
                elseif not name then
                    -- блоки вкладки без имени: тот же приём, что и у control-строки CVar выше
                    child:StripTextures()
                    child:SetTemplate("Transparent")
                    child.__elvSkinned = true
                end
            end
            skinTree(child)
        end
    end

    local function SkinDistancePanel()
        for _, panel in pairs(ACVar.PanelsByName or {}) do
            local built = panel.GetScrollChild and panel:GetScrollChild()
            if built then skinTree(built) end
        end
    end

    local function SkinMainFrame()
        if not ACVar.Frame or ACVar.Frame.__elvSkinned then return end

        ACVar.Frame:StripTextures()
        ACVar.Frame:SetTemplate("Transparent")

        local titleClose = _G["AwesomeCVarFrameClose"]
        if titleClose then
            S:HandleCloseButton(titleClose)
        end

        for _, tab in pairs(ACVar.TabsByName) do
            S:HandleTab(tab)
            local text = _G[tab:GetName().."Text"]
            text:ClearAllPoints()
            text:Point("CENTER", 0, 1)
        end

        for _, child in ipairs({ACVar.Frame:GetChildren()}) do
            local objType = child:GetObjectType()
            if objType == "ScrollFrame" then
                local cname = child:GetName() or ""
                child:StripTextures()
                local scrollBar = _G[cname.."ScrollBar"]
                if scrollBar then
                    S:HandleScrollBar(scrollBar)
                end
                local category = match(cname, "^AwesomeCVarScrollFrame_(.+)$")
                if category then
                    local subPanel = _G["AwesomeCVarFramePanel_"..category]
                    if subPanel then
                        subPanel:StripTextures()
                        subPanel:SetTemplate("Transparent")
                    end
                end
            end
        end

        local closeBtn = _G["AwesomeCVarCloseButton"]
        local okayBtn = _G["AwesomeCVarOkayButton"]
        local defaultsBtn = _G["AwesomeCVarDefaultsButton"]
        if closeBtn then S:HandleButton(closeBtn) end
        if okayBtn then S:HandleButton(okayBtn) end
        if defaultsBtn then S:HandleButton(defaultsBtn) end

        local reloadPopup = _G["AwesomeCVarReloadPopup"]
        if reloadPopup then
            reloadPopup:StripTextures()
            reloadPopup:SetTemplate("Transparent")
            local acceptBtn = _G["AwesomeCVarAcceptButton"]
            if acceptBtn then S:HandleButton(acceptBtn) end
        end

		local minimapCheck = _G["AwesomeCVarMinimapCheck"]
        if minimapCheck then
            S:HandleCheckBox(minimapCheck)
			minimapCheck:Size(24, 24)
            local text = _G["AwesomeCVarMinimapCheckText"]
            if text then
                text:ClearAllPoints()
                text:Point("LEFT", minimapCheck, "RIGHT", 5, 0)
            end
        end

        local gameMenuCheck = _G["AwesomeCVarGameMenuCheck"]
        if gameMenuCheck then
            S:HandleCheckBox(gameMenuCheck)
			gameMenuCheck:Size(24, 24)
            local text = _G["AwesomeCVarGameMenuCheckText"]
            if text then
                text:ClearAllPoints()
                text:Point("LEFT", gameMenuCheck, "RIGHT", 5, 0)
            end
        end

        ACVar.Frame.__elvSkinned = true
    end

    local function SkinBlizzOptions()
        local panel = _G["AwesomeCVarBlizzPanel"]
        if panel and not panel.__elvSkinned then
            local openBtn = _G["AwesomeCVarBlizzOpenBtn"]
            if openBtn then
                S:HandleButton(openBtn)
            end
            panel.__elvSkinned = true
        end
    end

    hooksecurefunc(ACVar, "UpdateUIForCVar", function(self, cvarDef)
        SkinCVarControl(cvarDef)
    end)

    -- Вкладка Distance строится из первого refresh (DistancePanel.lua), поэтому и оформляется тем же
    -- хуком на тот же проход: до него виджетов вкладки просто не существует.
    hooksecurefunc(ACVar, "UpdateDistancePanel", SkinDistancePanel)

    hooksecurefunc(ACVar, "AddGameMenuButton", function()
        local btn = _G["GameMenuButtonAwesomeCVar"]
        if btn then S:HandleButton(btn) end
    end)

    hooksecurefunc(ACVar, "CreateDefaultConfirmationPopup", function()
        if ACVar.DefaultConfirmationPopup and not ACVar.DefaultConfirmationPopup.__elvSkinned then
            ACVar.DefaultConfirmationPopup:StripTextures()
            ACVar.DefaultConfirmationPopup:SetTemplate("Transparent")
            local okayPopupBtn = _G["AwesomeCVar_ConfirmResetButton"]
            local cancelBtn = _G["AwesomeCVar_CancelResetButton"]
            if cancelBtn then S:HandleButton(cancelBtn) end
            if okayPopupBtn then S:HandleButton(okayPopupBtn) end
            ACVar.DefaultConfirmationPopup.__elvSkinned = true
        end
    end)

    hooksecurefunc(ACVar, "CreateMainFrame", SkinMainFrame)
    hooksecurefunc(ACVar, "CreateBlizzOptions", SkinBlizzOptions)

    if ACVar.Frame then
        SkinMainFrame()
    end

    if _G["AwesomeCVarBlizzPanel"] then
        SkinBlizzOptions()
    end

    if ACVar.GameMenuButton then
        S:HandleButton(ACVar.GameMenuButton)
    end

    if ACVar.DefaultConfirmationPopup then
        ACVar.DefaultConfirmationPopup:StripTextures()
        ACVar.DefaultConfirmationPopup:SetTemplate("Transparent")
        local okayPopupBtn = _G["AwesomeCVar_ConfirmResetButton"]
        local cancelBtn = _G["AwesomeCVar_CancelResetButton"]
        if cancelBtn then S:HandleButton(cancelBtn) end
        if okayPopupBtn then S:HandleButton(okayPopupBtn) end
        ACVar.DefaultConfirmationPopup.__elvSkinned = true
    end
end