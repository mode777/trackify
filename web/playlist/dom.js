/*
 * Trackify playlist frame DOM cache.
 *
 * One place to query every element this frame reads or writes. Every
 * other playlist module imports `els` from here; no module calls
 * document.getElementById directly (except where it manipulates
 * dynamically created nodes, e.g. the add-to-playlist popup).
 */
'use strict';

export const els = {
    heroArt: document.querySelector('.hero-art'),
    heroArtIcon: document.querySelector('.hero-playlist-icon'),
    heroEyebrow: document.getElementById('heroEyebrow'),
    heroTitle: document.getElementById('heroTitle'),
    heroEditButton: document.getElementById('heroEditButton'),
    heroArtEditButton: document.getElementById('heroArtEditButton'),
    heroArtEditPopover: document.getElementById('heroArtEditPopover'),
    heroArtEditColor: document.getElementById('heroArtEditColor'),
    heroArtEditColorSwatch: document.getElementById('heroArtEditColorSwatch'),
    heroArtEditIcon: document.getElementById('heroArtEditIcon'),
    heroArtEditSave: document.getElementById('heroArtEditSave'),
    heroArtEditCancel: document.getElementById('heroArtEditCancel'),
    heroCompany: document.getElementById('heroCompany'),
    heroYear: document.getElementById('heroYear'),
    heroMetaDot: document.getElementById('heroMetaDot'),
    publicToggleLabel: document.getElementById('publicToggleLabel'),
    publicToggle: document.getElementById('publicToggle'),
    list: document.getElementById('trackList'),
    status: document.getElementById('status'),
    playButton: document.querySelector('.primary-action'),
};
