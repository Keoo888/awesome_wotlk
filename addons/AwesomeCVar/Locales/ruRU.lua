-- File: ruRU.lua
-- Language: Russian
local _, AwesomeCVar = ...

if not AwesomeCVar.L then
    AwesomeCVar.L = {}
end

local L = AwesomeCVar.L

if GetLocale() == "ruRU" then
    -- Общее
    L.ADDON_NAME = "AwesomeCVar"
    L.ADDON_NAME_SHORT = "Awesome CVar"
    L.MAIN_FRAME_TITLE = "Менеджер Awesome CVar"
    L.RESET_TO = "Сбросить на %s"
	L.MINIMAP_ICON = "Значок миникарты"
	L.MINIMAP_TOOLTIP = "Нажмите, чтобы открыть\nПеретащите для перемещения"
	L.GAME_MENU_BUTTON = "Кнопка в меню игры"
	L.OPEN_ADDON = "Открыть AwesomeCVar"

    -- Всплывающие окна
    L.RELOAD_POPUP_TITLE = "Требуется перезагрузка интерфейса"
    L.RELOAD_POPUP_TEXT = "Одно или несколько внесенных изменений требуют перезагрузки интерфейса (ReloadUI) для вступления в силу."
    L.RESET_POPUP_TITLE = "Подтверждение сброса"
    L.RESET_POPUP_TEXT = "Вы уверены, что хотите сбросить все значения до настроек по умолчанию?"

    -- Сообщения в чате
    L.MSG_LOADED = "Awesome CVar загружен! Введите /awesome, чтобы открыть менеджер."
    L.MSG_FRAME_RESET = "Положение окна было сброшено в центр."
    L.MSG_SET_VALUE = "%s установлено на %s."
    L.MSG_UNKNOWN_COMMAND = "Неизвестная команда. Введите /awesome help для списка команд."
    L.MSG_HELP_HEADER = "Команды Awesome CVar:"
    L.MSG_HELP_TOGGLE = "/awesome - Показать/скрыть менеджер CVar"
    L.MSG_HELP_SHOW = "/awesome show - Показать менеджер CVar"
    L.MSG_HELP_HIDE = "/awesome hide - Скрыть менеджер CVar"
    L.MSG_HELP_RESET = "/awesome reset - Сбросить положение окна в центр"
    L.MSG_HELP_HELP = "/awesome help - Показать это справочное сообщение"

    -- Категории CVar
    L.CATEGORY_CAMERA = "Камера"
    L.CATEGORY_NAMEPLATES = "Индикаторы здоровья"
    L.CATEGORY_INTERACTION = "Взаимодействие"

    -- Метки и описания CVar
    L.CVAR_LABEL_INFO = "Заметки"
    L.CVAR_LABEL_CAMERA_FOV = "Угол обзора камеры (FoV)"
	L.CVAR_LABEL_NAMEPLATE_DISTANCE = "Дистанция отображения индикаторов"
    L.CVAR_LABEL_INTERACTION_MODE = "Режим взаимодействия"
    L.CVAR_LABEL_INTERACTION_ANGLE = "Угол конуса взаимодействия (град.)"
    L.CVAR_LABEL_CAMERA_INDIRECT_VISIBILITY = "Косвенная видимость камеры"
    L.CVAR_LABEL_CAMERA_INDIRECT_ALPHA = "Косвенная прозрачность камеры"

    L.DESC_INFO = "Наш AwesomeWotlkLib.dll публикует индикаторы как токены 'nameplateN' и через C_NamePlate:\n- C_NamePlate.GetNamePlateTokenByGUID(guid) -> 'nameplate4' или nil\n- C_NamePlate.GetNamePlateByGUID(guid) -> тот же токен\n\nТокен живёт ровно столько, сколько его индикатор: слот удерживается три кадра после исчезновения, а живые слоты никогда не перенумеровываются — иконки, привязанные к токену, не прыгают.\n\nВажно: клиент НЕ рассылает UNIT_AURA, UNIT_HEALTH и UNIT_SPELLCAST_* для этих токенов. Аддон обязан опрашивать их сам (AWNamePlateAPI и iTargetingFrames делают это каждые 0.2 с)."
    L.DESC_CAMERA_FOV = "Угол обзора камеры. 100 — штатное значение (dll переводит его как value * pi / 200 радиан, то есть 100 = 90 градусов); dll принимает 1..200, ползунок оставлен на безопасных 60..150. Включено профилем сборки (camera)."
    L.DESC_NAMEPLATE_DISTANCE = "Максимальная дистанция, на которой индикаторы ещё отображаются. Каждый кадр dll сверяет это значение с параметром дальности клиента, обрезает до 41..100 и помечает кадр к перерисовке при расхождении. Включено профилем сборки (scope=4)."
    L.DESC_INTERACTION_MODE = "0 — брать ближайший подбираемый/используемый объект в радиусе 20 с любой стороны; 1 — только в конусе взгляда (угол ниже). Включено профилем сборки (interact)."
    L.DESC_INTERACTION_ANGLE = "Полный угол конуса взгляда для поиска объекта командой /interact. dll обрезает значение до 15..160 градусов. Включено профилем сборки (interact)."
    L.DESC_CAMERA_INDIRECT_VISIBILITY = "Позволяет камере проходить сквозь некоторые объекты мира вместо блокировки."
    L.DESC_CAMERA_INDIRECT_ALPHA = "Задает уровень прозрачности объектов между камерой и персонажем."

	--! WotLK fix: пометки нашей сборки (%s = переключатель профиля).

    -- Дистанция до плейтов / цели / фокуса (AWDistance.lua читает эти строки, числа -- в его CLAMPS)
    L.CATEGORY_DISTANCE = "Дистанция"

    L.CVAR_LABEL_DISTANCE_DISPLAY = "Показывать дистанцию"

    L.DESC_DISTANCE_DISPLAY = "Общий переключатель меток дистанции: пока он равен 0, dll ничего не считает и не печатает, а AWDistance.lua ничего не рисует. Включено профилем сборки (distance)."

	L.AW_OFF = "— не зарегистрирована этой сборкой (%s)"

	-- Опции режима CVar

    L.MODE_LABEL_PLAYER_RADIUS = "Радиус игрока (20 ярдов)"
    L.MODE_LABEL_CONE_ANGLE = "Угол конуса (град.) в пределах 20 ярдов"

end