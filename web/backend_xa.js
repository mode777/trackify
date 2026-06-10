'use strict';

const XA_RIFF_HEADER = 0x2c;
const XA_SECTOR_2352 = 2352;
const XA_SECTOR_2336 = 2336;
const XA_SUBHEADER_2352 = 16;
const XA_SUBHEADER_2336 = 0;
const XA_ADPCM_OFFSET_2352 = 24;
const XA_ADPCM_OFFSET_2336 = 8;
const XA_ADPCM_BYTES = 0x900;
const XA_PORTION = 0x80;
const XA_PORTIONS = 18;

const POS = [0, 60, 115, 98, 122];
const NEG = [0, 0, -52, -55, -60];

const ZZ = [
    [0, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, -0x0002, 0x000A, -0x0022, 0x0041, -0x0054, 0x0034, 0x0009, -0x010A, 0x0400, -0x0A78, 0x234C, 0x6794, -0x1780, 0x0BCD, -0x0623, 0x0350, -0x016D, 0x006B, 0x000A, -0x0010, 0x0011, -0x0008, 0x0003, -0x0001],
    [0, 0x0000, 0x0000, 0x0000, -0x0002, 0x0000, 0x0003, -0x0013, 0x003C, -0x004B, 0x00A2, -0x00E3, 0x0132, -0x0043, -0x0267, 0x0C9D, 0x74BB, -0x11B4, 0x09B8, -0x05BF, 0x0372, -0x01A8, 0x00A6, -0x001B, 0x0005, 0x0006, -0x0008, 0x0003, -0x0001, 0x0000],
    [0, 0x0000, 0x0000, -0x0001, 0x0003, -0x0002, -0x0005, 0x001F, -0x004A, 0x00B3, -0x0192, 0x02B1, -0x039E, 0x04F8, -0x05A6, 0x7939, -0x05A6, 0x04F8, -0x039E, 0x02B1, -0x0192, 0x00B3, -0x004A, 0x001F, -0x0005, -0x0002, 0x0003, -0x0001, 0x0000, 0x0000],
    [0, 0x0000, -0x0001, 0x0003, -0x0008, 0x0006, 0x0005, -0x001B, 0x00A6, -0x01A8, 0x0372, -0x05BF, 0x09B8, -0x11B4, 0x74BB, 0x0C9D, -0x0267, -0x0043, 0x0132, -0x00E3, 0x00A2, -0x004B, 0x003C, -0x0013, 0x0003, 0x0000, -0x0002, 0x0000, 0x0000, 0x0000],
    [0, -0x0001, 0x0003, -0x0008, 0x0011, -0x0010, 0x000A, 0x006B, -0x016D, 0x0350, -0x0623, 0x0BCD, -0x1780, 0x6794, 0x234C, -0x0A78, 0x0400, -0x010A, 0x0009, 0x0034, -0x0054, 0x0041, -0x0022, 0x000A, -0x0001, 0x0000, 0x0001, 0x0000, 0x0000, 0x0000],
    [0, 0x0002, -0x0008, 0x0010, -0x0023, 0x002B, 0x001A, -0x00EB, 0x027B, -0x0548, 0x0AFA, -0x16FA, 0x53E0, 0x3C07, -0x1249, 0x080E, -0x0347, 0x015B, -0x0044, -0x0017, 0x0046, -0x0023, 0x0011, -0x0005, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000],
    [0, -0x0005, 0x0011, -0x0023, 0x0046, -0x0017, -0x0044, 0x015B, -0x0347, 0x080E, -0x1249, 0x3C07, 0x53E0, -0x16FA, 0x0AFA, -0x0548, 0x027B, -0x00EB, 0x001A, 0x002B, -0x0023, 0x0010, -0x0008, 0x0002, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000],
];

function clamp16(sample) {
    if (sample < -0x8000) return -0x8000;
    if (sample > 0x7fff) return 0x7fff;
    return sample;
}

function signed4bit(value) {
    return (value & 0x08) ? (value - 16) : value;
}

function zigzagPush(sample, zz, out, outBase, stride) {
    zz.ring[zz.p & 0x1f] = sample;
    zz.p++;
    if (--zz.six !== 0) return 0;
    zz.six = 6;

    let writePos = outBase;
    for (let t = 0; t < 7; t++) {
        const table = ZZ[t];
        let sum = 0;
        for (let i = 1; i <= 29; i++) {
            sum += Math.trunc((zz.ring[(zz.p - i) & 0x1f] * table[i]) / 0x8000);
        }
        out[writePos] = clamp16(sum);
        writePos += stride;
    }
    return 7;
}

class XaBackendAdapter extends ScriptNodeBackendAdapter {
    constructor() {
        super(2, 2, new BaseFileMapper());

        this._data = null;
        this._pcm = new Int16Array(0);
        this._pcmFrames = 0;
        this._sectors = [];
        this._sectorIdx = 0;
        this._nativeRate = 37800;
        this._stereo = true;
        this._bitsPerSample = 4;
        this._targetFile = 0;
        this._targetChannel = 0;

        this._adpcm = [{ old: 0, older: 0 }, { old: 0, older: 0 }];
        this._zz = [this._newZzState(), this._newZzState()];
        this._scratchL = new Int16Array(4032);
        this._scratchR = new Int16Array(4032);

        this._totalFrames = 0;
        this._playedFrames = 0;
        this._songInfo = {};
    }

    _newZzState() {
        return { ring: new Int32Array(32), p: 0, six: 6 };
    }

    isAdapterReady() {
        return true;
    }

    teardown() {
        super.teardown();
        this._data = null;
        this._pcm = new Int16Array(0);
        this._pcmFrames = 0;
        this._sectors = [];
        this._sectorIdx = 0;
        this._totalFrames = 0;
        this._playedFrames = 0;
        this._scratchL.fill(0);
        this._scratchR.fill(0);
    }

    getChannels() {
        return 2;
    }

    loadMusicData(sampleRate, path, filename, data) {
        let input = data;
        if (input instanceof ArrayBuffer) {
            input = new Uint8Array(input);
        }
        if (!(input instanceof Uint8Array) || !input.length) {
            return -1;
        }

        if (!this._parseContainer(input)) {
            return -1;
        }

        this._data = input;
        this._sectorIdx = 0;
        this._playedFrames = 0;
        this._pcmFrames = 0;
        this._resetDecodeState();

        this.resetSampleRate(sampleRate, 44100);
        this._buildSongInfo(filename);
        return 0;
    }

    computeAudioSamples() {
        if (this._sectorIdx >= this._sectors.length) {
            return 1;
        }

        const offset = this._sectors[this._sectorIdx++];
        this._pcmFrames = this._decodeAndReshapeSector(offset);
        this._playedFrames += this._pcmFrames;
        return 0;
    }

    getAudioBuffer() {
        return 0;
    }

    getAudioBufferLength() {
        return this._pcmFrames;
    }

    readFloatSample(buffer, idx) {
        return this._pcm[buffer + idx] / 0x8000;
    }

    getSongInfoMeta() {
        return {
            title: String,
            game: String,
            detail: String,
        };
    }

    updateSongInfo() {
    }

    getMaxPlaybackPosition() {
        if (!this._totalFrames) return 0;
        return Math.round((this._totalFrames / 44100) * 1000);
    }

    getPlaybackPosition() {
        if (!this._playedFrames) return 0;
        return Math.round((this._playedFrames / 44100) * 1000);
    }

    seekPlaybackPosition(ms) {
        const clampedMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
        const frame = Math.floor((clampedMs / 1000) * 44100);
        this._sectorIdx = this._frameToSectorIndex(frame);
        this._playedFrames = this._sectorIdx * this._framesPerSector();
        this._pcmFrames = 0;
        this._resetDecodeState();
        this._transformer.seekPosition(clampedMs);
    }

    _buildSongInfo(filename) {
        const fallback = 'XA Audio';
        const name = typeof filename === 'string' ? filename : '';
        const leaf = name.split('/').pop() || name.split('\\').pop() || fallback;
        const dot = leaf.lastIndexOf('.');
        const title = dot > 0 ? leaf.slice(0, dot) : leaf;

        this._songInfo = {
            title: title || fallback,
            game: '',
            detail: this._nativeRate + ' Hz - ' + (this._stereo ? 'Stereo' : 'Mono') + ' - ' + this._bitsPerSample + '-bit XA-ADPCM',
        };
    }

    _resetDecodeState() {
        this._adpcm[0].old = 0;
        this._adpcm[0].older = 0;
        this._adpcm[1].old = 0;
        this._adpcm[1].older = 0;

        this._zz[0].ring.fill(0);
        this._zz[0].p = 0;
        this._zz[0].six = 6;
        this._zz[1].ring.fill(0);
        this._zz[1].p = 0;
        this._zz[1].six = 6;
    }

    _ascii(off, len) {
        let out = '';
        for (let i = 0; i < len && off + i < this._data.length; i++) {
            out += String.fromCharCode(this._data[off + i]);
        }
        return out;
    }

    _hasSync2352(offset) {
        if (offset + 12 > this._data.length) return false;
        if (this._data[offset] !== 0x00 || this._data[offset + 11] !== 0x00) return false;
        for (let i = 1; i <= 10; i++) {
            if (this._data[offset + i] !== 0xff) return false;
        }
        return true;
    }

    _parseContainer(data) {
        this._data = data;

        let base = 0;
        let sectorSize = 0;
        let subOffset = 0;
        let adpcmOffset = 0;

        const riff = this._ascii(0, 4) === 'RIFF';
        const cdxa = this._ascii(8, 8) === 'CDXAfmt ';
        if (riff && cdxa) {
            base = XA_RIFF_HEADER;
            sectorSize = XA_SECTOR_2352;
            subOffset = XA_SUBHEADER_2352;
            adpcmOffset = XA_ADPCM_OFFSET_2352;
        } else if (this._hasSync2352(0)) {
            base = 0;
            sectorSize = XA_SECTOR_2352;
            subOffset = XA_SUBHEADER_2352;
            adpcmOffset = XA_ADPCM_OFFSET_2352;
        } else if (data.length % XA_SECTOR_2336 === 0) {
            base = 0;
            sectorSize = XA_SECTOR_2336;
            subOffset = XA_SUBHEADER_2336;
            adpcmOffset = XA_ADPCM_OFFSET_2336;
        } else {
            return false;
        }

        const available = data.length - base;
        if (available < sectorSize) return false;
        const sectorCount = Math.floor(available / sectorSize);
        if (!sectorCount) return false;

        let foundTarget = false;
        let targetFile = 0;
        let targetChannel = 0;
        let firstCi = 0;

        const sectors = [];
        for (let i = 0; i < sectorCount; i++) {
            const sectorStart = base + (i * sectorSize);
            const sh = sectorStart + subOffset;
            if (sh + 4 > data.length) break;

            const file = data[sh];
            const channel = data[sh + 1];
            const submode = data[sh + 2];
            const coding = data[sh + 3];

            if ((submode & 0x04) === 0) continue;

            if (!foundTarget) {
                foundTarget = true;
                targetFile = file;
                targetChannel = channel;
                firstCi = coding;
                this._stereo = (coding & 0x03) === 1;
                this._nativeRate = (coding & 0x04) ? 18900 : 37800;
                const bitsField = (coding >> 4) & 0x03;
                this._bitsPerSample = bitsField === 1 ? 8 : 4;
            }

            if (file !== targetFile || channel !== targetChannel) continue;

            const adpcmStart = sectorStart + adpcmOffset;
            if (adpcmStart + XA_ADPCM_BYTES > data.length) continue;
            sectors.push(adpcmStart);
        }

        if (!foundTarget || !sectors.length) return false;

        this._targetFile = targetFile;
        this._targetChannel = targetChannel;
        this._sectors = sectors;
        this._sectorIdx = 0;
        this._totalFrames = this._framesPerSector() * this._sectors.length;
        return firstCi >= 0;
    }

    _decodeRun4(view, blk, nibble, out, outPos, hist) {
        const header = view[4 + (blk * 2) + nibble];
        const shift = 12 - (header & 0x0f);
        const filter = (header & 0x30) >> 4;
        const f0 = POS[filter];
        const f1 = NEG[filter];

        let old = hist.old;
        let older = hist.older;
        for (let j = 0; j < 28; j++) {
            const packed = view[16 + blk + (j * 4)];
            const nib = signed4bit((packed >> (nibble * 4)) & 0x0f);
            const sample = clamp16((nib << shift) + ((old * f0 + older * f1 + 32) >> 6));
            out[outPos++] = sample;
            older = old;
            old = sample;
        }

        hist.old = old;
        hist.older = older;
        return outPos;
    }

    _decodeRun8(view, blk, out, outPos, hist) {
        const header = view[8 + blk];
        const shift = 12 - (header & 0x0f);
        const filter = (header & 0x30) >> 4;
        const f0 = POS[filter];
        const f1 = NEG[filter];

        let old = hist.old;
        let older = hist.older;
        for (let j = 0; j < 28; j++) {
            const t = (view[16 + blk + (j * 4)] << 24) >> 24;
            const sample = clamp16((t << shift) + ((old * f0 + older * f1 + 32) >> 6));
            out[outPos++] = sample;
            older = old;
            old = sample;
        }

        hist.old = old;
        hist.older = older;
        return outPos;
    }

    _decodeAdpcmSector(off) {
        let leftPos = 0;
        let rightPos = 0;

        for (let portion = 0; portion < XA_PORTIONS; portion++) {
            const pOff = off + (portion * XA_PORTION);
            const view = this._data.subarray(pOff, pOff + XA_PORTION);

            if (this._bitsPerSample === 8) {
                if (this._stereo) {
                    leftPos = this._decodeRun8(view, 0, this._scratchL, leftPos, this._adpcm[0]);
                    leftPos = this._decodeRun8(view, 1, this._scratchL, leftPos, this._adpcm[0]);
                    rightPos = this._decodeRun8(view, 2, this._scratchR, rightPos, this._adpcm[1]);
                    rightPos = this._decodeRun8(view, 3, this._scratchR, rightPos, this._adpcm[1]);
                } else {
                    leftPos = this._decodeRun8(view, 0, this._scratchL, leftPos, this._adpcm[0]);
                    leftPos = this._decodeRun8(view, 1, this._scratchL, leftPos, this._adpcm[0]);
                    leftPos = this._decodeRun8(view, 2, this._scratchL, leftPos, this._adpcm[0]);
                    leftPos = this._decodeRun8(view, 3, this._scratchL, leftPos, this._adpcm[0]);
                }
                continue;
            }

            if (this._stereo) {
                for (let blk = 0; blk < 4; blk++) {
                    leftPos = this._decodeRun4(view, blk, 0, this._scratchL, leftPos, this._adpcm[0]);
                    rightPos = this._decodeRun4(view, blk, 1, this._scratchR, rightPos, this._adpcm[1]);
                }
            } else {
                for (let blk = 0; blk < 4; blk++) {
                    leftPos = this._decodeRun4(view, blk, 0, this._scratchL, leftPos, this._adpcm[0]);
                    leftPos = this._decodeRun4(view, blk, 1, this._scratchL, leftPos, this._adpcm[0]);
                }
            }
        }

        if (!this._stereo) {
            this._scratchR.set(this._scratchL.subarray(0, leftPos), 0);
        }

        return this._stereo ? Math.min(leftPos, rightPos) : leftPos;
    }

    _decodeAndReshapeSector(off) {
        const decoded = this._decodeAdpcmSector(off);
        const outFrames = this._framesPerSector();

        if (this._pcm.length !== outFrames * 2) {
            this._pcm = new Int16Array(outFrames * 2);
        }

        let outL = 0;
        let outR = 1;
        for (let i = 0; i < decoded; i++) {
            const left = this._scratchL[i];
            const right = this._stereo ? this._scratchR[i] : left;
            const emittedL = zigzagPush(left, this._zz[0], this._pcm, outL, 2);
            const emittedR = zigzagPush(right, this._zz[1], this._pcm, outR, 2);
            const emitted = Math.min(emittedL, emittedR);
            outL += emitted * 2;
            outR += emitted * 2;
        }

        return outFrames;
    }

    _framesPerSector() {
        const basePerChannel = this._stereo ? 2016 : 4032;
        return Math.round((basePerChannel * 7) / 6);
    }

    _frameToSectorIndex(frame) {
        const framesPerSector = this._framesPerSector();
        if (!framesPerSector) return 0;
        const index = Math.floor(frame / framesPerSector);
        if (index < 0) return 0;
        if (index > this._sectors.length) return this._sectors.length;
        return index;
    }
}

window.XaBackendAdapter = XaBackendAdapter;
window.spp_backend_state_XA = { notReady: false };