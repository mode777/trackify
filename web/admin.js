/*
 * Trackify admin page entry.
 *
 * Standalone superuser page — intentionally OUTSIDE the shell/iframe
 * topology: no broker, no service id, its own PocketBase client with an
 * isolated auth store (see web/admin/auth.js and docs/admin.md).
 *
 * Flow: superuser gate -> select folder/files -> staging (offline) ->
 * optional WASM metadata probe -> review/edit -> batch upload with
 * per-item progress.
 */
'use strict';

import { createAdminAuth } from './admin/auth.js';
import { createStaging } from './admin/stage.js';
import { probeStagedGames } from './admin/probe.js';
import { createUploader } from './admin/upload.js';
import {
    renderStaging,
    renderUngrouped,
    renderUploadProgress,
    updateProbeState,
} from './admin/ui.js';

function byId(id) {
    return document.getElementById(id);
}

const loginView = byId('login-view');
const adminView = byId('admin-view');
const loginForm = byId('login-form');
const loginEmail = byId('login-email');
const loginPassword = byId('login-password');
const loginSubmit = byId('login-submit');
const loginError = byId('login-error');
const sessionBox = byId('session-box');
const sessionIdentity = byId('session-identity');
const logoutBtn = byId('logout-btn');
const folderInput = byId('folder-input');
const filesInput = byId('files-input');
const clearStagedBtn = byId('clear-staged');
const ungroupedList = byId('ungrouped-list');
const stagingRoot = byId('staging-root');
const stagingStatus = byId('staging-status');
const probeBtn = byId('probe-btn');
const uploadBtn = byId('upload-btn');
const uploadCard = byId('upload-card');
const uploadProgress = byId('upload-progress');
const uploadSummary = byId('upload-summary');
const retryFailedBtn = byId('retry-failed-btn');
const resumeBtn = byId('resume-btn');

const auth = createAdminAuth();
const staging = createStaging();

// Hidden input powering the per-game "Replace cover…" button.
const coverInput = document.createElement('input');
coverInput.type = 'file';
coverInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
coverInput.hidden = true;
let coverTargetKey = null;
coverInput.addEventListener('change', () => {
    const file = coverInput.files && coverInput.files[0];
    if (file && coverTargetKey) {
        staging.setManualCover(coverTargetKey, file);
        refreshStaging();
    }
    coverInput.value = '';
});

function refreshStaging() {
    renderUngrouped(staging, ungroupedList, {
        onAssign: (key, platform, slug) => {
            staging.assignUngrouped(key, platform, slug);
            refreshStaging();
        },
    });
    renderStaging(staging, stagingRoot, {
        onReplaceCover: (gameKey) => {
            coverTargetKey = gameKey;
            coverInput.click();
        },
        onClearCover: (gameKey) => {
            staging.clearCover(gameKey);
            refreshStaging();
        },
    });
    updateStartButton();
}

function updateStartButton() {
    const hasGames = staging.games.length > 0;
    const validation = staging.validate();
    uploadBtn.disabled = !hasGames || !validation.ok || probing || (uploader && uploader.running);
    stagingStatus.textContent = validation.ok
        ? ''
        : validation.problems.slice(0, 3).join(' · ');
}

// --- Auth gate -------------------------------------------------------------

function renderAuthState() {
    const valid = auth.isValid();
    loginView.hidden = valid;
    adminView.hidden = !valid;
    sessionBox.hidden = !valid;
    sessionIdentity.textContent = auth.identity();
}

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    loginError.textContent = '';
    loginSubmit.disabled = true;
    try {
        await auth.login(loginEmail.value.trim(), loginPassword.value);
    } catch (error) {
        loginError.hidden = false;
        loginError.textContent = error && (error.status === 400 || error.status === 401)
            ? 'Invalid superuser credentials.'
            : `Sign-in failed: ${error && error.message ? error.message : error}`;
    } finally {
        loginSubmit.disabled = false;
        loginPassword.value = '';
        renderAuthState();
    }
});

logoutBtn.addEventListener('click', () => {
    auth.logout();
});

auth.onChange(() => {
    renderAuthState();
    // Refresh skip-set-dependent buttons; staged data stays untouched.
    updateStartButton();
});

function handleAuthRequired() {
    auth.logout();
    renderAuthState();
    loginError.hidden = false;
    loginError.textContent = 'Session expired — sign in again to continue. Staged files are kept.';
}

// --- Staging inputs ---------------------------------------------------------

folderInput.addEventListener('change', () => {
    staging.addFiles(Array.from(folderInput.files || []));
    folderInput.value = '';
    refreshStaging();
});

filesInput.addEventListener('change', () => {
    staging.addFiles(Array.from(filesInput.files || []));
    filesInput.value = '';
    refreshStaging();
});

clearStagedBtn.addEventListener('click', () => {
    staging.clear();
    refreshStaging();
    uploadProgress.textContent = '';
    uploadSummary.textContent = '';
});

// --- Probing ----------------------------------------------------------------

let probing = false;

probeBtn.addEventListener('click', async () => {
    if (probing || staging.games.length === 0) return;
    probing = true;
    probeBtn.disabled = true;
    updateStartButton();
    await probeStagedGames(staging, {
        onTrackState: (track) => updateProbeState(stagingRoot, track),
        onBatchState: (text) => {
            stagingStatus.textContent = text;
        },
    });
    probing = false;
    probeBtn.disabled = false;
    updateStartButton();
});

// --- Upload -----------------------------------------------------------------

const uploader = createUploader({
    pb: auth.pb,
    staging,
    onItemsChanged: () => {
        renderUploadProgress(uploader, uploadProgress, uploadSummary, {
            retryFailed: retryFailedBtn,
            resume: resumeBtn,
            start: uploadBtn,
        });
    },
    onAuthRequired: handleAuthRequired,
    onDone: () => {
        updateStartButton();
        if (uploader.paused) {
            uploadSummary.textContent = 'Paused — sign in and resume. Staged items kept.';
        }
    },
});

uploadBtn.addEventListener('click', () => {
    if (!auth.isValid()) {
        handleAuthRequired();
        return;
    }
    uploadCard.hidden = false;
    uploader.start();
});

retryFailedBtn.addEventListener('click', () => {
    if (!auth.isValid()) {
        handleAuthRequired();
        return;
    }
    uploader.retryFailed();
});

resumeBtn.addEventListener('click', () => {
    if (!auth.isValid()) {
        handleAuthRequired();
        return;
    }
    uploader.resume();
});

// --- Boot -------------------------------------------------------------------

renderAuthState();
refreshStaging();
