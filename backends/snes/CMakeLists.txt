# SNES / SPC backend (websnes + Game Music Emu) compiled with emcmake.
# Mirrors submodules/websnes/emscripten/makeEmscripten.bat (modernized flags).

set(SNES_ROOT "${SUBMODULES}/websnes")
set(SNES_EMS "${SNES_ROOT}/emscripten")
set(GME "${SNES_ROOT}/gme")

set(SNES_SOURCES
    # GME core
    "${GME}/Blip_Buffer.cpp"
    "${GME}/Classic_Emu.cpp"
    "${GME}/Data_Reader.cpp"
    "${GME}/Dual_Resampler.cpp"
    "${GME}/Effects_Buffer.cpp"
    "${GME}/Fir_Resampler.cpp"
    "${GME}/gme.cpp"
    "${GME}/Gme_File.cpp"
    "${GME}/M3u_Playlist.cpp"
    "${GME}/Multi_Buffer.cpp"
    "${GME}/Music_Emu.cpp"
    # Emulators (SPC + deps pulled in by the original build)
    "${GME}/Sms_Apu.cpp"
    "${GME}/Ay_Apu.cpp"
    "${GME}/Ym2612_Emu.cpp"
    "${GME}/Ay_Cpu.cpp"
    "${GME}/Ay_Emu.cpp"
    "${GME}/Gym_Emu.cpp"
    "${GME}/Snes_Spc.cpp"
    "${GME}/Spc_Cpu.cpp"
    "${GME}/Spc_Dsp.cpp"
    "${GME}/Spc_Emu.cpp"
    "${GME}/Spc_Filter.cpp"
    # zlib
    "${SNES_ROOT}/zlib/adler32.c"
    "${SNES_ROOT}/zlib/compress.c"
    "${SNES_ROOT}/zlib/crc32.c"
    "${SNES_ROOT}/zlib/gzio.c"
    "${SNES_ROOT}/zlib/uncompr.c"
    "${SNES_ROOT}/zlib/deflate.c"
    "${SNES_ROOT}/zlib/trees.c"
    "${SNES_ROOT}/zlib/zutil.c"
    "${SNES_ROOT}/zlib/inflate.c"
    "${SNES_ROOT}/zlib/infback.c"
    "${SNES_ROOT}/zlib/inftrees.c"
    "${SNES_ROOT}/zlib/inffast.c"
    # Glue
    "${SNES_EMS}/MetaInfoHelper.cpp"
    "${SNES_EMS}/Adapter.cpp")

add_executable(snes ${SNES_SOURCES})

set_target_properties(snes PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
    OUTPUT_NAME "snes"
    SUFFIX ".js"
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED ON)

target_include_directories(snes PRIVATE
    "${SNES_EMS}"
    "${SNES_ROOT}"
    "${GME}"
    "${SNES_ROOT}/zlib")

target_compile_definitions(snes PRIVATE
    HAVE_ZLIB_H
    EMSCRIPTEN
    NO_DEBUG_LOGS
    HAVE_LIMITS_H
    HAVE_STDINT_H)

target_compile_options(snes PRIVATE
    -O3
    -fno-strict-aliasing
    -Wno-pointer-sign
    -Wno-cast-align)

set(SNES_EXPORTS
    "_emu_load_file,_emu_teardown,_emu_get_current_position,_emu_seek_position,_emu_get_max_position,_emu_set_subsong,_emu_get_track_info,_emu_get_sample_rate,_emu_get_audio_buffer,_emu_get_audio_buffer_length,_emu_compute_audio_samples,_malloc,_free")

set(RUNTIME_METHODS
    "ccall,UTF8ToString,HEAP16,HEAPU8,HEAP32,FS_createDataFile,FS_createPath,FS_unlink")

target_link_options(snes PRIVATE
    "-O3"
    "-sWASM=1"
    "-sFORCE_FILESYSTEM=1"
    "-sINITIAL_MEMORY=67108864"
    "-sALLOW_MEMORY_GROWTH=0"
    "-sASSERTIONS=0"
    "-sEXPORTED_FUNCTIONS=${SNES_EXPORTS}"
    "-sEXPORTED_RUNTIME_METHODS=${RUNTIME_METHODS}")

# ---- Assemble backend_snes.js = shell-pre + snes.js + shell-post + adapter ---
set(SNES_BACKEND_JS "${DIST_DIR}/backend_snes.js")
add_custom_command(
    OUTPUT "${SNES_BACKEND_JS}"
    COMMAND "${CMAKE_COMMAND}"
            -DOUTPUT=${SNES_BACKEND_JS}
            "-DINPUTS=${SNES_EMS}/shell-pre.js;${CMAKE_CURRENT_BINARY_DIR}/snes.js;${SNES_EMS}/shell-post.js;${SNES_EMS}/snes_adapter.js"
            -P "${CONCAT_SCRIPT}"
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${CMAKE_CURRENT_BINARY_DIR}/snes.wasm" "${DIST_DIR}/snes.wasm"
    DEPENDS snes
            "${SNES_EMS}/shell-pre.js"
            "${SNES_EMS}/shell-post.js"
            "${SNES_EMS}/snes_adapter.js"
            "${CONCAT_SCRIPT}"
    VERBATIM
    COMMENT "Assembling backend_snes.js (+ snes.wasm)")

add_custom_target(backend_snes ALL DEPENDS "${SNES_BACKEND_JS}")
