#include "Camera.h"
#include "GameClient.h"
#include "Hooks.h"
#include "Settings.h"
#include "Probe.h"
#include <Windows.h>
#include <Detours/detours.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <unordered_map>
#include <unordered_set>

// Затемнение моделей, стоящих между камерой и игроком (фича форка awesome, Camera.cpp).
//
// Что перенесено один в один: три точки правки и раскладки их стековых кадров -- форк нацелен на тот же
// build 12340, что и наш клиент (якоря 0x0060AFAA / 0x00495810 / 0x0098E9F9 / 0x00ADAA7C совпадают с
// измеренными у нами в игре), поэтому смещения кадров переписаны дословно.
//
// Что сознательно другое:
//   1) площадки проверяются до attach (Hooks::isImageCode) -- чтение битого адреса внутри транзакции
//      роняет всю транзакцию, это измерено 30.09 на clipboard;
//   2) переключение cameraIndirectVisibility НЕ переставляет детюры в рантайме (у форка это
//      DetourTransactionBegin/Commit из handler'а CVar'а). Хуки стоят всегда, а поведение включает/гасит
//      флаг, который мы читаем из CVar'а поллом;
//   3) ни одного C-указателя в данных клиента: CVar'ы регистрируются без handler'а.
//
// Риском остаётся то, что точки лежат внутри чужих функций, а не на их входах: три naked-стаба ниже
// работают с регистрами и смещениями кадра клиента. Ошибка в них -- это повреждение памяти в рендере, а
// не аккуратный отказ. Поэтому ключ fade по умолчанию выключен.

namespace {

#pragma pack(push, 1)
struct CM2Model {
    uint8_t gap0[0x17C];
    float alpha;            // 0x17C
};
#pragma pack(pop)
static_assert(sizeof(CM2Model) == 0x180);

using Intersect_t = char(__cdecl*)(VecXYZ* start, VecXYZ* end, VecXYZ* hitPoint, float* distance, uint32_t flags, uint32_t buffer);
const Intersect_t Intersect_fn = (Intersect_t)0x0077F310;

std::unordered_set<CM2Model*> g_current;      // модели, найденные трейсом в этом кадре
std::unordered_set<CM2Model*> g_fading;       // модели, которым мы трогали альфу
std::unordered_map<CM2Model*, float> g_originalAlpha;
std::unordered_map<CM2Model*, uint32_t> g_grace;

float g_indirectAlpha = 1.0f;
float g_actualDistance = 1.0f;
bool s_fadeOn = false;

// Указатель на модель приходит из буфера трейса и живёт у нас дольше одного кадра, а альфа лежит не в
// начале объекта, а на 0x17C от него. Прежняя проверка IsBadReadPtr(model, 4) смотрела первые четыре
// байта -- то есть не ту страницу, в которую мы потом пишем, и на границе страниц пропускала запись в
// выгруженную модель. Проверяем ровно адрес альфы и ровно на запись.
// IsBadWritePtr для этого не годится: она делает пробную запись в чужой объект, то есть сама портит то,
// что проверяет. VirtualQuery ничего не пишет.
bool modelAlphaWritable(CM2Model* model)
{
    if (!model) return false;
    const void* at = &model->alpha;
    MEMORY_BASIC_INFORMATION mbi = { 0 };
    if (!VirtualQuery(at, &mbi, sizeof(mbi))) return false;
    if (mbi.State != MEM_COMMIT) return false;
    if (mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD)) return false;
    const DWORD writable = PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
    if (!(mbi.Protect & writable)) return false;
    // Поле не должно выходить за конец региона: иначе «начало доступно» ничего не говорит о самой записи.
    return (uintptr_t)at + sizeof(float) <= (uintptr_t)mbi.BaseAddress + mbi.RegionSize;
}

char __cdecl Intersect_hk(VecXYZ* playerPos, VecXYZ* cameraPos, VecXYZ* hitPoint, float* hitDistance, uint32_t hitFlags, uint32_t buffer)
{
    auto buf = (void*)buffer;
    memset(buf, 0, 2048);

    char result = Intersect_fn(playerPos, cameraPos, hitPoint, hitDistance, hitFlags + 1 + 0x8000000, (uint32_t)(size_t)buf);
    // cameraIndirectVisibility = 0 значит «ничего не затемнять», и тогда ни один наш контейнер, ни чужая
    // альфа, ни *hitDistance не должны быть тронуты: клиент получает ровно то, что дал бы свой собственный
    // трейс. Раньше флаг читался только в pollFadeSettings (и restoreAll при выключении), а этот путь жил
    // сам по себе, поэтому при выключенном фейде модели всё равно резались в альфу, и вставки в
    // unordered_set шли каждый кадр -- поведение не совпадало с настройкой (смотрел код 02.10).
    if (!s_fadeOn) return result;
    if (result) {
        auto data = (const uint32_t*)buf;
        CM2Model* model = ((data[0] == 1 || data[0] == 2) && data[1] > 0)
            ? *(CM2Model**)((uint8_t*)buf + 12 + 80) : NULL;
        // Недоступная на запись модель = «затемнять нечего»: в контейнеры она не попадает вообще, иначе
        // мёртвый указатель оставался бы в таблицах и альфа однажды писалась бы в чужой объект.
        if (model && modelAlphaWritable(model)) {
            g_current.insert(model);
            g_fading.insert(model);
            if (!g_originalAlpha.count(model)) g_originalAlpha[model] = model->alpha;
            model->alpha += (g_indirectAlpha - model->alpha) * 0.25f;
            g_grace[model] = 0;
            if (g_actualDistance < 1.0f) *hitDistance = g_actualDistance;
            else result = 0;
        } else {
            g_current.clear();
            g_actualDistance = *hitDistance;
        }
    } else if (g_fading.empty()) {
        return result;
    } else {
        g_current.clear();
        g_actualDistance = 1.0f;
    }

    const uint32_t cleanupTimer = (uint32_t)g_fading.size() + 1;
    for (auto it = g_fading.begin(); it != g_fading.end();) {
        CM2Model* model = *it;
        auto saved = g_originalAlpha.find(model);
        // Две причины забыть модель, не трогая её. Первая -- она уже недоступна на запись (выгружена).
        // Вторая была тихой ошибкой: g_originalAlpha[model] на отсутствующем ключе СОЗДАЁТ запись со
        // значением 0.0f, и модель «восстанавливалась» в полную невидимость вместо своей альфы.
        if (saved == g_originalAlpha.end() || !modelAlphaWritable(model)) {
            g_originalAlpha.erase(model);
            g_grace.erase(model);
            it = g_fading.erase(it);
            continue;
        }
        uint32_t& timer = g_grace[model];
        if (timer > cleanupTimer) {
            const float original = saved->second;
            model->alpha += (original - model->alpha) * 0.25f;
            if (fabs(model->alpha - original) < 0.01f) {
                model->alpha = original;
                g_originalAlpha.erase(saved);
                g_grace.erase(model);
                it = g_fading.erase(it);
                continue;
            }
        }
        ++it;
    }
    for (auto& pair : g_grace) pair.second++;

    return result;
}

const DWORD INTERSECT_CALL = 0x006060E6;
const DWORD INTERSECT_JMPBACK = 0x00606103;

void __declspec(naked) Intersect_call_hk()
{
    __asm {
        sub esp, 2048
        lea eax, [esp]
        fld1
        push eax
        and ebx, ~1
        push ebx
        fstp dword ptr[ebp + 0x18]
        lea ecx, [ebp + 0x18]
        push ecx
        lea edx, [ebp - 0x48]
        push edx
        lea eax, [ebp - 0x18]
        push eax
        lea ecx, [ebp - 0x24]
        push ecx
        call Intersect_hk
        add esp, 2048
        jmp INTERSECT_JMPBACK
    }
}

// Empty set means "nothing to fade", and that is exactly the answer the lookup would give for every
// model -- so check the set once instead of hashing every candidate. Measured 01.10: 520..1064 lookups
// per update while the fade had 0..1 models to touch.
bool __cdecl collisionFilter(CM2Model* model)
{
    if (!s_fadeOn || g_current.empty()) return true;
    return !g_current.count(model);
}

const DWORD COLLISION_ITERATE = 0x007A279D;
const DWORD COLLISION_ITERATE_JMPBACK = 0x007A27A5;
const DWORD COLLISION_ITERATE_SKIP = 0x007A2943;

void __declspec(naked) Collision_iterate_hk()
{
    __asm {
        mov esi, [edx + 4]          // esi = запись объекта
        pushfd
        push eax
        push ecx
        push edx
        mov eax, [ebp + 0Ch]
        and eax, 0x8000000
        jz run_collision_processing
        mov eax, [esi + 0x34]       // eax = модель
        test eax, eax
        jz skip_collision_processing
        push eax
        call collisionFilter
        add esp, 4
        test al, al
        je skip_collision_processing
    run_collision_processing:
        pop edx
        pop ecx
        pop eax
        popfd
        cmp byte ptr[esi + 25h], bl
        jmp COLLISION_ITERATE_JMPBACK
    skip_collision_processing:
        pop edx
        pop ecx
        pop eax
        popfd
        jmp COLLISION_ITERATE_SKIP
    }
}

const DWORD WORLDOBJ_ITERATE = 0x007A2A1C;
const DWORD WORLDOBJ_ITERATE_JMPBACK = 0x007A2A23;
const DWORD WORLDOBJ_ITERATE_SKIP = 0x007A2A8A;

void __declspec(naked) Worldobj_iterate_hk()
{
    // Регистры и флаги сохраняются так же, как в Collision_iterate_hk выше. Без этого стаб отдавал клиенту
    // обратно другие eax/ecx/edx: ecx и edx портит сам вызов collisionFilter (их не обязан сохранять ни
    // один __cdecl), а edx -- ещё и строка чтения флагов ниже. Повреждение регистра внутри обхода мира --
    // это падение в рендере в произвольный момент, без всякой связи с нашим кодом по стеку вызовов.
    __asm {
        pushfd
        push eax
        push ecx
        push edx
        mov edx, [ebp + 0Ch]
        test edx, 0x8000000
        jz run_collision_processing
        push eax                    // eax = модель
        call collisionFilter
        add esp, 4
        test al, al
        je skip_collision_processing
    run_collision_processing:
        pop edx
        pop ecx
        pop eax
        popfd
        mov eax, [ebp - 68h]
        cmp dword ptr[eax + 2D8h], 0
        jmp WORLDOBJ_ITERATE_JMPBACK
    skip_collision_processing:
        pop edx
        pop ecx
        pop eax
        popfd
        jmp WORLDOBJ_ITERATE_SKIP
    }
}

decltype(&Intersect_call_hk) Intersect_call_orig;decltype(&Collision_iterate_hk) Collision_iterate_orig;
decltype(&Worldobj_iterate_hk) Worldobj_iterate_orig;

// --- настройки без handler'ов: читаем строки CVar'ов сами (см. шапку файла) -------------------------

Console::CVar* s_cvar_visibility;
Console::CVar* s_cvar_alpha;
char s_lastVisibility[16];
char s_lastAlpha[16];

// Забыть всё, ничего не записывая. Нужно там, где модели уже выгружены клиентом: писать по таким
// указателям восстановленную альфу нельзя -- по тому же адресу может лежать уже другой объект.
void forgetAll()
{
    g_originalAlpha.clear();
    g_grace.clear();
    g_fading.clear();
    g_current.clear();
    g_actualDistance = 1.0f;
}

void restoreAll()
{
    for (auto& pair : g_originalAlpha) {
        if (modelAlphaWritable(pair.first)) pair.first->alpha = pair.second;
    }
    forgetAll();
}

void pollFadeSettings()
{
    if (!s_cvar_visibility) s_cvar_visibility = Console::FindCVar("cameraIndirectVisibility");
    if (!s_cvar_alpha) s_cvar_alpha = Console::FindCVar("cameraIndirectAlpha");

    // Снимок сравнивается через Console::snapshotChanged (см. GameClient.h): обрезанный снимок против
    // полной строки не совпадал никогда, то есть фейд переустанавливался и писал в журнал каждый кадр.
    if (s_cvar_visibility && Console::snapshotChanged(s_lastVisibility, s_cvar_visibility->vStr)) {
        const bool on = atoi(s_cvar_visibility->vStr) != 0;
        if (!on && s_fadeOn) restoreAll();
        s_fadeOn = on;
        Probe::log("cvar: 'cameraIndirectVisibility' = \"%s\" -> %s (хуки стоят, поведение=%s)",
            s_cvar_visibility->vStr, on ? "вкл" : "выкл", on ? "вкл" : "выкл");
    }

    if (s_cvar_alpha && Console::snapshotChanged(s_lastAlpha, s_cvar_alpha->vStr)) {
        float a = (float)atof(s_cvar_alpha->vStr);
        if (a < 0.6f) a = 0.6f;
        if (a > 1.0f) a = 1.0f;
        g_indirectAlpha = a;
        Probe::log("cvar: 'cameraIndirectAlpha' = \"%s\" -> %.2f", s_cvar_alpha->vStr, a);
    }
}

}

void CamFade::onUpdate()
{
    // Смена сцены (вход в мир, портал, выход в меню) выгружает все модели сразу, а наши таблицы жили до
    // сих пор от запуска до выхода: восстанавливать альфу было некому, и затемнённая модель оставалась в
    // списке навсегда. При совпадении адреса в новой зоне это запись float в произвольный чужой объект.
    static bool wasInWorld = false;
    const bool inWorld = IsInWorld();
    if (wasInWorld != inWorld) {
        wasInWorld = inWorld;
        forgetAll();
    }
    pollFadeSettings();
}

void CamFade::initialize()
{
    if (!S().fade) return;

    const bool sitesOk = Hooks::isImageCode(INTERSECT_CALL) && Hooks::isImageCode(COLLISION_ITERATE)
                      && Hooks::isImageCode(WORLDOBJ_ITERATE);
    if (!sitesOk) {
        Probe::log("fade: sites are not executable client code (intersect=%d collision=%d worldobj=%d), feature skipped",
            (int)Hooks::isImageCode(INTERSECT_CALL), (int)Hooks::isImageCode(COLLISION_ITERATE),
            (int)Hooks::isImageCode(WORLDOBJ_ITERATE));
        return;
    }

    g_current.reserve(64);
    g_fading.reserve(64);
    g_originalAlpha.reserve(64);
    g_grace.reserve(64);

    Hooks::FrameXML::registerCVar(&s_cvar_visibility, "cameraIndirectVisibility", NULL, (Console::CVarFlags)1, "0", NULL);
    Hooks::FrameXML::registerCVar(&s_cvar_alpha, "cameraIndirectAlpha", NULL, (Console::CVarFlags)1, "0.6", NULL);

    Intersect_call_orig = (decltype(Intersect_call_orig))INTERSECT_CALL;
    Collision_iterate_orig = (decltype(Collision_iterate_orig))COLLISION_ITERATE;
    Worldobj_iterate_orig = (decltype(Worldobj_iterate_orig))WORLDOBJ_ITERATE;
    DetourAttach(&(LPVOID&)Intersect_call_orig, (LPVOID)&Intersect_call_hk);
    DetourAttach(&(LPVOID&)Collision_iterate_orig, (LPVOID)&Collision_iterate_hk);
    DetourAttach(&(LPVOID&)Worldobj_iterate_orig, (LPVOID)&Worldobj_iterate_hk);
    Hooks::FrameScript::registerOnUpdate(onUpdate);
}

void CamFade::auditSites()
{
    if (!S().fade) return;
    Probe::auditSite("CameraIntersectCall", (void*)INTERSECT_CALL);
    Probe::auditSite("CameraCollisionIterate", (void*)COLLISION_ITERATE);
    Probe::auditSite("CameraWorldObjIterate", (void*)WORLDOBJ_ITERATE);
}
