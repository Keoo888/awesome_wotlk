-- File: frFR.lua
-- Language: French
local _, AwesomeCVar = ...

if not AwesomeCVar.L then
    AwesomeCVar.L = {}
end

local L = AwesomeCVar.L

if GetLocale() == "frFR" then
    -- Général
    L.ADDON_NAME = "AwesomeCVar"
    L.ADDON_NAME_SHORT = "Awesome CVar"
    L.MAIN_FRAME_TITLE = "Gestionnaire Awesome CVar"
    L.RESET_TO = "Réinitialiser à %s"
	L.MINIMAP_ICON = "Icône de la minicarte"
	L.MINIMAP_TOOLTIP = "Clic pour ouvrir\nGlisser pour déplacer"
	L.GAME_MENU_BUTTON = "Bouton du menu de jeu"
	L.OPEN_ADDON = "Ouvrir AwesomeCVar"

    -- Fenêtres surgissantes (Popups)
    L.RELOAD_POPUP_TITLE = "Rechargement de l'IU requis"
    L.RELOAD_POPUP_TEXT = "Une ou plusieurs modifications nécessitent un rechargement de l'interface (ReloadUI) pour prendre effet."
    L.RESET_POPUP_TITLE = "Confirmer la réinitialisation"
    L.RESET_POPUP_TEXT = "Êtes-vous sûr de vouloir réinitialiser toutes les valeurs par défaut ?"

    -- Messages de chat
    L.MSG_LOADED = "Awesome CVar chargé ! Tapez /awesome pour ouvrir le gestionnaire."
    L.MSG_FRAME_RESET = "La position de la fenêtre a été réinitialisée au centre."
    L.MSG_SET_VALUE = "%s réglé sur %s."
    L.MSG_UNKNOWN_COMMAND = "Commande inconnue. Tapez /awesome help pour voir les commandes disponibles."
    L.MSG_HELP_HEADER = "Commandes Awesome CVar :"
    L.MSG_HELP_TOGGLE = "/awesome - Afficher/Masquer le gestionnaire"
    L.MSG_HELP_SHOW = "/awesome show - Afficher le gestionnaire"
    L.MSG_HELP_HIDE = "/awesome hide - Masquer le gestionnaire"
    L.MSG_HELP_RESET = "/awesome reset - Centrer la fenêtre"
    L.MSG_HELP_HELP = "/awesome help - Afficher ce message d'aide"

    -- Catégories CVar
    L.CATEGORY_CAMERA = "Caméra"
    L.CATEGORY_NAMEPLATES = "Barres d'info"
    L.CATEGORY_INTERACTION = "Interaction"

    -- Étiquettes et descriptions CVar
    L.CVAR_LABEL_INFO = "Notes"
    L.CVAR_LABEL_CAMERA_FOV = "Champ de vision (FoV)"
    L.CVAR_LABEL_NAMEPLATE_DISTANCE = "Distance d'affichage"
    L.CVAR_LABEL_INTERACTION_MODE = "Mode d'interaction"
    L.CVAR_LABEL_INTERACTION_ANGLE = "Angle d'interaction (deg)"
    L.CVAR_LABEL_CAMERA_INDIRECT_VISIBILITY = "Visibilité indirecte de la caméra"
    L.CVAR_LABEL_CAMERA_INDIRECT_ALPHA = "Opacité indirecte de la caméra"

    L.DESC_INFO = "Notre AwesomeWotlkLib.dll publie les barres d’info sous forme de jetons « nameplateN » et via C_NamePlate :\n- C_NamePlate.GetNamePlateTokenByGUID(guid) -> « nameplate4 » ou nil\n\nUn jeton vit exactement aussi longtemps que sa barre ; les jetons actifs ne sont jamais renumérotés. Note : le client n’envoie PAS UNIT_AURA, UNIT_HEALTH ni UNIT_SPELLCAST_* pour ces jetons, un addon d’affichage doit les interroger (AWNamePlateAPI et iTargetingFrames le font toutes les 0,2 s)."
    L.DESC_CAMERA_FOV = "Champ de vision de la caméra. 100 est la valeur d’origine (la dll convertit en valeur * pi / 200 radians, donc 100 = 90 degrés) ; la dll accepte 1..200 et ce curseur reste dans la plage raisonnable 60..150. Fait partie du profil intégré (camera)."
    L.DESC_NAMEPLATE_DISTANCE = "Distance maximale à laquelle les barres d’info sont encore affichées. La dll compare cette valeur à chaque frame au paramètre du client, la borne à 41..100 et marque le cadre pour un redessin. Fait partie du profil intégré (scope=4)."
    L.DESC_INTERACTION_MODE = "0 choisit l’objet ramassable/utilisable le plus proche dans un rayon de 20 mètres dans toutes les directions ; 1 uniquement dans le cône de vision ci-dessous. Fait partie du profil intégré (interact)."
    L.DESC_INTERACTION_ANGLE = "Angle total du cône de vision utilisé par « /interact » en mode cône. La dll le borne à 15..160 degrés. Fait partie du profil intégré (interact)."

    -- Дистанция до плейтов / цели / фокуса (AWDistance.lua читает эти строки, числа -- в его CLAMPS)
    L.CATEGORY_DISTANCE = "Distance"

    L.CVAR_LABEL_DISTANCE_DISPLAY = "Afficher la distance"

    L.DESC_DISTANCE_DISPLAY = "Interrupteur général des étiquettes de distance. À 0, la dll ne calcule et ne publie rien, et AWDistance.lua ne dessine rien. Fait partie du profil intégré (distance)."

    L.AW_OFF = "— non enregistrée par cette version (%s)"
    L.DESC_CAMERA_INDIRECT_VISIBILITY = "Permet à la caméra de traverser certains objets au lieu d'être bloquée."
    L.DESC_CAMERA_INDIRECT_ALPHA = "Définit la transparence des objets se trouvant entre la caméra et le personnage."

	-- Options Mode CVar

    L.MODE_LABEL_PLAYER_RADIUS = "Rayon joueur 20yd"
    L.MODE_LABEL_CONE_ANGLE = "Angle du cône (deg) à moins de 20yd"

end