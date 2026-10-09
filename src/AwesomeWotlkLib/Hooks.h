#pragma once
#include "GameClient.h"

namespace Hooks {

using DummyCallback_t = void(*)();

namespace FrameScript {
using TokenGuidGetter = guid_t();
using TokenNGuidGetter = guid_t(int);
using TokenIdGetter = bool(guid_t);
using TokenIdNGetter = int(guid_t);

// Alone tokens like player, target, focus
void registerToken(const char* token, TokenGuidGetter* getGuid, TokenIdGetter* getId);
// One more tokens like party1, raid1, arena1
void registerToken(const char* token, TokenNGuidGetter* getGuid, TokenIdNGetter* getId);
void registerOnUpdate(DummyCallback_t func);
// Resolve a registered custom token ("nameplate7") to a guid. True = we own this token name.
bool resolveToken(const char* token, guid_t* out);
}

namespace FrameXML {
void registerEvent(const char* str);
void registerCVar(Console::CVar** dst, const char* str, const char* desc, Console::CVarFlags flags, const char* initialValue, Console::CVar::Handler_t func);
void registerLuaLib(lua_CFunction func);
}

void initialize();
// Is this address committed executable image code? Every site we attach to must pass this BEFORE
// DetourAttach: reading a bad address inside the transaction faults, and a fault aborts the whole
// transaction -- one dead site would otherwise take down the features sharing it with it.
bool isImageCode(DWORD addr, MEMORY_BASIC_INFORMATION* mbiOut = NULL);
// Same hooks through debug registers instead of patched bytes (drhook=1); supports the token only.
void initializeDr();
// tokensite=tail: one manual JMP at 0x0060AD4B, the client's "unknown token" handover point.
bool installTailSite();
void removeTailSite();
// Wrap a call that OUR code makes to the client's resolver, name the exact token that call asks for, and
// hand over the label that says who is really behind it. The tail trace marks an arrival as ours only if
// it comes inside this window AND carries that token: 0x0060C1C0 is the client's own public entry for unit
// tokens, so a Lua ask and our probe can arrive with the SAME return address, and an address-only rule
// would stamp real Lua asks with [OURS] -- hiding the one piece of evidence the run exists to collect.
// The origin label matters for the same reason: C_NamePlate:GetNamePlateForUnit is called BY Lua and only
// relayed through the wrapper by us, so it must not read as "our probe".
void beginSelfProbe(const char* askedToken, const char* originLabel);
// Returns how many times the tail site was reached during the window: 0 proves the client's own wrapper
// route (0x0060C1C0) goes around 0x0060AD4B, which is the one functional difference from upstream's site.
long endSelfProbe();
// Counters for the placement question: arrivals at the patched site, arrivals whose token we recognised,
// arrivals that did not come from our own probe window, arrivals inside our window that were not the ask
// we made there (an [OURS]/[EXTERNAL] label is only trustworthy while this stays 0), the highest number of
// resolver frames seen through our site at once (>1 means the client re-enters through us) and how many
// claims the throttle refused.
void tailStats(long* arrivals, long* matched, long* external, long* overlap, long* depth, long* watchdog);
// scope>=3: replace FillEvents' two `call` sites instead of detouring 0x0081B5F0 itself, so the
// published function prologue reads stock.
bool installFillEventsSites();
void removeFillEventsSites();

}