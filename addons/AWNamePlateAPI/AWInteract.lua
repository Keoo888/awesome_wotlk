-- Умный interact: выбор объекта и клик делает dll (Interact.cpp), здесь только канал данных.
-- Живёт в аддоне AWNamePlateAPI вторым файлом: WeakAuras и iTargetingFrames ссылаются на имя
-- AWNamePlateAPI в ## OptionalDeps, поэтому отдельный аддон под это не нужен.
--
-- Почему так, а не C-функцией: форк awesome регистрирует SlashCmdList.INTERACTCMD как lua_CFunction,
-- то есть кладёт указатель на свою dll в данные клиента. Клиент 3.3.5a такие указатели проверяет в
-- момент вызова и убивает процесс ошибкой #134 (измерено 29.09 21:18 на C_NamePlate). Здесь указателей
-- нет: Lua пишет значение в глобальную таблицу, dll её читает каждый кадр и сама же гасит.
--
-- Требует AwesomeWotlkLib.dll с interact в профиле сборки (Settings.h); настроек извне у dll нет с 01.10.

AW_Request = AW_Request or {}

function AWInteract(mod)
    if type(mod) == "string" and mod ~= "" then
        AW_Request.interact = mod          -- "target", "focus", "nameplate1" ...: проверить только этот юнит
    else
        AW_Request.interact = true         -- обычный поиск: ближайший подбираемый в радиусе 20
    end
end

SLASH_AWINTERACT1 = "/interact"
SLASH_AWINTERACT2 = "/smartinteract"
SlashCmdList["AWINTERACT"] = function(msg)
    AWInteract((msg and msg ~= "") and msg or nil)
end

-- Вешается на кнопку обычным биндом: создай макрос с текстом
--     /run AWInteract()
-- и перетащи его на панель, затем назначь клавишу в «Сочетания клавиш -> Панели» (или
-- SetBinding("F", "CLICK ACTIONBAR:slot")). Отдельного заголовка в привязках аддон не требует.
