#include "Probe.h"
#include "Settings.h"
#include "DrHook.h"
#include "Misc.h"
#include "BugFixes.h"
#include "Camera.h"
#include <Windows.h>
#include <tlhelp32.h>
#include <cstdio>
#include <cstdarg>
#include <cstring>

namespace {

char g_logPath[MAX_PATH] = { 0 };
HMODULE g_self = NULL;
DWORD g_startTick = 0;
CRITICAL_SECTION g_lock;

const char* classify(const unsigned char* b) {
    if (b[0] == 0xE9) return "JMP(rel32)";
    if (b[0] == 0xCC) return "INT3";
    if (b[0] == 0xB8) return "MOV EAX,imm32";
    if (b[0] == 0xFF && b[1] == 0x25) return "JMP [addr]";
    if (b[0] == 0x55 && b[1] == 0x8B && b[2] == 0xEC) return "prologue(push ebp)";
    return "other";
}

// Every address awesome_wotlk upstream is known to patch, plus the two relocation targets this build
// uses instead. What a memory read here returns is exactly what the server would compare against a
// stock client.
// A bad read here must not kill the client -- this is a research build, so log it and move on.
static bool readSite(void* addr, unsigned char* out, size_t n) {
    __try {
        memcpy(out, addr, n);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
    return true;
}

void auditSites() {
    struct { const char* name; void* addr; } sites[] = {
        { "CVars_Initialize",      (void*)0x0051D9B0 },
        { "FireOnUpdate",          (void*)0x00495810 },
        { "FillEvents",            (void*)0x0081B5F0 },
        { "FillEventsCallGlue",    (void*)0x004DA757 },
        { "FillEventsCallInGame",  (void*)0x0052AB25 },
        { "OpenFrameXMLApi",       (void*)0x00530F85 },
        { "GetGuidByKeyword",      (void*)0x0060AFAA },
        { "GetGuidTail",           (void*)0x0060AD4B },
        { "GetKeywordsByGuid",     (void*)0x0060BB70 },
        { "NamePlateLevelUpdate",  (void*)0x0098E9F9 },
        // Only meaningful when the feature is on in the compiled profile, so the owning module appends them
        // rather than listed here -- an unconditional line would read "stock" and look like a failure.
        { "onsite:StartAddress",   (void*)0x0040B7D0 },
        { "onsite:ScanDllStart",   (void*)0x004E5CB0 },
        { "onsite:lua_ScanDllStart",(void*)0x004DCCF0 },
    };
    Probe::log("site audit (first 5 bytes at every address awesome_wotlk is known to patch;");
    Probe::log("             anything we no longer touch must read stock here):");
    for (auto& s : sites)
        Probe::auditSite(s.name, s.addr);
    // Current state of the "invalid function pointer" check globals (see Entry.cpp): stock unless we
    // patched them, which is itself a candidate signature (plan.md, H-C).
    unsigned char g[8] = { 0 };
    if (readSite((void*)0x00D415B8, g, 8))
        Probe::log("  ptr-check globals      @ 00D415B8 [%08X, %08X]", *(DWORD*)(g + 0), *(DWORD*)(g + 4));
    if (DrHook::installedCount())
        Probe::log("  dr slots=%d hits=%lu rearms=%lu  (0 image bytes changed)",
            DrHook::installedCount(), DrHook::hitCount(), DrHook::reArmCount());
    // cameraFov / macro sites, printed only when the compiled profile has those features on.
    Misc::auditSites();
    BugFixes::auditSites();
    CamFade::auditSites();
}

// What ModuleScan (CreateToolhelp32Snapshot walk) would report about us.
void auditModules() {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, 0);
    if (snap == INVALID_HANDLE_VALUE) { Probe::log("module snapshot failed (%lu)", GetLastError()); return; }
    MODULEENTRY32W me; me.dwSize = sizeof(me);
    int total = 0, ours = 0;
    char ourPath[260] = { 0 };
    DWORD ourSize = 0;
    if (Module32FirstW(snap, &me)) {
        do {
            total++;
            if (me.modBaseAddr == (BYTE*)g_self) {
                ours++;
                ourSize = me.modBaseSize;
                WideCharToMultiByte(CP_ACP, 0, me.szExePath, -1, ourPath, sizeof(ourPath), NULL, NULL);
            }
        } while (Module32NextW(snap, &me));
    }
    CloseHandle(snap);

    MEMORY_BASIC_INFORMATION mbi = { 0 };
    VirtualQuery(g_self, &mbi, sizeof(mbi));
    Probe::log("modules: total=%d ours_in_snapshot=%d  self: base=%p state=0x%X protect=0x%X type=0x%X(%s) warden/Scan.dll=%p",
        total, ours, g_self, mbi.State, mbi.Protect, mbi.Type,
        mbi.Type == MEM_IMAGE ? "IMAGE" : mbi.Type == MEM_PRIVATE ? "PRIVATE" : "?",
        GetModuleHandleA("Scan.dll"));
    if (ours == 0) Probe::log("  -> our dll is NOT visible to a Toolhelp snapshot");
    else Probe::log("  -> our dll IS visible to a Toolhelp snapshot: size=0x%X path=%s", ourSize, ourPath);
}

// One delayed snapshot, then the thread ends. The endless 15 s loop was the research rig: it re-read
// every patched address and re-walked the module list forever, which measured 2.4 MB of log over 39
// minutes of play, with a file open per written line.
DWORD WINAPI sampler(LPVOID)
{
    Sleep(15000);
    Probe::log("--- t+%lus sample #1 (one per session) ---", (GetTickCount() - g_startTick) / 1000);
    auditSites();
    auditModules();
    return 0;
}

}

void Probe::auditSite(const char* name, void* addr) {
    unsigned char b[5] = { 0 };
    if (!readSite(addr, b, 5)) { Probe::log("  %-22s @ %p <read fault, SEH caught>", name, addr); return; }
    char hex[24] = { 0 };
    for (int i = 0; i < 5; i++) sprintf(hex + i * 3, "%02X ", b[i]);
    Probe::log("  %-22s @ %p %s| %s", name, addr, hex, classify(b));
}

void Probe::log(const char* fmt, ...) {
    if (!S().log) return;
    EnterCriticalSection(&g_lock);
    FILE* f = fopen(g_logPath, "a");
    if (f) {
        SYSTEMTIME st; GetLocalTime(&st);
        // pid in every line: two clients of the same install share Logs\aw_probe.log, and without it the
        // boot-time rotation and every counter read out of the file describe two processes at once
        // (замер 04.10: t+12361s and t+118s lines written side by side, selftest-samples unusable)
        fprintf(f, "%02d:%02d:%02d.%03d %6lu t+%3lus ", st.wHour, st.wMinute, st.wSecond, st.wMilliseconds,
            GetCurrentProcessId(), (GetTickCount() - g_startTick) / 1000);
        va_list ap; va_start(ap, fmt);
        vfprintf(f, fmt, ap);
        va_end(ap);
        size_t len = strlen(fmt);
        if (len == 0 || fmt[len - 1] != '\n') fputc('\n', f);
        fclose(f);
    }
    LeaveCriticalSection(&g_lock);
}

// Why DR is dead here: a debug port attached to the process owns Dr0..Dr7, so our SetThreadContext
// values are discarded on the next context switch and no #DB ever reaches us.
static void logDebugHost() {
    PVOID port = NULL;
    HMODULE nt = GetModuleHandleA("ntdll.dll");
    if (nt) {
        typedef long(__stdcall *QPI_t)(HANDLE, ULONG, PVOID, ULONG, PULONG);
        QPI_t q = (QPI_t)GetProcAddress(nt, "NtQueryInformationProcess");
        if (q) q(GetCurrentProcess(), 7 /*ProcessDebugPort*/, &port, sizeof(port), NULL);
    }
    Probe::log("debug host: IsDebuggerPresent=%d ProcessDebugPort=%p%s", IsDebuggerPresent() ? 1 : 0, port,
        port ? "  -> hardware breakpoints are unusable" : "");
}

void Probe::initialize(HMODULE self) {
    g_self = self;
    g_startTick = GetTickCount();
    InitializeCriticalSection(&g_lock);

    char exe[MAX_PATH] = { 0 };
    if (GetModuleFileNameA(NULL, exe, MAX_PATH - 32)) {
        if (char* slash = strrchr(exe, '\\')) {
            *slash = 0;
            char dir[MAX_PATH]; snprintf(dir, sizeof(dir), "%s\\Logs", exe);
            CreateDirectoryA(dir, NULL);
            snprintf(g_logPath, sizeof(g_logPath), "%s\\aw_probe.log", dir);
        }
    }
    if (!*g_logPath) strcpy(g_logPath, "aw_probe.log");

    // Players leave the game running for days. Anything over half a megabyte moves aside once at boot,
    // into the .prev name the test bench already uses, so the file cannot grow without a bound.
    {
        WIN32_FIND_DATAA fd;
        HANDLE q = FindFirstFileA(g_logPath, &fd);
        if (q != INVALID_HANDLE_VALUE) {
            FindClose(q);
            if (fd.nFileSizeHigh > 0 || fd.nFileSizeLow > 512 * 1024) {
                char prev[MAX_PATH];
                snprintf(prev, sizeof(prev), "%s.prev", g_logPath);
                DeleteFileA(prev);
                MoveFileA(g_logPath, prev);
            }
        }
    }

    Probe::log("=== awesome_wotlk nameplate build, %s ===", S().describe().c_str());
    logDebugHost();
    // Only pure memory reads here: we are inside DllMain under the loader lock, so the module
    // snapshot (which walks the LDR) is left to the sampler thread, whose first action is a Sleep.
    auditSites();

    HANDLE h = CreateThread(NULL, 0, sampler, NULL, 0, NULL);
    if (h) CloseHandle(h);
    else Probe::log("sampler thread not started (%lu)", GetLastError());
}
