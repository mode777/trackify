# The Player & Formats

The player bar is pinned to the bottom of every page and keeps playing while
you browse. It is driven by real emulator cores compiled to WebAssembly —
the audio never leaves your machine; only the files themselves are streamed
from your instance.

## Transport controls

| Control        | What it does                                        |
| -------------- | --------------------------------------------------- |
| Play / pause   | Start or pause the current track                    |
| Previous / next| Step through the queue                              |
| Seek bar       | Click or drag to jump anywhere in the track         |
| Volume         | Drag to set the level                               |
| Shuffle        | Toggle shuffled playback (button lights up when on) |

The now-playing area shows the current track with its game and cover art.

## System media keys

Trackify registers with the browser's [Media Session
API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API):
your keyboard's media keys, lock screen, and OS media controls all control
playback, and show the current track's title and cover art.

## How backends are selected

The player picks a backend by file extension and **lazy-loads** it: only the
format runtime you actually open is fetched and initialized. The first track
of a new format takes a moment (WASM download + compilation); after that,
tracks of the same format start instantly.

## Supported formats

| System                     | Extensions                                                                 | Backend core        |
| -------------------------- | -------------------------------------------------------------------------- | ------------------- |
| PlayStation · PSF          | `.psf` `.minipsf` `.psf2` `.minipsf2` `.psflib`                            | Highly Experimental |
| Super Nintendo · SPC       | `.spc` `.rsn`                                                              | Game Music Emu      |
| NES, MSX & friends         | `.nsf` `.bgm` `.opx` `.sng` `.kss`                                         | NEZplug++           |
| Nintendo 64 · USF          | `.usf` `.miniusf` `.usflib`                                                | LazyUSF2            |
| Chip music logs · VGM      | `.vgm` `.vgz` `.cmf` `.dro`                                                | VGMPlay             |
| PlayStation CD-XA          | `.xa`                                                                      | Native JS decoder   |
| Streamed audio             | `.genh` `.mp3`                                                             | Native JS decoders  |

Sidecar files (`.psflib`, `.usflib`, and similar resources) are part of the
game's file bundle and are resolved automatically when a track needs them —
that is why [Adding Music](/adding-music/) asks you to upload whole game
folders rather than single files.

::: tip N64 tracks are heavy
The N64 core runs without dynamic recompilation and uses more memory than
the others. On slower machines, N64 playback may need a moment more to
start. See [Troubleshooting](/troubleshooting/).
:::
