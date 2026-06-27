/*
 * Trackify playlist status line.
 *
 * Single owner of the #status element text. Used by the playlist
 * state machine, the title edit flow, the navigation module, and the
 * player.stateChanged mirror.
 */
'use strict';

import { els } from './dom.js';

export function setStatus(message) {
    if (els.status) {
        els.status.textContent = message;
    }
}
