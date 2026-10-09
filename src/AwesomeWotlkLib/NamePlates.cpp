#include "NamePlates.h"
#include "GameClient.h"
#include "Hooks.h"
#include "Settings.h"
#include "Probe.h"
#include <Windows.h>
#include <Detours/detours.h>
#include <algorithm>
#include <vector>
#include <cstring>
#define NAME_PLATE_CREATED "NAME_PLATE_CREATED"
#define NAME_PLATE_UNIT_ADDED "NAME_PLATE_UNIT_ADDED"
#define NAME_PLATE_UNIT_REMOVED "NAME_PLATE_UNIT_REMOVED"

using NamePlateFlags = uint32_t;
enum NamePlateFlag_ {
    NamePlateFlag_Null = 0,
    NamePlateFlag_Created = (1 << 0),
    NamePlateFlag_Visible = (1 << 1),
    NamePlateFlag_CreatedAndVisible = NamePlateFlag_Created | NamePlateFlag_Visible,
};

struct NamePlateEntry {
    NamePlateEntry() : nameplate(NULL), guid(0), flags(NamePlateFlag_Null), updateId(0),
        distance(-1.f), distancePushed(-1.f) {}
    Frame* nameplate;
    guid_t guid;
    NamePlateFlags flags;
    uint32_t updateId;
    // Ярды до игрока, посчитанные в текущем скрипт-апдейте. Значимо только когда updateId совпадает с
    // vars.updateId: для протухшей строки здесь лежит число прошлого кадра.
    float distance;
    // Что сейчас стоит в AW_NamePlateDistances под этим токеном, -1 = nil. Нужно, чтобы не писать в Lua
    // каждое кадр одно и то же число и чтобы убрать значение, когда плейт умер или тумблер выключили.
    float distancePushed;
};

struct NamePlateVars {
    NamePlateVars() : updateId(1) {}
    std::vector<NamePlateEntry> nameplates;
    uint32_t updateId;
};

static Console::CVar* s_cvar_nameplateDistance;

// No metatable and no __gc here, on purpose. A __gc is a lua_CFunction, i.e. it stores a pointer INTO our
// dll inside the client's Lua state, and the client validates such pointers against the image range before
// calling them: measured 29.09 19:39, the client closed the state on exit and asserted
// "ERROR #134 Invalid function pointer: 704E34B0", which the map resolves to this very __gc. Upstream
// answers that assert by widening the allowed range (globals 0x00D415B8/BC) -- and that widening is what
// the server drops the session (same profile, same patch, globals stock: 12 minutes in-world with no session break).
// So the fix is not to widen the range but to keep our pointers out of the client's state. One
// NamePlateVars (~1 KB) is then left behind per Lua state instead of being finalised; the userdata itself
// is Lua-owned and freed with the state.
static NamePlateVars& lua_findorcreatevars(lua_State* L)
{
    NamePlateVars* result = NULL;
    lua_getfield(L, LUA_REGISTRYINDEX, "nameplatevars"); // vars
    if (lua_isuserdata(L, -1))
        result = *(NamePlateVars**)lua_touserdata(L, -1);
    lua_pop(L, 1);

    if (!result) {
        result = new NamePlateVars();
        // A 4-byte Lua block that only holds our pointer: no metatable, no __gc, so nothing in the client's
        // state names an address inside this dll.
        *(NamePlateVars**)lua_newuserdata(L, sizeof(void*)) = result; // vars
        lua_setfield(L, LUA_REGISTRYINDEX, "nameplatevars");
    }
    return *result;
}

static guid_t getTokenGuid(int id)
{
    // Эти два геттера зовёт резолвер токенов клиента, а он работает и в те моменты, когда Lua-состояния
    // ещё/уже нет (загрузка, /reload, выход в меню). Без проверки указателя первый же такой вызов читал
    // бы по нулевому адресу внутри чужого кода, где SEH у нас нет.
    lua_State* L = GetLuaState();
    if (!L) return 0;
    NamePlateVars& vars = lua_findorcreatevars(L);
    if (id < 0 || size_t(id) >= vars.nameplates.size())
        return 0;
    return vars.nameplates[id].guid;
}

static int getTokenId(guid_t guid)
{
    if (!guid) return -1;
    lua_State* L = GetLuaState();
    if (!L) return -1;
    NamePlateVars& vars = lua_findorcreatevars(L);
    for (size_t i = 0; i < vars.nameplates.size(); i++) {
        NamePlateEntry& entry = vars.nameplates[i];
        if ((entry.flags & NamePlateFlag_CreatedAndVisible) == NamePlateFlag_CreatedAndVisible && entry.guid == guid)
            return i;
    }
    return -1;
}

// nameplateDistance without a handler. A Console::CVar stores a Handler_t -- a pointer into our dll -- and
// the client validates function pointers before calling them (measured 29.09 21:18 with C_NamePlate:
// ERROR #134 "Invalid function pointer"). Upstream answers by widening the allowed range, which is the
// measured session-break cause. So register the CVar with NO handler and read its own value back every frame:
// CVar::vStr is plain data, and applying it is our job, not a callback the client has to call into us for.
static char s_lastDistance[64];   // our own copy of the string we applied, not the client's pointer
static float s_wantDistance;      // what 0x00ADAA7C must hold while that string stands
static long s_distanceRepairs;    // how often we found the float written by someone else

static void applyNameplateDistance()
{
    // Указатель уже получен на registerCVar ( см. s_cvar_nameplateDistance ниже по файлу), поэтому
    // FindCVar здесь только страховка: искать переменную по имени в консоли каждый скрипт-апдейт незачем.
    Console::CVar* cvar = s_cvar_nameplateDistance
        ? s_cvar_nameplateDistance : (s_cvar_nameplateDistance = Console::FindCVar("nameplateDistance"));
    if (!cvar || !cvar->vStr) return;
    double f = atof(cvar->vStr);
    // Вилка 41..100 -- как в форке (и как у ползунка AwesomeCVar). Раньше проходило любое положительное
    // число; теперь 200 даст 100, и это видно в той же строке лога.
    if (f < 41.) f = 41.;
    if (f > 100.) f = 100.;
    float want = (float)(f * f);

    // Снимок сравнивается через Console::snapshotChanged (см. GameClient.h): обрезанный снимок против полной
    // строки клиента не совпадал никогда, то есть дальность переписывалась и флаг перерисовки мира
    // поднимался каждый скрипт-апдейт, а ветка «кто-то другой писал наш float» не работала вовсе.
    if (Console::snapshotChanged(s_lastDistance, cvar->vStr)) {
        s_wantDistance = want;
        *(float*)0x00ADAA7C = want;
        // Форк после смены дальности поднимает флаг перерисовки мира (WorldFrame+0xB10 |= 1), иначе новый
        // радиус применяется только со следующим изменением сцены.
        if (WorldFrame* wf = GetWorldFrame()) *(DWORD*)((char*)wf + 0xB10) |= 1;
        Probe::log("cvar: 'nameplateDistance' = \"%s\" -> %g (handler=%08X)", cvar->vStr, f, (unsigned)(size_t)cvar->handler);
    } else if (*(float*)0x00ADAA7C != s_wantDistance) {
        // Same string, different float: something else wrote our address. Whether that ever happens is
        // exactly what the counter measures (0x00ADAA7C is a float we took over for the feature, and
        // disassembling Wow.exe is off limits), so this both repairs and reports instead of drifting.
        *(float*)0x00ADAA7C = s_wantDistance;
        s_distanceRepairs++;
    }
}

// --- ярды до плейтов / цели / фокуса (то же, что рисует chuzhoy rangeview.dll) ---
// Один тумблер, прочитанный обратно строкой каждый скрипт-апдейт. Свой handler ставить нельзя: CVar хранит
// Handler_t, то есть указатель внутрь этой dll в таблице клиента, и клиент перед вызовом проверяет его по
// диапазону имиджа -> ERROR #134 (см. applyNameplateDistance). Один strcmp -- вся цена настроек.
// Всё остальное (показывать ли плейте игроков/НПС/цель/фокус, шрифт, цвет, привязка, смещения, десятые,
// предел дальности) живёт в AWDistanceDB и в окне AwesomeCVar: dll обязана знать только «считать ли ярды
// вообще», а не внешний вид цифр.
static Console::CVar* s_cvar_distMaster;

static char s_distLast[16];
static bool s_distOn;

static void readDistanceSwitches()
{
    const char* vStr = s_cvar_distMaster ? s_cvar_distMaster->vStr : NULL;   // до ensureCustomCVars её ещё нет
    if (!Console::snapshotChanged(s_distLast, vStr)) return;
    s_distOn = atof(vStr) >= 0.5;
}

// C_NamePlate without a single C function pointer. The client validates function pointers before calling
// them and kills the process with ERROR #134 when one lies outside the exe image (measured 29.09 21:18:
// "Current Addon function: GetNamePlateForUnit", pointer = RVA 0x3640 inside our dll). Upstream answers by
// widening the allowed range -- and that widening is exactly what the server drops the session. So the dll publishes
// PLAIN DATA here (token -> plate frame, guid -> token, array of frames) and a Lua file defines the
// functions over it; Lua closures carry no C pointer, so there is nothing for the validator to reject.
static void plateSetMapEntry(lua_State* L, const char* table, const char* key, Frame* frame)
{
    lua_getglobal(L, table); // tbl
    // Строго «это таблица», а не «это не nil»: lua_setfield по не-таблице -- это ошибка внутри Lua,
    // а мы здесь не внутри pcall, а внутри C-колбэка из скрипт-апдейта клиента. Lua в таком случае
    // уходит longjmp'ом мимо нашего кадра стека, и для игрока это не сообщение в чат, а закрывшийся
    // клиент. Глобал с нашим именем может перезаписать любой чужой аддон (например числом или строкой),
    // поэтому проверка обязана быть по типу.
    if (!lua_istable(L, -1)) { lua_pop(L, 1); return; } // API ещё не открыт в этом state (или глобал занят чужим значением)
    if (frame) lua_pushframe(L, frame); // tbl, value
    else lua_pushnil(L);                // tbl, nil
    lua_setfield(L, -2, key); // tbl[key] = value
    lua_pop(L, 1); // tbl
}

static void plateGuidKey(guid_t guid, char* out)
{
    out[0] = 0;
    ObjectMgr::Guid2HexString(guid, out);
    // Guid2HexString answers "0xF130…" while UnitGUID() answers the same with a prefix too, but the shim
    // strips it on its side -- so strip here as well and the two ends cannot disagree about a key format.
    if (out[0] == '0' && (out[1] == 'x' || out[1] == 'X'))
        memmove(out, out + 2, strlen(out + 2) + 1);
}

static void plateSetMapString(lua_State* L, const char* table, const char* key, const char* value)
{
    lua_getglobal(L, table); // tbl
    if (!lua_istable(L, -1)) { lua_pop(L, 1); return; } // см. plateSetMapEntry: проверка по типу, не по nil
    if (value) lua_pushstring(L, value); // tbl, value
    else lua_pushnil(L);                 // tbl, nil
    lua_setfield(L, -2, key); // tbl[key] = value
    lua_pop(L, 1); // tbl
}

// То же, что plateSetMapEntry, только числом: AW_NamePlateDistances["nameplate7"] = ярды. Метатables,
// __gc и C-замыканий тут намеренно нет -- только данные (см. комментарий над plateSetMapEntry).
static void plateSetNumber(lua_State* L, const char* table, const char* key, const float* value)
{
    lua_getglobal(L, table); // tbl
    if (!lua_istable(L, -1)) { lua_pop(L, 1); return; } // см. plateSetMapEntry: проверка по типу, не по nil
    if (value) lua_pushnumber(L, *value); // tbl, value
    else lua_pushnil(L);                  // tbl, nil
    lua_setfield(L, -2, key); // tbl[key] = value
    lua_pop(L, 1); // tbl
}

static void platePublish(lua_State* L, const char* token, guid_t guid, Frame* frame)
{
    plateSetMapEntry(L, "AW_NamePlates", token, frame);
    char guidKey[24] = { 0 };
    if (guid) {
        plateGuidKey(guid, guidKey);
        plateSetMapEntry(L, "AW_NamePlateGuids", guidKey, frame);
        // Обратная связь guid -> токен. В форке это C_NamePlate.GetNamePlateTokenByGUID, реализованный
        // C-функцией; у та же связка просто ещё одна строка в данных, а функцию пишет Lua-shim.
        plateSetMapString(L, "AW_NamePlateTokens", guidKey, token);
    }
}

static void plateUnpublish(lua_State* L, const char* token, guid_t guid)
{
    plateSetMapEntry(L, "AW_NamePlates", token, NULL);
    char guidKey[24] = { 0 };
    if (guid) {
        plateGuidKey(guid, guidKey);
        plateSetMapEntry(L, "AW_NamePlateGuids", guidKey, NULL);
        plateSetMapString(L, "AW_NamePlateTokens", guidKey, NULL);
    }
}

// Одна запись в AW_NamePlateDistances на токен, и только когда число сдвинулось заметнее, чем видно по
// формату "%.1f": 20 плейтов на 60 fps иначе дают 1200 записей в секунду ради тех же самых цифр.
// want < 0 значит «метки быть не должно» -- тем же путём убираем значение, когда плейт умер, токен
// ушёл в grace-окно или тумблер выключили.
static void platePushDistance(lua_State* L, NamePlateEntry& entry, const char* token, bool show)
{
    const float want = (show && entry.distance >= 0.f) ? entry.distance : -1.f;
    if (want < 0.f && entry.distancePushed < 0.f) return;
    if (want >= 0.f && entry.distancePushed >= 0.f) {
        const float d = want - entry.distancePushed;
        if (d < 0.f ? -d < 0.05f : d < 0.05f) return;
    }
    plateSetNumber(L, "AW_NamePlateDistances", token, want >= 0.f ? &want : NULL);
    entry.distancePushed = want;
}

// Цель и фокус -- тот же путь «имя юнита -> guid -> объект -> позиция», что уже стоит в /interact
// (Interact.cpp). slot хранит то, что напечатано в AW_UnitDistances (-1 = nil), чтобы не писать каждое
// кадр одно и то же.
static float s_distPushedUnit[2] = { -1.f, -1.f };   // [0] target, [1] focus
static bool s_unresolvedLogged[2];

// Публичный резолвер (0x0060C1C0) на НЕразрешающийся токен отвечает не нулём: замер 30.09 00:20:35 дал
// 0xFFFFFFFFFFFFFFFE, и объект по такому «guid» клиент всё равно находит. Владелец поймал следствие 04.10
// 15:5x -- цифра дистанции при пустом фокусе. Решение «юнит есть» остаётся за клиентом (AWDistance.lua
// смотрит UnitExists), а здесь мы просто не печатаем заведомо неразрешённое значение и один раз пишем в
// журнал, что именно пришло, чтобы следующий прогон отвечал на этот вопрос фактом, а не догадкой.
static const guid_t s_guidUnresolved[] = { 0xFFFFFFFFFFFFFFFFULL, 0xFFFFFFFFFFFFFFFEULL };

static bool guidResolved(guid_t guid)
{
    if (!guid) return false;
    for (guid_t bad : s_guidUnresolved) if (guid == bad) return false;
    return true;
}

static void pushUnitDistance(lua_State* L, VecXYZ* posPlayer, const char* unit, bool want, int slot)
{
    float* pushed = &s_distPushedUnit[slot];
    float dist = -1.f;
    if (want && posPlayer) {
        guid_t guid = ObjectMgr::GetGuidByUnitID(unit);
        if (guidResolved(guid)) {
            if (Unit* obj = (Unit*)ObjectMgr::Get(guid, ObjectFlags_Unit)) {
                VecXYZ pos;
                obj->vmt->GetPosition(obj, &pos);
                dist = posPlayer->distance(pos);
            }
        } else if (guid && !s_unresolvedLogged[slot]) {
            s_unresolvedLogged[slot] = true;
            Probe::log("distance: %s не резолвится, резолвер ответил %016llX -- число не печатается",
                unit, (unsigned long long)guid);
        }
    }
    if (dist >= 0.f && *pushed >= 0.f) {
        const float d = dist - *pushed;
        if (d < 0.f ? -d < 0.05f : d < 0.05f) return;
    }
    if (dist < 0.f && *pushed < 0.f) return;
    plateSetNumber(L, "AW_UnitDistances", unit, dist >= 0.f ? &dist : NULL);
    *pushed = dist;
}

// Rebuilt only when the set of visible plates changes, never per frame: GetNamePlates() copies this array.
static void plateRebuildList(lua_State* L, NamePlateVars& vars)
{
    lua_newtable(L); // list
    int n = 1;
    for (NamePlateEntry& entry : vars.nameplates) {
        if ((entry.flags & NamePlateFlag_CreatedAndVisible) != NamePlateFlag_CreatedAndVisible || !entry.guid)
            continue;
        lua_pushframe(L, entry.nameplate); // list, frame
        lua_rawseti(L, -2, n++); // list
    }
    lua_setglobal(L, "AW_NamePlateList"); // (empty stack)
}

// Один глобал = одна таблица данных. Если под нашим именем лежит не таблица (чужой аддон или остаток
// прошлой сессии), заводим таблицу заново: иначе все публикации молча уходят в никуда до перезахода,
// потому что plateSetMapEntry по типу откажется писать.
static void ensureGlobalTable(lua_State* L, const char* name)
{
    lua_getglobal(L, name);
    const bool ok = lua_istable(L, -1);
    lua_pop(L, 1);
    if (ok) return;
    lua_newtable(L);
    lua_setglobal(L, name);
}

static int lua_openlibnameplates(lua_State* L)
{
    ensureGlobalTable(L, "AW_NamePlates");
    ensureGlobalTable(L, "AW_NamePlateGuids");
    ensureGlobalTable(L, "AW_NamePlateTokens");
    ensureGlobalTable(L, "AW_NamePlateList");
    // Дистанции. Обе таблицы существуют только в профиле с distance=true: для Lua отсутствие globals и
    // есть сигнал «dll без этой функции», тогда AWDistance.lua молчит и ничего не рисует.
    if (S().distance) {
        ensureGlobalTable(L, "AW_NamePlateDistances");
        ensureGlobalTable(L, "AW_UnitDistances");
    }
    return 0;
}

// Autonomous proof written to Logs\aw_probe.log from the main thread: how many plates we see, whether our
// own probe through the client's wrapper reaches the patched site, and who else ever arrives there.
static void plateSelfTest(NamePlateVars& vars) {
    static DWORD lastTest = 0;
    static guid_t lastGuid = 0;
    DWORD now = GetTickCount();
    if (lastTest && now - lastTest < 15000) return;
    lastTest = now;

    size_t visible = 0, free = 0;
    for (NamePlateEntry& e : vars.nameplates) {
        if (!e.nameplate) { free++; continue; }
        if ((e.flags & NamePlateFlag_CreatedAndVisible) == NamePlateFlag_CreatedAndVisible && e.guid) visible++;
    }

    Hooks::beginSelfProbe("nameplate1", "[OURS: our C++ probe via the wrapper]");
    guid_t g = ObjectMgr::GetGuidByUnitID("nameplate1");
    const long siteHits = Hooks::endSelfProbe();
    // What this line does and does not prove: our own call goes through the public wrapper (0x0060C1C0),
    // but the c1c0 run established that the Lua route goes around that wrapper and enters the resolver
    // directly. So YES only says "the site is on the wrapper's route"; the Lua route is judged by the
    // `tail traffic` / `[EXTERNAL]` lines below, not by this one.
    // Хвост 0x0060AD4B ставится только при tokenSite=2 (Entry.cpp). При tokenSite=0 эти две строки
    // в журнале -- не «ещё один ноль», а ложное показание: они измеряют площадку, которой в этом профиле
    // нет, и «tail path: NO» читается как сломанный резолв. Журнал -- единственный след dll, поэтому
    // молчим, пока площадка не стоит.
    if (S().tokenSite != 0) {
	    static bool pathReported = false;
	    if (!pathReported) {
	        pathReported = true;
	        Probe::log("tail path: our probe reached the site %s (arrivals=%ld)",
	                   siteHits ? "YES" : "NO -- 0x0060AD4B is off the wrapper's route", siteHits);
	    }
	    // Once a minute: arrivals vs matched separates "nobody external ever gets here" (placement wrong)
	    // from "the site is live, but external asks carry tokens we don't own" (recognition wrong).
	    static int trafficTick = 0;
	    if (++trafficTick % 4 == 0) {
	        long arrivals = 0, matched = 0, external = 0, overlap = 0, depth = 0, wd = 0;
	        Hooks::tailStats(&arrivals, &matched, &external, &overlap, &depth, &wd);
	        Probe::log("tail traffic: arrivals=%ld matched=%ld external=%ld overlap=%ld depth=%ld wd=%ld  selftest-samples=%d",
	                   arrivals, matched, external, overlap, depth, wd, trafficTick);
	    }
    }
    char hex[24] = { 0 };
    if (g) ObjectMgr::Guid2HexString(g, hex);
    // Two different questions, so two columns. `ours` is what our own table holds for index 0; the wrapper
    // value is what the client answers, and for an unresolved token it is NOT 0 -- measured 30.09 00:20:35
    // (t+1110s, plates_visible=13 free=5): 0xFFFFFFFFFFFFFFFE. Printing only the wrapper value made a
    // perfectly normal "no plate under this number right now" look like a corrupt guid.
    guid_t ours = getTokenGuid(0);
    char hexOurs[24] = { 0 };
    if (ours) ObjectMgr::Guid2HexString(ours, hexOurs);
    if (g || visible)
        Probe::log("selftest: plates_visible=%u slots=%u free=%u dist_repairs=%ld  nameplate1 ours=%s  client-wrapper=%s%s",
            (unsigned)visible, (unsigned)vars.nameplates.size(), (unsigned)free, s_distanceRepairs,
            ours ? hexOurs : "<нет плейта под этим номером>",
            g ? hex : "<не резолвится>",
            (ours && lastGuid && ours != lastGuid) ? "  (под номером теперь другой плейт)" : "");
    lastGuid = ours;
}

// A token keeps its number for this many script updates after its plate stops being enumerated.
static const uint32_t s_tokenGraceFrames = 3;


static void onUpdateCallback()
{
    static std::vector<std::tuple<Frame*, guid_t, float>> s_plateSort;

    readDistanceSwitches();
    const bool distWanted = s_distOn;

    if (!IsInWorld()) {
        // Вышли из мира: метки цели/фокуса должны погаснуть, а не остаться с числом последнего кадра.
        // Плейты чистятся сами (токены публикуются только в мире), Lua прячет их по отсутствию токена.
        lua_State* L = GetLuaState();
        if (L) {
            if (distWanted) {
                pushUnitDistance(L, NULL, "target", false, 0);
                pushUnitDistance(L, NULL, "focus", false, 1);
            }
        }
        return;
    }


    lua_State* L = GetLuaState();
    // Ветка «не в мире» выше уже проверяет указатель; здесь он так же обязателен -- состояние пересоздаётся
    // на каждом /reload и при переходе меню<->игра, и попасть сюда без него можно.
    if (!L) return;
    NamePlateVars& vars = lua_findorcreatevars(L);

    Player* player = ObjectMgr::GetPlayer();
    VecXYZ posPlayer;
    if (player) player->ToUnit()->vmt->GetPosition(player->ToUnit(), &posPlayer);

    // Имя юнита разлинуется не в том же кадре, в котором появляется плейт; форк такие плейты не
    // объявляет, иначе на кадр-два в фрейме мелькает «Unknown Being». Строку берём один раз за кадр.
    // Ключ namegate: без него поведение ровно то, что уже измерено 30.09 (плейт объявляется сразу).
    const char* unknownName = S().namegate ? FrameScript::GetText("UNKNOWNOBJECT", -1, 0) : NULL;

    ObjectMgr::EnumObjects([&vars, player, &posPlayer, unknownName, distWanted](guid_t guid) -> bool {
        Unit* unit = (Unit*)ObjectMgr::Get(guid, ObjectFlags_Unit);
        if (!unit || !unit->nameplate) return true;
        if (unknownName) {
            const char* name = unit->GetName(NULL, 1);
            if (name && (!strcmp(name, "Unknown Being") || (unknownName && *unknownName && !strcmp(name, unknownName))))
                return true;   // имя придёт в следующем кадре -- тогда и объявим плейт
        }
        auto it = std::find_if(vars.nameplates.begin(), vars.nameplates.end(), [nameplate = unit->nameplate](const NamePlateEntry& entry) {
            return entry.nameplate == nameplate;
        });
        // Одна позиция на плейт за кадр: она нужна и сортировке, и публикуемым ярдам. Считаем до того, как
        // узнаем, новый это токен или уже записанный, -- дальше оба поля заполняются одним значением.
        float dist = -1.f;
        if (player && (S().sort || distWanted)) {
            VecXYZ unitPos;
            unit->vmt->GetPosition(unit, &unitPos);
            dist = posPlayer.distance(unitPos);
        }
        if (it == vars.nameplates.end()) {
            // A token belongs to a plate for the plate's whole lifetime. Take the lowest freed slot instead
            // of appending: renumbering the live plates is what made WeakAuras icons jump when a plate
            // appeared or disappeared (the aura was anchored to "nameplate5", which after a shift is a
            // different unit). Reusing a freed slot also means a plate that flickers out for one frame
            // usually comes back with its own number.
            NamePlateEntry* slot = NULL;
            for (NamePlateEntry& e : vars.nameplates)
                if (!e.nameplate) { slot = &e; break; }
            NamePlateEntry& entry = slot ? *slot : vars.nameplates.emplace_back();
            entry.guid = guid;
            entry.nameplate = unit->nameplate;
            entry.flags = NamePlateFlag_Null;   // same as a fresh entry: CREATED/ADDED must fire again
            entry.updateId = vars.updateId;
            entry.distance = dist;
        } else {
            if (it->guid != guid) {
                // FIXME: potential problem with silent changing real unit
                it->guid = guid;
            }
            it->updateId = vars.updateId;
            it->distance = dist;
        }

        if (dist >= 0.f && S().sort)
            s_plateSort.push_back({ unit->nameplate, guid, dist });

        return true;
    });

    if (S().sort && !s_plateSort.empty()) {
        std::sort(s_plateSort.begin(), s_plateSort.end(), [targetGuid = ObjectMgr::GetTargetGuid()](auto& a1, auto& a2) {
            auto& [frame1, guid1, distance1] = a1;
            auto& [frame2, guid2, distance2] = a2;
            if (guid1 == targetGuid) return false;
            if (guid2 == targetGuid) return true;
            return distance1 > distance2;
        });

        int level = 10;
        for (auto& entry : s_plateSort)
            CFrame::SetFrameLevel(std::get<0>(entry), level++, 1);

        s_plateSort.clear();
    }

    // Дистанции -- своим проходом и до работы с флагами: у прохода нет continue-путей, и он обязан увидеть
    // и слот в grace-окне (его метка гаснет, хотя токен ещё жив), и уже освобождённый. Кадр, в котором
    // токен только что опубликован, здесь ещё без Visible -- метка появляется на следующий кадр, что
    // незаметно на перерисовке в 0.1 с.
    // Выключенный тумблер НЕ имеет права пропускать проход: написанное в Lua раньше остаётся, и метки
    // зависают последними числами (замер владельца 04.10 21:1x). Проход идёт всегда, а show=false гасит
    // значение тем же путём, что смерть плейта; platePushDistance на уже погашенном слоте выходит по
    // первой же строке, так что лишней записи в кадр нет.
    for (size_t i = 0; i < vars.nameplates.size(); i++) {
        NamePlateEntry& entry = vars.nameplates[i];
        if (!entry.nameplate && entry.distancePushed < 0.f) continue;   // мёртвый слот: писать нечего
        char token[16];
        snprintf(token, std::size(token), "nameplate%d", i + 1);
        platePushDistance(L, entry, token,
            distWanted && entry.updateId == vars.updateId && (entry.flags & NamePlateFlag_Visible) != 0);
    }

    bool changed = false;
    for (size_t i = 0; i < vars.nameplates.size(); i++) {
        NamePlateEntry& entry = vars.nameplates[i];
        if (entry.updateId == vars.updateId) {
            if (!(entry.flags & NamePlateFlag_Created)) {
                // GetEventIdByName() gives -1 while the event is not registered (scope < 3), and
                // firing event id -1 walks off the client's event table.
                int createdId = FrameScript::GetEventIdByName(NAME_PLATE_CREATED);
                if (createdId >= 0) {
                    lua_pushstring(L, NAME_PLATE_CREATED); // tbl, event
                    lua_pushframe(L, entry.nameplate); // tbl,  event, frame
                    FrameScript::FireEvent_inner(createdId, L, 2); // tbl
                    lua_pop(L, 2);
                }
                entry.flags |= NamePlateFlag_Created;
            }

            if (!(entry.flags & NamePlateFlag_Visible)) {
                entry.flags |= NamePlateFlag_Visible;
                char token[16];
                snprintf(token, std::size(token), "nameplate%d", i + 1);
                // Publish before the event: FireEvent_inner dispatches to Lua handlers right here, on the
                // arguments still on this stack, so a handler that resolves its own token
                // (C_NamePlate.GetNamePlateForUnit) would otherwise see nil during its own ADDED. Measured
                // in the client as ElvUI_ProjectZidras Nameplates.lua:470 "index upvalue 'plate' (a nil
                // value)" -- and the same nil made iTargetingFrames skip its ADDED-time refill.
                platePublish(L, token, entry.guid, entry.nameplate);
                FrameScript::FireEvent(NAME_PLATE_UNIT_ADDED, "%s", token);
                changed = true;
            }
        } else {
            if (!entry.nameplate) continue;   // slot was already freed; its token died with the plate
            // Hold the token for a few frames before releasing it. EnumObjects culls plates that are
            // momentarily not drawn (camera turn, fade distance), and releasing at once means two plates
            // that blink in the same frame come back with swapped numbers -- exactly the icon hop reported
            // in WeakAuras. A plate that really dies is forgotten 3 script updates later.
            if (vars.updateId - entry.updateId < s_tokenGraceFrames) continue;
            if (entry.flags & NamePlateFlag_Visible) {
                char token[16];
                snprintf(token, std::size(token), "nameplate%d", i + 1);
                FrameScript::FireEvent(NAME_PLATE_UNIT_REMOVED, "%s", token);
                plateUnpublish(L, token, entry.guid);
                changed = true;
            }
            entry.nameplate = NULL;
            entry.guid = 0;
            entry.flags = NamePlateFlag_Null;
        }
    }

    if (S().scope >= 4) applyNameplateDistance();

    if (player) {
        // тем же проходом гасим написанное, когда тумблер снят (см. комментарий у прохода плейтов)
        pushUnitDistance(L, &posPlayer, "target", distWanted, 0);
        pushUnitDistance(L, &posPlayer, "focus", distWanted, 1);
    }

    // The array is what C_NamePlate.GetNamePlates() copies; rebuilding it only on a real change keeps the
    // per-frame cost at "one bool test", which matters because this runs inside the script update.
    if (changed) plateRebuildList(L, vars);

    vars.updateId++;
    plateSelfTest(vars);
}

LPVOID PatchNamePlateLevelUpdate_orig = (LPVOID)0x0098E9F9;
void __declspec(naked) PatchNamePlateLevelUpdate_hk()
{
    __asm {
        push edi;
        push 0x0098EA27;
        ret;
    }
}

void NamePlates::initialize()
{
    if (S().scope >= 2)
        Hooks::FrameXML::registerLuaLib(lua_openlibnameplates);
    if (S().scope >= 3) {
        Hooks::FrameXML::registerEvent(NAME_PLATE_CREATED);
        Hooks::FrameXML::registerEvent(NAME_PLATE_UNIT_ADDED);
        Hooks::FrameXML::registerEvent(NAME_PLATE_UNIT_REMOVED);
    }
    if (S().scope >= 4)
        // No handler on purpose -- see applyNameplateDistance(): a handler would be a pointer into this dll
        // stored in the client's CVar table, and that is what ERROR #134 rejects.
        Hooks::FrameXML::registerCVar(&s_cvar_nameplateDistance, "nameplateDistance", NULL, (Console::CVarFlags)1, "43", NULL);
    if (S().distance) {
        // NULL handler -- по той же причине, что и у nameplateDistance: handler хранил бы указатель в эту
        // dll внутри таблицы CVar клиента, и клиент перед вызовом проверяет его по диапазону имиджа -> #134.
        // Одна переменная: dll обязана знать только «считать ли ярды». Как они выглядят (показывать ли
        // игрокам/НПС/цели/фокусу, шрифт, контур, цвет, привязка, смещения, десятые, предел дальности) --
        // AWDistanceDB и вкладка Distance окна AwesomeCVar; одиннадцать строк раскладки, что стояли здесь
        // раньше, убраны, потому что настройка не может жить в двух местах сразу.
        Hooks::FrameXML::registerCVar(&s_cvar_distMaster, "distanceDisplay", NULL, (Console::CVarFlags)1, "0", NULL);
    }
    if (S().scope >= 1) {
        Hooks::FrameScript::registerToken("nameplate", getTokenGuid, getTokenId);
        Hooks::FrameScript::registerOnUpdate(onUpdateCallback);
    }

    if (S().sort && S().scope >= 1)
        // Gated by scope like everything else: the built-in defaults promise that scope=0 patches nothing,
        // and a profile with sort=true and no scope must not break that promise.
        DetourAttach(&(LPVOID&)PatchNamePlateLevelUpdate_orig, PatchNamePlateLevelUpdate_hk);
}