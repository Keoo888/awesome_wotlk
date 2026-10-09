#include "Misc.h"
#include "GameClient.h"
#include "Hooks.h"
#include "Settings.h"
#include "Probe.h"
#include <Windows.h>
#include <Detours/detours.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// Two features ported from upstream awesome, each behind its own conf key so a run changes exactly one
// of them: cameraFov (upstream Misc.cpp) and the @cursor / @playerlocation macro conditionals (the
// awesome_wotlk-macros branch, which is the control build that never got session lost).
//
// The rule that governs both is the one the nameplate work measured: nothing that lives in the client's
// data may name an address inside this dll. So cameraFov is registered WITHOUT a handler and polled, and
// the macros are built on detours of client functions -- a detour rewrites code at a client address, the
// client's own pointers keep pointing at that same client address, and there is nothing for the pointer
// validator to reject.

namespace {

const double kPi = 3.14159265358979323846;

// ---------------------------------------------------------------- cameraFov

Console::CVar* s_cvar_cameraFov;
char s_lastFov[32];
float s_wantFov;
long s_fovRepairs;

float parseFov(const char* v)
{
    int degrees = atoi(v);
    if (degrees < 1) degrees = 1;
    if (degrees > 200) degrees = 200;
    return (float)(kPi / 200.0 * degrees);
}

Camera_Initialize_t Camera_Initialize_orig;

// Честное значение CVar'а или NULL. Пустая строка -- это не «fov 0»: parseFov("") даёт atoi("")=0,
// который клампится к 1 градусу (0.0157 рад), то есть схлопнутую проекцию вместо камеры. Такую строку
// переменная держит, если игрок написал `/console cameraFov ""`, и тогда стоять на месте обязаны оба
// места, где fov берётся отсюда.
const char* fovValue()
{
    if (!s_cvar_cameraFov) s_cvar_cameraFov = Console::FindCVar("cameraFov");
    const Console::CVar* cvar = s_cvar_cameraFov;
    if (!cvar || !cvar->vStr || !cvar->vStr[0]) return NULL;
    return cvar->vStr;
}

void __fastcall Camera_Initialize_hk(Camera* self, void* edx, float a2, float a3, float fov)
{
    // Upstream's site: the camera picks its fov here, so applying our value at this point is what makes
    // it survive a camera switch. Without the CVar yet (login before the first poll) the client's own
    // argument stands.
    const char* value = fovValue();
    if (value) fov = parseFov(value);
    Camera_Initialize_orig(self, edx, a2, a3, fov);
}

void applyCameraFov()
{
    const char* value = fovValue();
    if (!value) return;

    // Снимок сравнивается через Console::snapshotChanged (см. GameClient.h): обрезанный снимок против полной
    // строки не совпадал никогда, и строка про fov уходила в журнал каждый кадр.
    const bool changed = Console::snapshotChanged(s_lastFov, value);
    if (changed) {
        s_wantFov = parseFov(value);
        Probe::log("cvar: 'cameraFov' = \"%s\" -> %.4f rad (handler=%08X)", value, s_wantFov, (unsigned)(size_t)s_cvar_cameraFov->handler);
    }

    Camera* camera = GetActiveCamera();
    if (camera && camera->fovInRadians != s_wantFov) {
        // A frame where the string did not change but the camera's fov did: something reset the camera
        // behind our back. The counter is the measurement of whether that ever happens.
        // Счётчик без строки в журнале ничего не измеряет, поэтому печатаем первый случай -- и именно
        // до записи, иначе в строке был бы наш угол вместо клиентского.
        if (!changed && ++s_fovRepairs == 1)
            Probe::log("camera: клиент сам поставил fov %.4f вместо наших %.4f -- возвращаем свой, дальше такие случаи только считаем",
                camera->fovInRadians, s_wantFov);
        camera->fovInRadians = s_wantFov;
    }
}

// ---------------------------------------------------------------- @cursor / @playerlocation

// Set while a macro conditional is parsed, consumed by the terrain-tracking hook below. Upstream cleared
// them from a patch in the middle of the spell-reset function (0x007FEE99); an expiry in our per-frame
// callback covers the same case -- a conditional that was parsed but never reached the terrain handler --
// without writing into the body of a client function we never measured.
bool s_macroCursor;
bool s_macroPlayerLocation;
DWORD s_macroStamp;
long s_macroExpired;

SecureCmdOptionParse_t SecureCmdOptionParse_orig;
WorldFrame_TrackTerrain_t WorldFrame_TrackTerrain_orig;

void terrainClick(float x, float y, float z)
{
    TerrainClickEvent ev = { 0, { x, y, z }, 1 };
    HandleTerrainClick_fn(&ev);
}

bool sameWord(const char* a, const char* word)
{
    return a && _stricmp(a, word) == 0;
}

int __cdecl SecureCmdOptionParse_hk(lua_State* L)
{
    int result = SecureCmdOptionParse_orig(L);

    // The client's own contract here: three strings on the stack -- the raw conditional, the parsed
    // branch it chose, and the unit keyword it parsed out of it.
    if (lua_gettop(L) < 3 || lua_type(L, 2) != LUA_TSTRING || lua_type(L, 3) != LUA_TSTRING)
        return result;

    const char* keyword = lua_tostring(L, 3);
    const bool isCursor = sameWord(keyword, "cursor");
    const bool isPlayerLocation = sameWord(keyword, "playerlocation");
    if (!isCursor && !isPlayerLocation) return result;

    // Copy before touching the stack: the two pushes below can reallocate the state's stack, and the
    // pointers we hold belong to it.
    char original[512], parsed[512];
    snprintf(original, sizeof(original), "%s", lua_tostring(L, 1));
    snprintf(parsed, sizeof(parsed), "%s", lua_tostring(L, 2));

    // Hand the client back "the branch it chose, with no unit keyword": the keyword is the part it cannot
    // resolve, and dropping it is what makes [@cursor] pass validation instead of failing the conditional.
    lua_pop(L, 3);
    lua_pushstring(L, original);
    lua_pushstring(L, parsed);
    lua_pushnil(L);

    if (isCursor) s_macroCursor = true;
    else s_macroPlayerLocation = true;
    s_macroStamp = GetTickCount();
    Probe::log("macro: conditional '%s' принята, ждём terrain track (%s)", keyword, isCursor ? "@cursor" : "@playerlocation");

    return result;
}

int __fastcall WorldFrame_TrackTerrain_hk(void* self, void* edx, int* a1)
{
    if (s_macroPlayerLocation) {
        s_macroPlayerLocation = false;
        Player* player = ObjectMgr::GetPlayer();
        if (player) {
            VecXYZ pos = {};
            // Тот же слот vtable, который Interact.cpp зовёт через objectPosition под __try. Вызов уходит
            // в код клиента, который мы не мерили, а падение посреди макроса -- это падение клиента.
            bool ok = true;
            __try {
                player->ToUnit()->vmt->GetPosition(player->ToUnit(), &pos);
            } __except (EXCEPTION_EXECUTE_HANDLER) {
                ok = false;
                Probe::log("macro: @playerlocation -- GetPosition упал (%08lX), клик пропущен", GetExceptionCode());
            }
            if (!ok) return WorldFrame_TrackTerrain_orig(self, a1);
            terrainClick(pos.x, pos.y, pos.z);
            Probe::log("macro: @playerlocation -> клик по земле в позиции игрока (%.1f, %.1f, %.1f)", pos.x, pos.y, pos.z);
        }
    } else if (s_macroCursor) {
        s_macroCursor = false;
        // The tracking argument carries the cursor's world position as floats at [2..4] -- the same
        // layout the client's own click handler reads.
        const float* coords = (const float*)a1;
        terrainClick(coords[2], coords[3], coords[4]);
        Probe::log("macro: @cursor -> клик по земле под курсором (%.1f, %.1f, %.1f)", coords[2], coords[3], coords[4]);
    }
    return WorldFrame_TrackTerrain_orig(self, a1);
}

// ---------------------------------------------------------------- shared per-frame

void onUpdate()
{
    if (S().camera) applyCameraFov();
    if ((s_macroCursor || s_macroPlayerLocation) && GetTickCount() - s_macroStamp > 250) {
        s_macroCursor = s_macroPlayerLocation = false;
        s_macroExpired++;
        Probe::log("macro: флаг истёк, terrain track не пришёл (всего таких: %ld)", s_macroExpired);
    }
}

}

void Misc::initialize()
{
    // Площадки проверяются до attach: DetourAttach читает байты цели, а чтение битого адреса внутри
    // транзакции роняет её целиком -- вместе с nameplate-слоем, если бы они делили одну транзакцию.
    if (S().camera) {
        // CVar и полл работают сами по себе; детюр нужен только чтобы fov переживал смену камеры.
        Hooks::FrameXML::registerCVar(&s_cvar_cameraFov, "cameraFov", NULL, (Console::CVarFlags)1, "100", NULL);
        if (!Hooks::isImageCode((DWORD)Camera_Initialize_fn))
            Probe::log("camera: Camera::Initialize %p is not executable client code, fov will not survive a camera switch",
                (void*)Camera_Initialize_fn);
        else {
            Camera_Initialize_orig = Camera_Initialize_fn;
            DetourAttach(&(LPVOID&)Camera_Initialize_orig, (LPVOID)&Camera_Initialize_hk);
        }
    }
    if (S().macros) {
        if (!Hooks::isImageCode((DWORD)SecureCmdOptionParse_fn) || !Hooks::isImageCode((DWORD)WorldFrame_TrackTerrain_fn)) {
            Probe::log("macros: sites are not executable client code (parse=%d terrain=%d), feature skipped",
                (int)Hooks::isImageCode((DWORD)SecureCmdOptionParse_fn), (int)Hooks::isImageCode((DWORD)WorldFrame_TrackTerrain_fn));
        } else {
            SecureCmdOptionParse_orig = SecureCmdOptionParse_fn;
            WorldFrame_TrackTerrain_orig = WorldFrame_TrackTerrain_fn;
            DetourAttach(&(LPVOID&)SecureCmdOptionParse_orig, (LPVOID)&SecureCmdOptionParse_hk);
            DetourAttach(&(LPVOID&)WorldFrame_TrackTerrain_orig, (LPVOID)&WorldFrame_TrackTerrain_hk);
        }
    }
    if (S().camera || S().macros)
        Hooks::FrameScript::registerOnUpdate(onUpdate);
}

void Misc::auditSites()
{
    if (S().camera)
        Probe::auditSite("CameraInitialize", (void*)Camera_Initialize_fn);
    if (S().macros) {
        Probe::auditSite("SecureCmdOptionParse", (void*)SecureCmdOptionParse_fn);
        Probe::auditSite("WorldFrameTrackTerrain", (void*)WorldFrame_TrackTerrain_fn);
    }
}
