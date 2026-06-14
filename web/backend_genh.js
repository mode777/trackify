'use strict';

const GENH_CODEC_PSX = 0;
const GENH_CODEC_PCM16LE = 4;
const GENH_BLOCK_SIZE_PSX = 16;
const GENH_SAMPLES_PER_PSX_FRAME = 28;
const GENH_CHUNK_FRAMES = 2048;

const PSX_F0 = [0, 60, 115, 98, 122];
const PSX_F1 = [0, 0, -52, -55, -60];

function clamp16(sample) {
    if (sample < -0x8000) return -0x8000;
    if (sample > 0x7fff) return 0x7fff;
    return sample;
}

function signed4bit(value) {
    return (value & 0x08) ? (value - 16) : value;
}

function asciiAt(data, offset, length) {
    let out = '';
    for (let i = 0; i < length && offset + i < data.length; i++) {
        out += String.fromCharCode(data[offset + i]);
    }
    return out;
}

function parseGenhHeader(data) {
    if (!(data instanceof Uint8Array) || data.length < 0x24) return null;

    if (asciiAt(data, 0, 4) !== 'GENH') return null;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const channels = view.getUint32(0x04, true);
    const interleave = view.getUint32(0x08, true);
    const sampleRate = view.getUint32(0x0c, true);
    const loopStartSampleRaw = view.getInt32(0x10, true);
    const loopEndSampleRaw = view.getInt32(0x14, true);
    const codec = view.getUint32(0x18, true);
    let startOffset = view.getUint32(0x1c, true);
    let headerSize = view.getUint32(0x20, true);

    if (headerSize === 0) {
        startOffset = 0x800;
        headerSize = 0x800;
    }

    if (!channels || !sampleRate) return null;
    if (headerSize < 0x24) return null;
    if (headerSize > startOffset) return null;
    if (startOffset >= data.length) return null;

    let numSamples = 0;
    let dataSize = 0;
    let interleaveLast = 0;

    if (headerSize >= 0x100) {
        numSamples = view.getInt32(0x40, true);
        dataSize = view.getUint32(0x50, true);
        interleaveLast = view.getUint32(0x54, true);
    }

    if (dataSize === 0) {
        dataSize = data.length - startOffset;
    }

    if (dataSize <= 0) return null;

    const payloadSize = Math.min(dataSize, data.length - startOffset);
    if (payloadSize <= 0) return null;

    if (codec !== GENH_CODEC_PSX && codec !== GENH_CODEC_PCM16LE) return null;

    const hasLoop = loopStartSampleRaw !== -1;
    let loopStartSample = hasLoop ? Math.max(0, loopStartSampleRaw) : 0;
    let loopEndSample = hasLoop && loopEndSampleRaw > 0 ? loopEndSampleRaw : 0;

    if (numSamples <= 0) {
        numSamples = loopEndSampleRaw;
    }

    if (numSamples <= 0) {
        if (codec === GENH_CODEC_PCM16LE) {
            const bytesPerFrame = channels * 2;
            if (!bytesPerFrame) return null;
            numSamples = Math.floor(payloadSize / bytesPerFrame);
        } else {
            const psxFramesPerChannel = Math.floor(payloadSize / (channels * GENH_BLOCK_SIZE_PSX));
            numSamples = psxFramesPerChannel * GENH_SAMPLES_PER_PSX_FRAME;
        }
    }

    if (numSamples <= 0) return null;

    loopStartSample = Math.min(loopStartSample, numSamples);
    if (loopEndSample <= 0 || loopEndSample > numSamples) {
        loopEndSample = numSamples;
    }

    return {
        channels,
        sampleRate,
        codec,
        interleave,
        interleaveLast,
        startOffset,
        headerSize,
        dataSize: payloadSize,
        numSamples,
        loopFlag: hasLoop,
        loopStartSample,
        loopEndSample,
    };
}

class GenhBackendAdapter extends ScriptNodeBackendAdapter {
    constructor() {
        super(2, 2, new BaseFileMapper());

        this._data = null;
        this._header = null;

        this._codec = -1;
        this._channels = 2;
        this._sampleRate = 44100;
        this._numSamples = 0;
        this._loopStart = 0;
        this._loopEnd = 0;
        this._hasLoop = false;

        this._cursorSample = 0;
        this._payloadStart = 0;
        this._payloadSize = 0;
        this._payloadEnd = 0;
        this._chunkFramesTarget = GENH_CHUNK_FRAMES;

        this._interleave = 0;
        this._interleaveLast = 0;
        this._hist = [];

        this._psxFrameOffsets = [];
        this._psxFrameCount = 0;
        this._psxDecodedFrameIndex = -1;
        this._psxFrameCache = [];

        this._pcm = new Int16Array(0);
        this._pcmFrames = 0;

        this._songInfo = {
            title: 'GENH Audio',
            game: '',
            detail: '',
        };
    }

    isAdapterReady() {
        return true;
    }

    teardown() {
        super.teardown();
        this._data = null;
        this._header = null;
        this._pcm = new Int16Array(0);
        this._pcmFrames = 0;
        this._psxFrameOffsets = [];
        this._psxFrameCount = 0;
        this._psxFrameCache = [];
    }

    getChannels() {
        return this._channels;
    }

    loadMusicData(sampleRate, path, filename, data) {
        let input = data;
        if (input instanceof ArrayBuffer) {
            input = new Uint8Array(input);
        }
        if (!(input instanceof Uint8Array) || !input.length) {
            return -1;
        }

        const header = parseGenhHeader(input);
        if (!header) {
            return -1;
        }

        this._data = input;
        this._header = header;

        this._codec = header.codec;
        this._channels = header.channels;
        this._sampleRate = header.sampleRate;
        this._numSamples = header.numSamples;
        this._loopStart = header.loopStartSample;
        this._loopEnd = header.loopEndSample;
        this._hasLoop = header.loopFlag;

        this._cursorSample = 0;
        this._payloadStart = header.startOffset;
        this._payloadSize = header.dataSize;
        this._payloadEnd = this._payloadStart + this._payloadSize;

        this._interleave = header.interleave;
        this._interleaveLast = header.interleaveLast;

        this._pcmFrames = 0;
        this._psxDecodedFrameIndex = -1;
        this._initDecodeState();

        if (this._codec === GENH_CODEC_PSX) {
            if (!this._preparePsxFrames()) {
                return -1;
            }
        }

        this.resetSampleRate(sampleRate, this._sampleRate);
        this._buildSongInfo(filename);
        return 0;
    }

    computeAudioSamples() {
        if (!this._data || this._cursorSample >= this._numSamples) {
            this._pcmFrames = 0;
            return 1;
        }

        const remaining = this._numSamples - this._cursorSample;
        const targetFrames = Math.min(this._chunkFramesTarget, remaining);
        if (targetFrames <= 0) {
            this._pcmFrames = 0;
            return 1;
        }

        this._ensurePcmCapacity(targetFrames);

        const produced = this._codec === GENH_CODEC_PCM16LE
            ? this._decodePcm16leChunk(targetFrames)
            : this._decodePsxChunk(targetFrames);

        this._pcmFrames = produced;
        if (produced <= 0) {
            return 1;
        }
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
        if (!this._sampleRate || !this._numSamples) return 0;
        return Math.round((this._numSamples / this._sampleRate) * 1000);
    }

    getPlaybackPosition() {
        if (!this._sampleRate || !this._cursorSample) return 0;
        return Math.round((this._cursorSample / this._sampleRate) * 1000);
    }

    seekPlaybackPosition(ms) {
        const clampedMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
        const targetSample = Math.max(
            0,
            Math.min(this._numSamples, Math.floor((clampedMs / 1000) * this._sampleRate))
        );

        if (this._codec === GENH_CODEC_PCM16LE) {
            this._cursorSample = targetSample;
        } else {
            this._initDecodeState();
            this._cursorSample = 0;
            this._psxDecodedFrameIndex = -1;
            this._fastForwardPsx(targetSample);
        }

        this._pcmFrames = 0;
        this._transformer.seekPosition(clampedMs);
    }

    _buildSongInfo(filename) {
        const fallback = 'GENH Audio';
        const name = typeof filename === 'string' ? filename : '';
        const leaf = name.split('/').pop() || name.split('\\').pop() || fallback;
        const dot = leaf.lastIndexOf('.');
        const title = dot > 0 ? leaf.slice(0, dot) : leaf;

        const codecLabel = this._codec === GENH_CODEC_PSX ? 'PSX ADPCM' : 'PCM16LE';
        this._songInfo = {
            title: title || fallback,
            game: '',
            detail: this._sampleRate + ' Hz - ' + this._channels + ' ch - ' + codecLabel,
        };
    }

    _initDecodeState() {
        this._hist = new Array(this._channels);
        this._psxFrameCache = new Array(this._channels);
        for (let ch = 0; ch < this._channels; ch++) {
            this._hist[ch] = { old: 0, older: 0 };
            this._psxFrameCache[ch] = new Int16Array(GENH_SAMPLES_PER_PSX_FRAME);
        }
    }

    _ensurePcmCapacity(frames) {
        const needed = frames * this._channels;
        if (this._pcm.length !== needed) {
            this._pcm = new Int16Array(needed);
        }
    }

    _decodePcm16leChunk(targetFrames) {
        const bytesPerFrame = this._channels * 2;
        if (!bytesPerFrame) return 0;

        let produced = 0;
        let sampleCursor = this._cursorSample;

        while (produced < targetFrames) {
            const absoluteByte = this._payloadStart + (sampleCursor * bytesPerFrame);
            if (absoluteByte + bytesPerFrame > this._payloadEnd) break;

            const outBase = produced * this._channels;
            for (let ch = 0; ch < this._channels; ch++) {
                const byteOffset = absoluteByte + (ch * 2);
                const lo = this._data[byteOffset];
                const hi = this._data[byteOffset + 1];
                let value = lo | (hi << 8);
                if (value & 0x8000) value -= 0x10000;
                this._pcm[outBase + ch] = value;
            }

            produced++;
            sampleCursor++;
        }

        this._cursorSample = sampleCursor;
        return produced;
    }

    _preparePsxFrames() {
        if (this._channels < 1) return false;
        if (this._channels > 2) return false;

        if (this._channels === 1) {
            const single = [];
            for (let off = this._payloadStart; off + GENH_BLOCK_SIZE_PSX <= this._payloadEnd; off += GENH_BLOCK_SIZE_PSX) {
                single.push(off);
            }
            this._psxFrameOffsets = [single];
            this._psxFrameCount = single.length;
            const maxSamples = this._psxFrameCount * GENH_SAMPLES_PER_PSX_FRAME;
            this._numSamples = Math.min(this._numSamples, maxSamples);
            return this._psxFrameCount > 0;
        }

        if (!this._interleave || this._interleave < GENH_BLOCK_SIZE_PSX) {
            return false;
        }

        const offsets = [[], []];
        const perChannelSize = Math.floor(this._payloadSize / this._channels);
        if (perChannelSize <= 0) return false;

        const fullStripeCount = Math.floor(perChannelSize / this._interleave);
        let lastStripeSize = perChannelSize - (fullStripeCount * this._interleave);

        if (this._interleaveLast > 0) {
            lastStripeSize = Math.min(this._interleaveLast, perChannelSize);
        }

        for (let stripe = 0; stripe < fullStripeCount; stripe++) {
            const groupBase = this._payloadStart + (stripe * this._interleave * this._channels);
            for (let ch = 0; ch < this._channels; ch++) {
                const stripeBase = groupBase + (ch * this._interleave);
                const frameCount = Math.floor(this._interleave / GENH_BLOCK_SIZE_PSX);
                for (let frame = 0; frame < frameCount; frame++) {
                    const off = stripeBase + (frame * GENH_BLOCK_SIZE_PSX);
                    if (off + GENH_BLOCK_SIZE_PSX <= this._payloadEnd) {
                        offsets[ch].push(off);
                    }
                }
            }
        }

        if (lastStripeSize >= GENH_BLOCK_SIZE_PSX) {
            const groupBase = this._payloadStart + (fullStripeCount * this._interleave * this._channels);
            for (let ch = 0; ch < this._channels; ch++) {
                const stripeBase = groupBase + (ch * lastStripeSize);
                const frameCount = Math.floor(lastStripeSize / GENH_BLOCK_SIZE_PSX);
                for (let frame = 0; frame < frameCount; frame++) {
                    const off = stripeBase + (frame * GENH_BLOCK_SIZE_PSX);
                    if (off + GENH_BLOCK_SIZE_PSX <= this._payloadEnd) {
                        offsets[ch].push(off);
                    }
                }
            }
        }

        this._psxFrameOffsets = offsets;
        this._psxFrameCount = Math.min(offsets[0].length, offsets[1].length);

        if (this._psxFrameCount <= 0) return false;

        const maxSamples = this._psxFrameCount * GENH_SAMPLES_PER_PSX_FRAME;
        this._numSamples = Math.min(this._numSamples, maxSamples);
        return true;
    }

    _decodePsxFrameChannel(frameOffset, channel) {
        const hist = this._hist[channel];
        const out = this._psxFrameCache[channel];

        const predict = this._data[frameOffset];
        const shift = predict & 0x0f;
        const filter = (predict >> 4) & 0x0f;
        const f0 = PSX_F0[filter] || 0;
        const f1 = PSX_F1[filter] || 0;

        let old = hist.old;
        let older = hist.older;

        let outPos = 0;
        for (let i = 0; i < 14; i++) {
            const packed = this._data[frameOffset + 2 + i];

            const lowNib = signed4bit(packed & 0x0f);
            const lowSample = clamp16((lowNib << (12 - shift)) + ((old * f0 + older * f1 + 32) >> 6));
            out[outPos++] = lowSample;
            older = old;
            old = lowSample;

            const highNib = signed4bit((packed >> 4) & 0x0f);
            const highSample = clamp16((highNib << (12 - shift)) + ((old * f0 + older * f1 + 32) >> 6));
            out[outPos++] = highSample;
            older = old;
            old = highSample;
        }

        hist.old = old;
        hist.older = older;
    }

    _decodePsxFrame(frameIndex) {
        if (frameIndex < 0 || frameIndex >= this._psxFrameCount) {
            return false;
        }

        for (let ch = 0; ch < this._channels; ch++) {
            const channelFrames = this._psxFrameOffsets[ch];
            const frameOffset = channelFrames[frameIndex];
            if (!Number.isFinite(frameOffset) || frameOffset + GENH_BLOCK_SIZE_PSX > this._payloadEnd) {
                return false;
            }
            this._decodePsxFrameChannel(frameOffset, ch);
        }

        this._psxDecodedFrameIndex = frameIndex;
        return true;
    }

    _decodePsxChunk(targetFrames) {
        let produced = 0;

        while (produced < targetFrames && this._cursorSample < this._numSamples) {
            const frameIndex = Math.floor(this._cursorSample / GENH_SAMPLES_PER_PSX_FRAME);
            if (frameIndex >= this._psxFrameCount) break;

            if (this._psxDecodedFrameIndex !== frameIndex) {
                if (!this._decodePsxFrame(frameIndex)) {
                    break;
                }
            }

            let sampleInFrame = this._cursorSample % GENH_SAMPLES_PER_PSX_FRAME;
            const frameRemaining = GENH_SAMPLES_PER_PSX_FRAME - sampleInFrame;
            const songRemaining = this._numSamples - this._cursorSample;
            const toCopy = Math.min(targetFrames - produced, frameRemaining, songRemaining);

            for (let i = 0; i < toCopy; i++) {
                const outBase = (produced + i) * this._channels;
                const srcIdx = sampleInFrame + i;
                for (let ch = 0; ch < this._channels; ch++) {
                    this._pcm[outBase + ch] = this._psxFrameCache[ch][srcIdx];
                }
            }

            produced += toCopy;
            this._cursorSample += toCopy;
            sampleInFrame += toCopy;
        }

        return produced;
    }

    _fastForwardPsx(targetSample) {
        while (this._cursorSample < targetSample) {
            const frameIndex = Math.floor(this._cursorSample / GENH_SAMPLES_PER_PSX_FRAME);
            if (frameIndex >= this._psxFrameCount) {
                this._cursorSample = this._numSamples;
                break;
            }

            if (this._psxDecodedFrameIndex !== frameIndex) {
                if (!this._decodePsxFrame(frameIndex)) {
                    this._cursorSample = this._numSamples;
                    break;
                }
            }

            const sampleInFrame = this._cursorSample % GENH_SAMPLES_PER_PSX_FRAME;
            const frameRemaining = GENH_SAMPLES_PER_PSX_FRAME - sampleInFrame;
            const toSkip = Math.min(frameRemaining, targetSample - this._cursorSample);
            this._cursorSample += toSkip;
        }
    }
}

window.GenhBackendAdapter = GenhBackendAdapter;
window.spp_backend_state_GENH = { notReady: false };
