/*
 * Trackify admin UI rendering.
 *
 * All dynamic values are written via textContent/value assignment — no
 * untrusted-HTML rendering anywhere (the page holds a superuser token).
 */
'use strict';

import { PLATFORM_OPTIONS, coverDisplayName } from './stage.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function platformSelect(value, onChange) {
    const select = el('select');
    const options = PLATFORM_OPTIONS.includes(value)
        ? PLATFORM_OPTIONS
        : [value, ...PLATFORM_OPTIONS].filter(Boolean);
    for (const option of options) {
        const node = el('option', '', option);
        node.value = option;
        select.appendChild(node);
    }
    select.value = value || '';
    if (onChange) select.addEventListener('change', () => onChange(select.value));
    return select;
}

function bindInput(input, get, set) {
    input.value = get();
    input.addEventListener('change', () => set(input.value));
    return input;
}

function probeStateClass(state) {
    if (state === 'ok') return 'ok';
    if (state === 'fail') return 'fail';
    if (state === 'active') return 'active';
    return 'pending';
}

export function renderUngrouped(staging, container, { onAssign }) {
    container.textContent = '';
    if (staging.ungrouped.length === 0) {
        container.closest('.card').hidden = true;
        return;
    }
    container.closest('.card').hidden = false;

    for (const entry of staging.ungrouped) {
        const li = el('li');
        li.appendChild(el('span', 'ungrouped-path', entry.relPath));

        const gameSelect = el('select');
        const placeholder = el('option', '', '— assign to game —');
        placeholder.value = '';
        gameSelect.appendChild(placeholder);
        for (const game of staging.games) {
            const node = el('option', '', `${game.platform} / ${game.title || game.id}`);
            node.value = game.key;
            gameSelect.appendChild(node);
        }
        const newOption = el('option', '', '— new game —');
        newOption.value = '__new__';
        gameSelect.appendChild(newOption);

        const newPlatform = platformSelect('');
        const newSlug = el('input');
        newSlug.placeholder = 'game-folder-name';
        const assignNew = el('button', '', 'Assign');
        const newFields = el('span');
        newFields.style.display = 'none';
        newFields.append(newPlatform, newSlug, assignNew);
        assignNew.addEventListener('click', () => {
            onAssign(entry.key, newPlatform.value, newSlug.value);
        });

        gameSelect.addEventListener('change', () => {
            if (gameSelect.value === '__new__') {
                newFields.style.display = 'inline-flex';
                newFields.style.gap = '8px';
                return;
            }
            newFields.style.display = 'none';
            if (gameSelect.value) {
                const game = staging.games.find((candidate) => candidate.key === gameSelect.value);
                if (game) {
                    onAssign(entry.key, game.platform, game._gameDir.split('/')[1]);
                }
            }
        });

        li.append(gameSelect, newFields);
        container.appendChild(li);
    }
}

function coverPreview(game) {
    const box = el('div', 'cover-box');
    const name = coverDisplayName(game);
    if (game.cover && game.cover.kind === 'manual' && game.cover.url) {
        const img = document.createElement('img');
        img.src = game.cover.url;
        img.alt = name;
        box.appendChild(img);
    } else if (name) {
        box.appendChild(el('span', '', name));
    } else {
        box.appendChild(el('span', '', 'no cover'));
    }
    return box;
}

function renderGameSection(staging, game, handlers) {
    const section = el('div', 'game-section');

    const head = el('div', 'game-head');
    head.appendChild(coverPreview(game));

    const coverControls = el('div', 'field');
    const replaceBtn = el('button', '', 'Replace cover…');
    const clearBtn = el('button', '', 'Clear cover');
    replaceBtn.addEventListener('click', () => handlers.onReplaceCover(game.key));
    clearBtn.addEventListener('click', () => handlers.onClearCover(game.key));
    coverControls.append(replaceBtn, clearBtn);
    head.appendChild(coverControls);

    const fields = el('div', 'game-fields');
    const fieldId = el('label', 'field');
    fieldId.append('id', bindInput(el('input'), () => game.id, (value) => { game.id = value; }));
    const fieldTitle = el('label', 'field');
    fieldTitle.append('title', bindInput(el('input'), () => game.title, (value) => { game.title = value; }));
    const fieldPlatform = el('label', 'field');
    fieldPlatform.append('platform', platformSelect(game.platform, (value) => { game.platform = value; }));
    const fieldYear = el('label', 'field');
    fieldYear.append('year', bindInput(el('input'), () => game.year, (value) => { game.year = value; }));
    const fieldCompany = el('label', 'field');
    fieldCompany.append(
        'company (comma separated)',
        bindInput(el('input'), () => game.companyText, (value) => { game.companyText = value; })
    );
    fields.append(fieldId, fieldTitle, fieldPlatform, fieldYear, fieldCompany);
    head.appendChild(fields);
    section.appendChild(head);

    for (const warning of game.warnings) {
        section.appendChild(el('p', 'muted', `Warning: ${warning}`));
    }

    if (game.sidecars.length > 0) {
        const sidecarList = el('ul', 'sidecar-list');
        for (const sidecar of game.sidecars) {
            sidecarList.appendChild(el('li', '', `sidecar: ${sidecar.name}`));
        }
        section.appendChild(sidecarList);
    }

    if (game.tracks.length > 0) {
        const table = el('table', 'track-table');
        const thead = el('thead');
        const headerRow = el('tr');
        for (const label of ['id', 'title', 'artist', 'length (s)', 'filename', 'probe']) {
            headerRow.appendChild(el('th', '', label));
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);
        const tbody = el('tbody');
        for (const track of game.tracks) {
            const row = el('tr');
            row.dataset.trackKey = track.key;
            const cellId = el('td');
            cellId.appendChild(bindInput(el('input'), () => track.id, (value) => { track.id = value; }));
            const cellTitle = el('td');
            cellTitle.appendChild(bindInput(el('input'), () => track.title, (value) => { track.title = value; }));
            const cellArtist = el('td');
            cellArtist.appendChild(bindInput(el('input'), () => track.artistText, (value) => { track.artistText = value; }));
            const cellLength = el('td');
            cellLength.appendChild(bindInput(el('input'), () => String(track.length), (value) => {
                const parsed = Number(value);
                track.length = Number.isFinite(parsed) ? Math.trunc(parsed) : -1;
            }));
            row.append(cellId, cellTitle, cellArtist, cellLength);
            const cellFilename = el('td', 'cell-filename', track.filename);
            row.appendChild(cellFilename);
            const cellProbe = el('td', `probe-state ${probeStateClass(track.probe.state)}`, track.probe.state);
            row.appendChild(cellProbe);
            tbody.appendChild(row);
        }
        table.appendChild(tbody);
        section.appendChild(table);
    }

    return section;
}

export function renderStaging(staging, container, handlers) {
    container.textContent = '';
    const games = staging.games;
    container.closest('.card').hidden = games.length === 0;
    for (const game of games) {
        container.appendChild(renderGameSection(staging, game, handlers));
    }
}

export function updateProbeState(container, track) {
    const row = container.querySelector(`tr[data-track-key="${track.key}"]`);
    if (!row) return;
    const cell = row.querySelector('.probe-state');
    if (!cell) return;
    cell.textContent = track.probe.error ? `${track.probe.state} (${track.probe.error})` : track.probe.state;
    cell.className = `probe-state ${probeStateClass(track.probe.state)}`;
}

const KIND_LABELS = { game: 'game', cover: 'cover', file: 'file', track: 'track' };

export function renderUploadProgress(uploader, container, summaryEl, buttons) {
    container.textContent = '';
    for (const item of uploader.items) {
        if (item.kind === 'game') {
            const gameBox = el('div', 'upload-game');
            gameBox.appendChild(el('strong', '', item.label));
            gameBox.dataset.gameKey = item.gameKey;
            container.appendChild(gameBox);
        }
        const gameBox = container.lastElementChild;
        if (!gameBox) continue;
        const row = el('div', 'upload-item');
        row.dataset.itemKey = item.key;
        row.appendChild(el('span', 'item-kind', KIND_LABELS[item.kind] || item.kind));
        row.appendChild(el('span', 'item-label', item.label));
        const state = el('span', `item-state ${item.state}`, item.state);
        if (item.note) state.textContent += ` (${item.note})`;
        row.appendChild(state);
        if (item.error) {
            row.appendChild(el('span', 'item-error', item.error));
        }
        gameBox.appendChild(row);
    }

    const counts = uploader.summary();
    summaryEl.textContent = `${uploader.items.length} items — completed ${counts.completed}, skipped ${counts.skipped}, failed ${counts.failed}, pending ${counts.pending + counts.active}`;
    buttons.retryFailed.hidden = counts.failed === 0;
    buttons.retryFailed.disabled = uploader.running;
    buttons.resume.hidden = !uploader.paused;
    buttons.resume.disabled = uploader.running;
    buttons.start.disabled = uploader.running;
    buttons.start.hidden = false;
}