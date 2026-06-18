/*
 * Trackify player seek UI.
 *
 * Owns the seek bar element and its drag state, plus the 250 ms position
 * polling loop. Knows nothing about transport or media session other than
 * the callbacks passed in at bind time.
 */
'use strict';

import { els } from './dom.js';
import { getPlayer } from './player_host.js';

const SEEK_POLL_MS = 250;

let seekDragging = false;
let seekMaxMs = 0;
let syncMediaSessionPositionStateFn = () => {};

export function getSeekMaxMs() {
    return seekMaxMs;
}

export function formatMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '0:00';

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return String(hours) + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }
    return String(minutes) + ':' + String(seconds).padStart(2, '0');
}

function setSeekUiEnabled(enabled) {
    if (!els.seekBar || !els.seekWrap) return;

    els.seekBar.disabled = !enabled;
    els.seekWrap.classList.toggle('disabled', !enabled);
}

function updateSeekBarFill() {
    if (!els.seekBar) return;

    const max = Number(els.seekBar.max) || 1;
    const value = Number(els.seekBar.value) || 0;
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    els.seekBar.style.setProperty('--seek-progress', pct + '%');
}

export function resetSeekUi() {
    seekDragging = false;
    seekMaxMs = 0;
    if (!els.seekBar || !els.timeCurrent || !els.timeTotal) return;

    els.seekBar.max = '100';
    els.seekBar.value = '0';
    els.timeCurrent.textContent = '0:00';
    els.timeTotal.textContent = '0:00';
    updateSeekBarFill();
    setSeekUiEnabled(false);
}

export function refreshSeekUi() {
    const player = getPlayer();
    if (!player) {
        resetSeekUi();
        return;
    }

    let maxMs = -1;
    try {
        maxMs = player.getMaxPlaybackPosition();
    } catch (_error) {
        resetSeekUi();
        return;
    }

    if (!Number.isFinite(maxMs) || maxMs <= 0) {
        resetSeekUi();
        return;
    }

    const normalizedMaxMs = Math.floor(maxMs);
    if (normalizedMaxMs !== seekMaxMs && els.seekBar) {
        seekMaxMs = normalizedMaxMs;
        els.seekBar.max = String(seekMaxMs);
    }
    setSeekUiEnabled(true);

    if (els.timeTotal) {
        els.timeTotal.textContent = formatMs(seekMaxMs);
    }

    if (seekDragging || !els.seekBar) return;

    let positionMs = 0;
    try {
        positionMs = player.getPlaybackPosition();
    } catch (_error) {
        return;
    }
    if (!Number.isFinite(positionMs) || positionMs < 0) {
        positionMs = 0;
    }

    const clampedPosition = Math.max(0, Math.min(seekMaxMs, Math.floor(positionMs)));
    els.seekBar.value = String(clampedPosition);
    updateSeekBarFill();
    if (els.timeCurrent) {
        els.timeCurrent.textContent = formatMs(clampedPosition);
    }

    syncMediaSessionPositionStateFn();
}

export function bindSeekUi(deps = {}) {
    syncMediaSessionPositionStateFn = deps.syncMediaSessionPositionState || (() => {});

    if (!els.seekBar) return;

    els.seekBar.addEventListener('input', () => {
        if (els.seekBar.disabled) return;
        seekDragging = true;
        const pendingMs = Number(els.seekBar.value);
        updateSeekBarFill();
        if (els.timeCurrent) {
            els.timeCurrent.textContent = formatMs(pendingMs);
        }
    });

    els.seekBar.addEventListener('change', () => {
        if (els.seekBar.disabled) return;

        const player = getPlayer();
        if (!player) {
            seekDragging = false;
            return;
        }

        const targetMs = Number(els.seekBar.value);
        if (!Number.isFinite(targetMs)) {
            seekDragging = false;
            return;
        }

        try {
            player.seekPlaybackPosition(targetMs);
        } catch (error) {
            console.error('Seek failed', error);
        } finally {
            seekDragging = false;
            refreshSeekUi();
        }
    });
}

export function startSeekPolling() {
    setInterval(refreshSeekUi, SEEK_POLL_MS);
}
