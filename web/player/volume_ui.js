/*
 * Trackify player volume UI.
 *
 * Owns the volume slider element: keeps the fill bar in sync with the slider
 * value, propagates slider changes to ScriptNodePlayer.setVolume, and pulls
 * the current player volume back into the slider on demand.
 */
'use strict';

import { els } from './dom.js';
import { getPlayer } from './player_host.js';

export function updateVolumeBarFill() {
    if (!els.volumeBar) return;

    const max = Number(els.volumeBar.max) || 100;
    const value = Number(els.volumeBar.value) || 0;
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    els.volumeBar.style.setProperty('--volume-progress', pct + '%');
}

export function applyVolumeFromSlider() {
    if (!els.volumeBar) return;

    const value = Number(els.volumeBar.value);
    if (!Number.isFinite(value)) return;

    const player = getPlayer();
    if (!player) return;

    player.setVolume(Math.max(0, Math.min(100, value)) / 100);
}

export function syncVolumeUiFromPlayer() {
    if (!els.volumeBar) return;

    const player = getPlayer();
    if (!player) return;

    const volume = player.getVolume();
    if (!Number.isFinite(volume)) return;

    const clamped = Math.max(0, Math.min(1, volume));
    els.volumeBar.value = String(Math.round(clamped * 100));
    updateVolumeBarFill();
}

export function bindVolumeUi() {
    if (!els.volumeBar) return;

    updateVolumeBarFill();
    els.volumeBar.addEventListener('input', () => {
        updateVolumeBarFill();
        applyVolumeFromSlider();
    });
}
