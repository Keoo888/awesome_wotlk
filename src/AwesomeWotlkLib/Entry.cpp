#include "NamePlates.h"
#include "Misc.h"
#include "BugFixes.h"
#include "Camera.h"
#include "Interact.h"
#include "Hooks.h"
#include "Settings.h"
#include "Probe.h"
#include <Windows.h>
#include <Detours/detours.h>


// Глобал `debugbreak` отсюда убран. Это была lua_CFunction, то есть указатель на эту dll, положенный в
// таблицу глобалов клиента -- ровно та конструкция, из-за которой клиент выдаёт ERROR #134 "Invalid
// function pointer", и единственная причина, по которой в сборке вообще оставалась правка диапазона
// указателей (а она -- измеренная причина обрыва сессии на Warmane). Отладочный брейк того не стоит: в
// Debug он всё равно требовал подключённого отладчика, а в Release его никогда и не было.
static int lua_openawesomewotlk(lua_State* L)
{
    lua_pushnumber(L, 1.f);
    lua_setglobal(L, "AwesomeWotlk");
    return 0;
}

// SEH, not C++ try: on a client build that differs from 12340 these fixed addresses may not be
// mapped, and a research dll must not be able to kill the process -- log it and carry on.
// No objects with destructors may live in these functions (C2712).
static void patchPointerRange()
{
    __try {
        *(DWORD*)0x00D415B8 = 1;
        *(DWORD*)0x00D415BC = 0x7FFFFFFF;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        Probe::log("boot: pointer-range patch faulted (%08lX)", GetExceptionCode());
    }
}

static LONG commitTransaction()
{
    LONG commit = -1;
    __try {
        DetourTransactionBegin();
        DetourUpdateThread(GetCurrentThread());
        Hooks::initialize();
        NamePlates::initialize();
        commit = DetourTransactionCommit();
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        // Без abort транзакция остаётся висящей, и следующий DetourTransactionBegin отказывает
        // (ERROR_ALREADY_INITIALIZED): изоляция двух транзакций, ради которой extras вынесены отдельно,
        // на этом кончается -- вторая молча не поставила бы ни одного хука.
        DetourTransactionAbort();
        Probe::log("boot: detour transaction faulted (%08lX)", GetExceptionCode());
    }
    return commit;
}

// cameraFov, the macro hooks and the clipboard fix go in their OWN transaction. Their addresses come from
// the upstream/fork sources, and if any of them turned out not to be attachable on this exact build,
// sharing a transaction with the nameplate profile would let the new feature take down the one that is
// already measured good.
static LONG commitExtras()
{
    LONG commit = -1;
    __try {
        DetourTransactionBegin();
        DetourUpdateThread(GetCurrentThread());
        Misc::initialize();
        BugFixes::initialize();
        CamFade::initialize();
        Interact::initialize();
        commit = DetourTransactionCommit();
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        DetourTransactionAbort();
        Probe::log("boot: extras transaction faulted (%08lX) -- camera/macros/clipboard не поднялись, nameplate не затронут",
            GetExceptionCode());
    }
    return commit;
}

static void OnAttach(HMODULE self)
{
    Probe::initialize(self);
    Probe::log("boot: probe up, settings: %s", S().describe().c_str());

    // The client validates function pointers it is about to call and aborts with ERROR #134 when one lands
    // outside the image range. What actually trips that check is a pointer STORED in client data, not a code
    // patch: measured 29.09 19:39, the offending value (0x704E34B0, base 0x704E0000) resolves through the
    // map to Dummy::lua_gc inside lua_findorcreatevars -- a __gc we used to put in a metatable in the
    // client's Lua state. That pointer is gone now, so at scope<=1 nothing in the client names this dll and
    // the range check has nothing to reject: widening it is unnecessary AND it is the session-break cause
    // (globals patched + resolver E9 -> session break at 5m26s; globals stock + same E9 -> 12m04s clean).
    // From scope>=2 we used to register Lua C functions (and at scope>=4 a CVar handler), which is what forced
    // the patch here. Both are gone: C_NamePlate is now plain data + Lua closures, and nameplateDistance is
    // registered with a NULL handler (measured 29.09 21:18: a C closure in client data = #134 on call). Теперь
    // ни одного указателя на dll в данных клиента не остаётся НИ В ОДНОЙ сборке: Debug-глобал `debugbreak`
    // удалён (см. lua_openawesomewotlk выше). Значит авто-режим ptrPatch всегда отвечает «не надо», и правка
    // диапазона остаётся только как ручной тумблер для измерений -- включать её нельзя.
    const bool storesSelfPointer = false;
    const bool patchRange = S().ptrPatch < 0 ? storesSelfPointer : (S().ptrPatch != 0);
    Probe::log("boot: detours=%d luafuncs=%d ptrpatch=%s", (int)(S().scope >= 1 && !S().drhook),
               (int)storesSelfPointer,
               S().ptrPatch < 0 ? "auto" : (S().ptrPatch ? "forced on" : "forced off"));
    if (patchRange) {
        // Both globals live in uninitialised .data (BSS), so "stock" only exists at runtime: log what
        // the client itself had there before we overwrite it -- that is what an integrity read would see.
        Probe::log("boot: pointer-range globals before patch: [%08X, %08X]", *(DWORD*)0x00D415B8, *(DWORD*)0x00D415BC);
        patchPointerRange();
        Probe::log("boot: pointer-range check patched -> [%08X, %08X]", *(DWORD*)0x00D415B8, *(DWORD*)0x00D415BC);
    }

    Probe::log("boot: detour transaction begin");
    LONG commit = commitTransaction();
    Probe::log("boot: commit = %ld (scope=%d sort=%d drhook=%d)", commit, S().scope, (int)S().sort, (int)S().drhook);

    if (S().camera || S().macros || S().clipboard || S().fade || S().interact)
        Probe::log("boot: extras commit = %ld (camera=%d macros=%d clipboard=%d fade=%d interact=%d)", commitExtras(),
            (int)S().camera, (int)S().macros, (int)S().clipboard, (int)S().fade, (int)S().interact);

    // After the registrations, so the token/onUpdate callbacks are already queued.
    if (S().drhook && S().scope >= 1)
        Hooks::initializeDr();
    else if (S().tokenSite == 2 && S().scope >= 1) {
        // The whole point of this variant is that the published resolver addresses stay untouched,
        // so say plainly whether the single JMP went in -- a run without it proves nothing.
        Probe::log("boot: tail site 0x0060AD4B %s, resolver sites left stock",
                   Hooks::installTailSite() ? "patched" : "NOT installed");
    }

    // NAME_PLATE_* event names: FillEvents is reached through its two call sites, so the function itself
    // is never patched. Has to go in before the client runs its script init.
    if (S().scope >= 3) {
        const bool ok = Hooks::installFillEventsSites();
        Probe::log("boot: FillEvents call sites %s, 0x0081B5F0 left stock", ok ? "replaced" : "NOT installed");
    }

    // Base global; opened into the live Lua state from the per-frame hook (scope >= 2).
    Hooks::FrameXML::registerLuaLib(lua_openawesomewotlk);
    Probe::log("boot: done");
}

int __stdcall DllMain(HMODULE hModule, DWORD reason, LPVOID)
{
    if (reason == DLL_PROCESS_ATTACH)
        OnAttach(hModule);
    return 1;
}
