# FAQ

## What is Trackify?

A self-hosted web player for video game music. You run one instance on your
own hardware, load your own soundtrack rips into its catalog, and listen
from any browser — the audio is decoded locally by emulator cores compiled
to WebAssembly.

## Which formats does it play?

PSF (PlayStation), SPC (Super Nintendo), NSF and friends (NES/MSX), USF
(Nintendo 64), VGM/VGZ/CMF/DRO (chip music logs), CD-XA, and streamed MP3 /
GENH audio. The full table with extensions lives in
[The Player & Formats](/player/).

## Where does the music come from?

From you. Trackify ships with an empty catalog and distributes nothing —
you provide your own files and upload them to your instance. All game music
remains the property of its respective rights holders.

## Do I need an account?

Only for favorites and playlists. Browsing and playback work without
signing in; catalog reads are public on the instance, writes are
superuser-only.

## Why is the first song slow to start?

The player lazy-loads the emulator core for a format on first use. After
that, tracks of the same format start instantly. See
[Troubleshooting](/troubleshooting/).

## How do I add music to my instance?

Sign in as superuser and use the upload page at `/admin.html`, or run the
CLI import pipeline from a repository checkout. Both are covered in
[Adding Music](/adding-music/).

## Is there a prebuilt Docker image?

Not publicly — the release image currently lives in a private registry.
Build your own with the two commands in [Hosting & Running](/hosting/).

## Can I listen on my phone?

Yes — the UI is responsive, and playback integrates with the phone's media
controls (lock screen, notification controls) through the Media Session API.

## How do I back up my instance?

Everything that matters — catalog, users, favorites, playlists, audio,
cover art — lives in the `pb_data` volume. Snapshot that volume and you have
a complete backup.

## Where do I report bugs or contribute?

On GitHub: [mode777/trackify](https://github.com/mode777/trackify).
Developer-facing architecture docs live in the repository's `docs/`
directory.
