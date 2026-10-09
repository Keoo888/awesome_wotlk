#pragma once
#include <Windows.h>

namespace Probe {

// Opens Logs\aw_probe.log, writes the banner and starts a sampler thread that records what an
// server-side check memory read would see. Safe to call from DllMain.
void initialize(HMODULE self);
void log(const char* fmt, ...);
// One line of the site audit ("name @ address  bytes | what it looks like"). Exported so a module whose
// sites only exist when its conf key is on can report them without a "stock" line that reads as failure.
void auditSite(const char* name, void* addr);

}
