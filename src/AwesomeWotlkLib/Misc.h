#pragma once

namespace Misc {
void initialize();
// One line per site this module patches, only while its conf key is on: a run where camera=1 but the
// Camera::Initialize detour did not go in must not look like a clean run.
void auditSites();
}
