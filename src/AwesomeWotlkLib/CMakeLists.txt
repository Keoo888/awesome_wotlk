project( AwesomeWotlkLib )

add_library(
	${PROJECT_NAME} SHARED
		"Entry.cpp"

		GameClient.h
		"Settings.h" "Settings.cpp"
		"DrHook.h" "DrHook.cpp"
		"Probe.h" "Probe.cpp"
		"NamePlates.h" "NamePlates.cpp"
		"Misc.h" "Misc.cpp"
		"Camera.h" "Camera.cpp"
		"Interact.h" "Interact.cpp"
		"BugFixes.h" "BugFixes.cpp"
		"Hooks.h" "Hooks.cpp")

target_include_directories(
	${PROJECT_NAME} PRIVATE
		${CMAKE_SOURCE_DIR}/deps
)

target_link_libraries(
	${PROJECT_NAME} PRIVATE
		Detours
)

target_compile_definitions(
	${PROJECT_NAME} PRIVATE
		APP_NAME="${PROJECT_NAME}"
)

# The client's own crash reports quote an address inside this dll ("Invalid function pointer: 704E34B0"),
# and without a map file that number cannot be turned back into a function. /MAP writes only a side file,
# it does not change the image.
target_link_options(
	${PROJECT_NAME} PRIVATE
		"/MAP"
)
