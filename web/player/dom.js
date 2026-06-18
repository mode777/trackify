/*
 * Trackify player frame DOM cache.
 *
 * Owns the lookup of UI element references used by every other player module.
 * Centralizing it keeps selectors in one place and lets us guard against
 * missing elements once.
 */
'use strict';

export const els = {
    prev: document.getElementById('prevBtn'),
    play: document.getElementById('playBtn'),
    next: document.getElementById('nextBtn'),
    thumb: document.querySelector('.thumb'),
    status: document.getElementById('status'),
    trackTitle: document.getElementById('currentTrackTitle'),
    trackMeta: document.getElementById('currentTrackMeta'),
    seekWrap: document.getElementById('seekWrap'),
    seekBar: document.getElementById('seekBar'),
    volumeBar: document.getElementById('volumeBar'),
    timeCurrent: document.getElementById('timeCurrent'),
    timeTotal: document.getElementById('timeTotal'),
};
