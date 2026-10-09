#include "Interact.h"
#include "GameClient.h"
#include "Hooks.h"
#include "Settings.h"
#include "Probe.h"
#include <Windows.h>
#include <cmath>
#include <cstdio>
#include <cstring>

// «Умный» interact из форка (Misc.cpp): взять ближайший подбираемый объект в радиусе 20 и, если режим
// конусный, в конусе взгляда. Из форка взята ТОЛЬКО логика выбора и исполнения; форма другая:
//
//   * форк регистрирует C-функцию как слэш-команду SlashCmdList.INTERACTCMD и как обработчик бинда.
//     Это lua_CFunction, то есть указатель на нашу dll в данных клиента -- ровно то, за что бывает
//     ERROR #134. У нас командy и бинд пишет Lua-аддон (addons/AWNamePlateAPI, файл AWInteract.lua), а dll только смотрит в
//     таблицу данных AW_Request.interact -- как с C_NamePlate и с CVar'ами без handler'ов;
//   * исполнение (OnRightClick) отделено от перечисления объектов: клик делается в следующем кадре,
//     чтобы не менять список объектов во время обхода;
//   * ни одна площадка клиента не правится: мы только вызываем его функции. Поэтому у фичи нет строк
//     в аудите адресов -- вместо них есть самопроверка смещения массива полей (см. findFieldsOffset).

namespace {

const int FIELD_GUID = 0;              // OBJECT_FIELD_GUID, два uint32
const int FIELD_TYPE = 2;              // OBJECT_FIELD_TYPE: 3 = UNIT, 5 = GAMEOBJECT (OBJECT_END = 6)
const int FIELD_GO_BYTES1 = 6 + 0x0B;  // GAMEOBJECT_BYTES_1
const int FIELD_UNIT_FLAGS = 6 + 0x35;   // UNIT_FIELD_FLAGS
const int FIELD_UNIT_DYNFLAGS = 6 + 0x49;// UNIT_DYNAMIC_FLAGS
const int FIELD_UNIT_NPCFLAGS = 6 + 0x4C;// UNIT_NPC_FLAGS

const uint32_t DYNFLAG_LOOTABLE = 0x1;
// UNIT_FIELD_FLAGS берётся из enum в GameClient.h, а не переписывается локально: прежняя локальная
// константа стоила 0x20000000, что там же описано как PREVENT_EMOTES_FROM_CHAT_TEXT, а skinnable --
// 0x04000000. На следствии это значит, что поиск брал в «шкурятся» юнитов не тех и пропускал мёртвую
// дичь без лута (для охотника/друида это ровно тот случай, ради которого фича и нужна).
const uint32_t FLAG_SKINNABLE = UNIT_FLAG_SKINNABLE;
const int TYPEID_UNIT = 3, TYPEID_GAMEOBJECT = 5;

const int VTABLE_GET_POSITION = 11, VTABLE_GET_FACING = 13, VTABLE_ON_RIGHT_CLICK = 44;

using CanUseNow_t = bool(__thiscall*)(void*);
const CanUseNow_t CanUseNow_fn = (CanUseNow_t)0x0070BA10;

const uint8_t kInteractableGoTypes[] = { 0, 1, 2, 3, 4, 7, 8, 10, 17, 19, 23, 34 };

bool isInteractableGoType(uint8_t type)
{
    for (uint8_t t : kInteractableGoTypes) if (t == type) return true;
    return false;
}

// Смещение массива полей внутри объекта. 0 = ещё не найдено, и до тех пор ни одно поле не читается.
// g_fieldsInline: false -- по смещению лежит указатель на массив; true -- сам массив.
int g_fieldsAt = 0;
bool g_fieldsInline = false;
bool s_fieldsChecked = false;

// Чтение поля = *(fields(obj) + index). Всё под SEH: смещение ищет findFieldsOffset(), и до того как
// оно найдено, любое чтение может оказаться чтением в никуда.
bool readField(void* object, int index, uint32_t* out)
{
    if (!g_fieldsAt) return false;
    __try {
        const uint32_t* f = g_fieldsInline
            ? (const uint32_t*)((const char*)object + g_fieldsAt)
            : *(const uint32_t* const*)((const char*)object + g_fieldsAt);
        if (!f) return false;
        *out = f[index];
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
    return true;
}

bool guidAtOffset(void* object, int off, guid_t* out)
{
    __try {
        uint32_t* f = *(uint32_t**)((char*)object + off);
        if (!f) return false;
        *out = (guid_t)f[0] | ((guid_t)f[1] << 32);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
    return true;
}

// Вторая модель: массив полей лежит внутри самого объекта, а не за указателем. Замер 30.09 21:34:50
// показал, что указателя на массив нет ни на одном смещении 0x40..0x200 (8 объектов), так что проверять
// надо и это.
bool guidInlineAtOffset(void* object, int off, guid_t* out)
{
    __try {
        *out = *(guid_t*)((char*)object + off);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
    return *out != 0;
}

// Первый же скан обязан доказать, где живут поля. Смещение 0x110 из форка в этом билде НЕ подтвердилось
// (замер 21:17:46: guid из массива 002E4251D52E4251 против запрошенного), поэтому не угадываем, а ищем:
// кандидат правильный, если OBJECT_FIELD_GUID по нему совпадает с guid'ом, по которому клиент сам выдал
// объект. Проверяются обе формы -- указатель на массив и массив внутри объекта.
void findFieldsOffset(void* object, guid_t asked)
{
    // Разные типы объектов могут держать поля по-разному, поэтому пробуем несколько первых: после восьми
    // неудач считаем, что метода нет.
    const int maxAttempts = 8;
    static int attempts = 0;
    if (s_fieldsChecked) return;
    attempts++;

    int ptrHit = 0, ptrOff = 0, inlineHit = 0, inlineOff = 0;
    // Диапазон до 0xC00: у CGUnit_C имяплейт лежит на 0xC38, то есть класс огромный, и указатель на
    // массив полей может сидеть далеко за 0x400. 8 объектов x ~700 чтений под SEH -- один раз за сессию.
    for (int off = 0x40; off <= 0xC00; off += 4) {
        guid_t got = 0;
        if (guidAtOffset(object, off, &got) && got == asked) { if (!ptrOff) ptrOff = off; ptrHit++; }
        if (guidInlineAtOffset(object, off, &got) && got == asked) { if (!inlineOff) inlineOff = off; inlineHit++; }
    }

    if (ptrHit == 1) {
        g_fieldsAt = ptrOff;
        g_fieldsInline = false;
        s_fieldsChecked = true;
        Probe::log("interact: поля = массив по указателю в 0x%X (guid %016llX совпал один раз, попыток %d)",
            ptrOff, (unsigned long long)asked, attempts);
        return;
    }
    if (inlineHit == 1) {
        g_fieldsAt = inlineOff;
        g_fieldsInline = true;
        s_fieldsChecked = true;
        Probe::log("interact: поля = массив внутри объекта с 0x%X (guid %016llX совпал один раз, попыток %d)",
            inlineOff, (unsigned long long)asked, attempts);
        return;
    }
    if (ptrHit > 1 || inlineHit > 1) {
        s_fieldsChecked = true;
        Probe::log("interact: совпадений несколько (указателей %d, внутренних %d) -- читать поля нельзя", ptrHit, inlineHit);
        return;
    }
    if (attempts >= maxAttempts) {
        s_fieldsChecked = true;
        Probe::log("interact: массив полей не найден ни как указатель, ни как внутреннее поле (%d объекта, 0x40..0xC00)"
            " -- фича выключена", attempts);
    }
}

float vtableFloat(void* object, int index)
{
    float v = 0.f;
    __try {
        v = ((float(__thiscall*)(void*))(*(void***)object)[index])(object);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        v = 0.f;
    }
    return v;
}

void vtableRightClick(void* object)
{
    __try {
        ((void(__thiscall*)(void*))(*(void***)object)[VTABLE_ON_RIGHT_CLICK])(object);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        Probe::log("interact: OnRightClick (vtable[%d]) упал, пропущено", VTABLE_ON_RIGHT_CLICK);
    }
}

bool canUseNow(void* object)
{
    bool ok = false;
    __try {
        ok = CanUseNow_fn(object);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        ok = false;
    }
    return ok;
}

bool objectPosition(void* object, VecXYZ* out)
{
    bool ok = true;
    __try {
        ((void(__thiscall*)(void*, VecXYZ*))(*(void***)object)[VTABLE_GET_POSITION])(object, out);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        ok = false;
    }
    return ok;
}

// --- настройки: читаем строки CVar'ов сами, handler'ов не регистрируем -------------------------------

Console::CVar* s_cvar_mode;
Console::CVar* s_cvar_angle;
char s_lastMode[16], s_lastAngle[16];
int g_mode = 1;        // 1 = смотреть только в конусе взгляда
int g_angle = 60;      // полный угол конуса, градусы

// Снимок сравнивается через Console::snapshotChanged (см. GameClient.h): сравнение полной строки клиента с
// обрезанным снимком не совпадало никогда и перезаписывало настройку каждый кадр.
void pollSettings()
{
    if (!s_cvar_mode) s_cvar_mode = Console::FindCVar("interactionMode");
    if (!s_cvar_angle) s_cvar_angle = Console::FindCVar("interactionAngle");

    if (s_cvar_mode && Console::snapshotChanged(s_lastMode, s_cvar_mode->vStr)) {
        int m = atoi(s_cvar_mode->vStr);
        g_mode = (m < 0) ? 0 : (m > 1 ? 1 : m);
        Probe::log("cvar: 'interactionMode' = \"%s\" -> %d", s_cvar_mode->vStr, g_mode);
    }
    if (s_cvar_angle && Console::snapshotChanged(s_lastAngle, s_cvar_angle->vStr)) {
        int a = atoi(s_cvar_angle->vStr);
        if (a < 15) a = 15;
        if (a > 160) a = 160;
        g_angle = a;
        Probe::log("cvar: 'interactionAngle' = \"%s\" -> %d", s_cvar_angle->vStr, g_angle);
    }
}

// --- канал данных: Lua-аддон выставляет AW_Request.interact, мы забираем и гасим ---------------------

guid_t s_pendingGuid = 0;
void* s_pendingObject = NULL;
char s_modifier[32];

bool takeRequest()
{
    lua_State* L = GetLuaState();
    if (!L) return false;

    lua_getglobal(L, "AW_Request");
    // Проверка по типу, а не «не nil»: AW_Request -- обычный глобал, и чужой аддон может положить туда
    // что угодно. lua_getfield/lua_setfield по не-таблице -- ошибка внутри Lua, а мы здесь в C-колбэке
    // из скрипт-апдейта, не внутри pcall: Lua уйдёт longjmp'ом мимо нашего кадра, и клиент закроется.
    if (!lua_istable(L, -1)) { lua_pop(L, 1); return false; }

    lua_getfield(L, -1, "interact");
    const int type = lua_type(L, -1);
    bool request = false;
    s_modifier[0] = 0;

    if (type == LUA_TSTRING) {
        const char* s = lua_tostring(L, -1);
        if (s) snprintf(s_modifier, sizeof(s_modifier), "%s", s);
        request = true;
    } else if (type == LUA_TNUMBER || type == LUA_TBOOLEAN) {
        request = true;   // "/run AW_Request.interact = true" -- без модификатора
    }

    lua_pop(L, 1);                       // interact
    if (request) {
        lua_pushnil(L);
        lua_setfield(L, -2, "interact");  // гасим, чтобы следующее нажатие снова было событием
    }
    lua_pop(L, 1);                       // AW_Request
    return request;
}

bool usableObject(void* object)
{
    uint32_t typeId = 0;
    if (!readField(object, FIELD_TYPE, &typeId)) return false;

    if (typeId == TYPEID_UNIT) {
        uint32_t dyn = 0, flags = 0, npc = 0;
        readField(object, FIELD_UNIT_DYNFLAGS, &dyn);
        readField(object, FIELD_UNIT_FLAGS, &flags);
        readField(object, FIELD_UNIT_NPCFLAGS, &npc);
        const bool lootable = (dyn & DYNFLAG_LOOTABLE) != 0;
        const bool skinnable = (flags & FLAG_SKINNABLE) != 0;
        // Форк дополнительно зовёт CanAssist, чтобы не брать враждебного квестодателя; npc-флаги при этом
        // остаются обязательным условием, так что без CanAssist мы рискуем выбрать только врага с
        // квест-флагом. Оставляем как есть и смотрим на жалобу в игре.
        return lootable || skinnable || npc != 0;
    }
    if (typeId == TYPEID_GAMEOBJECT) {
        uint32_t bytes = 0;
        if (!readField(object, FIELD_GO_BYTES1, &bytes)) return false;
        if (!isInteractableGoType((bytes >> 8) & 0xFF)) return false;
        return canUseNow(object);
    }
    return false;
}

void scan()
{

    Player* player = ObjectMgr::GetPlayer();
    if (!player) return;
    Unit* playerUnit = player->ToUnit();

    VecXYZ posPlayer;
    if (!objectPosition(playerUnit, &posPlayer)) return;
    const float facing = vtableFloat(playerUnit, VTABLE_GET_FACING);
    const float fx = cosf(facing), fy = sinf(facing);
    const float minDot = cosf((g_angle / 2.f) * (3.14159265358979f / 180.f));

    guid_t best = 0;
    void* bestObject = NULL;
    float bestDistance = 20.0f;
    int checked = 0, matched = 0;

    // Именованный юнит ("/interact target") -- это явное решение игрока, а не поиск: проверять только
    // дистанцию, без конуса и без чтения флагов. Причина не в удобстве, а в том, что флаги мы сейчас
    // прочитать не можем (массив полей не найден), а тыкать в цель по её же имени можно и так.
    auto consider = [&](guid_t guid, bool named) {
        if (!guid) return;
        void* object = (void*)ObjectMgr::Get(guid, (ObjectFlags)(ObjectFlags_Unit | ObjectFlags_GameObject));
        if (!object || object == (void*)player) return;
        if (!named) { if (!g_fieldsAt) { findFieldsOffset(object, guid); if (!g_fieldsAt) return; } }
        checked++;

        VecXYZ pos;
        if (!objectPosition(object, &pos)) return;
        const float dx = pos.x - posPlayer.x, dy = pos.y - posPlayer.y, dz = pos.z - posPlayer.z;
        const float distance = sqrtf(dx * dx + dy * dy + dz * dz);
        if (distance <= 0.f || distance > bestDistance) return;

        if (!named && g_mode == 1) {
            const float length = sqrtf(dx * dx + dy * dy);
            if (length == 0.f) return;
            if ((dx / length) * fx + (dy / length) * fy < minDot) return;
        }
        if (!named && !usableObject(object)) return;

        best = guid;
        bestObject = object;
        bestDistance = distance;
        matched++;
    };

    if (s_modifier[0]) {
        // "/interact target" и т.п.: проверяем ровно тот юнит, который назван, без обхода всех объектов.
        consider(ObjectMgr::GetGuidByUnitID(s_modifier), true);
    } else {
        ObjectMgr::EnumObjects([&](guid_t guid) -> bool {
            if (guid) consider(guid, false);
            return true;
        });
    }

    if (best) {
        s_pendingGuid = best;
        s_pendingObject = bestObject;
        char hex[24] = { 0 };
        ObjectMgr::Guid2HexString(best, hex);
        Probe::log("interact: выбран %s (дистанция %.1f, просмотрено %d, подходит %d)", hex, bestDistance, checked, matched);
    } else {
        Probe::log("interact: ничего подходящего (просмотрено %d, режим конуса %d, угол %d, модификатор \"%s\")",
            checked, g_mode, g_angle, s_modifier);
    }
}

void onUpdate()
{
    if (!IsInWorld()) return;
    pollSettings();

    if (!s_pendingGuid && takeRequest()) scan();

    if (s_pendingGuid) {
        void* again = (void*)ObjectMgr::Get(s_pendingGuid, (ObjectFlags)(ObjectFlags_Unit | ObjectFlags_GameObject));
        void* object = s_pendingObject;
        guid_t asked = s_pendingGuid;
        s_pendingGuid = 0;
        s_pendingObject = NULL;
        if (!again) {
            Probe::log("interact: объекта %016llX уже нет в списке, клик пропущен", (unsigned long long)asked);
        } else if (again != object) {
            // Другой объект по тому же guid'у за один кадр -- это не тот, кого мы выбирали.
            Probe::log("interact: по guid %016llX уже другой объект (%p вместо %p), клик пропущен",
                (unsigned long long)asked, again, object);
        } else {
            vtableRightClick(again);
            Probe::log("interact: правый клик по объекту %p (guid %016llX)", again, (unsigned long long)asked);
        }
    }
}

}

void Interact::initialize()
{
    if (!S().interact) return;
    Hooks::FrameXML::registerCVar(&s_cvar_mode, "interactionMode", NULL, (Console::CVarFlags)1, "1", NULL);
    Hooks::FrameXML::registerCVar(&s_cvar_angle, "interactionAngle", NULL, (Console::CVarFlags)1, "60", NULL);
    Hooks::FrameScript::registerOnUpdate(onUpdate);
    Probe::log("interact: включён (правок кода нет; Lua-аддон AWNamePlateAPI пишет AW_Request.interact)");
}
