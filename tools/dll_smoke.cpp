#include <Windows.h>
#include <cstdio>
#include <cstdlib>

// Boots AwesomeWotlkLib.dll outside the game. The client addresses we hook are meaningless in a bare
// host process, so this host first commits pages at exactly those addresses (code sites get a short
// prologue, data sites stay zero) -- the detours then attach for real and the DR traps can be fired
// by calling the stub. Everything the dll does on boot is verifiable this way except the client
// semantics themselves.
struct Stub { DWORD addr; const char* what; bool code; } stubs[] = {
    { 0x0051D9B0, "CVars_Initialize", true },
    { 0x00495810, "FireOnUpdate", true },
    { 0x0081B5F0, "FillEvents", true },
    { 0x00530F85, "OpenFrameXMLApi", true },
    { 0x0060AFAA, "GetGuidByKeyword", true },
    { 0x0060BB70, "GetKeywordsByGuid", true },
    { 0x0098E9F9, "NamePlateLevelUpdate", true },
    { 0x0040B7D0, "onsite StartAddress", true },
    { 0x004E5CB0, "onsite ScanDllStart", true },
    { 0x004DCCF0, "onsite lua_ScanDllStart", true },
    { 0x0060AD44, "token jmpback (not ours)", true },
    { 0x0060AD57, "token jmpback (ours)", true },
    { 0x00D415B8, "pointer-range globals", false },
    { 0x00ADAA7C, "nameplateDistance float", false },
    { 0x00BD0792, "IsInWorld flag", false },   // stays 0 -> onUpdateCallback returns early
    { 0x00BD07B0, "target guid", false },
};

static int commitStubs() {
    int failed = 0;
    for (auto& s : stubs) {
        MEMORY_BASIC_INFORMATION mbi = { 0 };
        if (VirtualQuery((PVOID)s.addr, &mbi, sizeof(mbi)) && mbi.State == MEM_COMMIT) {
            // Owned by someone else (CRT heap / our image). Taking it over would corrupt the host and
            // prove nothing about the dll, so leave it: the dll reads these through SEH-guarded probes
            // and reports <read fault> / the stock bytes. Whether the DR trap fires is verified in the
            // game, where these addresses really are code (Logs\aw_probe.log: "dr slots=.. hits=..").
            printf("  stub %s @ %p: left alone (owned, protect 0x%lX)\n", s.what, (PVOID)s.addr, mbi.Protect);
            continue;
        }
        PVOID base = VirtualAlloc((PVOID)(s.addr & ~0xFFFF), 0x20000, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
        if (!base) { printf("  stub %s @ %p: VirtualAlloc FAILED (%lu)\n", s.what, (PVOID)s.addr, GetLastError()); failed++; continue; }
        if (s.code) {
            unsigned char prologue[8] = { 0x55, 0x8B, 0xEC, 0xC9, 0xC3, 0x90, 0x90, 0x90 };
            memcpy((void*)s.addr, prologue, sizeof(prologue));
        }
    }
    printf(failed ? "STUBS_INCOMPLETE %d\n" : "STUBS_ALL_OK\n", failed);
    return failed;
}

int main(int argc, char** argv) {
    if (argc < 2) { printf("usage: dll_smoke <dll> [sleep_ms]\n"); return 2; }
    DWORD wait = argc > 2 ? (DWORD)atoi(argv[2]) : 17000;  // > the sampler's 15 s, to catch one sample
    commitStubs();

    HMODULE m = LoadLibraryA(argv[1]);
    printf("LoadLibraryA -> %p, GetLastError=%lu\n", (void*)m, GetLastError());
    if (!m) return 1;

    // The keeper arms Dr0..Dr7 on this thread; the readback line in the log proves it stuck.
    // Firing a real trap needs the site to be executable code, which only the game provides.
    Sleep(3000);
    printf("DR_ARM_WAITED\n");

    Sleep(wait);
    printf("boot path survived %lu ms; exiting\n", wait);
    return 0;
}
