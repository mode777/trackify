# N64 / USF backend (webn64 + LazyUSF2/Mupen64plus) compiled with emcmake.
# Mirrors submodules/webn64/emscripten/makeEmscripten.bat (modernized flags).

set(N64_ROOT "${SUBMODULES}/webn64")
set(N64_PATCH "${PATCHES}/webn64")
set(N64_EMS "${N64_ROOT}/emscripten")
set(N64_EMS_PATCH "${N64_PATCH}/emscripten")
set(N64_SRC "${N64_ROOT}/src")

set(N64_SOURCES
    # psflib (PSF container parsing)
    "${N64_ROOT}/psflib/psflib.c"
    "${N64_ROOT}/psflib/psf2fs.c"
    # zlib
    "${N64_ROOT}/zlib/adler32.c"
    "${N64_ROOT}/zlib/compress.c"
    "${N64_ROOT}/zlib/crc32.c"
    "${N64_ROOT}/zlib/gzio.c"
    "${N64_ROOT}/zlib/uncompr.c"
    "${N64_ROOT}/zlib/deflate.c"
    "${N64_ROOT}/zlib/trees.c"
    "${N64_ROOT}/zlib/zutil.c"
    "${N64_ROOT}/zlib/inflate.c"
    "${N64_ROOT}/zlib/infback.c"
    "${N64_ROOT}/zlib/inftrees.c"
    "${N64_ROOT}/zlib/inffast.c"
    # Mupen64plus core (cached interpreter mode — no dynarec/SSE2 in WASM)
    "${N64_SRC}/r4300/empty_dynarec.c"
    "${N64_SRC}/ai/ai_controller.c"
    "${N64_SRC}/api/callbacks.c"
    "${N64_SRC}/debugger/dbg_decoder.c"
    "${N64_SRC}/main/main.c"
    "${N64_SRC}/main/rom.c"
    "${N64_SRC}/main/savestates.c"
    "${N64_SRC}/main/util.c"
    "${N64_SRC}/memory/memory.c"
    "${N64_SRC}/pi/cart_rom.c"
    "${N64_SRC}/pi/pi_controller.c"
    "${N64_SRC}/r4300/cached_interp.c"
    "${N64_SRC}/r4300/cp0.c"
    "${N64_SRC}/r4300/cp1.c"
    "${N64_SRC}/r4300/exception.c"
    "${N64_SRC}/r4300/interupt.c"
    "${N64_SRC}/r4300/mi_controller.c"
    "${N64_SRC}/r4300/pure_interp.c"
    "${N64_SRC}/r4300/r4300.c"
    "${N64_SRC}/r4300/r4300_core.c"
    "${N64_SRC}/r4300/recomp.c"
    "${N64_SRC}/r4300/reset.c"
    "${N64_SRC}/r4300/tlb.c"
    "${N64_SRC}/rdp/rdp_core.c"
    "${N64_SRC}/ri/rdram.c"
    "${N64_SRC}/ri/rdram_detection_hack.c"
    "${N64_SRC}/ri/ri_controller.c"
    "${N64_SRC}/rsp/rsp_core.c"
    "${N64_SRC}/rsp_hle/hvqm.c"
    "${N64_SRC}/rsp_hle/re2.c"
    "${N64_SRC}/rsp_hle/alist.c"
    "${N64_SRC}/rsp_hle/alist_audio.c"
    "${N64_SRC}/rsp_hle/alist_naudio.c"
    "${N64_SRC}/rsp_hle/alist_nead.c"
    "${N64_SRC}/rsp_hle/audio.c"
    "${N64_SRC}/rsp_hle/cicx105.c"
    "${N64_SRC}/rsp_hle/hle.c"
    "${N64_SRC}/rsp_hle/jpeg.c"
    "${N64_SRC}/rsp_hle/memory.c"
    "${N64_SRC}/rsp_hle/mp3.c"
    "${N64_SRC}/rsp_hle/musyx.c"
    "${N64_SRC}/rsp_hle/plugin.c"
    "${N64_SRC}/rsp_lle/rsp.c"
    "${N64_SRC}/si/cic.c"
    "${N64_SRC}/si/game_controller.c"
    "${N64_SRC}/si/n64_cic_nus_6105.c"
    "${N64_SRC}/si/pif.c"
    "${N64_SRC}/si/si_controller.c"
    "${N64_SRC}/usf/usf.c"
    "${N64_SRC}/usf/barray.c"
    "${N64_SRC}/usf/resampler.c"
    "${N64_SRC}/vi/vi_controller.c"
    # Glue / driver
    "${N64_EMS_PATCH}/n64plug.cpp"
    "${N64_EMS}/MetaInfoHelper.cpp"
    "${N64_EMS}/Adapter.cpp")

add_executable(n64 ${N64_SOURCES})

set_target_properties(n64 PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
    OUTPUT_NAME "n64"
    SUFFIX ".js"
    CXX_STANDARD 14
    CXX_STANDARD_REQUIRED ON)

target_include_directories(n64 PRIVATE
    "${N64_EMS}"
    "${N64_ROOT}"
    "${N64_ROOT}/src"
    "${N64_ROOT}/psflib"
    "${N64_ROOT}/zlib")

target_compile_definitions(n64 PRIVATE
    EMU_COMPILE
    EMU_LITTLE_ENDIAN
    HAVE_STDINT_H
    NO_DEBUG_LOGS
    EMSCRIPTEN)

target_compile_options(n64 PRIVATE
    -Os
    -O3
    -fno-rtti
    -fno-strict-aliasing
    -Wno-pointer-sign
    -Wno-cast-align
    -Wno-incompatible-function-pointer-types
    -Wno-incompatible-pointer-types)

set(N64_EXPORTS
    "_emu_load_file,_emu_set_boost,_emu_teardown,_emu_get_current_position,_emu_seek_position,_emu_get_max_position,_emu_set_subsong,_emu_get_track_info,_emu_get_sample_rate,_emu_get_audio_buffer,_emu_get_audio_buffer_length,_emu_compute_audio_samples,_malloc,_free")

set(RUNTIME_METHODS
    "ccall,UTF8ToString,HEAP16,HEAPU8,HEAP32,FS_createDataFile,FS_createPath,FS_unlink")

target_link_options(n64 PRIVATE
    "-O3"
    "-sWASM=1"
    "-sFORCE_FILESYSTEM=1"
    "-sINITIAL_MEMORY=134217728"
    "-sALLOW_MEMORY_GROWTH=0"
    "-sASSERTIONS=0"
    "-sDISABLE_EXCEPTION_CATCHING=1"
    "-sEXPORTED_FUNCTIONS=${N64_EXPORTS}"
    "-sEXPORTED_RUNTIME_METHODS=${RUNTIME_METHODS}"
    "--js-library" "${N64_EMS}/callback.js")

# ---- Assemble backend_n64.js = shell-pre + n64.js + shell-post + adapter ----
# `n64_adapter.js` is sourced from patches/webn64/emscripten/ (it drops
# the legacy setProcessorBufSize(0x4000) hack — see
# docs/audio-worklet-migration.md WP-H).
set(N64_BACKEND_JS "${DIST_DIR}/backend_n64.js")
add_custom_command(
    OUTPUT "${N64_BACKEND_JS}"
    COMMAND "${CMAKE_COMMAND}"
            -DOUTPUT=${N64_BACKEND_JS}
            "-DINPUTS=${N64_EMS}/shell-pre.js;${CMAKE_CURRENT_BINARY_DIR}/n64.js;${N64_EMS}/shell-post.js;${N64_EMS_PATCH}/n64_adapter.js"
            -P "${CONCAT_SCRIPT}"
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${CMAKE_CURRENT_BINARY_DIR}/n64.wasm" "${DIST_DIR}/n64.wasm"
    DEPENDS n64
            "${N64_EMS}/shell-pre.js"
            "${N64_EMS}/shell-post.js"
            "${N64_EMS_PATCH}/n64_adapter.js"
            "${CONCAT_SCRIPT}"
    VERBATIM
    COMMENT "Assembling backend_n64.js (+ n64.wasm)")

add_custom_target(backend_n64 ALL DEPENDS "${N64_BACKEND_JS}")
