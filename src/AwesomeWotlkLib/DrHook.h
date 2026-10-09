#pragma once
#include <Windows.h>

// Hardware-breakpoint hooking: no byte of the client image is modified, so a memory read at the
// patched addresses returns stock bytes and the client's own "invalid function pointer" check does
// not have to be disabled.
namespace DrHook {

typedef void (*HitFn_t)(PCONTEXT ctx);

// addr: instruction to trap (execute breakpoint). fn gets the live CONTEXT and may rewrite Eip/EFs.
// Returns false when no debug-register slot is left (max 4).
bool install(void* addr, HitFn_t fn);

// Arms Dr0..Dr3/Dr7 on the bound thread and keeps them armed (re-arms after anything clears them).
void arm();
// Remembers the current (main) thread as the one to arm. Called from install().
void bindThread();

int installedCount();
unsigned long hitCount();      // total traps handled
unsigned long reArmCount();    // how often we had to put the registers back

}
