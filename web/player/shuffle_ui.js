/*
 * Trackify player shuffle UI.
 *
 * Owns the shuffle button: toggles the transport's shuffle flag on click
 * and mirrors the active state back into the button (green icon + filled
 * glyph when on, muted outline when off).
 */
'use strict';

import { els } from './dom.js';
import { toggleShuffle, isShuffleEnabled } from './transport.js';

let onChangeFn = () => {};

export function bindShuffleUi(deps = {}) {
    onChangeFn = deps.onChange || (() => {});

    if (!els.shuffle) return;

    const syncButton = () => {
        const enabled = isShuffleEnabled();
        els.shuffle.classList.toggle('active', enabled);
        els.shuffle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        els.shuffle.title = enabled ? 'Shuffle on' : 'Shuffle';
    };

    els.shuffle.addEventListener('click', () => {
        toggleShuffle();
        syncButton();
        onChangeFn(isShuffleEnabled());
    });

    syncButton();
}
