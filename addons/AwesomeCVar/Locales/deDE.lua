-- File: deDE.lua
-- Language: German
local _, AwesomeCVar = ...

if not AwesomeCVar.L then
    AwesomeCVar.L = {}
end

local L = AwesomeCVar.L

if GetLocale() == "deDE" then
    -- Allgemein
    L.ADDON_NAME = "AwesomeCVar"
    L.ADDON_NAME_SHORT = "Awesome CVar"
    L.MAIN_FRAME_TITLE = "Awesome CVar Manager"
    L.RESET_TO = "Zurücksetzen auf %s"
	L.MINIMAP_ICON = "Minimap-Symbol"
	L.MINIMAP_TOOLTIP = "Klicken zum Öffnen\nZiehen zum Bewegen"
	L.GAME_MENU_BUTTON = "Spielmenü-Button"
	L.OPEN_ADDON = "AwesomeCVar öffnen"

    -- Popups
    L.RELOAD_POPUP_TITLE = "Interface-Reload erforderlich"
    L.RELOAD_POPUP_TEXT = "Eine oder mehrere Änderungen erfordern ein Neuladen des Interfaces (ReloadUI), um wirksam zu werden."
    L.RESET_POPUP_TITLE = "Standardwerte wiederherstellen"
    L.RESET_POPUP_TEXT = "Bist du sicher, dass du alle Werte auf die Standardeinstellungen zurücksetzen möchtest?"

    -- Chat-Nachrichten
    L.MSG_LOADED = "Awesome CVar geladen! Gib /awesome ein, um den Manager zu öffnen."
    L.MSG_FRAME_RESET = "Fensterposition wurde auf die Mitte zurückgesetzt."
    L.MSG_SET_VALUE = "%s auf %s gesetzt."
    L.MSG_UNKNOWN_COMMAND = "Unbekannter Befehl. Gib /awesome help für eine Übersicht ein."
    L.MSG_HELP_HEADER = "Awesome CVar Befehle:"
    L.MSG_HELP_TOGGLE = "/awesome - CVar-Manager umschalten"
    L.MSG_HELP_SHOW = "/awesome show - CVar-Manager anzeigen"
    L.MSG_HELP_HIDE = "/awesome hide - CVar-Manager ausblenden"
    L.MSG_HELP_RESET = "/awesome reset - Fensterposition zentrieren"
    L.MSG_HELP_HELP = "/awesome help - Diese Hilfe anzeigen"

    -- CVar-Kategorien
    L.CATEGORY_CAMERA = "Kamera"
    L.CATEGORY_NAMEPLATES = "Namensplaketten"
    L.CATEGORY_INTERACTION = "Interaktion"

    -- CVar-Beschriftungen & Beschreibungen
    L.CVAR_LABEL_INFO = "Notizen"
    L.CVAR_LABEL_CAMERA_FOV = "Kamera-Sichtfeld (FoV)"
    L.CVAR_LABEL_NAMEPLATE_DISTANCE = "Plaketten-Sichtweite"
    L.CVAR_LABEL_INTERACTION_MODE = "Interaktionsmodus"
    L.CVAR_LABEL_INTERACTION_ANGLE = "Interaktionswinkel (Grad)"
    L.CVAR_LABEL_CAMERA_INDIRECT_VISIBILITY = "Indirekte Kamera-Sichtbarkeit"
    L.CVAR_LABEL_CAMERA_INDIRECT_ALPHA = "Indirekter Kamera-Alpha"

    L.DESC_INFO = "Unsere AwesomeWotlkLib.dll veröffentlicht Namensplaketten als Tokens „nameplateN“ und über C_NamePlate:\n- C_NamePlate.GetNamePlateTokenByGUID(guid) -> „nameplate4“ oder nil\n\nEin Token lebt genau so lange wie seine Plakette; lebende Tokens werden nie umbenannt. Hinweis: der Client sendet für diese Tokens keine UNIT_AURA-, UNIT_HEALTH- oder UNIT_SPELLCAST_-Events, ein Anzeigen-Addon muss sie abfragen (AWNamePlateAPI und iTargetingFrames tun das alle 0,2 s)."
    L.DESC_CAMERA_FOV = "Sichtfeld der Kamera. 100 ist der Standardwert (die dll rechnet value * pi / 200 Rad, also 100 = 90 Grad); die dll akzeptiert 1..200, dieser Regler bleibt im sinnvollen Bereich 60..150. Teil des eingebauten Profils (camera)."
    L.DESC_NAMEPLATE_DISTANCE = "Größte Entfernung, aus der Namensplaketten noch angezeigt werden. Die dll vergleicht diesen Wert in jedem Frame mit der Distanz des Clients, begrenzt ihn auf 41..100 und markiert das Frame zum Neuzeichnen. Teil des eingebauten Profils (scope=4)."
    L.DESC_INTERACTION_MODE = "0 wählt das nächste lesbare/benutzbare Objekt innerhalb von 20 Yard in beliebiger Richtung; 1 nur innerhalb des Sichtkegels unten. Teil des eingebauten Profils (interact)."
    L.DESC_INTERACTION_ANGLE = "Vollwinkel des Sichtkegels, den „/interact“ im Kegelmodus benutzt. Die dll begrenzt ihn auf 15..160 Grad. Teil des eingebauten Profils (interact)."

    -- Дистанция до плейтов / цели / фокуса (AWDistance.lua читает эти строки, числа -- в его CLAMPS)
    L.CATEGORY_DISTANCE = "Distanz"

    L.CVAR_LABEL_DISTANCE_DISPLAY = "Distanz anzeigen"

    L.DESC_DISTANCE_DISPLAY = "Hauptschalter der Distanzbeschriftungen. Bei 0 rechnet und veröffentlicht die dll nichts, und AWDistance.lua zeichnet nichts. Teil des eingebauten Profils (distance)."

    L.AW_OFF = "— von diesem Build nicht registriert (%s)"
    L.DESC_CAMERA_INDIRECT_VISIBILITY = "Ermöglicht es der Kamera, durch bestimmte Objekte hindurchzugehen, anstatt blockiert zu werden."
    L.DESC_CAMERA_INDIRECT_ALPHA = "Legt die Transparenz von Objekten fest, die sich zwischen Kamera und Spieler befinden."

    -- CVar Mode Optionen

	L.MODE_LABEL_PLAYER_RADIUS = "Spieler-Radius 20yd"
	L.MODE_LABEL_CONE_ANGLE = "Kegelwinkel (Grad) innerhalb 20yd"

end