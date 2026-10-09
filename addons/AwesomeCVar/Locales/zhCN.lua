-- File: zhCN.lua
-- Language: Simplified Chinese
local _, AwesomeCVar = ...

if not AwesomeCVar.L then
    AwesomeCVar.L = {}
end

local L = AwesomeCVar.L

if GetLocale() == "zhCN" then
    -- 常规
    L.ADDON_NAME = "AwesomeCVar"
    L.ADDON_NAME_SHORT = "Awesome CVar"
    L.MAIN_FRAME_TITLE = "Awesome CVar 管理器"
    L.RESET_TO = "重置为 %s"
	L.MINIMAP_ICON = "小地图图标"
	L.MINIMAP_TOOLTIP = "点击打开\n拖动移动"
	L.GAME_MENU_BUTTON = "游戏菜单按钮"
	L.OPEN_ADDON = "打开 AwesomeCVar"

    -- 弹出窗口
    L.RELOAD_POPUP_TITLE = "需要重载界面"
    L.RELOAD_POPUP_TEXT = "你所做的一项或多项修改需要重载界面 (ReloadUI) 才能生效。"
    L.RESET_POPUP_TITLE = "确认重置默认值"
    L.RESET_POPUP_TEXT = "你确定要将所有数值重置回默认设置吗？"

    -- 聊天消息
    L.MSG_LOADED = "Awesome CVar 已加载！输入 /awesome 打开管理器。"
    L.MSG_FRAME_RESET = "框架位置已重置至屏幕中心。"
    L.MSG_SET_VALUE = "已将 %s 设置为 %s。"
    L.MSG_UNKNOWN_COMMAND = "未知命令。输入 /awesome help 查看可用命令。"
    L.MSG_HELP_HEADER = "Awesome CVar 命令列表:"
    L.MSG_HELP_TOGGLE = "/awesome - 切换显示/隐藏管理器"
    L.MSG_HELP_SHOW = "/awesome show - 显示管理器"
    L.MSG_HELP_HIDE = "/awesome hide - 隐藏管理器"
    L.MSG_HELP_RESET = "/awesome reset - 重置框架位置到中心"
    L.MSG_HELP_HELP = "/awesome help - 显示此帮助信息"

    -- CVar 分类
    L.CATEGORY_CAMERA = "镜头"
    L.CATEGORY_NAMEPLATES = "姓名板"
    L.CATEGORY_INTERACTION = "交互"

    -- CVar 标签与描述
    L.CVAR_LABEL_INFO = "备注"
    L.CVAR_LABEL_CAMERA_FOV = "镜头视野 (FoV)"
	L.CVAR_LABEL_NAMEPLATE_DISTANCE = "姓名板显示距离"
    L.CVAR_LABEL_INTERACTION_MODE = "交互模式"
    L.CVAR_LABEL_INTERACTION_ANGLE = "交互锥形角度 (度)"
    L.CVAR_LABEL_CAMERA_INDIRECT_VISIBILITY = "镜头间接可见性"
    L.CVAR_LABEL_CAMERA_INDIRECT_ALPHA = "镜头间接透明度"

    L.DESC_INFO = "我们的 AwesomeWotlkLib.dll 以 'nameplateN' 令牌的形式并通过 C_NamePlate 发布姓名板：\n- C_NamePlate.GetNamePlateTokenByGUID(guid) -> 'nameplate4' 或 nil\n\n令牌与姓名板同生命周期：活动令牌的编号不会改变。注意：客户端不会为这些令牌发送 UNIT_AURA、UNIT_HEALTH 或 UNIT_SPELLCAST_* 事件，显示类插件必须自行轮询（AWNamePlateAPI 和 iTargetingFrames 每 0.2 秒查询一次）。"
    L.DESC_CAMERA_FOV = "摄像机视野范围。100 是默认值（dll 按 value * pi / 200 弧度换算，所以 100 = 90 度）；dll 接受 1..200，这个滑块只保留在合理的 60..150 区间。属于内置配置（camera）。"
    L.DESC_NAMEPLATE_DISTANCE = "仍会显示姓名板的最大距离。dll 每帧把这个值与客户端自身的距离参数比较，限制在 41..100，不一致时标记重绘。属于内置配置（scope=4）。"
    L.DESC_INTERACTION_MODE = "0 在任意方向的 20 码内选择最近的拾取/使用目标；1 只在下面的视野锥内选择。属于内置配置（interact）。"
    L.DESC_INTERACTION_ANGLE = "锥形模式下 '/interact' 使用的视野锥全角。dll 将其限制在 15..160 度。属于内置配置（interact）。"

    -- Дистанция до плейтов / цели / фокуса (AWDistance.lua читает эти строки, числа -- в его CLAMPS)
    L.CATEGORY_DISTANCE = "距离"

    L.CVAR_LABEL_DISTANCE_DISPLAY = "显示距离"

    L.DESC_DISTANCE_DISPLAY = "距离文字的总开关。为 0 时 dll 既不计算也不发布数值，AWDistance.lua 也不绘制任何东西。属于内置配置（distance）。"

    L.AW_OFF = "— 本次构建未注册该变量（%s）"
    L.DESC_CAMERA_INDIRECT_VISIBILITY = "允许镜头穿过某些世界物体而非被阻挡。"
    L.DESC_CAMERA_INDIRECT_ALPHA = "设置镜头与玩家角色之间的遮挡物透明度。"

	-- CVar 模式选项

    L.MODE_LABEL_PLAYER_RADIUS = "玩家半径 20码"
    L.MODE_LABEL_CONE_ANGLE = "20码内的锥形角度 (度)"

end