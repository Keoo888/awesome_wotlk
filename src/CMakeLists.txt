add_subdirectory( AwesomeWotlkLib )
add_subdirectory( AwesomeWotlkPatch )

# cmake -S . -B reference/build -G "Visual Studio 18 2026" -A Win32 -T host=x64 -DAW_BUILD_TESTS=ON
# -- затем node tools/run_dll_smoke.js 4 0
# Парсер aw_plate.conf уехал из сборки вместе с конфигом (профиль зашит в Settings.h), поэтому
# settings_test больше нечего тестировать.
if( AW_BUILD_TESTS )
	# Loads the real dll outside the game to exercise its boot path (see tools/run_dll_smoke.js).
	add_executable( dll_smoke "${CMAKE_SOURCE_DIR}/tools/dll_smoke.cpp" )
	# Link high and without ASLR so none of the client addresses we stub collide with the host image.
	target_link_options( dll_smoke PRIVATE "/BASE:0x10000000" "/DYNAMICBASE:NO" )
endif()