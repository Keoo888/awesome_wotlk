-- File: esMX.lua
-- Language: Spanish (Mexico)
local _, AwesomeCVar = ...

if not AwesomeCVar.L then
    AwesomeCVar.L = {}
end

local L = AwesomeCVar.L

if GetLocale() == "esMX" then
    -- General
    L.ADDON_NAME = "AwesomeCVar"
    L.ADDON_NAME_SHORT = "Awesome CVar"
    L.MAIN_FRAME_TITLE = "Gestor de Awesome CVar"
    L.RESET_TO = "Restablecer a %s"
	L.MINIMAP_ICON = "Icono del minimapa"
	L.MINIMAP_TOOLTIP = "Clic para abrir\nArrastrar para mover"
	L.GAME_MENU_BUTTON = "Botón del menú del juego"
	L.OPEN_ADDON = "Abrir AwesomeCVar"

    -- Popups
    L.RELOAD_POPUP_TITLE = "Requiere Recarga de IU"
    L.RELOAD_POPUP_TEXT = "Uno o más cambios que has realizado requieren recargar la interfaz (ReloadUI) para aplicarse."
    L.RESET_POPUP_TITLE = "Confirmar Restablecimiento"
    L.RESET_POPUP_TEXT = "¿Estás seguro de que deseas restablecer todos los valores a sus valores predeterminados?"

    -- Chat Messages
    L.MSG_LOADED = "¡Awesome CVar cargado! Escribe /awesome para abrir el gestor."
    L.MSG_FRAME_RESET = "La posición del marco se ha restablecido al centro."
    L.MSG_SET_VALUE = "%s establecido en %s."
    L.MSG_UNKNOWN_COMMAND = "Comando desconocido. Escribe /awesome help para ver los comandos disponibles."
    L.MSG_HELP_HEADER = "Comandos de Awesome CVar:"
    L.MSG_HELP_TOGGLE = "/awesome - Alternar el gestor de CVar"
    L.MSG_HELP_SHOW = "/awesome show - Mostrar el gestor de CVar"
    L.MSG_HELP_HIDE = "/awesome hide - Ocultar el gestor de CVar"
    L.MSG_HELP_RESET = "/awesome reset - Restablecer posición del marco al centro"
    L.MSG_HELP_HELP = "/awesome help - Mostrar este mensaje de ayuda"

    -- CVar Categories
    L.CATEGORY_CAMERA = "Cámara"
    L.CATEGORY_NAMEPLATES = "Placas de nombre"
    L.CATEGORY_INTERACTION = "Interacción"

    -- CVar Labels & Descriptions
    L.CVAR_LABEL_INFO = "Notas"
    L.CVAR_LABEL_CAMERA_FOV = "Campo de visión (FoV)"
	L.CVAR_LABEL_NAMEPLATE_DISTANCE = "Distancia de visualización de placas"
    L.CVAR_LABEL_INTERACTION_MODE = "Modo de interacción"
    L.CVAR_LABEL_INTERACTION_ANGLE = "Ángulo de interacción (grados)"
    L.CVAR_LABEL_CAMERA_INDIRECT_VISIBILITY = "Visibilidad indirecta de cámara"
    L.CVAR_LABEL_CAMERA_INDIRECT_ALPHA = "Alfa indirecto de cámara"

    L.DESC_INFO = "Nuestra AwesomeWotlkLib.dll publica las placas como tokens 'nameplateN' y a través de C_NamePlate:\n- C_NamePlate.GetNamePlateTokenByGUID(guid) -> 'nameplate4' o nil\n\nUn token vive exactamente lo que vive su placa, y los tokens activos nunca se renumeran. Nota: el cliente NO envía UNIT_AURA, UNIT_HEALTH ni UNIT_SPELLCAST_* para estos tokens; un addon de pantalla debe consultarlos (AWNamePlateAPI e iTargetingFrames lo hacen cada 0,2 s)."
    L.DESC_CAMERA_FOV = "Campo de visión de la cámara. 100 es el valor original (la dll lo convierte en valor * pi / 200 radianes, así que 100 = 90 grados); la dll acepta 1..200 y este deslizador se queda en la zona razonable de 60..150. Forma parte del perfil integrado (camera)."
    L.DESC_NAMEPLATE_DISTANCE = "Distancia máxima a la que todavía se muestran las placas de nombre. La dll compara este valor cada frame con el parámetro del cliente, lo limita a 41..100 y marca el frame para redibujarlo. Forma parte del perfil integrado (scope=4)."
    L.DESC_INTERACTION_MODE = "0 elige el objeto saqueable/utilizable más cercano en un radio de 20 yardas en cualquier dirección; 1 solo dentro del cono de visión de abajo. Forma parte del perfil integrado (interact)."
    L.DESC_INTERACTION_ANGLE = "Ángulo total del cono de visión que usa '/interact' cuando el modo es cono. La dll lo limita a 15..160 grados. Forma parte del perfil integrado (interact)."

    -- Дистанция до плейтов / цели / фокуса (AWDistance.lua читает эти строки, числа -- в его CLAMPS)
    L.CATEGORY_DISTANCE = "Distancia"

    L.CVAR_LABEL_DISTANCE_DISPLAY = "Mostrar distancia"

    L.DESC_DISTANCE_DISPLAY = "Interruptor principal de las etiquetas de distancia. Con 0 la dll no calcula ni publica nada y AWDistance.lua no dibuja nada. Forma parte del perfil integrado (distance)."

    L.AW_OFF = "— no registrada por esta compilación (%s)"
    L.DESC_CAMERA_INDIRECT_VISIBILITY = "Permite que la cámara atraviese ciertos objetos del mundo en lugar de ser bloqueada."
    L.DESC_CAMERA_INDIRECT_ALPHA = "Establece el nivel de transparencia de los objetos que se interponen entre la cámara y el jugador."

	-- CVar Mode Options

    L.MODE_LABEL_PLAYER_RADIUS = "Radio del jugador 20yd"
    L.MODE_LABEL_CONE_ANGLE = "Ángulo de cono (grados) dentro de 20yd"

end