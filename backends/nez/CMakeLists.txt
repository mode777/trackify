# NEZ backend (webnez + NEZplug++) compiled with emcmake.
# Mirrors submodules/webnez/emscripten/makeEmscripten.bat (modernized flags).

set(NEZ_ROOT "${SUBMODULES}/webnez")
set(NEZ_EMS "${NEZ_ROOT}/emscripten")
set(NEZ_SRC "${NEZ_ROOT}/src")
set(NEZ_KSS_CONV "${NEZ_ROOT}/kss_conv")

set(NEZ_SOURCES
    # CPU
    "${NEZ_SRC}/cpu/kmz80/kmz80t.c"
    "${NEZ_SRC}/cpu/kmz80/kmz80c.c"
    "${NEZ_SRC}/cpu/kmz80/kmz80.c"
    "${NEZ_SRC}/cpu/kmz80/kmevent.c"
    "${NEZ_SRC}/cpu/kmz80/kmdmg.c"
    # Devices
    "${NEZ_SRC}/device/opl/s_deltat.c"
    "${NEZ_SRC}/device/opl/s_opltbl.c"
    "${NEZ_SRC}/device/opl/s_opl.c"
    "${NEZ_SRC}/device/nes/s_vrc7.c"
    "${NEZ_SRC}/device/nes/s_vrc6.c"
    "${NEZ_SRC}/device/s_sng.c"
    "${NEZ_SRC}/device/s_scc.c"
    "${NEZ_SRC}/device/s_psg.c"
    "${NEZ_SRC}/device/nes/s_n106.c"
    "${NEZ_SRC}/device/nes/s_mmc5.c"
    "${NEZ_SRC}/device/s_logtbl.c"
    "${NEZ_SRC}/device/s_hesad.c"
    "${NEZ_SRC}/device/s_hes.c"
    "${NEZ_SRC}/device/nes/s_fme7.c"
    "${NEZ_SRC}/device/nes/s_fds3.c"
    "${NEZ_SRC}/device/nes/s_fds2.c"
    "${NEZ_SRC}/device/nes/s_fds1.c"
    "${NEZ_SRC}/device/nes/s_fds.c"
    "${NEZ_SRC}/device/s_dmg.c"
    "${NEZ_SRC}/device/nes/s_apu.c"
    "${NEZ_SRC}/device/nes/logtable.c"
    # Format handlers
    "${NEZ_SRC}/format/songinfo.c"
    "${NEZ_SRC}/format/nsf6502.c"
    "${NEZ_SRC}/format/m_nsd.c"
    "${NEZ_SRC}/format/m_sgc.c"
    "${NEZ_SRC}/format/m_zxay.c"
    "${NEZ_SRC}/format/m_nsf.c"
    "${NEZ_SRC}/format/m_kss.c"
    "${NEZ_SRC}/format/m_hes.c"
    "${NEZ_SRC}/format/m_gbr.c"
    "${NEZ_SRC}/format/audiosys.c"
    "${NEZ_SRC}/format/handler.c"
    "${NEZ_SRC}/format/nezplug.c"
    # Extra converters
    "${NEZ_KSS_CONV}/NSFEConverter.cpp"
    "${NEZ_KSS_CONV}/MUSConverter.cpp"
    "${NEZ_KSS_CONV}/SNGConverter.cpp"
    "${NEZ_KSS_CONV}/Converter.cpp"
    "${NEZ_KSS_CONV}/MPKConverter.cpp"
    "${NEZ_KSS_CONV}/OPXConverter.cpp"
    "${NEZ_KSS_CONV}/BGMConverter.cpp"
    "${NEZ_KSS_CONV}/MGSConverter.cpp"
    "${NEZ_KSS_CONV}/MBMConverter.cpp"
    # Glue
    "${NEZ_EMS}/MetaInfoHelper.cpp"
    "${NEZ_EMS}/Adapter.cpp")

add_executable(nez ${NEZ_SOURCES})

set_target_properties(nez PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
    OUTPUT_NAME "nez"
    SUFFIX ".js"
    CXX_STANDARD 14
    CXX_STANDARD_REQUIRED ON)

target_include_directories(nez PRIVATE
    "${NEZ_EMS}"
    "${NEZ_ROOT}"
    "${NEZ_SRC}"
    "${NEZ_SRC}/format"
    "${NEZ_SRC}/device"
    "${NEZ_SRC}/cpu"
    "${NEZ_SRC}/sdlplay"
    "${NEZ_KSS_CONV}")

target_compile_definitions(nez PRIVATE
    NO_DEBUG_LOGS
    HAVE_LIMITS_H
    HAVE_STDINT_H
    EMSCRIPTEN)

target_compile_options(nez PRIVATE
    -O3
    -fno-strict-aliasing
    -Wno-pointer-sign
    -Wno-cast-align
    -Wno-incompatible-function-pointer-types
    -Wno-incompatible-pointer-types)

set(NEZ_EXPORTS
    "_emu_load_file,_emu_set_loop,_emu_teardown,_emu_get_current_position,_emu_seek_position,_emu_get_max_position,_emu_number_trace_streams,_emu_get_trace_streams,_emu_get_trace_titles,_emu_set_subsong,_emu_get_track_info,_emu_get_sample_rate,_emu_get_audio_buffer,_emu_get_audio_buffer_length,_emu_compute_audio_samples,_emu_force_mbm_device,_malloc,_free")

set(RUNTIME_METHODS
    "ccall,UTF8ToString,HEAP16,HEAPU8,HEAP32,FS_createDataFile,FS_createPath,FS_unlink")

target_link_options(nez PRIVATE
    "-O3"
    "-Wl,--allow-multiple-definition"
    "-sWASM=1"
    "-sFORCE_FILESYSTEM=1"
    "-sINITIAL_MEMORY=67108864"
    "-sALLOW_MEMORY_GROWTH=0"
    "-sASSERTIONS=0"
    "-sDISABLE_EXCEPTION_CATCHING=0"
    "-sEXPORTED_FUNCTIONS=${NEZ_EXPORTS}"
    "-sEXPORTED_RUNTIME_METHODS=${RUNTIME_METHODS}"
    "--js-library" "${NEZ_EMS}/callback.js")

# ---- Assemble backend_nez.js = shell-pre + nez.js + shell-post + adapter ----
set(NEZ_BACKEND_JS "${DIST_DIR}/backend_nez.js")
add_custom_command(
    OUTPUT "${NEZ_BACKEND_JS}"
    COMMAND "${CMAKE_COMMAND}"
            -DOUTPUT=${NEZ_BACKEND_JS}
            "-DINPUTS=${NEZ_EMS}/shell-pre.js;${CMAKE_CURRENT_BINARY_DIR}/nez.js;${NEZ_EMS}/shell-post.js;${NEZ_EMS}/nez_adapter.js"
            -P "${CONCAT_SCRIPT}"
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${CMAKE_CURRENT_BINARY_DIR}/nez.wasm" "${DIST_DIR}/nez.wasm"
    DEPENDS nez
            "${NEZ_EMS}/shell-pre.js"
            "${NEZ_EMS}/shell-post.js"
            "${NEZ_EMS}/nez_adapter.js"
            "${CONCAT_SCRIPT}"
    VERBATIM
    COMMENT "Assembling backend_nez.js (+ nez.wasm)")

add_custom_target(backend_nez ALL DEPENDS "${NEZ_BACKEND_JS}")
