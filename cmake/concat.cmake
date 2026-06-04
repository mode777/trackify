# concat.cmake - cross-platform binary-safe file concatenation.
#
# Usage:
#   cmake -DOUTPUT=<out-file> "-DINPUTS=<file1>;<file2>;..." -P concat.cmake
#
# Reads each input file as hex and writes the raw bytes to OUTPUT. Using HEX
# avoids any CMake variable/escape mangling of the JavaScript payload
# (template literals like ${...}, backslashes, quotes, etc.).

if(NOT DEFINED OUTPUT)
    message(FATAL_ERROR "concat.cmake: OUTPUT not set")
endif()
if(NOT DEFINED INPUTS)
    message(FATAL_ERROR "concat.cmake: INPUTS not set")
endif()

set(_accum "")
foreach(_f IN LISTS INPUTS)
    if(NOT EXISTS "${_f}")
        message(FATAL_ERROR "concat.cmake: input file does not exist: ${_f}")
    endif()
    file(READ "${_f}" _hex HEX)
    string(APPEND _accum "${_hex}")
endforeach()

# Write accumulated hex back as raw bytes.
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "\\1\n" _lines "${_accum}")
# Build the binary content from the hex pairs.
file(WRITE "${OUTPUT}.hex" "${_accum}")

# Convert hex string into bytes via a small loop.
string(LENGTH "${_accum}" _len)
math(EXPR _bytes "${_len} / 2")
set(_out "")
set(_i 0)
# CMake string ops are slow for huge files; process in chunks using a writer.
# Use file(WRITE) once by building a list of byte values is impractical;
# instead decode using string(ASCII) per byte appended to a buffer that we
# flush periodically.
set(_buffer "")
set(_flushcount 0)
while(_i LESS _len)
    string(SUBSTRING "${_accum}" ${_i} 2 _pair)
    # Convert hex pair to decimal.
    string(TOUPPER "${_pair}" _pairU)
    string(SUBSTRING "${_pairU}" 0 1 _hi)
    string(SUBSTRING "${_pairU}" 1 1 _lo)
    string(FIND "0123456789ABCDEF" "${_hi}" _hiv)
    string(FIND "0123456789ABCDEF" "${_lo}" _lov)
    math(EXPR _dec "${_hiv} * 16 + ${_lov}")
    string(ASCII ${_dec} _ch)
    string(APPEND _buffer "${_ch}")
    math(EXPR _i "${_i} + 2")
endwhile()
file(WRITE "${OUTPUT}" "${_buffer}")
file(REMOVE "${OUTPUT}.hex")
