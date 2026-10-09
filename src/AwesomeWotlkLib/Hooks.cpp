#include "Hooks.h"
#include "Settings.h"
#include "DrHook.h"
#include "Probe.h"
#include <Windows.h>
#include <Detours/detours.h>
#include <string>
#include <vector>
#include <unordered_map>

struct CVarArgs {
    Console::CVar** dst;
    const char* name;
    const char* desc;
    Console::CVarFlags flags;
    const char* initialValue;
    Console::CVar::Handler_t func;
};

static std::vector<CVarArgs> s_customCVars;
void Hooks::FrameXML::registerCVar(Console::CVar** dst, const char* str, const char* desc, Console::CVarFlags flags, const char* initialValue, Console::CVar::Handler_t func)
{
    s_customCVars.push_back({ dst, str, desc, flags, initialValue, func });
}

// Upstream installs these two as detours on 0x0051D9B0 / 0x00530F85, but neither body actually needs to
// run *inside* the hooked function: CVars_Initialize's hook only calls the client's public
// Console::RegisterCVar, and OpenFrameXMLApi's hook only calls our lua_open* functions with the live
// state. Both can be driven from the per-frame update instead, which leaves 0x0051D9B0 and 0x00530F85
// byte-identical to stock -- one fewer published address with a JMP in it. (In drhook=1 there is no
// per-frame callback, so scope>=2 features are not registered in that mode.)

// Регистрация CVar'ов идёт из скрипт-апдейта, то есть первая попытка может прийтись на кадр, когда консоль
// клиента ещё не готова. Раньше done=true стояло ДО цикла: один неудачный кадр -- и переменная не
// появлялась до конца сессии (ползунки в AwesomeCVar просто ничего не делали, без единой жалобы). Теперь
// повторяем только то, что не зарегистрировалось, и сдаёмся по счёту попыток, а не с первого раза.
static void ensureCustomCVars()
{
    static const int kMaxAttempts = 300;   // ~несколько секунд кадров, дальше это уже не «ещё не готово»
    static bool done = false;
    static int attempts = 0;
    static std::vector<char> registered;

    if (done || s_customCVars.empty()) return;
    if (registered.size() != s_customCVars.size()) registered.assign(s_customCVars.size(), 0);
    attempts++;

    bool all = true;
    for (size_t i = 0; i < s_customCVars.size(); i++) {
        if (registered[i]) continue;
        const auto& [dst, name, desc, flags, initialValue, func] = s_customCVars[i];
        Console::CVar* cvar = Console::RegisterCVar(name, desc, flags, initialValue, func, 0, 0, 0, 0);
        if (dst) *dst = cvar;
        if (cvar) {
            registered[i] = 1;
            Probe::log("cvar: '%s' registered %s", name, "ok");
            continue;
        }
        all = false;
        // Строка про неудачу пишется только на первой попытке и на последней: иначе это запись в журнал
        // каждый кадр до выхода из игры.
        if (attempts == 1 || attempts == kMaxAttempts)
            Probe::log("cvar: '%s' registered %s", name, "FAILED");
    }

    if (all) {
        done = true;
    } else if (attempts >= kMaxAttempts) {
        done = true;
        Probe::log("cvar: сдались после %d попыток -- часть переменных не зарегистрирована", attempts);
    }
}


// Filled into the call-site stubs below (FillEventsWithExtra) -- no detour on FillEvents itself.
static std::vector<const char*> s_customEvents;
void Hooks::FrameXML::registerEvent(const char* str) { s_customEvents.push_back(str); }


static std::vector<lua_CFunction> s_customLuaLibs;
void Hooks::FrameXML::registerLuaLib(lua_CFunction func) { s_customLuaLibs.push_back(func); }
// Defined next to the tail counters it reads (windows, asked token, overlap counter).
static const char* attributeAsk(unsigned ebp, const char* tok, DWORD* callerOut);
static void afaTrace(unsigned ebp, const char* asked, guid_t g);

// The client throws away and rebuilds its Lua state (login <-> in-game, /reload), and the address can be
// reused, so "did I already open the libs here?" cannot be answered from a pointer comparison. The
// registry is per-state, so a field in it dies with the state -- that is the marker.
static void ensureLuaApiInCurrentState()
{
    static const char MARKER[] = "awesomewotlk_libs_opened";
    lua_State* L = GetLuaState();
    if (!L || s_customLuaLibs.empty()) return;
    lua_getfield(L, LUA_REGISTRYINDEX, MARKER);
    const bool opened = !lua_isnil(L, -1);
    lua_pop(L, 1);
    if (opened) return;
    const int topBefore = lua_gettop(L);
    for (auto& func : s_customLuaLibs)
        func(L);
    lua_pushnumber(L, 1);
    lua_setfield(L, LUA_REGISTRYINDEX, MARKER);
    // Measured, because the 29.09 20:36 run printed "2 lib(s) opened" four times in two minutes with a
    // DIFFERENT state pointer each time: either the marker does not stick, or GetLuaState() really hands us
    // another state (a coroutine), or both. If the marker is nil right after we set it, the write is the
    // broken part; if the depth moved, our opener leaks values onto a live Lua stack -- which is exactly how
    // a registered global could break unrelated script calls like /tar.
    const int markerType = (lua_getfield(L, LUA_REGISTRYINDEX, MARKER), lua_type(L, -1));
    lua_pop(L, 1);
    Probe::log("luaapi: %d lib(s) into state %p, stack %d->%d, marker type=%d",
               (int)s_customLuaLibs.size(), (void*)L, topBefore, lua_gettop(L), markerType);
}

struct CustomTokenDetails {
    // Было memset(this, NULL, sizeof(*this)): NULL здесь стоит на месте байта-заполнителя, то есть тип
    // указателя использован как число. Поля инициализируются по именам -- того же результата, но без
    // записи сырыми байтами по собственному this.
    CustomTokenDetails() : hasN(false), getGuid(NULL), getId(NULL) {}
    CustomTokenDetails(Hooks::FrameScript::TokenGuidGetter* getGuid, Hooks::FrameScript::TokenIdGetter* getId)
        : hasN(false), getGuid(getGuid), getId(getId)
    {}
    CustomTokenDetails(Hooks::FrameScript::TokenNGuidGetter* getGuid, Hooks::FrameScript::TokenIdNGetter* getId)
        : hasN(true), getGuidN(getGuid), getIdN(getId)
    {}

    bool hasN;
    union {
        Hooks::FrameScript::TokenGuidGetter* getGuid;
        Hooks::FrameScript::TokenNGuidGetter* getGuidN;
    };
    union {
        Hooks::FrameScript::TokenIdGetter* getId;
        Hooks::FrameScript::TokenIdNGetter* getIdN;
    };
};
static std::unordered_map<std::string, CustomTokenDetails> s_customTokens;
void Hooks::FrameScript::registerToken(const char* token, TokenGuidGetter* getGuid, TokenIdGetter* getId) { s_customTokens[token] = { getGuid, getId }; }
void Hooks::FrameScript::registerToken(const char* token, TokenNGuidGetter* getGuid, TokenIdNGetter* getId) { s_customTokens[token] = { getGuid, getId }; }

static DWORD_PTR GetGuidByKeyword_jmpbackaddr = 0;
static void GetGuidByKeyword_bulk(const char** stackStr, guid_t* guid, unsigned ebp)
{
    const char* asked = stackStr && *stackStr ? *stackStr : NULL;
    // Пустой указатель -- не «токен неизвестен», а вообще нечего спрашивать. Без этого выхода цикл ниже
    // звал strncmp по NULL на пути, который клиент проходит для каждого Unit(): резолвер вызывается внутри
    // чужого кода, и SEH здесь нет.
    // Нулевой приёмник guid'а -- то же самое с другой стороны: ответить некуда, значит claim невозможен, и
    // единственный правильный ход -- отдать токен штатному пути клиента. Иначе запись ответа ниже шла бы
    // по нулевому адресу, то есть клиент закрывался бы молча, на чужом кадре стека.
    if (!asked || !guid) {
        GetGuidByKeyword_jmpbackaddr = 0x0060AD44;
        return;
    }
    // E1-off: hook stays installed, but our tokens never resolve -- the client takes its own
    // 0x0060AD44 path for every token, exactly like a stock client would.
    if (!S().tokenResolve) {
        GetGuidByKeyword_jmpbackaddr = 0x0060AD44;
        return;
    }
    for (auto& [token, conv] : s_customTokens) {
        if (strncmp(*stackStr, token.data(), token.size()) == 0) {
            *stackStr += token.size();
            if (conv.hasN) {
                int n = gc_atoi(stackStr);
                *guid = n > 0 ? conv.getGuidN(n - 1) : 0;
            } else {
                *guid = conv.getGuid();
            }
            afaTrace(ebp, asked, *guid);
            GetGuidByKeyword_jmpbackaddr = 0x0060AD57;
            return;
        }
    }
    GetGuidByKeyword_jmpbackaddr = 0x0060AD44;
}

static void(*GetGuidByKeyword_orig)() = (decltype(GetGuidByKeyword_orig))0x0060AFAA;
static void __declspec(naked) GetGuidByKeyword_hk()
{
    __asm {
        pushad;
        pushfd;
        // cdecl args go on in reverse: (stackStr, guid, ebp). This is the convention proven in the game
        // (A1): arg1 = ADDRESS of the cursor slot [ebp+8] (a char** the resolver walks), arg2 = the guid
        // receiver stored in [ebp+0xC], arg3 = ebp, added now only so the trace can name the caller.
        push ebp;
        push[ebp + 0xC];
        lea eax, [ebp + 0x8];
        push eax;
        call GetGuidByKeyword_bulk;
        add esp, 12;
        popfd;
        popad;

        push GetGuidByKeyword_jmpbackaddr;
        ret;
    }
}

static char** (*GetKeywordsByGuid_orig)(guid_t* guid, size_t* size) = (decltype(GetKeywordsByGuid_orig))0x0060BB70;
static char** GetKeywordsByGuid_hk(guid_t* guid, size_t* size)
{
    char** buf = GetKeywordsByGuid_orig(guid, size);
    // Все три указателя приходят из клиента. Массив мы здесь дописываем своими строками, поэтому каждая
    // ячейка проверяется отдельно: клиент отдаёт восемь слотов, но заполненность их буферов -- его дело,
    // а не наше, и запись в пустой слот была бы записью по нулевому адресу.
    if (!buf || !size || !guid) return buf;
    for (auto& [token, conv] : s_customTokens) {
        if (*size >= 8) break;
        char* slot = buf[*size];
        if (!slot) break;
        if (conv.hasN) {
            int id = conv.getIdN(*guid);
            if (id >= 0) {
                snprintf(slot, 32, "%s%d", token.c_str(), id + 1);
                (*size)++;
            }
        } else {
            if (conv.getId(*guid)) {
                snprintf(slot, 32, "%s", token.c_str());
                (*size)++;
            }
        }
    }
    return buf;
}

static std::vector<Hooks::DummyCallback_t> s_customOnUpdate;
// --- gated resolver patch ---------------------------------------------------------------
// The resolver is only ever asked about tokens from Lua, i.e. inside the per-frame script update,
// while the server-side check checks arrive as packets processed outside it. So we write the 5-byte JMP only
// for the duration of that window and put the original bytes back right after: at any moment chosen by
// a memory read the site is stock. Neither exit falls through into the overwritten bytes, so no
// trampoline relocation is needed (both paths leave through GetGuidByKeyword_jmpbackaddr).
static unsigned char s_guidSiteBytes[5] = { 0 };
static bool s_guidSiteSaved = false;
static bool s_guidSiteOn = false;
static bool s_guidSiteRefused = false;

// Определены ниже, рядом с остальными ручными правками кода; здесь нужны объявления, потому что площадка
// gate включается/выключается из скрипт-апдейта выше по файлу.
static bool siteIsImageCode(DWORD addr, MEMORY_BASIC_INFORMATION* mbiOut);
static bool peekCode5(DWORD addr, unsigned char out[5]);

// Раньше эта функция молча возвращалась при отказе VirtualProtect, а вызывающий всё равно считал площадку
// переключённой. Два следствия: при отказе на включении хук «стоял» только в наших флагах (токены не
// резолвились, и причину нельзя было увидеть), а при отказе на выключении в коде клиента НАВСЕГДА оставался
// наш E9 -- ровно то состояние, которого вся схема gate и должна избегать.
static bool writeGuidSite(const unsigned char bytes[5]) {
    void* site = (void*)0x0060AFAA;
    DWORD old = 0;
    if (!VirtualProtect(site, 5, PAGE_EXECUTE_READWRITE, &old)) return false;
    memcpy(site, bytes, 5);
    FlushInstructionCache(GetCurrentProcess(), site, 5);
    DWORD tmp = 0;
    VirtualProtect(site, 5, old, &tmp);
    return memcmp(site, bytes, 5) == 0;
}

static void guidSiteEnable() {
    if (s_guidSiteOn || s_guidSiteRefused) return;

    // Та же проверка, что у installTailSite: площадка должна быть исполняемым кодом образа, а её байты --
    // теми, что мы однажды сохранили. Писать E9 по адресу, который в этой сборке клиента занят чем-то
    // другим, значит портить чужой код; а если байты изменились с прошлого раза, там уже кто-то стоит, и
    // наше «восстановление» затёрло бы его правку.
    MEMORY_BASIC_INFORMATION mbi = { 0 };
    unsigned char cur[5] = { 0 };
    if (!siteIsImageCode(0x0060AFAA, &mbi) || !peekCode5(0x0060AFAA, cur)) {
        s_guidSiteRefused = true;
        Probe::log("gate: площадка 0x0060AFAA не исполняемый код клиента (state=%08X type=%08X protect=%08X) -- gate выключен",
                   mbi.State, mbi.Type, mbi.Protect);
        return;
    }
    if (!s_guidSiteSaved) {
        memcpy(s_guidSiteBytes, cur, 5);
        s_guidSiteSaved = true;
    } else if (memcmp(cur, s_guidSiteBytes, 5) != 0) {
        s_guidSiteRefused = true;
        Probe::log("gate: байты 0x0060AFAA изменились (%02X %02X %02X %02X %02X вместо %02X %02X %02X %02X %02X) -- gate выключен",
                   cur[0], cur[1], cur[2], cur[3], cur[4],
                   s_guidSiteBytes[0], s_guidSiteBytes[1], s_guidSiteBytes[2], s_guidSiteBytes[3], s_guidSiteBytes[4]);
        return;
    }

    unsigned char jmp[5] = { 0xE9, 0, 0, 0, 0 };
    *(DWORD*)(jmp + 1) = (DWORD)(DWORD_PTR)&GetGuidByKeyword_hk - 0x0060AFAA - 5;
    if (!writeGuidSite(jmp)) {
        s_guidSiteRefused = true;
        Probe::log("gate: запись E9 в 0x0060AFAA не удалась (%lu) -- gate выключен", GetLastError());
        return;
    }
    s_guidSiteOn = true;
}

static void guidSiteDisable() {
    if (!s_guidSiteOn) return;
    if (!writeGuidSite(s_guidSiteBytes)) {
        // Снять правку не удалось: флаг НЕ сбрасываем, иначе следующий кадр попробовал бы записать E9
        // поверх E9 и посчитал бы это нормой. В коде клиента остался наш переход, и об этом надо сказать.
        Probe::log("gate: вернуть стоковые байты 0x0060AFAA НЕ удалось (%lu) -- правка осталась в коде клиента",
                   GetLastError());
        return;
    }
    s_guidSiteOn = false;
}

void Hooks::FrameScript::registerOnUpdate(DummyCallback_t func) { s_customOnUpdate.push_back(func); }

static int(*FrameScript_FireOnUpdate_orig)(int a1, int a2, int a3, int a4) = (decltype(FrameScript_FireOnUpdate_orig))0x00495810;

// Наша часть кадра вынесена в отдельную функцию: обёртка ниже пользуется __try/__finally, а в функции с
// C++-объектами, у которых есть деструктор (здесь это итератор вектора), SEH-обёртку поставить нельзя (C2712).
static void fireOnUpdateBody()
{
    // Runs on the script-update thread with a live Lua state, which is exactly the moment upstream
    // waited for by hooking OpenFrameXMLApi/CVars_Initialize.
    if (S().scope >= 2) ensureLuaApiInCurrentState();
    if (S().scope >= 4) ensureCustomCVars();
    for (auto func : s_customOnUpdate)
        func();
}

static int FrameScript_FireOnUpdate_hk(int a1, int a2, int a3, int a4)
{
    // gate открывает площадку резолвера на время кадра. Смысл в этом есть только когда резолвер вообще наш:
    // при scope=0 токены не перехватываются, и прежний код всё равно писал E9 в код клиента каждый кадр --
    // то есть «выключенный» профиль правил клиент ровно так же, как включённый.
    const bool gate = S().gate && S().scope >= 1;
    int ret = 0;
    if (gate) guidSiteEnable();
    // __finally обязателен: без него любой сбой внутри кадра (в нашем колбэке или в самой функции клиента)
    // уходил мимо строки guidSiteDisable, и наш переход оставался в коде клиента до конца сессии -- то
    // есть именно в тот момент, когда площадка гарантированно не стоковая, её никто уже не снимал.
    __try {
        fireOnUpdateBody();
        ret = FrameScript_FireOnUpdate_orig(a1, a2, a3, a4);
    } __finally {
        if (gate) guidSiteDisable();
    }
    return ret;
}

// Public token->guid wrapper (0x0060C1C0). It calls into the resolver above, so hooking it covers the
// same Unit*()/secure-attribute path while leaving the resolver itself untouched -- that is what
// tokensite=c1c0 is for: the fixed-address signature, if any, points at the resolver, not at this one.
static guid_t (__cdecl *GetGuidByUnitID_orig)(const char*) = (decltype(GetGuidByUnitID_orig))0x0060C1C0;
static guid_t __cdecl GetGuidByUnitID_hk(const char* unitId)
{
    if (S().tokenResolve && unitId) {
        guid_t g = 0;
        if (Hooks::FrameScript::resolveToken(unitId, &g)) return g;
    }
    return GetGuidByUnitID_orig(unitId);
}

bool Hooks::FrameScript::resolveToken(const char* token, guid_t* out)
{
    if (!S().tokenResolve) return false;
    for (auto& [name, conv] : s_customTokens) {
        if (strncmp(token, name.data(), name.size()) != 0) continue;
        const char* rest = token + name.size();
        if (conv.hasN) {
            int n = gc_atoi(&rest);
            *out = n > 0 ? conv.getGuidN(n - 1) : 0;
        } else {
            *out = conv.getGuid();
        }
        return true;
    }
    return false;
}

// --- tokensite=tail -------------------------------------------------------------------
// 0x0060AD4B is where the client's own prefix chain ("player", "target", "pet", "partyN", ...) hands
// over the still-unresolved token: [ebp+8] still points at the whole token, [ebp+0xC] is the guid
// receiver and [esi] was just verified to be zero. Same decision point as upstream's 0x0060AFAA, but
// an address that does not appear in the public awesome_wotlk source.
//
// Overwritten bytes at 0x0060AD4B: 8B 55 08 (mov edx,[ebp+8]) 80 3A (cmp byte[edx],.., first 2 of 3)
// -- the stub re-executes both instructions, so partial coverage is fine.
static const DWORD TAIL_SITE = 0x0060AD4B;

// The one question a T1 run must answer besides "did it session break" is "does the Lua side of Unit() actually
// reach this site" -- c1c0 and gate both resolved from C++ while Lua stayed blind. Bounded tracing: a
// nameplate token only shows up here when something asks for one, so this cannot turn into spam.
static long s_tailSeen = 0;
static long s_tailHit = 0;
static volatile long s_tailMatched = 0;  // arrivals whose token carried one of our prefixes
static char s_tailLogged[12][32];
// Self-calibration for the caller address: the C++ selftest is our only caller at scope<=1, so whatever
// caller address appears while it runs is "us". Labelled rather than guessed from a hardcoded range, so
// nobody has to disassemble Wow.exe to read the log. Main thread only, no cross-thread interleaving.
// The address alone is NOT enough, though: 0x0060C1C0 is the client's own public entry for unit tokens,
// so a Lua ask and our probe can arrive with the same return address. The token named by
// beginSelfProbe() is what tells them apart -- and getting this backwards stamps real Lua asks with
// [OURS], which would hide the decisive evidence rather than merely mislabel it.
static volatile long s_selfProbe = 0;
static volatile DWORD s_selfCaller = 0;
static char s_selfAsked[24] = { 0 };
static const char* s_selfOrigin = "[OURS: called from our dll]";
// Token text arrives out of the client's own memory, so it is flattened to printable ASCII everywhere it
// is compared or printed: one stray byte would turn the run's only evidence into mojibake.
static void asciiToken(const char* src, char* dst, size_t dstSize)
{
    size_t i = 0;
    if (src)
        for (; i + 1 < dstSize && src[i]; i++)
            dst[i] = (src[i] >= ' ' && src[i] <= '~') ? src[i] : '?';
    dst[i] = 0;
}
// Arrivals that showed up inside one of our windows but are not the ask we made there: proof that
// somebody else resolves concurrently, and therefore a reason to distrust the OURS/EXTERNAL split.
static volatile long s_tailOverlap = 0;
// Arrivals at the patched site, counted before any of our own early returns, so "the client's wrapper
// route never reaches 0x0060AD4B" is measurable rather than guessed from a missing guid.
static volatile long s_tailEntries = 0;
static volatile long s_tailOurs = 0;      // arrivals during beginSelfProbe..endSelfProbe
static long s_selfProbeEntryMark = 0;
void Hooks::beginSelfProbe(const char* askedToken, const char* originLabel)
{
    asciiToken(askedToken, s_selfAsked, sizeof(s_selfAsked));
    s_selfOrigin = (originLabel && *originLabel) ? originLabel : "[OURS: called from our dll]";
    s_selfProbeEntryMark = s_tailEntries;
    InterlockedIncrement(&s_selfProbe);
}
long Hooks::endSelfProbe() { InterlockedDecrement(&s_selfProbe); return s_tailEntries - s_selfProbeEntryMark; }
// The trace has to name its caller AND its origin: our C++ selftest asks "nameplate1" through the public
// wrapper (0x0060C1C0) every 15 s, and the client's own Lua path reaches that same wrapper with the same
// return address, so an address alone cannot tell "our probe" from "Unit() asked" -- which is the one thing
// T1 is supposed to prove. Hence: inside-window + same-token + same-caller, with the window naming itself.
static void tailTrace(const char* tok, guid_t g, DWORD caller)
{
    char safe[24];
    asciiToken(tok, safe, sizeof(safe));

    s_tailSeen++;
    if (g) s_tailHit++;
    const bool askedHere = s_selfProbe != 0 && !strcmp(safe, s_selfAsked);
    if (s_selfProbe && !askedHere) InterlockedIncrement(&s_tailOverlap);
    if (askedHere && !s_selfCaller) s_selfCaller = caller;
    const bool ours = askedHere && s_selfCaller != 0 && caller == s_selfCaller;
    char key[32];
    snprintf(key, sizeof(key), "%s@%08X", safe, caller);
    int freeSlot = -1;
    for (int i = 0; i < 12; i++) {
        if (!s_tailLogged[i][0]) { freeSlot = i; break; }
        if (!strcmp(s_tailLogged[i], key)) return;
    }
    if (freeSlot < 0) return;
    snprintf(s_tailLogged[freeSlot], sizeof(s_tailLogged[0]), "%s", key);
    // ASCII only: aw_probe.log is read next to the client's own logs, and Cyrillic here would land as
    // mojibake depending on the editor.
    Probe::log("tail: '%s' -> %s from=%08X %s (asks=%ld ours=%ld resolved=%ld)", safe,
               g ? "resolved" : "left to stock", caller,
               ours ? s_selfOrigin : "[EXTERNAL: asked by the client itself]",
               s_tailSeen, (long)s_tailMatched, s_tailHit);
}

// Shared attribution for BOTH resolver sites: an arrival is ours only if it landed inside one of our probe
// windows AND carries the token we asked there -- 0x0060C1C0 is the client's own public entry, so a Lua ask
// and our probe can share the same return address, and address alone would mislabel both ways.
static const char* attributeAsk(unsigned ebp, const char* tok, DWORD* callerOut)
{
    const DWORD caller = *(const DWORD*)(ebp + 4);
    if (callerOut) *callerOut = caller;
    char safe[24];
    asciiToken(tok, safe, sizeof(safe));
    const bool askedHere = s_selfProbe != 0 && !strcmp(safe, s_selfAsked);
    if (s_selfProbe && !askedHere) InterlockedIncrement(&s_tailOverlap);
    if (askedHere && !s_selfCaller) s_selfCaller = caller;
    return (askedHere && s_selfCaller && caller == s_selfCaller) ? "[OURS: our C++ probe]"
                                                                 : "[EXTERNAL: asked by the client]";
}

// The afaa site (0x0060AFAA) is the one that works in the game, so it needs the same question the tail site
// answered: does the client reach it about OUR token without us asking? Without this a failed /tar cannot be
// split into "Lua never got here" / "we answered and the client still did not target" / "never called at all".
static void afaTrace(unsigned ebp, const char* asked, guid_t g)
{
    static long traced = 0, matched = 0;
    static char logged[8][40];
    matched++;
    char safe[24];
    asciiToken(asked, safe, sizeof(safe));
    DWORD caller = 0;
    const char* who = attributeAsk(ebp, asked, &caller);
    char key[40];
    // The resolved bit belongs in the key: the first eight asks of the 21:25 run were all loading-phase
    // zero-guid answers, and with a token+caller key they filled the whole table and hid the real evidence
    // that came later, when plates existed.
    snprintf(key, sizeof(key), "%s@%08X%c", safe, caller, g ? 'y' : 'n');
    for (int i = 0; i < 8; i++) if (logged[i][0] && !strcmp(logged[i], key)) return;
    int slot = 0;
    while (slot < 8 && logged[slot][0]) slot++;
    if (slot >= 8 && g) {
        // Full table must not mean "the interesting answers never get printed": in the 22:26 session the
        // eight loading-phase zero answers filled every slot, so 53 later answers with real guids were
        // dropped and the log looked as if nothing resolved. A real answer evicts a zero answer.
        slot = 8;
        for (int i = 0; i < 8; i++) {
            size_t len = strlen(logged[i]);
            if (len && logged[i][len - 1] == 'n') { slot = i; break; }
        }
        if (slot >= 8) return;
    } else if (slot >= 8) return;
    snprintf(logged[slot], sizeof(logged[0]), "%s", key);
    Probe::log("afaa: '%s' -> %08X%08X from=%08X %s (matched=%ld traced=%ld)", safe,
               (unsigned)(g >> 32), (unsigned)g, caller, who, matched, ++traced);
}

// Re-entrancy and claim rate, measured rather than argued. The run of 29.09 18:29 is why: the patch was
// live for the first time and the client ended up burning ~0.5 core while the sampler thread (separate
// thread, 15 s tick) went silent for minutes -- the shape of a loop, not of a wait. A claim that hands
// control back to the client's "is the guid ready" test can fall straight back into our own JMP, so the
// depth counter shows whether the resolver re-enters through us, and the throttle turns a runaway claim
// loop into an unresolved token (dead feature) instead of a frozen client. Counts, not the client's
// stability, are the product here: a hang of our own making must never be readable as "the server
// dropped the session us".
static volatile long s_tailDepth = 0;
static volatile long s_tailMaxDepth = 0;
static volatile long s_tailWatchdog = 0;
static volatile DWORD s_claimWindowTick = 0;
static volatile long s_claimsInWindow = 0;
static bool claimThrottleAllows()
{
    const DWORD now = GetTickCount();
    if (now - s_claimWindowTick >= 1000) { s_claimWindowTick = now; s_claimsInWindow = 0; }
    return ++s_claimsInWindow <= 8;
}

// The placement question for the Lua route: `external` counts arrivals that did not come from our own
// probe, and every one of them is traced by name in tailTrace -- so "arrivals>0 but matched=0" is readable
// as "the client's route does come through, and here are the tokens it actually asks with".
void Hooks::tailStats(long* arrivals, long* matched, long* external, long* overlap, long* depth, long* watchdog)
{
    *arrivals = s_tailEntries;
    *matched = s_tailMatched;
    *external = s_tailEntries - s_tailOurs;
    *overlap = s_tailOverlap;
    *depth = s_tailMaxDepth;
    *watchdog = s_tailWatchdog;
}

// Reads up to n-1 printable bytes at p; returns false if p is not readable or starts with garbage.
static bool asciiAt(const void* p, char* dst, int n)
{
    dst[0] = 0;
    const char* s = (const char*)p;
    if (!p) return false;
    __try {
        int i = 0;
        for (; i < n - 1 && s[i] >= ' ' && s[i] <= '~'; i++) dst[i] = s[i];
        dst[i] = 0;
        return i > 0;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        dst[0] = 0;
        return false;
    }
}

// What the three-candidate dump could not answer: at this site NONE of A/B/C held text during our own
// "nameplate1" ask (all three printed empty, in every frame, and [ebp+8] carried the same value across two
// different frames). A layout cannot be picked from candidate guesses, so this prints the raw window of
// the frame plus one level of dereference, read-only: the slot whose pointer shows a token is the string,
// and that decides where a claim must read and where it must write. First three arrivals only -- 0x0060AD4B
// sits on the client's hot route (measured 23 213 external arrivals in 4 minutes), so it must stay rare.
static void dumpTailFrame(unsigned ebp)
{
    static int printed = 0;
    if (printed >= 3) return;
    printed++;
    unsigned ret = 0, w[9] = { 0 };
    __try {
        ret = *(const unsigned*)(ebp + 4);
        for (int i = 0; i < 9; i++) w[i] = *(const unsigned*)(ebp + i * 4);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        Probe::log("tail frame #%d: ebp=%08X unreadable (%lu)", printed, ebp, GetLastError());
        return;
    }
    char win[128];
    snprintf(win, sizeof(win), "w0..w8=%08X,%08X,%08X,%08X,%08X,%08X,%08X,%08X,%08X",
             w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8]);
    char deep[160] = { 0 };
    int at = 0;
    for (int i = 2; i < 9 && at < (int)sizeof(deep) - 24; i++) {
        char txt[20];
        if (!asciiAt((const void*)(size_t)w[i], txt, sizeof(txt))) continue;
        int n = snprintf(deep + at, sizeof(deep) - at, " w%d->\"%s\"", i, txt);
        if (n <= 0) break;
        at += n;
    }
    Probe::log("tail frame #%d: ebp=%08X ret=%08X %s%s", printed, ebp, ret, win, deep);
}

// One guarded read. The first version of the hunt wrapped the whole scan in a single __try and a single
// unreadable candidate (at t+19s: "read fault at ebp=0431FCD8 (0)") killed the search for the entire run --
// exactly the kind of instrument that reports "not found" when the real answer is "I could not look".
static bool peek(unsigned addr, void* dst, size_t n)
{
    __try {
        memcpy(dst, (const void*)(size_t)addr, n);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
    return true;
}

static bool textIsAt(unsigned p, const char* tok, size_t len)
{
    char buf[32];
    if (!p || len == 0 || len + 1 > sizeof(buf)) return false;
    if (!peek(p, buf, len + 1)) return false;
    return memcmp(buf, tok, len) == 0 && (buf[len] == 0 || buf[len] == ' ');
}

// Search, don't guess. Registers count as much as the stack here: the continuation at 0x0060AD57 is
// `push edi, esi, eax; call 0x0060AA9A`, so the cursor and the receiver travel in registers, and the
// instruction we replaced (`mov edx,[ebp+8]`) reads a stack slot. Layouts are named in the output, so the
// next claim can use the measured one instead of a note that turned out to be wrong twice.
static void huntTailFrame(unsigned ebp, unsigned regs)
{
    static int tries = 0, found = 0;
    static const struct { const char* name; int off; } kRegs[6] =
        { { "edi", 0x00 }, { "esi", 0x04 }, { "ebx", 0x10 }, { "edx", 0x14 }, { "ecx", 0x18 }, { "eax", 0x1C } };
    if (found >= 3 || tries >= 40) return;
    if (!s_selfProbe || !s_selfAsked[0]) return;
    tries++;
    const size_t len = strlen(s_selfAsked);

    for (int r = 0; r < 6; r++) {
        unsigned v = 0, w = 0;
        if (!peek(regs + kRegs[r].off, &v, sizeof(v))) continue;
        if (textIsAt(v, s_selfAsked, len)) {
            Probe::log("tail hunt #%d: '%s' = char* in %s (%08X)", ++found, s_selfAsked, kRegs[r].name, v);
            return;
        }
        if (v && peek(v, &w, sizeof(w)) && textIsAt(w, s_selfAsked, len)) {
            Probe::log("tail hunt #%d: '%s' = char** in %s (%08X -> %08X)", ++found, s_selfAsked, kRegs[r].name, v, w);
            return;
        }
    }
    for (int off = -0x40; off <= 0x60; off += 4) {
        unsigned v = 0, w = 0;
        if (!peek(ebp + (unsigned)off, &v, sizeof(v))) continue;
        if (textIsAt(v, s_selfAsked, len)) {
            Probe::log("tail hunt #%d: '%s' = char* in [ebp%+d] (%08X)", ++found, s_selfAsked, off, v);
            return;
        }
        if (v && peek(v, &w, sizeof(w)) && textIsAt(w, s_selfAsked, len)) {
            Probe::log("tail hunt #%d: '%s' = char** in [ebp%+d] (%08X -> %08X)", ++found, s_selfAsked, off, v, w);
            return;
        }
    }
    // Last, in case the token was copied inline into the frame rather than reached through a pointer.
    for (int off = -0x40; off <= 0x60; off++) {
        char raw[32];
        if (len + 1 > sizeof(raw) || !peek(ebp + (unsigned)off, raw, len + 1)) continue;
        if (memcmp(raw, s_selfAsked, len) == 0) {
            Probe::log("tail hunt #%d: '%s' written inline at [ebp%+d]", ++found, s_selfAsked, off);
            return;
        }
    }
    if (tries == 40 && !found)
        Probe::log("tail hunt: '%s' not found in regs or [ebp-0x40..ebp+0x60] over %d tries", s_selfAsked, tries);
}

// The work itself, without accounting: called through ResolveTail(), which measures re-entrancy and
// applies the claim throttle. Everything here runs inside the client's unit-token resolver, on whatever
// thread the client happens to resolve on, at any moment of loading -- so this body must stay cheap and
// must never hand control back to a point that can fall into our own JMP again.
static bool resolveTailWork(unsigned ebp)
{
    if (!S().tokenResolve) return false;
    const char** slot = (const char**)(ebp + 8);
    const char* str = *slot;
    if (!str || !*str) return false;
    guid_t* out = *(guid_t**)(ebp + 0xC);
    if (!out) return false;
    const DWORD caller = *(DWORD*)(ebp + 4);
    for (auto& [name, conv] : s_customTokens) {
        if (strncmp(str, name.data(), name.size()) != 0) continue;
        const char* rest = str + name.size();
        guid_t g;
        if (conv.hasN) {
            int n = gc_atoi(&rest);
            g = n > 0 ? conv.getGuidN(n - 1) : 0;
        } else {
            g = conv.getGuid();
        }
        s_tailMatched++;
        tailTrace(str, g, caller);
        // A token whose plate is gone stays untouched: the stub then takes the client's own unknown-token
        // path and "nameplateN with no plate N" answers nil, exactly as stock answers a token it does not
        // know. Claiming with a zero guid would leave the client's continuation working on nothing.
        if (!g) return false;
        if (!claimThrottleAllows()) { s_tailWatchdog++; return false; }
        *out = g;
        *slot = rest;
        return true;
    }
    // A token that is not ours still gets a line: without it "arrivals>0, matched=0" would be a counter
    // nobody can interpret, and this is precisely the branch that decides whether the client's Lua route
    // reaches the site at all.
    tailTrace(str, 0, caller);
    return false;
}

static bool __cdecl ResolveTail(unsigned ebp, unsigned regs)
{
    s_tailEntries++;
    if (s_selfProbe) s_tailOurs++;
    dumpTailFrame(ebp);
    huntTailFrame(ebp, regs);
    const long d = InterlockedIncrement(&s_tailDepth);
    if (d > s_tailMaxDepth) s_tailMaxDepth = d;
    const bool r = resolveTailWork(ebp);
    InterlockedDecrement(&s_tailDepth);
    return r;
}

static volatile long s_tailResult = 0;

__declspec(naked) static void GetGuidTail_hk()
{
    __asm {
        pushad;
        pushfd;
        mov eax, esp;
        add eax, 4;            // PUSHAD block base: EDI@+0, ESI@+4, EBX@+0x10, EDX@+0x14, ECX@+0x18, EAX@+0x1C
        push eax;              // arg2 = snapshot of the client's registers at this instruction
        push ebp;              // arg1 = the resolver's frame
        call ResolveTail;
        add esp, 8;
        mov s_tailResult, eax;   // keep it: popad would overwrite the flags we branch on
        popfd;
        popad;
        cmp s_tailResult, 0;
        jnz Lhandled;
        mov edx, [ebp + 0x8];      // re-execute what we overwrote
        cmp byte ptr [edx], 0;
        jnz LnotOurs;
        push 0x0060AD57;           // MSVC inline asm has no absolute jmp; every exit here rebuilds
        ret;                       // esp from ebp, so the extra dword is harmless
    LnotOurs:
        push 0x0060AFDB;
        ret;
    Lhandled:
        // 0x0060AD57 -- the continuation the client itself takes once the guid is ready ("guid готов ->
        // jne 0x60AD57"), with [ebp+8] already moved past our keyword. NOT 0x0060AD44: that is the guid
        // *test*, and if the client's own scratch (esi) does not read back what we wrote, control falls
        // through 0x0060AD4B straight into our JMP again -- an endless loop with the token already
        // consumed. That is the freeze measured on 29.09 18:29 (CPU climbing, sampler thread silent).
        push 0x0060AD57;
        ret;
    }
}

static unsigned char s_tailOriginal[5] = { 0 };
static bool s_tailPatched = false;

// In the test host these client addresses land on its own heap, which may be unmapped or hold a
// look-alike pattern, so no patch site may simply be dereferenced. peekCode5 is the only way to look at
// one, and patchJump5 re-checks before it writes.
// MEM_IMAGE is a value of MEMORY_BASIC_INFORMATION::Type, not of ::State (State carries MEM_COMMIT) --
// comparing it against State made this return false for every real code page, so in the game the manual
// JMP sites all refused to install while the audit happily read their bytes (run of 29.09 18:16:
// "site 0x0060AD4B is not readable client code" + "tail site ... NOT installed").
static bool siteIsImageCode(DWORD addr, MEMORY_BASIC_INFORMATION* mbiOut = NULL)
{
    MEMORY_BASIC_INFORMATION mbi = { 0 };
    VirtualQuery((void*)addr, &mbi, sizeof(mbi));
    if (mbiOut) *mbiOut = mbi;
    if (mbi.State != MEM_COMMIT || mbi.Type != MEM_IMAGE) return false;
    return (mbi.Protect & (PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY)) != 0;
}

static bool peekCode5(DWORD addr, unsigned char out[5])
{
    if (!siteIsImageCode(addr)) return false;
    __try {
        memcpy(out, (const void*)addr, 5);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
    return true;
}

// Writes a 5-byte E9 rel32 over `addr`, or refuses if it is not an executable image page (we are about
// to modify the client's code section, so a heap page or a private mapping means the addresses belong to
// something else -- the test host's own heap can and does accidentally hold a matching byte pattern).
static bool patchJump5(DWORD addr, void* target, unsigned char saved[5])
{
    MEMORY_BASIC_INFORMATION mbi = { 0 };
    if (!siteIsImageCode(addr, &mbi) || !peekCode5(addr, saved)) {
        Probe::log("patch: %08X is not writable client code (state=%08X type=%08X protect=%08X), refusing",
                   addr, mbi.State, mbi.Type, mbi.Protect);
        return false;
    }
    unsigned char jmp[5] = { 0xE9, 0, 0, 0, 0 };
    *(DWORD*)(jmp + 1) = (DWORD)(DWORD_PTR)target - addr - 5;
    DWORD old = 0;
    if (!VirtualProtect((void*)addr, 5, PAGE_EXECUTE_READWRITE, &old)) {
        Probe::log("patch: VirtualProtect(%08X) failed (%lu)", addr, GetLastError());
        return false;
    }
    memcpy((void*)addr, jmp, 5);
    FlushInstructionCache(GetCurrentProcess(), (void*)addr, 5);
    DWORD tmp = 0;
    VirtualProtect((void*)addr, 5, old, &tmp);
    return memcmp((const void*)addr, jmp, 5) == 0;
}

static void restoreJump5(DWORD addr, const unsigned char saved[5])
{
    DWORD old = 0;
    if (!VirtualProtect((void*)addr, 5, PAGE_EXECUTE_READWRITE, &old)) return;
    memcpy((void*)addr, saved, 5);
    FlushInstructionCache(GetCurrentProcess(), (void*)addr, 5);
    DWORD tmp = 0;
    VirtualProtect((void*)addr, 5, old, &tmp);
}

bool Hooks::installTailSite()
{
    if (s_tailPatched) return true;
    static const unsigned char STOCK[5] = { 0x8B, 0x55, 0x08, 0x80, 0x3A }; // mov edx,[ebp+8]; cmp byte[edx],..
    unsigned char cur[5];
    MEMORY_BASIC_INFORMATION mbi = { 0 };
    if (!siteIsImageCode(TAIL_SITE, &mbi) || !peekCode5(TAIL_SITE, cur)) {
        // state/type/protect are printed with the same numbers the `modules:` line uses for our own dll
        // (MEM_COMMIT=0x1000, MEM_IMAGE=0x1000000), so a refusal names its reason without a debugger.
        Probe::log("tail: site 0x0060AD4B is not writable client code (state=%08X type=%08X protect=%08X), refusing",
                   mbi.State, mbi.Type, mbi.Protect);
        return false;
    }
    if (memcmp(cur, STOCK, 5) != 0) {
        Probe::log("tail: site is not stock (%02X %02X %02X %02X %02X), refusing to patch", cur[0], cur[1], cur[2], cur[3], cur[4]);
        return false;
    }
    if (patchJump5(TAIL_SITE, &GetGuidTail_hk, s_tailOriginal)) s_tailPatched = true;
    else memset(s_tailOriginal, 0, sizeof(s_tailOriginal));
    return s_tailPatched;
}

void Hooks::removeTailSite()
{
    if (!s_tailPatched) return;
    restoreJump5(TAIL_SITE, s_tailOriginal);
    s_tailPatched = false;
}

// --- scope>=3: events without touching FillEvents' published prologue -----------------------------
// FrameScript::FillEvents(0x0081B5F0) is cdecl(list, count) and rebuilds the whole event table from the
// array it is handed (resize at 0x81B632, and count==0 wipes it), so it cannot be called a second time
// with just our names. Upstream solves that by detouring it -- which puts a patch at an address that is
// in the public source. The client calls it from exactly two places, both a plain 5-byte `E8 rel32`:
//   0x004DA757  push 0x29,  push 0xB6AFF8   (41 names, glue/login script init)
//   0x0052AB25  push 0x2D2, push 0xC24EB0   (722 names, in-game init; CVars_Initialize follows)
// Overwriting the call itself is enough: the stub reads the caller's own arguments off the stack, calls
// FillEvents with an extended array, then continues after the call with the stack exactly as it was.
typedef void (__cdecl *FillEvents_t)(const char** list, size_t count);
static const DWORD FILL_EVENTS_FN = 0x0081B5F0;
static const DWORD FILL_EVENTS_SITES[2] = { 0x004DA757, 0x0052AB25 };
static unsigned char s_fillEventsOriginal[2][5] = { { 0 }, { 0 } };
// Состояние каждой площадки отдельно. Раньше флаг был один и ставился только при полном успехе: если первая
// площадка записалась, а вторая нет, функция отвечала «не установлено», а снять уже записанную правку было
// нечем -- E9 оставался в коде клиента до выхода из игры.
static bool s_fillEventsSiteOn[2] = { false, false };
static bool s_fillEventsPatched = false;

static void __cdecl FillEventsWithExtra(const char** list, size_t count)
{
    FillEvents_t raw = (FillEvents_t)FILL_EVENTS_FN;
    if (!list || s_customEvents.empty()) { raw(list, count); return; }
    std::vector<const char*> events;
    events.reserve(count + s_customEvents.size());
    for (size_t i = 0; i < count; i++) events.push_back(list[i]);
    for (auto& name : s_customEvents) events.push_back(name);
    // Proof for the in-game run that the call really was redirected and the arguments were read correctly:
    // count has to come back as the client's own number (41 or 722) plus our names. Without this a broken
    // stub and a stock client look identical from Lua.
    Probe::log("events: %u + %d custom -> %u (first='%s' added='%s')", (unsigned)count,
               (int)s_customEvents.size(), (unsigned)events.size(),
               count == 0 ? "(none)" : (list[0] ? list[0] : "(null)"), s_customEvents.front());
    raw(events.data(), events.size());
}

// At entry [esp] = list, [esp+4] = count: replacing `call` with `jmp` means no return address was pushed,
// so the caller's two pushes are still on top of the stack. pushad+pushfd shifts esp by 36, which puts both
// operands at [esp+0x28] *at their own moment* (the first push is what moves list into that slot). Only
// [ebp+8]/[ebp+0xC] are read by FillEvents, and popad leaves esp exactly where a real `ret` would have left
// it, so the caller's own cleanup (the in-game site does `add esp,0xc` for a third stale dword) is
// unaffected. MSVC's inline assembler is line-oriented, so the two sites are written out rather than
// shared through a macro.
__declspec(naked) static void FillEventsSiteGlue_hk()
{
    __asm {
        pushad;
        pushfd;
        push dword ptr [esp + 0x28];
        push dword ptr [esp + 0x28];
        call FillEventsWithExtra;
        add esp, 8;
        popfd;
        popad;
        push 0x004DA75C;
        ret;
    }
}

__declspec(naked) static void FillEventsSiteInGame_hk()
{
    __asm {
        pushad;
        pushfd;
        push dword ptr [esp + 0x28];
        push dword ptr [esp + 0x28];
        call FillEventsWithExtra;
        add esp, 8;
        popfd;
        popad;
        push 0x0052AB2A;
        ret;
    }
}


bool Hooks::installFillEventsSites()
{
    if (s_fillEventsPatched) return true;
    void* stubs[2] = { &FillEventsSiteGlue_hk, &FillEventsSiteInGame_hk };
    bool all = true;
    for (int i = 0; i < 2; i++) {
        if (s_fillEventsSiteOn[i]) continue;
        unsigned char p[5];
        if (!peekCode5(FILL_EVENTS_SITES[i], p)) {
            Probe::log("events: site %d (%08X) is not readable client code", i, FILL_EVENTS_SITES[i]);
            all = false;
            continue;
        }
        // E8 <rel32> that really targets FillEvents -- on any other client build these bytes differ, and
        // then blindly writing a JMP would corrupt unrelated code.
        const bool isCallToFillEvents = p[0] == 0xE8 &&
            (FILL_EVENTS_SITES[i] + 5 + *(const DWORD*)(p + 1)) == FILL_EVENTS_FN;
        if (!isCallToFillEvents) {
            Probe::log("events: site %d (%08X) is not a call to FillEvents (%02X %02X %02X %02X %02X)",
                       i, FILL_EVENTS_SITES[i], p[0], p[1], p[2], p[3], p[4]);
            all = false;
            continue;
        }
        if (!patchJump5(FILL_EVENTS_SITES[i], stubs[i], s_fillEventsOriginal[i])) { all = false; continue; }
        s_fillEventsSiteOn[i] = true;
        Probe::log("events: call site %08X replaced, %s", FILL_EVENTS_SITES[i],
                   i ? "in-game init" : "glue init");
    }
    s_fillEventsPatched = all;
    return all;
}

void Hooks::removeFillEventsSites()
{
    // Снимаем каждую площадку, которую действительно записали, независимо от «все ли встали».
    for (int i = 0; i < 2; i++) {
        if (!s_fillEventsSiteOn[i]) continue;
        restoreJump5(FILL_EVENTS_SITES[i], s_fillEventsOriginal[i]);
        s_fillEventsSiteOn[i] = false;
    }
    s_fillEventsPatched = false;
}

void Hooks::initialize()
{
    // Exactly one detour is left: FireOnUpdate (0x00495810 -- the clean control build hooks the very same
    // address, so it cannot be the thing the server reads back). Everything else is either driven from
    // that per-frame callback (Lua globals, CVars) or relocated off the published address (tail site for
    // the token, call sites for FillEvents).
    // cameraFov and the macro flags are applied from the same per-frame callback, so they need it as well;
    // the token sites below stay behind scope>=1.
    if ((S().scope >= 1 || S().camera || S().macros) && !S().drhook)
        DetourAttach(&(LPVOID&)FrameScript_FireOnUpdate_orig, FrameScript_FireOnUpdate_hk);

    if (S().scope >= 1 && !S().drhook) {
        switch (S().tokenSite) {
        case 0: // upstream layout: resolver + reverse lookup (gate=1 keeps the resolver patch only
                // during the per-frame Lua window, and skips the reverse site altogether)
            if (!S().gate) {
                DetourAttach(&(LPVOID&)GetGuidByKeyword_orig, GetGuidByKeyword_hk);
                DetourAttach(&(LPVOID&)GetKeywordsByGuid_orig, GetKeywordsByGuid_hk);
            }
            break;
        case 1: // c1c0: the public wrapper -- proven NOT to cover the Lua Unit*/tar path
            DetourAttach(&(LPVOID&)GetGuidByUnitID_orig, GetGuidByUnitID_hk);
            break;
        case 2: // tail: manual JMP at 0x0060AD4B, installed by Entry after the transaction
            break;
        }
    }
}

// --- DR mode: same two entry points, but trapped through debug registers instead of patched.
// Nothing in the client image is written, so a memory read there returns stock bytes and the
// client's own function-pointer check never sees our code (no need to disable it).

static void drOnGuid(PCONTEXT ctx)
{
    // Same frame as the detour at 0x0060AFAA: cursor slot at [ebp+8], receiver pointer at [ebp+0xC]. The
    // earlier version of this line had the two swapped -- that is the note that made me doubt the tail
    // layout, and it was the DR path that was wrong, not the tail.
    const char** stackStr = (const char**)((BYTE*)ctx->Ebp + 0x8);
    guid_t* guid = *(guid_t**)((BYTE*)ctx->Ebp + 0xC);
    GetGuidByKeyword_bulk(stackStr, guid, ctx->Ebp);
    ctx->Eip = GetGuidByKeyword_jmpbackaddr; // skip the trapped instruction, land where the detour did
}

static void drOnUpdate(PCONTEXT ctx)
{
    for (auto func : s_customOnUpdate)
        func();
    // Resume past the trapped instruction by emulating its prologue (55 8B EC = push ebp; mov ebp,esp)
    // instead of relying on the Resume Flag from a context edit, which is not applied reliably and
    // otherwise re-traps on the same address forever.
    ctx->Esp -= 4;
    *(DWORD*)ctx->Esp = ctx->Ebp;
    ctx->Ebp = ctx->Esp;
    ctx->Eip = 0x00495810 + 3;
}

void Hooks::initializeDr()
{
    if (S().scope < 1) return;
    DrHook::install((void*)0x0060AFAA, drOnGuid);
    DrHook::install((void*)0x00495810, drOnUpdate);
    // No arm() here: arming suspends the main thread, so it must happen on the keeper thread.
    Probe::log("dr: %d slots installed (arming by keeper thread, ~2 s)", DrHook::installedCount());
}

// Public form of the same check, for the modules that attach outside this file (Misc, BugFixes).
bool Hooks::isImageCode(DWORD addr, MEMORY_BASIC_INFORMATION* mbiOut)
{
    return siteIsImageCode(addr, mbiOut);
}