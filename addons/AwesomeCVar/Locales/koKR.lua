-- File: koKR.lua
-- Language: Korean
local _, AwesomeCVar = ...

if not AwesomeCVar.L then
    AwesomeCVar.L = {}
end

local L = AwesomeCVar.L

if GetLocale() == "koKR" then
    -- 일반
    L.ADDON_NAME = "AwesomeCVar"
    L.ADDON_NAME_SHORT = "Awesome CVar"
    L.MAIN_FRAME_TITLE = "Awesome CVar 관리자"
    L.RESET_TO = "%s(으)로 초기화"
	L.MINIMAP_ICON = "미니맵 아이콘"
	L.MINIMAP_TOOLTIP = "클릭하여 열기\n드래그하여 이동"
	L.GAME_MENU_BUTTON = "게임 메뉴 버튼"
	L.OPEN_ADDON = "AwesomeCVar 열기"

    -- 팝업
    L.RELOAD_POPUP_TITLE = "UI 재시작 필요"
    L.RELOAD_POPUP_TEXT = "변경 사항 중 하나 이상을 적용하려면 UI 재시작(/reload)이 필요합니다."
    L.RESET_POPUP_TITLE = "기본값 초기화 확인"
    L.RESET_POPUP_TEXT = "모든 설정값을 기본값으로 초기화하시겠습니까?"

    -- 채팅 메시지
    L.MSG_LOADED = "Awesome CVar가 로드되었습니다! /awesome을 입력하여 관리자를 여세요."
    L.MSG_FRAME_RESET = "프레임 위치가 화면 중앙으로 초기화되었습니다."
    L.MSG_SET_VALUE = "%s을(를) %s(으)로 설정했습니다."
    L.MSG_UNKNOWN_COMMAND = "알 수 없는 명령어입니다. /awesome help를 입력하여 사용 가능한 명령어를 확인하세요."
    L.MSG_HELP_HEADER = "Awesome CVar 명령어:"
    L.MSG_HELP_TOGGLE = "/awesome - CVar 관리자 열기/닫기"
    L.MSG_HELP_SHOW = "/awesome show - CVar 관리자 표시"
    L.MSG_HELP_HIDE = "/awesome hide - CVar 관리자 숨기기"
    L.MSG_HELP_RESET = "/awesome reset - 프레임 위치 초기화"
    L.MSG_HELP_HELP = "/awesome help - 도움말 메시지 표시"

    -- CVar 카테고리
    L.CATEGORY_CAMERA = "카메라"
    L.CATEGORY_NAMEPLATES = "이름표"
    L.CATEGORY_INTERACTION = "상호작용"

    -- CVar 라벨 및 설명
    L.CVAR_LABEL_INFO = "참고"
    L.CVAR_LABEL_CAMERA_FOV = "카메라 시야각(FoV)"
    L.CVAR_LABEL_NAMEPLATE_DISTANCE = "이름표 표시 거리"
    L.CVAR_LABEL_INTERACTION_MODE = "상호작용 모드"
    L.CVAR_LABEL_INTERACTION_ANGLE = "상호작용 원뿔 각도(도)"
    L.CVAR_LABEL_CAMERA_INDIRECT_VISIBILITY = "카메라 간접 가시성"
    L.CVAR_LABEL_CAMERA_INDIRECT_ALPHA = "카메라 간접 투명도"

    L.DESC_INFO = "AwesomeWotlkLib.dll은 이름표를 'nameplateN' 토큰으로, 그리고 C_NamePlate를 통해 공개합니다:\n- C_NamePlate.GetNamePlateTokenByGUID(guid) -> 'nameplate4' 또는 nil\n\n토큰은 이름표가 존재하는 동안만 유지되며, 사용 중인 토큰 번호는 바뀌지 않습니다. 참고: 클라이언트는 이 토큰에 대해 UNIT_AURA, UNIT_HEALTH, UNIT_SPELLCAST_* 이벤트를 보내지 않으므로 표시 애드온은 직접 조회해야 합니다(AWNamePlateAPI와 iTargetingFrames는 0.2초마다 확인합니다)."
    L.DESC_CAMERA_FOV = "카메라 시야각. 100이 원본 값입니다(dll은 value * pi / 200 라디안으로 변환하므로 100 = 90도). dll은 1..200을 받으며 이 슬라이더는 무난한 60..150 범위에만 머무릅니다. 내장 프로필(camera)의 일부입니다."
    L.DESC_NAMEPLATE_DISTANCE = "이름표가 여전히 표시되는 최대 거리. dll은 이 값을 매 프레임 클라이언트의 거리 값과 비교하고 41..100으로 제한한 뒤 다시 그리도록 표시합니다. 내장 프로필(scope=4)의 일부입니다."
    L.DESC_INTERACTION_MODE = "0은 모든 방향에서 20야드 안에서 가장 가까운 획득/사용 가능한 물체를 고르고, 1은 아래 시야 원뿔 안에서만 고릅니다. 내장 프로필(interact)의 일부입니다."
    L.DESC_INTERACTION_ANGLE = "원뿔 모드에서 '/interact'가 사용하는 시야 원뿔의 전체 각도. dll은 15..160도로 제한합니다. 내장 프로필(interact)의 일부입니다."

    -- Дистанция до плейтов / цели / фокуса (AWDistance.lua читает эти строки, числа -- в его CLAMPS)
    L.CATEGORY_DISTANCE = "거리"

    L.CVAR_LABEL_DISTANCE_DISPLAY = "거리 표시"

    L.DESC_DISTANCE_DISPLAY = "거리 라벨의 주 스위치입니다. 0이면 dll은 계산도 공개도 하지 않고 AWDistance.lua도 아무것도 그리지 않습니다. 내장 프로필(distance)의 일부입니다."

    L.AW_OFF = "— 이 빌드가 등록하지 않은 변수 (%s)"
    L.DESC_CAMERA_INDIRECT_VISIBILITY = "카메라가 지형지물에 막히지 않고 통과할 수 있게 합니다."
    L.DESC_CAMERA_INDIRECT_ALPHA = "카메라와 캐릭터 사이를 가리는 물체의 투명도를 설정합니다."

	-- CVar 모드 옵션

	L.MODE_LABEL_PLAYER_RADIUS = "플레이어 반경 20yd"
	L.MODE_LABEL_CONE_ANGLE = "20yd 내 원뿔 각도(도)"

end