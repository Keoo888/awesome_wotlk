-- File: ptBR.lua
-- Language: Portuguese (Brazil)
local _, AwesomeCVar = ...

if not AwesomeCVar.L then
    AwesomeCVar.L = {}
end

local L = AwesomeCVar.L

if GetLocale() == "ptBR" then
    -- Geral
    L.ADDON_NAME = "AwesomeCVar"
    L.ADDON_NAME_SHORT = "Awesome CVar"
    L.MAIN_FRAME_TITLE = "Gerenciador Awesome CVar"
    L.RESET_TO = "Redefinir para %s"
	L.MINIMAP_ICON = "Ícone do minimapa"
	L.MINIMAP_TOOLTIP = "Clique para abrir\nArraste para mover"
	L.GAME_MENU_BUTTON = "Botão do menu do jogo"
	L.OPEN_ADDON = "Abrir AwesomeCVar"

    -- Popups
    L.RELOAD_POPUP_TITLE = "Recarga de IU Necessária"
    L.RELOAD_POPUP_TEXT = "Uma ou mais alterações feitas exigem uma recarga da interface (ReloadUI) para entrar em vigor."
    L.RESET_POPUP_TITLE = "Confirmar Redefinição"
    L.RESET_POPUP_TEXT = "Tem certeza de que deseja redefinir todos os valores para os padrões?"

    -- Mensagens de Chat
    L.MSG_LOADED = "Awesome CVar carregado! Digite /awesome para abrir o gerenciador."
    L.MSG_FRAME_RESET = "A posição da janela foi redefinida para o centro."
    L.MSG_SET_VALUE = "%s definido para %s."
    L.MSG_UNKNOWN_COMMAND = "Comando desconhecido. Digite /awesome help para comandos disponíveis."
    L.MSG_HELP_HEADER = "Comandos Awesome CVar:"
    L.MSG_HELP_TOGGLE = "/awesome - Alternar o gerenciador CVar"
    L.MSG_HELP_SHOW = "/awesome show - Mostrar o gerenciador CVar"
    L.MSG_HELP_HIDE = "/awesome hide - Ocultar o gerenciador CVar"
    L.MSG_HELP_RESET = "/awesome reset - Centralizar posição da janela"
    L.MSG_HELP_HELP = "/awesome help - Mostrar esta mensagem de ajuda"

    -- Categorias de CVar
    L.CATEGORY_CAMERA = "Câmera"
    L.CATEGORY_NAMEPLATES = "Placas de Nome"
    L.CATEGORY_INTERACTION = "Interação"

    -- Rótulos e Descrições de CVar
    L.CVAR_LABEL_INFO = "Notas"
    L.CVAR_LABEL_CAMERA_FOV = "Campo de Visão (FoV)"
	L.CVAR_LABEL_NAMEPLATE_DISTANCE = "Distância de Exibição das Placas"
    L.CVAR_LABEL_INTERACTION_MODE = "Modo de Interação"
    L.CVAR_LABEL_INTERACTION_ANGLE = "Ângulo de Interação (graus)"
    L.CVAR_LABEL_CAMERA_INDIRECT_VISIBILITY = "Visibilidade Indireta da Câmera"
    L.CVAR_LABEL_CAMERA_INDIRECT_ALPHA = "Alfa Indireto da Câmera"

    L.DESC_INFO = "Nossa AwesomeWotlkLib.dll publica as placas como tokens 'nameplateN' e através de C_NamePlate:\n- C_NamePlate.GetNamePlateTokenByGUID(guid) -> 'nameplate4' ou nil\n\nUm token vive exatamente enquanto sua placa existir; tokens ativos nunca são renumerados. Observação: o cliente NÃO envia UNIT_AURA, UNIT_HEALTH nem UNIT_SPELLCAST_* para esses tokens; um addon de exibição precisa consultá-los (AWNamePlateAPI e iTargetingFrames fazem isso a cada 0,2 s)."
    L.DESC_CAMERA_FOV = "Campo de visão da câmera. 100 é o valor padrão (a dll converte como valor * pi / 200 radianos, então 100 = 90 graus); a dll aceita 1..200 e este controle fica na faixa sensata de 60..150. Faz parte do perfil embutido (camera)."
    L.DESC_NAMEPLATE_DISTANCE = "Maior distância em que as placas de nome ainda são exibidas. A dll compara este valor a cada quadro com o parâmetro do cliente, limita a 41..100 e marca o quadro para redesenho. Faz parte do perfil embutido (scope=4)."
    L.DESC_INTERACTION_MODE = "0 escolhe o objeto coletável/utilizável mais próximo num raio de 20 jardas em qualquer direção; 1 apenas dentro do cone de visão abaixo. Faz parte do perfil embutido (interact)."
    L.DESC_INTERACTION_ANGLE = "Ângulo total do cone de visão usado por '/interact' no modo cone. A dll limita a 15..160 graus. Faz parte do perfil embutido (interact)."

    -- Дистанция до плейтов / цели / фокуса (AWDistance.lua читает эти строки, числа -- в его CLAMPS)
    L.CATEGORY_DISTANCE = "Distância"

    L.CVAR_LABEL_DISTANCE_DISPLAY = "Mostrar distância"

    L.DESC_DISTANCE_DISPLAY = "Chave geral das etiquetas de distância. Em 0 a dll não calcula nem publica nada, e o AWDistance.lua não desenha nada. Faz parte do perfil embutido (distance)."

    L.AW_OFF = "— não registrada nesta compilação (%s)"
    L.DESC_CAMERA_INDIRECT_VISIBILITY = "Permite que a câmera atravesse certos objetos em vez de ser bloqueada."
    L.DESC_CAMERA_INDIRECT_ALPHA = "Define o nível de transparência de objetos que ficam entre a câmera e o personagem."

	-- Opções de Modo CVar

    L.MODE_LABEL_PLAYER_RADIUS = "Raio do Jogador 20yd"
    L.MODE_LABEL_CONE_ANGLE = "Ângulo do Cone (graus) dentro de 20yd"

end