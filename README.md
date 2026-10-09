# Sources of AwesomeWotlkLib.dll and AwesomeWotlkPatch.exe

This is the code behind the client library that the Warmane nameplate pack uses: a 32-bit
`AwesomeWotlkLib.dll` for the WoW 3.3.5a (build 12340) client, a small `AwesomeWotlkPatch.exe`
that writes the three places in `Wow.exe` which make that client load the library, the three
addons that read it, and the checks that guard all of it. Players do not need this repository:
the built dll, the patcher and the addon folders ship in the release pack of
`iTargetingFrames_warmane`.

The library is a hook layer, not a replacement client. It publishes nameplates as `nameplateN`
unit tokens and reads a handful of client structures through addresses that belong to build
12340 only, which is why everything here is written for one executable and nothing is
configurable from outside: the profile is compiled in (`src/AwesomeWotlkLib/Settings.h`), and
the player-facing switches are CVars registered by the library and edited in `/awesome`.

## Building

Needs Visual Studio 2026 (MSVC 14.51 was used here), the Windows SDK, CMake 3.15 or newer and
Node.js for the checks. Everything is 32-bit; the Detours dependency is vendored in `deps/`.

```
cmake -S . -B reference/build -G "Visual Studio 18 2026" -A Win32 -T host=x64 -DAW_BUILD_TESTS=ON
cmake --build reference/build --config Release
```

Both binaries land in `reference/build/Release`, together with `dll_smoke.exe`, the host the
first check below runs the dll in. Re-run `cmake -S . -B reference/build ...` whenever the list
of sources changes: the generated project file keeps the old list and then fails on missing
files, which is how a deleted source stayed in a build here once.

## Checks

The checks read the sources and the built image, and they are the reason the numbers in commits
and release notes are measurements rather than claims.

```
node tools/run_dll_smoke.js        # 62 checks: the dll boots outside the game with the compiled profile,
                                   #   the boot path changes no client code it should not touch, the log
                                   #   lines keep their format, and the patch table in the built patcher
                                   #   equals src/AwesomeWotlkPatch/Patch.h
node tools/run_addon_behavior.js   # 319 checks of the addons' data logic in fengari, no client needed
node tools/run_cvar_contract.js    # 7 addon rows against the clamps read out of the C++ sources
node tools/run_addon_lint.js       # Lua 5.1 syntax of every file, locale completeness, encoding
node tools/run_itf_layout_check.js # 47 checks of the frame grid and the settings window in iTargetingFrames
node tools/run_dead_code_check.js  # dead locals and reads of outside globals, against a baseline
node tools/run_deploy_parity.js    # byte-for-byte comparison of these addons against an installed client
```

The last one is the only machine-specific check: it wants a client folder to compare with and
defaults to a local sandbox path, so pass yours as an argument or skip it. `tools/probes` holds
`AWHiddenAuraProbe`, a measurement addon that is deliberately not part of the pack: it is
installed for one raid to find out whether the client reports the caster of a hidden aura, and
it says so in its own title line. `tools/_map_lookup.py` turns an address from a client crash
report into a function name using the `.map` that `/MAP` writes next to the dll -- which is why
that map file is archived with every build rather than left to be overwritten by the next one.

## Credits

- Upstream project: **FrostAtom** -- [awesome_wotlk](https://github.com/FrostAtom/awesome_wotlk). Both binaries
  here are rebuilt from that tree, and `src/AwesomeWotlkPatch/Patch.h` writes the same three places in `Wow.exe`
  that upstream's own patcher writes.
- iTargetingFrames: original by **Ironi**, WotLK backport by **Cheeta**
- AwesomeCVar: original by **noname08662**
- Detours: vendored from [microsoft/Detours](https://github.com/microsoft/Detours)
- This fork: **Keoo** -- [discord.gg/sKpJbUrsvR](https://discord.gg/sKpJbUrsvR)

Made by Keoo for Warmane. Discord: https://discord.gg/sKpJbUrsvR
