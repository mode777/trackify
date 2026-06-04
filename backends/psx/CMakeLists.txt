# PSX / PSF backend (webpsx + HighlyExperimental) compiled with emcmake.
# Mirrors submodules/webpsx/emscripten/makeEmscripten.bat (modernized flags).

set(PSX_ROOT "${SUBMODULES}/webpsx")
set(PSX_EMS "${PSX_ROOT}/emscripten")

set(PSX_SOURCES
    # Core emulator
    "${PSX_ROOT}/Core/psx.c"
    "${PSX_ROOT}/Core/ioptimer.c"
    "${PSX_ROOT}/Core/iop.c"
    "${PSX_ROOT}/Core/bios.c"
    "${PSX_ROOT}/Core/r3000dis.c"
    "${PSX_ROOT}/Core/r3000asm.c"
    "${PSX_ROOT}/Core/r3000.c"
    "${PSX_ROOT}/Core/vfs.c"
    "${PSX_ROOT}/Core/spucore.c"
    "${PSX_ROOT}/Core/spu.c"
    "${PSX_ROOT}/Core/mkhebios.c"
    # PSF container
    "${PSX_ROOT}/psflib/psf2fs.c"
    "${PSX_ROOT}/psflib/psflib.c"
    # zlib
    "${PSX_ROOT}/zlib/adler32.c"
    "${PSX_ROOT}/zlib/compress.c"
    "${PSX_ROOT}/zlib/crc32.c"
    "${PSX_ROOT}/zlib/gzio.c"
    "${PSX_ROOT}/zlib/uncompr.c"
    "${PSX_ROOT}/zlib/deflate.c"
    "${PSX_ROOT}/zlib/trees.c"
    "${PSX_ROOT}/zlib/zutil.c"
    "${PSX_ROOT}/zlib/inflate.c"
    "${PSX_ROOT}/zlib/infback.c"
    "${PSX_ROOT}/zlib/inftrees.c"
    "${PSX_ROOT}/zlib/inffast.c"
    # Glue / driver
    "${PSX_EMS}/SPUDriver.cpp"
    "${PSX_EMS}/heplug.c"
    "${PSX_EMS}/MetaInfoHelper.cpp"
    "${PSX_EMS}/Adapter.cpp")

add_executable(psx ${PSX_SOURCES})

# Emit "psx.js" (+ psx.wasm) rather than a bare module name.
set_target_properties(psx PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
    OUTPUT_NAME "psx"
    SUFFIX ".js")

target_include_directories(psx PRIVATE
    "${PSX_EMS}"
    "${PSX_ROOT}"
    "${PSX_ROOT}/Core"
    "${PSX_ROOT}/psflib"
    "${PSX_ROOT}/zlib")

target_compile_definitions(psx PRIVATE
    BUILTIN_HEBIOS
    EMU_COMPILE
    EMU_LITTLE_ENDIAN
    HAVE_STDINT_H
    NO_DEBUG_LOGS
    # Older emcc implicitly defined EMSCRIPTEN; modern emcc only defines
    # __EMSCRIPTEN__. The webpsx sources still gate the WASM code paths
    # (compressed BIOS overlays, decode_xa stubs) on EMSCRIPTEN, so define it.
    EMSCRIPTEN)

target_compile_options(psx PRIVATE
    -O3
    -fno-strict-aliasing
    -Wno-pointer-sign
    -Wno-cast-align)

set(PSX_EXPORTS
    "_emu_set_bios,_emu_set_boost,_emu_load_file,_emu_teardown,_emu_get_current_position,_emu_seek_position,_emu_get_max_position,_emu_set_subsong,_emu_get_track_info,_emu_get_sample_rate,_emu_get_audio_buffer,_emu_get_audio_buffer_length,_emu_compute_audio_samples,_malloc,_free")

# Runtime methods needed by the generic player adapters (HEAP views + FS helpers
# in addition to the prompt's ccall/UTF8ToString).
set(RUNTIME_METHODS
    "ccall,UTF8ToString,HEAP16,HEAPU8,HEAP32,FS_createDataFile,FS_createPath,FS_unlink")

target_link_options(psx PRIVATE
    "-O3"
    "-sWASM=1"
    "-sFORCE_FILESYSTEM=1"
    "-sINITIAL_MEMORY=134217728"
    "-sALLOW_MEMORY_GROWTH=0"
    "-sASSERTIONS=0"
    "-sEXPORTED_FUNCTIONS=${PSX_EXPORTS}"
    "-sEXPORTED_RUNTIME_METHODS=${RUNTIME_METHODS}"
    "--js-library" "${PSX_EMS}/callback.js")

# ---- Assemble backend_psx.js = shell-pre + psx.js + shell-post + adapter -----
set(PSX_BACKEND_JS "${DIST_DIR}/backend_psx.js")
add_custom_command(
    OUTPUT "${PSX_BACKEND_JS}"
    COMMAND "${CMAKE_COMMAND}"
            -DOUTPUT=${PSX_BACKEND_JS}
            "-DINPUTS=${PSX_EMS}/shell-pre.js;${CMAKE_CURRENT_BINARY_DIR}/psx.js;${PSX_EMS}/shell-post.js;${PSX_EMS}/psx_adapter.js"
            -P "${CONCAT_SCRIPT}"
    # Copy the wasm next to the assembled backend.
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${CMAKE_CURRENT_BINARY_DIR}/psx.wasm" "${DIST_DIR}/psx.wasm"
    DEPENDS psx
            "${PSX_EMS}/shell-pre.js"
            "${PSX_EMS}/shell-post.js"
            "${PSX_EMS}/psx_adapter.js"
            "${CONCAT_SCRIPT}"
    VERBATIM
    COMMENT "Assembling backend_psx.js (+ psx.wasm)")

add_custom_target(backend_psx ALL DEPENDS "${PSX_BACKEND_JS}")
