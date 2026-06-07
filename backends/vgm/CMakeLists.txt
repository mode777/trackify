# VGM / Mega Drive backend (vgmplay) compiled with emcmake.
# Mirrors submodules/vgmplay-0.40.9/emscripten/makeEmscripten.bat
# with modernized Emscripten flags.

set(VGM_ROOT "${SUBMODULES}/vgmplay-0.40.9")
set(VGM_EMS "${VGM_ROOT}/emscripten")
set(VGM_SRC "${VGM_ROOT}/src")
set(VGM_ZLIB "${VGM_ROOT}/3rdParty/zlib")

set(VGM_SOURCES
    # zlib
    "${VGM_ZLIB}/adler32.c"
    "${VGM_ZLIB}/compress.c"
    "${VGM_ZLIB}/crc32.c"
    "${VGM_ZLIB}/gzio.c"
    "${VGM_ZLIB}/uncompr.c"
    "${VGM_ZLIB}/deflate.c"
    "${VGM_ZLIB}/trees.c"
    "${VGM_ZLIB}/zutil.c"
    "${VGM_ZLIB}/inflate.c"
    "${VGM_ZLIB}/infback.c"
    "${VGM_ZLIB}/inftrees.c"
    "${VGM_ZLIB}/inffast.c"
    # chips
    "${VGM_SRC}/chips/x1_010.c"
    "${VGM_SRC}/chips/ws_audio.c"
    "${VGM_SRC}/chips/vsu.c"
    "${VGM_SRC}/chips/saa1099.c"
    "${VGM_SRC}/chips/iremga20.c"
    "${VGM_SRC}/chips/es5506.c"
    "${VGM_SRC}/chips/es5503.c"
    "${VGM_SRC}/chips/c352.c"
    "${VGM_SRC}/chips/262intf.c"
    "${VGM_SRC}/chips/2151intf.c"
    "${VGM_SRC}/chips/2203intf.c"
    "${VGM_SRC}/chips/2413intf.c"
    "${VGM_SRC}/chips/2608intf.c"
    "${VGM_SRC}/chips/2610intf.c"
    "${VGM_SRC}/chips/2612intf.c"
    "${VGM_SRC}/chips/3526intf.c"
    "${VGM_SRC}/chips/3812intf.c"
    "${VGM_SRC}/chips/8950intf.c"
    "${VGM_SRC}/chips/adlibemu_opl2.c"
    "${VGM_SRC}/chips/adlibemu_opl3.c"
    "${VGM_SRC}/chips/ay8910.c"
    "${VGM_SRC}/chips/ay_intf.c"
    "${VGM_SRC}/chips/c140.c"
    "${VGM_SRC}/chips/c6280.c"
    "${VGM_SRC}/chips/c6280intf.c"
    "${VGM_SRC}/chips/dac_control.c"
    "${VGM_SRC}/chips/emu2149.c"
    "${VGM_SRC}/chips/emu2413.c"
    "${VGM_SRC}/chips/fm2612.c"
    "${VGM_SRC}/chips/fm.c"
    "${VGM_SRC}/chips/fmopl.c"
    "${VGM_SRC}/chips/gb.c"
    "${VGM_SRC}/chips/k051649.c"
    "${VGM_SRC}/chips/k053260.c"
    "${VGM_SRC}/chips/k054539.c"
    "${VGM_SRC}/chips/multipcm.c"
    "${VGM_SRC}/chips/nes_apu.c"
    "${VGM_SRC}/chips/nes_intf.c"
    "${VGM_SRC}/chips/np_nes_apu.c"
    "${VGM_SRC}/chips/np_nes_dmc.c"
    "${VGM_SRC}/chips/np_nes_fds.c"
    "${VGM_SRC}/chips/okim6258.c"
    "${VGM_SRC}/chips/okim6295.c"
    "${VGM_SRC}/chips/Ootake_PSG.c"
    "${VGM_SRC}/chips/panning.c"
    "${VGM_SRC}/chips/pokey.c"
    "${VGM_SRC}/chips/pwm.c"
    "${VGM_SRC}/chips/qsound_mame.c"
    "${VGM_SRC}/chips/qsound_intf.c"
    "${VGM_SRC}/chips/qsound_ctr.c"
    "${VGM_SRC}/chips/rf5c68.c"
    "${VGM_SRC}/chips/segapcm.c"
    "${VGM_SRC}/chips/scd_pcm.c"
    "${VGM_SRC}/chips/scsp.c"
    "${VGM_SRC}/chips/scspdsp.c"
    "${VGM_SRC}/chips/sn76489.c"
    "${VGM_SRC}/chips/sn76496.c"
    "${VGM_SRC}/chips/sn764intf.c"
    "${VGM_SRC}/chips/upd7759.c"
    "${VGM_SRC}/chips/ym2151.c"
    "${VGM_SRC}/chips/ym2413.c"
    "${VGM_SRC}/chips/ym2612.c"
    "${VGM_SRC}/chips/ymdeltat.c"
    "${VGM_SRC}/chips/ymf262.c"
    "${VGM_SRC}/chips/ymf271.c"
    "${VGM_SRC}/chips/ymf278b.c"
    "${VGM_SRC}/chips/ymz280b.c"
    "${VGM_SRC}/chips/ay8910_opl.c"
    "${VGM_SRC}/chips/sn76496_opl.c"
    "${VGM_SRC}/chips/ym3438.c"
    "${VGM_SRC}/chips/ym2413hd.c"
    "${VGM_SRC}/chips/ym2413_opl.c"
    # main
    "${VGM_SRC}/ChipMapper.c"
    "${VGM_SRC}/VGMPlay.c"
    "${VGM_SRC}/VGMPlayUI.c"
    "${VGM_SRC}/VGMPlay_AddFmts.c"
    # glue
    "${VGM_EMS}/Adapter.cpp"
    "${VGM_EMS}/MetaInfoHelper.cpp")

add_executable(vgm ${VGM_SOURCES})

set_target_properties(vgm PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
    OUTPUT_NAME "vgm"
    SUFFIX ".js"
    CXX_STANDARD 14
    CXX_STANDARD_REQUIRED ON)

target_include_directories(vgm PRIVATE
    "${VGM_EMS}"
    "${VGM_ROOT}"
    "${VGM_ZLIB}"
    "${VGM_SRC}")

target_compile_definitions(vgm PRIVATE
    ENABLE_ALL_CORES
    FM_EMU
    ADDITIONAL_FORMATS
    SET_CONSOLE_TITLE
    DISABLE_HW_SUPPORT
    NO_DEBUG_LOGS
    HAVE_STDINT_H
    EMSCRIPTEN)

target_compile_options(vgm PRIVATE
    -Os
    -O3
    -fno-strict-aliasing
    -Wno-pointer-sign
    -Wno-cast-align)

set(VGM_EXPORTS
    "_emu_set_resource_path,_emu_set_boost,_emu_load_file,_emu_get_sample_rate,_emu_get_current_position,_emu_get_max_position,_emu_seek_position,_emu_teardown,_emu_set_subsong,_emu_get_track_info,_emu_get_audio_buffer,_emu_get_audio_buffer_length,_emu_compute_audio_samples,_malloc,_free")

set(RUNTIME_METHODS
    "ccall,UTF8ToString,HEAP16,HEAPU8,HEAP32,FS_createDataFile,FS_createPath,FS_unlink")

target_link_options(vgm PRIVATE
    "-O3"
    "-Wl,--allow-multiple-definition"
    "-sERROR_ON_UNDEFINED_SYMBOLS=0"
    "-sWASM=1"
    "-sFORCE_FILESYSTEM=1"
    "-sINITIAL_MEMORY=67108864"
    "-sALLOW_MEMORY_GROWTH=0"
    "-sASSERTIONS=0"
    "-sNO_EXIT_RUNTIME=1"
    "-sDISABLE_EXCEPTION_CATCHING=1"
    "-sEXPORTED_FUNCTIONS=${VGM_EXPORTS}"
    "-sEXPORTED_RUNTIME_METHODS=${RUNTIME_METHODS}"
    "--js-library" "${VGM_EMS}/callback.js")

# ---- Assemble backend_vgm.js = shell-pre + vgm.js + shell-post + adapter ----
set(VGM_BACKEND_JS "${DIST_DIR}/backend_vgm.js")
add_custom_command(
    OUTPUT "${VGM_BACKEND_JS}"
    COMMAND "${CMAKE_COMMAND}"
            -DOUTPUT=${VGM_BACKEND_JS}
            "-DINPUTS=${VGM_EMS}/shell-pre.js;${CMAKE_CURRENT_BINARY_DIR}/vgm.js;${VGM_EMS}/shell-post.js;${VGM_EMS}/vgm_adapter.js"
            -P "${CONCAT_SCRIPT}"
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${CMAKE_CURRENT_BINARY_DIR}/vgm.wasm" "${DIST_DIR}/vgm.wasm"
    DEPENDS vgm
            "${VGM_EMS}/shell-pre.js"
            "${VGM_EMS}/shell-post.js"
            "${VGM_EMS}/vgm_adapter.js"
            "${CONCAT_SCRIPT}"
    VERBATIM
    COMMENT "Assembling backend_vgm.js (+ vgm.wasm)")

add_custom_target(backend_vgm ALL DEPENDS "${VGM_BACKEND_JS}")