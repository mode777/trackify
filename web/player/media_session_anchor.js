/*
 * Trackify silent media-session anchor.
 *
 * ScriptNodePlayer drives audio via the Web Audio API, which does not expose
 * an HTMLMediaElement. Chrome only keeps the OS media controls (and Media
 * Session) alive while a media element is playing or paused, so it tears the
 * session down a few seconds after Web Audio output stops on pause. We anchor
 * the session to a silent, looping <audio> element whose play/pause state
 * mirrors real playback; pausing it (rather than stopping/removing it) keeps
 * the OS card visible just like a normal paused audio track.
 */
'use strict';

let silenceAnchorEl = null;
let silenceAnchorUrl = '';

function createSilentWavUrl() {
    const sampleRate = 8000;
    const numSamples = sampleRate; // 1 second of silence, looped.
    const dataSize = numSamples; // 8-bit mono.
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset, text) => {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true); // byteRate (sampleRate * blockAlign)
    view.setUint16(32, 1, true); // blockAlign
    view.setUint16(34, 8, true); // bitsPerSample
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < numSamples; i++) {
        view.setUint8(44 + i, 128); // 8-bit PCM silence midpoint
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
}

function ensureSilenceAnchor() {
    if (silenceAnchorEl) return silenceAnchorEl;

    silenceAnchorUrl = createSilentWavUrl();
    silenceAnchorEl = new Audio();
    silenceAnchorEl.src = silenceAnchorUrl;
    silenceAnchorEl.loop = true;
    silenceAnchorEl.preload = 'auto';
    // Must stay unmuted with non-zero volume; muted elements do not anchor a
    // media session. The content itself is silent, so nothing is audible.
    silenceAnchorEl.volume = 1;
    return silenceAnchorEl;
}

export function startSilenceAnchor() {
    const el = ensureSilenceAnchor();
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
            // Autoplay restrictions; the next user gesture will retry.
        });
    }
}

export function pauseSilenceAnchor() {
    if (silenceAnchorEl) {
        silenceAnchorEl.pause();
    }
}
