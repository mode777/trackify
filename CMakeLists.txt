# Web Audio Player for VGM sample files (PSX/PSF + SNES/SPC)
#
# Build the two Emscripten backends with emcmake, assemble the generic player,
# and stage everything under dist/. Submodule sources are never modified.
#
# Configure & build:
#   emcmake cmake -B build -G Ninja
#   cmake --build build
#
# Then serve dist/ over HTTP (see verification steps in the plan).

cmake_minimum_required(VERSION 3.21)

project(trackify_webaudio LANGUAGES C CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR
        "This project must be configured through the Emscripten toolchain.\n"
        "Use: emcmake cmake -B build -G Ninja")
endif()

# ---- Common locations -------------------------------------------------------
set(SUBMODULES "${CMAKE_SOURCE_DIR}/submodules")
set(WEBAUDIO_SRC "${SUBMODULES}/webaudio-player/src")
set(CONCAT_SCRIPT "${CMAKE_SOURCE_DIR}/cmake/concat.cmake")
set(SAMPLE_DIR "${CMAKE_SOURCE_DIR}/sample-files")
set(WEB_DIR "${CMAKE_SOURCE_DIR}/web")
set(DIST_DIR "${CMAKE_BINARY_DIR}/dist")

file(MAKE_DIRECTORY "${DIST_DIR}")

# Helper: concatenate a list of files into OUT via the concat.cmake -P script.
# Produces a custom command bound to OUT and DEPENDS on all inputs.
function(add_concat_command OUT)
    set(_inputs ${ARGN})
    add_custom_command(
        OUTPUT "${OUT}"
        COMMAND "${CMAKE_COMMAND}"
                -DOUTPUT=${OUT}
                "-DINPUTS=${_inputs}"
                -P "${CONCAT_SCRIPT}"
        DEPENDS ${_inputs} "${CONCAT_SCRIPT}"
        VERBATIM
        COMMENT "Assembling ${OUT}")
endfunction()

# ---- Generic player (plain concat, no minify) -------------------------------
set(PLAYER_JS "${DIST_DIR}/scriptprocessor_player.js")
add_concat_command("${PLAYER_JS}"
    "${WEBAUDIO_SRC}/player_header.txt"
    "${WEBAUDIO_SRC}/impl/Utils.js"
    "${WEBAUDIO_SRC}/AbstractTicker2.js"
    "${WEBAUDIO_SRC}/BaseFileMapper.js"
    "${WEBAUDIO_SRC}/impl/SimpleFileMapper.js"
    "${WEBAUDIO_SRC}/ScopeDataProvider.js"
    "${WEBAUDIO_SRC}/impl/EmscriptenScopeProviders.js"
    "${WEBAUDIO_SRC}/AudioBackendAdapterBase.js"
    "${WEBAUDIO_SRC}/impl/OutputTransformer.js"
    "${WEBAUDIO_SRC}/impl/ScriptNodeBackendAdapter.js"
    "${WEBAUDIO_SRC}/impl/EmscriptenScriptNodeBackendAdapters.js"
    "${WEBAUDIO_SRC}/impl/FileCache.js"
    "${WEBAUDIO_SRC}/ScriptNodePlayer.js")
add_custom_target(player ALL DEPENDS "${PLAYER_JS}")

# ---- Backends ---------------------------------------------------------------
add_subdirectory(backends/psx)
add_subdirectory(backends/snes)

# ---- Stage static UI + sample files into dist/ ------------------------------
set(_ui_files index.html app.js app.css)
set(_staged_ui "")
foreach(_f IN LISTS _ui_files)
    add_custom_command(
        OUTPUT "${DIST_DIR}/${_f}"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                "${WEB_DIR}/${_f}" "${DIST_DIR}/${_f}"
        DEPENDS "${WEB_DIR}/${_f}"
        COMMENT "Staging web/${_f}")
    list(APPEND _staged_ui "${DIST_DIR}/${_f}")
endforeach()

# Stage sample files (incl. driver.psflib next to the minipsf dependency).
set(_sample_files
    "01 main menu.minipsf"
    "driver.psflib"
    "super james pond - codename robocod.spc")
set(_staged_samples "")
foreach(_f IN LISTS _sample_files)
    add_custom_command(
        OUTPUT "${DIST_DIR}/${_f}"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                "${SAMPLE_DIR}/${_f}" "${DIST_DIR}/${_f}"
        DEPENDS "${SAMPLE_DIR}/${_f}"
        COMMENT "Staging sample-files/${_f}")
    list(APPEND _staged_samples "${DIST_DIR}/${_f}")
endforeach()

add_custom_target(stage ALL DEPENDS ${_staged_ui} ${_staged_samples})
