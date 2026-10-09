cmake_minimum_required(VERSION 3.15)

set(CMAKE_DISABLE_SOURCE_CHANGES ON)
set(CMAKE_DISABLE_IN_SOURCE_BUILD ON)
set(CMAKE_SUPPRESS_REGENERATION ON)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/reference/build/${CMAKE_BUILD_TYPE}/)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/reference/build/${CMAKE_BUILD_TYPE}/)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/reference/build/${CMAKE_BUILD_TYPE}/)

# msvc general
set(CMAKE_CXX20_STANDARD_COMPILE_OPTION "-std:c++latest")
set(CMAKE_CXX20_EXTENSION_COMPILE_OPTION "-std:c++latest")
set(CMAKE_CXX_STANDARD 20)
# /utf-8 fixes both the source and the execution charset. Without it the charset of the narrow literals
# comes from the machine's ACP, and the Cyrillic text in the Probe::log strings is the one thing that
# depends on it: measured here (ACP=1251, MSVC 14.51) Logs\aw_probe.log already carries UTF-8 bytes, so
# the flag records what happens today instead of changing it -- and on an older toolset or a different
# ACP it keeps the log readable instead of turning the dll's only trace into mojibake. Nothing else can
# be affected: every non-ASCII literal in src/ sits inside a Probe::log call, none of them reaches Lua or
# the client. Prerequisite checked file by file: non-ASCII bytes live in exactly 10 files, all of them
# under src/AwesomeWotlkLib (deps/ and tools/ are pure ASCII); all 10 decode as valid UTF-8 and none
# carries a BOM.
set(COMMON_COMPILE_FLAGS "/utf-8 /DWIN32_LEAN_AND_MEAN /D_CRT_SECURE_NO_WARNINGS /DUNICODE /D_UNICODE")
# Межмодульной оптимизации (/GL у MSVC, -flto у Clang) здесь быть не должно, и дело не в размере сборки.
# Половина этой dll -- это naked-стабы с ручным ассемблером и функции, адреса которых мы берём и патчим в
# рантайме (DetourAttach, ручные E9). /GL разрешает компоновщику сливать, встраивать и выбрасывать такие
# функции целиком: получается, что хук стоит на коде, которого в образе уже нет в ожидаемом виде. Плюс
# /GL без /LTCG заставляет компоновщик перезапускать линковку сам, то есть флаг и так ничего не давал.
if (CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
	set(CMAKE_CXX_FLAGS_RELEASE "${COMMON_COMPILE_FLAGS} /O2 /Gw /DNDEBUG /MT")
	set(CMAKE_CXX_FLAGS_DEBUG "${COMMON_COMPILE_FLAGS} /Od /Zi /DDEBUG /MTd")
elseif(CMAKE_CXX_COMPILER_ID STREQUAL "MSVC")
	set(CMAKE_CXX_FLAGS_RELEASE "${COMMON_COMPILE_FLAGS} /O2 /Gw /wd4458 /DNDEBUG /MT")
	set(CMAKE_CXX_FLAGS_DEBUG "${COMMON_COMPILE_FLAGS} /Od /Zi /wd4458 /DDEBUG /MTd")
else()
	message(FATAL_ERROR "Unsupported toolset, use MSVC or Clang for build")
endif()


add_subdirectory( deps )
add_subdirectory( src )