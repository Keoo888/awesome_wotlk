#include "DrHook.h"
#include "Probe.h"
#include <cstring>

namespace {

// Our own exception code, kept so a deliberate raise can still re-arm from the target thread if we
// ever need it. Primary arming path is SetThreadContext from the keeper thread (see arm()).
const DWORD ARM_MAGIC = 0x44524131; // "DRA1"

struct Slot { void* addr; DrHook::HitFn_t fn; } g_slots[4];
int g_count = 0;
volatile unsigned long g_hits = 0;
volatile unsigned long g_rearms = 0;
PVOID g_veh = NULL;
HANDLE g_self = NULL;
DWORD g_selfTid = 0;

// Dr7 layout: for slot i the enable bits are 2i (GE, global) and 2i+1 (LE, local) -- stride 2, not 4;
// condition is bits 16+4i (00b = execution) and length bits 18+4i (11b: ignored for execution but
// 01b/10b get rejected on some CPUs). We set both GE and LE because the kernel normalises a context
// apply to the global bit.
DWORD wantedDr7() {
    DWORD dr7 = 0;
    for (int i = 0; i < g_count; i++) {
        dr7 |= (3u << (2 * i));
        dr7 |= (3u << (18 + 4 * i));
    }
    return dr7;
}

void applyRegs(PCONTEXT ctx) {
    for (int i = 0; i < g_count; i++) {
        DWORD_PTR a = (DWORD_PTR)g_slots[i].addr;
        switch (i) {
        case 0: ctx->Dr0 = a; break;
        case 1: ctx->Dr1 = a; break;
        case 2: ctx->Dr2 = a; break;
        default: ctx->Dr3 = a; break;
        }
    }
    ctx->Dr7 = wantedDr7();
    ctx->ContextFlags |= CONTEXT_DEBUG_REGISTERS;
}

LONG CALLBACK veh(PEXCEPTION_POINTERS p) {
    DWORD code = p->ExceptionRecord->ExceptionCode;
    static int seen = 0;
    if (seen < 8) {
        seen++;
        Probe::log("veh: code=%08X eip=%08X (slot0=%08X slot1=%08X)", code,
            (DWORD)p->ContextRecord->Eip, g_count > 0 ? (DWORD)g_slots[0].addr : 0,
            g_count > 1 ? (DWORD)g_slots[1].addr : 0);
    }
    if (code == ARM_MAGIC) {
        DrHook::arm();
        return EXCEPTION_CONTINUE_EXECUTION;
    }
    if (code != EXCEPTION_SINGLE_STEP && code != EXCEPTION_BREAKPOINT) return EXCEPTION_CONTINUE_SEARCH;

    PCONTEXT ctx = p->ContextRecord;
    for (int i = 0; i < g_count; i++) {
        if (!g_slots[i].addr || (DWORD)ctx->Eip != (DWORD)g_slots[i].addr) continue;
        g_hits++;
        if (g_slots[i].fn) g_slots[i].fn(ctx);
        return EXCEPTION_CONTINUE_EXECUTION;
    }
    return EXCEPTION_CONTINUE_SEARCH;
}

DWORD WINAPI keeper(LPVOID) {
    Sleep(2000); // let DllMain finish: the main thread holds the loader lock while we are being created
    for (;;) {
        DrHook::arm();
        Sleep(5000);
    }
    return 0;
}

}

bool DrHook::install(void* addr, HitFn_t fn) {
    if (g_count >= 4) return false;
    for (int i = 0; i < g_count; i++)
        if (g_slots[i].addr == addr) return true;
    g_slots[g_count].addr = addr;
    g_slots[g_count].fn = fn;
    g_count++;
    if (!g_veh) g_veh = AddVectoredExceptionHandler(1, veh);
    if (!g_self) {
        bindThread();
        HANDLE h = CreateThread(NULL, 0, keeper, NULL, 0, NULL);
        if (h) CloseHandle(h);
        else Probe::log("dr: keeper thread not started (%lu)", GetLastError());
    }
    return g_veh != NULL && g_self != NULL;
}

void DrHook::bindThread() {
    if (!g_self) {
        g_selfTid = GetCurrentThreadId();
        g_self = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_SET_CONTEXT,
            FALSE, g_selfTid);
    }
}

// Editing debug registers through the CONTEXT of an arbitrary exception does not stick, so arm them
// the documented way: from another thread, suspend -> Get/SetThreadContext -> resume. Running it on a
// timer also puts the registers back after anything (e.g. an server-side check GetThreadContext round) wipes
// Dr7.
void DrHook::arm() {
    if (!g_veh || !g_count || !g_self) return;
    // Suspending the target from itself deadlocks (and the keeper cannot rescue it while DllMain owns
    // the loader lock), so arming is only ever allowed from another thread.
    if (GetCurrentThreadId() == g_selfTid) {
        Probe::log("dr: arm() on the target thread -> skipped (must come from the keeper)");
        return;
    }
    CONTEXT ctx = { 0 };
    ctx.ContextFlags = CONTEXT_DEBUG_REGISTERS;
    bool rearm = false, getFailed = false;
    DWORD err = 0;

    // Nothing that can touch the loader (file IO, CRT init of another dll) may run inside the
    // suspended window: the target thread can hold the loader lock, and we would deadlock it.
    SuspendThread(g_self);
    if (GetThreadContext(g_self, &ctx)) {
        rearm = (ctx.Dr7 & wantedDr7()) != wantedDr7();
        applyRegs(&ctx);
        SetThreadContext(g_self, &ctx);
    } else {
        getFailed = true;
        err = GetLastError();
    }
    ResumeThread(g_self);

    if (getFailed) Probe::log("dr: GetThreadContext failed (%lu)", err);
    else if (rearm) g_rearms++;

    // One-time proof that the kernel kept our registers: read them back from the other thread.
    static bool verified = false;
    if (!verified && g_self) {
        verified = true;
        CONTEXT back = { 0 };
        back.ContextFlags = CONTEXT_DEBUG_REGISTERS;
        SuspendThread(g_self);
        BOOL ok = GetThreadContext(g_self, &back);
        ResumeThread(g_self);
        Probe::log("dr: readback ok=%d Dr0=%08X Dr1=%08X Dr7=%08X (want %08X)", ok ? 1 : 0,
            (DWORD)back.Dr0, (DWORD)back.Dr1, (DWORD)back.Dr7, wantedDr7());
    }
}

int DrHook::installedCount() { return g_count; }
unsigned long DrHook::hitCount() { return g_hits; }
unsigned long DrHook::reArmCount() { return g_rearms; }
