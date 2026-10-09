-- File: zhTW.lua
-- Language: Traditional Chinese
local _, AwesomeCVar = ...

if not AwesomeCVar.L then
    AwesomeCVar.L = {}
end

local L = AwesomeCVar.L

if GetLocale() == "zhTW" then
    -- 常規
    L.ADDON_NAME = "AwesomeCVar"
    L.ADDON_NAME_SHORT = "Awesome CVar"
    L.MAIN_FRAME_TITLE = "Awesome CVar 管理器"
    L.RESET_TO = "重設為 %s"
	L.MINIMAP_ICON = "小地圖圖示"
	L.MINIMAP_TOOLTIP = "點擊開啟\n拖曳移動"
	L.GAME_MENU_BUTTON = "遊戲選單按鈕"
	L.OPEN_ADDON = "開啟 AwesomeCVar"

    -- 彈出視窗
    L.RELOAD_POPUP_TITLE = "需要重新載入介面"
    L.RELOAD_POPUP_TEXT = "你所做的一項或多項修改需要重新載入介面 (ReloadUI) 才能生效。"
    L.RESET_POPUP_TITLE = "確認重設預設值"
    L.RESET_POPUP_TEXT = "你確定要將所有數值重設回預設設定嗎？"

    -- 聊天訊息
    L.MSG_LOADED = "Awesome CVar 已載入！輸入 /awesome 打開管理器。"
    L.MSG_FRAME_RESET = "框架位置已重設至螢幕中心。"
    L.MSG_SET_VALUE = "已將 %s 設置為 %s。"
    L.MSG_UNKNOWN_COMMAND = "未知指令。輸入 /awesome help 查看可用指令。"
    L.MSG_HELP_HEADER = "Awesome CVar 指令列表:"
    L.MSG_HELP_TOGGLE = "/awesome - 切換顯示/隱藏管理器"
    L.MSG_HELP_SHOW = "/awesome show - 顯示管理器"
    L.MSG_HELP_HIDE = "/awesome hide - 隱藏管理器"
    L.MSG_HELP_RESET = "/awesome reset - 重設框架位置到中心"
    L.MSG_HELP_HELP = "/awesome help - 顯示此幫助訊息"

    -- CVar 分類
    L.CATEGORY_CAMERA = "鏡頭"
    L.CATEGORY_NAMEPLATES = "姓名板"
    L.CATEGORY_INTERACTION = "互動"

    -- CVar 標籤與描述
    L.CVAR_LABEL_INFO = "備註"
    L.CVAR_LABEL_CAMERA_FOV = "鏡頭視野 (FoV)"
	L.CVAR_LABEL_NAMEPLATE_DISTANCE = "姓名板顯示距離"
    L.CVAR_LABEL_INTERACTION_MODE = "互動模式"
    L.CVAR_LABEL_INTERACTION_ANGLE = "互動錐形角度 (度)"
    L.CVAR_LABEL_CAMERA_INDIRECT_VISIBILITY = "鏡頭間接可見性"
    L.CVAR_LABEL_CAMERA_INDIRECT_ALPHA = "鏡頭間接透明度"

    L.DESC_INFO = "我們的 AwesomeWotlkLib.dll 以 'nameplateN' 令牌的形式並透過 C_NamePlate 發佈姓名牌：\n- C_NamePlate.GetNamePlateTokenByGUID(guid) -> 'nameplate4' 或 nil\n\n令牌與姓名牌同生命週期：活動令牌的編號不會改變。注意：客戶端不會為這些令牌傳送 UNIT_AURA、UNIT_HEALTH 或 UNIT_SPELLCAST_* 事件，顯示類外掛必須自行輪詢（AWNamePlateAPI 和 iTargetingFrames 每 0.2 秒查詢一次）。"
    L.DESC_CAMERA_FOV = "攝影機視野範圍。100 是預設值（dll 依 value * pi / 200 弧度換算，所以 100 = 90 度）；dll 接受 1..200，這個滑桿只保留在合理的 60..150 區間。屬於內建設定（camera）。"
    L.DESC_NAMEPLATE_DISTANCE = "仍會顯示姓名牌的最大距離。dll 每幀將這個值與客戶端自身的距離參數比較，限制在 41..100，不一致時標記重繪。屬於內建設定（scope=4）。"
    L.DESC_INTERACTION_MODE = "0 在任意方向的 20 碼內選擇最近的拾取/使用目標；1 只在下方的視野錐內選擇。屬於內建設定（interact）。"
    L.DESC_INTERACTION_ANGLE = "錐狀模式下 '/interact' 使用的視野錐全角。dll 將其限制在 15..160 度。屬於內建設定（interact）。"

    -- Дистанция до плейтов / цели / фокуса (AWDistance.lua читает эти строки, числа -- в его CLAMPS)
    L.CATEGORY_DISTANCE = "距離"

    L.CVAR_LABEL_DISTANCE_DISPLAY = "顯示距離"

    L.DESC_DISTANCE_DISPLAY = "距離文字的總開關。為 0 時 dll 既不計算也不發布數值，AWDistance.lua 也不繪製任何東西。屬於內建設定（distance）。"

    L.AW_OFF = "— 本次建置未註冊該變數（%s）"
    L.DESC_CAMERA_INDIRECT_VISIBILITY = "允許鏡頭穿過某些世界物體而非被阻擋。"
    L.DESC_CAMERA_INDIRECT_ALPHA = "設置鏡頭與玩家角色之間的遮擋物透明度。"

	-- CVar 模式選項

    L.MODE_LABEL_PLAYER_RADIUS = "玩家半徑 20碼"
    L.MODE_LABEL_CONE_ANGLE = "20碼內的錐形角度 (度)"

end