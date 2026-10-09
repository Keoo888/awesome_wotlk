-- File: enUS.lua
-- Language: English (US)
local _, AwesomeCVar = ...

if not AwesomeCVar.L then
    AwesomeCVar.L = {}
end

local L = AwesomeCVar.L

if GetLocale() == "enUS" then
    -- General
    L.ADDON_NAME = "AwesomeCVar"
    L.ADDON_NAME_SHORT = "Awesome CVar"
    L.MAIN_FRAME_TITLE = "Awesome CVar Manager"
    L.RESET_TO = "Reset to %s"
	L.MINIMAP_ICON = "Minimap Icon"
	L.MINIMAP_TOOLTIP = "Click to open\nDrag to move"
	L.GAME_MENU_BUTTON = "Game Menu Button"
	L.OPEN_ADDON = "Open AwesomeCVar"

    -- Popups
    L.RELOAD_POPUP_TITLE = "Reload UI Required"
    L.RELOAD_POPUP_TEXT = "One or more of the changes you have made require a ReloadUI to take effect."
    L.RESET_POPUP_TITLE = "Confirm Default Reset"
    L.RESET_POPUP_TEXT = "Are you sure you want to reset all values back to their defaults?"

    -- Chat Messages
    L.MSG_LOADED = "Awesome CVar loaded! Type /awesome to open the manager."
    L.MSG_FRAME_RESET = "Frame position has been reset to the center."
    L.MSG_SET_VALUE = "Set %s to %s."
    L.MSG_UNKNOWN_COMMAND = "Unknown command. Type /awesome help for available commands."
    L.MSG_HELP_HEADER = "Awesome CVar Commands:"
    L.MSG_HELP_TOGGLE = "/awesome - Toggle the CVar manager"
    L.MSG_HELP_SHOW = "/awesome show - Show the CVar manager"
    L.MSG_HELP_HIDE = "/awesome hide - Hide the CVar manager"
    L.MSG_HELP_RESET = "/awesome reset - Reset frame position to center"
    L.MSG_HELP_HELP = "/awesome help - Show this help message"

    -- CVar Categories
    L.CATEGORY_CAMERA = "Camera"
    L.CATEGORY_NAMEPLATES = "Nameplates"
    L.CATEGORY_INTERACTION = "Interaction"

    -- CVar Labels & Descriptions
    L.CVAR_LABEL_INFO = "Notes"
    L.CVAR_LABEL_CAMERA_FOV = "Camera FoV"
    L.CVAR_LABEL_NAMEPLATE_DISTANCE = "Nameplate Display Distance"
    L.CVAR_LABEL_INTERACTION_MODE = "Interaction Mode"
    L.CVAR_LABEL_INTERACTION_ANGLE = "Interaction Cone Angle (deg)"
    L.CVAR_LABEL_CAMERA_INDIRECT_VISIBILITY = "Camera Indirect Visibility"
	L.CVAR_LABEL_CAMERA_INDIRECT_ALPHA = "Camera Indirect Alpha"

    L.DESC_INFO = "Our AwesomeWotlkLib.dll publishes nameplates as 'nameplateN' tokens and through C_NamePlate:\n- C_NamePlate.GetNamePlateTokenByGUID(guid) -> 'nameplate4' or nil\n- C_NamePlate.GetNamePlateByGUID(guid) -> the same token\n\nA token lives exactly as long as its nameplate: a slot is held for three frames after the plate dies and live slots are never renumbered, so icons anchored to a token do not jump around.\n\nNote: the client does NOT send UNIT_AURA, UNIT_HEALTH or UNIT_SPELLCAST_* events for these tokens. A display addon has to poll them (AWNamePlateAPI and iTargetingFrames do it every 0.2s)."
    L.DESC_CAMERA_FOV = "Camera field of view. 100 is the stock value (the dll converts it as value * pi / 200 radians, so 100 = 90 degrees); the dll accepts 1..200 and this slider stays on the sane 60..150 part. Part of the built-in profile (camera)."
    L.DESC_NAMEPLATE_DISTANCE = "Largest distance at which nameplates are still shown. The dll compares this value with the client's own distance parameter every frame, clamps it to 41..100 and marks the frame for a redraw when they differ. Part of the built-in profile (scope=4)."
    L.DESC_INTERACTION_MODE = "0 picks the nearest lootable/usable object within 20 yards in any direction; 1 only within the view cone below. Part of the built-in profile (interact)."
    L.DESC_INTERACTION_ANGLE = "Full angle of the view cone used by '/interact' when the mode is cone. The dll clamps it to 15..160 degrees. Part of the built-in profile (interact)."
	L.DESC_CAMERA_INDIRECT_VISIBILITY = "When enabled, the camera can move freely through certain world objects rather than being blocked by them."
    L.DESC_CAMERA_INDIRECT_ALPHA = "Sets the transparency level of objects that come between the camera and the player character."

    --! WotLK fix: пометки нашей сборки. AW_OFF -- переменную не поставил профиль сборки (Settings.h),
    -- %s = её переключатель. Внешних настроек (файл рядом с Wow.exe) у dll с 01.10 нет.

    -- Дистанция до плейтов / цели / фокуса (AWDistance.lua читает эти строки, числа -- в его CLAMPS)
    L.CATEGORY_DISTANCE = "Distance"

    L.CVAR_LABEL_DISTANCE_DISPLAY = "Show Distance"

    L.DESC_DISTANCE_DISPLAY = "Master switch of the distance labels. While it is 0 the dll computes and publishes nothing and AWDistance.lua draws nothing. Part of the built-in profile (distance)."

    L.AW_OFF = "— not registered by this build (%s)"

    -- CVar Mode Labels

    L.MODE_LABEL_PLAYER_RADIUS = "Player Radius 20yd"
    L.MODE_LABEL_CONE_ANGLE = "Cone Angle (deg) within 20yd"

end